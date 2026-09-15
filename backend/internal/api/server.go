// Package api expone el core Go por HTTP para la interfaz de React y para
// cualquier cliente local (curl, scripts, la CLI).
//
// El daemon escucha solo en 127.0.0.1: es un servicio de escritorio, no un
// servidor en red, y no tiene autenticación a propósito.
package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/ismaelosuna/saveme/backend/internal/config"
	"github.com/ismaelosuna/saveme/backend/internal/domain"
	"github.com/ismaelosuna/saveme/backend/internal/service"
	"github.com/ismaelosuna/saveme/backend/internal/store"
	"github.com/ismaelosuna/saveme/backend/internal/workspace"
)

// Server es el handler HTTP del core.
type Server struct {
	svc     *service.Service
	cfg     config.Config
	version string
	started time.Time
	hub     *hub
	log     *slog.Logger

	// port es el puerto en el que el daemon escucha de verdad, que no siempre
	// coincide con el configurado: si estaba ocupado se prueba el siguiente.
	// Reportar el configurado haría que un cliente que lee /health se conectara
	// a un puerto donde no hay nada.
	port int

	// rootChangePending avisa que el usuario cambió la carpeta del workspace y
	// hace falta reiniciar el proceso para que el cambio tenga efecto.
	rootChangePending bool
}

// New construye el servidor. boundPort es el puerto realmente abierto, que
// puede no ser el configurado si estaba ocupado.
func New(svc *service.Service, cfg config.Config, version string, boundPort int, log *slog.Logger) *Server {
	if log == nil {
		log = slog.Default()
	}
	return &Server{
		svc:     svc,
		cfg:     cfg,
		version: version,
		port:    boundPort,
		started: time.Now(),
		hub:     newHub(),
		log:     log,
	}
}

// Handler devuelve el mux con todas las rutas.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/health", s.handleHealth)
	mux.HandleFunc("GET /api/config", s.handleGetConfig)
	mux.HandleFunc("PUT /api/config", s.handlePutConfig)
	mux.HandleFunc("GET /api/categories", s.handleCategories)
	mux.HandleFunc("GET /api/stats", s.handleStats)
	mux.HandleFunc("GET /api/tags", s.handleTags)
	mux.HandleFunc("GET /api/agents/guide", s.handleGuide)

	mux.HandleFunc("GET /api/projects", s.handleListProjects)
	mux.HandleFunc("POST /api/projects", s.handleCreateProject)
	mux.HandleFunc("GET /api/projects/{slug}", s.handleGetProject)
	// Todo el proyecto en una respuesta, para poder exportarlo a un documento.
	mux.HandleFunc("GET /api/projects/{slug}/export", s.handleExportProject)
	mux.HandleFunc("GET /api/projects/{slug}/briefing", s.handleBriefing)
	mux.HandleFunc("GET /api/projects/{slug}/activity", s.handleActivity)
	mux.HandleFunc("GET /api/projects/{slug}/changelog", s.handleChangelog)
	mux.HandleFunc("DELETE /api/projects/{slug}", s.handleDeleteProject)

	mux.HandleFunc("GET /api/summaries", s.handleListSummaries)
	// Escribir un resumen desde la interfaz. Va aparte del PUT, que edita uno que
	// ya existe y compite con el editor.
	mux.HandleFunc("POST /api/summaries", s.handleCreateSummary)
	mux.HandleFunc("GET /api/summaries/{id}", s.handleGetSummary)
	mux.HandleFunc("PUT /api/summaries/{id}", s.handleSaveSummary)
	// Cambiar categoría y título. Va aparte del PUT porque el PUT guarda
	// **contenido** con hash base y puede fallar por conflicto de edición; esto no
	// toca el cuerpo y no compite con nadie.
	mux.HandleFunc("PATCH /api/summaries/{id}", s.handleUpdateSummaryMeta)
	mux.HandleFunc("DELETE /api/summaries/{id}", s.handleDeleteSummary)
	// Notas: de la interfaz, no del MCP.
	mux.HandleFunc("GET /api/notes/tree", s.handleNotesTree)
	mux.HandleFunc("GET /api/notes/file", s.handleNoteRead)
	mux.HandleFunc("PUT /api/notes/file", s.handleNoteSave)
	mux.HandleFunc("POST /api/notes/create", s.handleNoteCreate)
	mux.HandleFunc("POST /api/notes/move", s.handleNoteMove)
	mux.HandleFunc("DELETE /api/notes/file", s.handleNoteDelete)
	mux.HandleFunc("GET /api/notes/search", s.handleNoteSearch)
	mux.HandleFunc("GET /api/trash", s.handleTrash)
	mux.HandleFunc("POST /api/trash/restore", s.handleRestore)
	mux.HandleFunc("DELETE /api/trash", s.handleEmptyTrash)
	mux.HandleFunc("GET /api/summaries/{id}/raw", s.handleRawSummary)

	// Lo hecho en un rango de fechas, cruzando todos los proyectos.
	mux.HandleFunc("GET /api/digest", s.handleDigest)

	mux.HandleFunc("GET /api/proposals", s.handleListProposals)
	mux.HandleFunc("GET /api/proposals/{token}", s.handleGetProposal)
	// El diff va aparte y no dentro del listado: son varios kilobytes por
	// propuesta y casi nunca se miran todas.
	mux.HandleFunc("GET /api/proposals/{token}/diff", s.handleProposalDiff)
	mux.HandleFunc("POST /api/proposals/{token}/confirm", s.handleConfirmProposal)
	mux.HandleFunc("POST /api/proposals/{token}/cancel", s.handleCancelProposal)

	mux.HandleFunc("GET /api/mcp/providers", s.handleMCPProviders)
	mux.HandleFunc("POST /api/mcp/install", s.handleMCPInstall)
	mux.HandleFunc("POST /api/mcp/configure", s.handleMCPConfigure)
	mux.HandleFunc("POST /api/mcp/unconfigure", s.handleMCPUnconfigure)
	mux.HandleFunc("GET /api/mcp/snippet", s.handleMCPSnippet)

	mux.HandleFunc("POST /api/reindex", s.handleReindex)
	mux.HandleFunc("GET /api/events", s.handleEvents)

	return withCORS(withLogging(mux, s.log))
}

// StartEventPump mantiene caliente el hub SSE.
//
// En vez de que cada capa empuje eventos al hub, el hub hace tail de la tabla
// `events`. Eso hace que los eventos generados por OTRO proceso (el servidor
// MCP corriendo en la sesión del agente, con la app cerrada) lleguen igual a la
// interfaz en cuanto se levanten: el canal de comunicación es la base, no la
// memoria.
func (s *Server) StartEventPump(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(400 * time.Millisecond)
		defer ticker.Stop()

		last, err := s.svc.Store().LastEventID(ctx)
		if err != nil {
			s.log.Warn("no pude leer el último evento, arranco desde cero", "err", err)
		}

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				events, err := s.svc.Store().EventsSince(ctx, last, 200)
				if err != nil {
					s.log.Warn("no pude leer eventos", "err", err)
					continue
				}
				for _, ev := range events {
					last = ev.ID
					s.hub.broadcast(ev)
				}
			}
		}
	}()
}

// --- handlers de metadatos ---------------------------------------------------

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":        true,
		"version":   s.version,
		"uptime_ms": time.Since(s.started).Milliseconds(),
		"root_dir":  s.svc.Workspace().Root(),
		"db_path":   s.svc.Store().Path(),
		"using_fts": s.svc.Store().UsesFTS(),
		"port":      s.port,
	})
}

func (s *Server) handleGetConfig(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.currentConfig())
}

func (s *Server) currentConfig() map[string]any {
	return map[string]any{
		"version":       s.cfg.Version,
		"root_dir":      s.svc.Workspace().Root(),
		"port":          s.cfg.Port,
		"theme":         s.cfg.Theme,
		"opacity":       s.cfg.Opacity,
		"language":      s.cfg.Language,
		"editor":        s.cfg.Editor,
		"onboarded":     s.cfg.Onboarded,
		"root_from_env": s.cfg.RootFromEnv,
		// `created` avisa de que la raíz no existía y se ha creado vacía en este
		// arranque. La interfaz lo usa para avisar de que puede que el usuario
		// haya movido su carpeta, en vez de dar por bueno el workspace vacío.
		"root_state":          rootState(s.cfg),
		"root_suggestions":    s.cfg.RootSuggestions,
		"root_change_pending": s.rootChangePending,
		"config_path":         s.cfg.Path,
	}
}

// handlePutConfig actualiza preferencias.
//
// Cambiar root_dir exige reiniciar el proceso, porque el workspace y la conexión
// a SQLite se abren una sola vez al arrancar. En vez de mentir diciendo que se
// aplicó, se persiste el cambio y se responde `restart_required: true` para que
// la interfaz lo diga con todas las letras.
func (s *Server) handlePutConfig(w http.ResponseWriter, r *http.Request) {
	// Todos los campos son punteros para poder distinguir "no lo mandé" de "lo
	// mandé con el valor cero". Con un struct de valores, un parche parcial
	// —`{"editor":{"preview_mode":"live"}}`— pisaría `wrap` a false y
	// `autosave_ms` a 0, porque los campos ausentes llegan como cero.
	var body struct {
		RootDir  *string `json:"root_dir"`
		Theme    *string `json:"theme"`
		Opacity  *int    `json:"opacity"`
		Language *string `json:"language"`
		Editor   *struct {
			FontSize    *int    `json:"font_size"`
			Wrap        *bool   `json:"wrap"`
			PreviewMode *string `json:"preview_mode"`
			AutosaveMs  *int    `json:"autosave_ms"`
			VimMode     *bool   `json:"vim_mode"`
		} `json:"editor"`
		Onboard *bool `json:"onboarded"`
	}
	if !decodeBody(w, r, &body) {
		return
	}

	restartRequired := false
	next := s.cfg

	if body.RootDir != nil {
		clean := strings.TrimSpace(*body.RootDir)
		if clean == "" {
			writeErr(w, http.StatusBadRequest, "invalid_root", "la carpeta raíz no puede estar vacía")
			return
		}
		if clean != s.svc.Workspace().Root() {
			if s.cfg.RootFromEnv {
				writeErr(w, http.StatusConflict, "root_from_env",
					"SAVEME_ROOT está definido en el entorno y gana sobre la configuración; quítalo para poder cambiarla desde aquí")
				return
			}
			next.RootDir = clean
			s.rootChangePending = true
			restartRequired = true
		}
	}
	if body.Opacity != nil {
		// Se acota en vez de rechazar: que un deslizador mande 101 por un redondeo
		// no es un error del usuario, y devolver un 400 por eso sería absurdo.
		next.Opacity = config.ClampOpacity(*body.Opacity)
	}

	if body.Theme != nil {
		next.Theme = *body.Theme
	}
	if body.Language != nil {
		// Solo los idiomas que existen. Un valor desconocido dejaría la interfaz
		// cayendo al español en cada texto sin que nadie supiera por qué.
		lang := strings.TrimSpace(*body.Language)
		switch lang {
		case "", "es", "en":
			next.Language = lang
		default:
			writeErr(w, http.StatusBadRequest, "invalid_language",
				`el idioma debe ser "es", "en" o vacío para usar el del sistema`)
			return
		}
	}
	// Se fusiona campo a campo: solo se toca lo que el cliente mandó de verdad.
	if e := body.Editor; e != nil {
		if e.FontSize != nil && *e.FontSize > 0 {
			next.Editor.FontSize = *e.FontSize
		}
		if e.Wrap != nil {
			next.Editor.Wrap = *e.Wrap
		}
		if e.PreviewMode != nil && *e.PreviewMode != "" {
			next.Editor.PreviewMode = *e.PreviewMode
		}
		if e.AutosaveMs != nil && *e.AutosaveMs >= 0 {
			next.Editor.AutosaveMs = *e.AutosaveMs
		}
		if e.VimMode != nil {
			next.Editor.VimMode = *e.VimMode
		}
	}
	if body.Onboard != nil {
		next.Onboarded = *body.Onboard
	}

	if err := next.Save(); err != nil {
		s.fail(w, r, "config_save_failed", err)
		return
	}
	s.cfg = next

	resp := s.currentConfig()
	resp["restart_required"] = restartRequired
	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) handleCategories(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, domain.Categories())
}

func (s *Server) handleStats(w http.ResponseWriter, r *http.Request) {
	stats, err := s.svc.Stats(r.Context())
	if err != nil {
		s.fail(w, r, "stats_failed", err)
		return
	}
	writeJSON(w, http.StatusOK, stats)
}

func (s *Server) handleTags(w http.ResponseWriter, r *http.Request) {
	tags, err := s.svc.Tags(r.Context())
	if err != nil {
		s.fail(w, r, "tags_failed", err)
		return
	}
	writeJSON(w, http.StatusOK, tags)
}

// --- proyectos ---------------------------------------------------------------

func (s *Server) handleListProjects(w http.ResponseWriter, r *http.Request) {
	projects, err := s.svc.ListProjects(r.Context())
	if err != nil {
		s.fail(w, r, "list_projects_failed", err)
		return
	}
	if projects == nil {
		projects = []domain.Project{}
	}
	writeJSON(w, http.StatusOK, projects)
}

func (s *Server) handleCreateProject(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name string `json:"name"`
		Slug string `json:"slug"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	project, err := s.svc.EnsureProject(r.Context(), body.Name, body.Slug)
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, project)
}

func (s *Server) handleGetProject(w http.ResponseWriter, r *http.Request) {
	project, err := s.svc.GetProject(r.Context(), r.PathValue("slug"))
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, project)
}

func (s *Server) handleDeleteProject(w http.ResponseWriter, r *http.Request) {
	if err := s.svc.DeleteProject(r.Context(), r.PathValue("slug")); err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// --- resúmenes ---------------------------------------------------------------

func (s *Server) handleListSummaries(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	filter := store.SummaryFilter{
		Project:  q.Get("project"),
		Category: q.Get("category"),
		Status:   q.Get("status"),
		Tag:      q.Get("tag"),
		Query:    q.Get("q"),
		Sort:     q.Get("sort"),
		Limit:    atoiDefault(q.Get("limit"), 50),
		Offset:   atoiDefault(q.Get("offset"), 0),
	}
	items, total, err := s.svc.List(r.Context(), filter)
	if err != nil {
		s.fail(w, r, "list_failed", err)
		return
	}
	if items == nil {
		items = []domain.SummaryMeta{}
	}
	filter.Normalize()
	writeJSON(w, http.StatusOK, map[string]any{
		"items":  items,
		"total":  total,
		"limit":  filter.Limit,
		"offset": filter.Offset,
	})
}

func (s *Server) handleGetSummary(w http.ResponseWriter, r *http.Request) {
	meta, body, err := s.svc.Read(r.Context(), r.PathValue("id"))
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"meta": meta, "content": body})
}

func (s *Server) handleRawSummary(w http.ResponseWriter, r *http.Request) {
	meta, raw, err := s.svc.ReadRaw(r.Context(), r.PathValue("id"))
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
	w.Header().Set("X-Saveme-Rel-Path", meta.RelPath)
	w.Header().Set("X-Saveme-Content-Hash", meta.ContentHash)
	w.WriteHeader(http.StatusOK)
	_, _ = io.WriteString(w, raw)
}

func (s *Server) handleSaveSummary(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Content  string `json:"content"`
		BaseHash string `json:"base_hash"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	res, err := s.svc.Save(r.Context(), r.PathValue("id"), body.Content, body.BaseHash)
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	if res.Mismatch {
		// 409 con el contenido actual del disco: el cliente puede ofrecer
		// "recargar" sin una segunda petición ni perder lo que escribió.
		writeJSON(w, http.StatusConflict, map[string]any{
			"error": map[string]any{
				"code":    "hash_mismatch",
				"message": "El archivo cambió en disco desde que lo cargaste.",
			},
			"disk_content": res.DiskContent,
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"meta": res.Meta})
}

func (s *Server) handleDeleteSummary(w http.ResponseWriter, r *http.Request) {
	hard := r.URL.Query().Get("hard") == "true"
	archived, err := s.svc.Delete(r.Context(), r.PathValue("id"), hard)
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "archived_path": archived})
}

// --- papelera ----------------------------------------------------------------

// handleTrash lista lo borrado. No toca el disco más que para leer.
func (s *Server) handleTrash(w http.ResponseWriter, r *http.Request) {
	entries, err := s.svc.Trash(r.Context())
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": entries})
}

// handleRestore devuelve un archivo de la papelera a donde estaba.
func (s *Server) handleRestore(w http.ResponseWriter, r *http.Request) {
	var body struct {
		TrashRel string `json:"trash_rel"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	rel, err := s.svc.Restore(r.Context(), body.TrashRel)
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "rel_path": rel})
}

// handleEmptyTrash borra la papelera de verdad. Es la única operación de la API
// que destruye información sin vuelta atrás.
func (s *Server) handleEmptyTrash(w http.ResponseWriter, r *http.Request) {
	removed, err := s.svc.EmptyTrash(r.Context())
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "removed": removed})
}

// --- propuestas --------------------------------------------------------------

func (s *Server) handleListProposals(w http.ResponseWriter, r *http.Request) {
	status := r.URL.Query().Get("status")
	if status == "" {
		status = domain.ProposalPending
	}
	limit := atoiDefault(r.URL.Query().Get("limit"), 50)

	proposals, err := s.svc.ListProposals(r.Context(), status, limit)
	if err != nil {
		s.fail(w, r, "list_proposals_failed", err)
		return
	}
	if proposals == nil {
		proposals = []domain.Proposal{}
	}
	writeJSON(w, http.StatusOK, proposals)
}

func (s *Server) handleGetProposal(w http.ResponseWriter, r *http.Request) {
	p, err := s.svc.GetProposal(r.Context(), r.PathValue("token"))
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, p)
}

// handleExportProject sirve todo un proyecto para exportarlo a un documento.
//
// Devuelve datos y no el markdown montado: los títulos de sección los lee una
// persona y el idioma solo lo conoce la interfaz.
func (s *Server) handleExportProject(w http.ResponseWriter, r *http.Request) {
	out, err := s.svc.ExportProject(r.Context(), r.PathValue("slug"))
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// handleCreateSummary escribe un resumen nuevo desde la interfaz.
func (s *Server) handleCreateSummary(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Project      string   `json:"project"`
		Title        string   `json:"title"`
		Body         string   `json:"body"`
		Category     string   `json:"category"`
		Summary      string   `json:"summary"`
		Tags         []string `json:"tags"`
		FilesTouched []string `json:"files_touched"`
	}
	if !decodeBody(w, r, &body) {
		return
	}

	res, err := s.svc.CreateNow(r.Context(), domain.CreateRequest{
		Project:      body.Project,
		Title:        body.Title,
		Body:         body.Body,
		Category:     body.Category,
		Summary:      body.Summary,
		Tags:         body.Tags,
		FilesTouched: body.FilesTouched,
		// El autor y el agente distinguen lo que escribió una persona de lo que
		// escribió una máquina, que es lo que permite filtrarlo después.
		Author: "humano",
		Agent:  "ui",
	}, domain.ResolvedViaUI)
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, res)
}

// handleUpdateSummaryMeta cambia la categoría y el título de un resumen.
func (s *Server) handleUpdateSummaryMeta(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Category string `json:"category"`
		Title    string `json:"title"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	meta, err := s.svc.UpdateMeta(r.Context(), r.PathValue("id"), body.Category, body.Title)
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, meta)
}

// handleDigest sirve lo hecho en los últimos días, de todos los proyectos.
func (s *Server) handleDigest(w http.ResponseWriter, r *http.Request) {
	dias := atoiDefault(r.URL.Query().Get("days"), service.DigestDaysPorDefecto)
	out, err := s.svc.Digest(r.Context(), dias)
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// handleBriefing sirve «¿dónde lo dejamos?» de un proyecto.
func (s *Server) handleBriefing(w http.ResponseWriter, r *http.Request) {
	dias := atoiDefault(r.URL.Query().Get("days"), service.BriefingDaysPorDefecto)
	out, err := s.svc.Briefing(r.Context(), r.PathValue("slug"), dias)
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// handleActivity sirve el mapa de actividad de un proyecto: qué días se trabajó y
// cuánto, con los días vacíos incluidos para que la interfaz solo tenga que pintar
// el array que recibe.
func (s *Server) handleActivity(w http.ResponseWriter, r *http.Request) {
	dias := atoiDefault(r.URL.Query().Get("days"), service.ActivityDaysPorDefecto)
	out, err := s.svc.ActivityMap(r.Context(), r.PathValue("slug"), dias)
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// handleChangelog sirve las notas de versión de un proyecto entre dos fechas.
//
// Devuelve **datos, no markdown**: los títulos de sección los pone quien lo lee, y
// el idioma solo lo conoce la interfaz. `until` incluye el día entero.
func (s *Server) handleChangelog(w http.ResponseWriter, r *http.Request) {
	desde, err := parseFechaQuery(r.URL.Query().Get("since"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_date", err.Error())
		return
	}
	hasta, err := parseFechaQuery(r.URL.Query().Get("until"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_date", err.Error())
		return
	}

	out, err := s.svc.ChangelogProject(r.Context(), r.PathValue("slug"), desde, service.EndOfDay(hasta))
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// parseFechaQuery lee una fecha AAAA-MM-DD de la barra de direcciones. Vacío es
// cero, que significa «lo que corresponda»: el servicio pone entonces su ventana
// por defecto.
func parseFechaQuery(valor string) (time.Time, error) {
	valor = strings.TrimSpace(valor)
	if valor == "" {
		return time.Time{}, nil
	}
	fecha, err := time.ParseInLocation("2006-01-02", valor, time.Local)
	if err != nil {
		return time.Time{}, fmt.Errorf("fecha ilegible %q: se espera AAAA-MM-DD", valor)
	}
	return fecha, nil
}

// handleProposalDiff sirve el antes y el después de una propuesta, para poder
// enseñar qué cambia antes de aprobarla.
func (s *Server) handleProposalDiff(w http.ResponseWriter, r *http.Request) {
	diff, err := s.svc.ProposalDiff(r.Context(), r.PathValue("token"))
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, diff)
}

func (s *Server) handleConfirmProposal(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Decision string `json:"decision"`
		Override *struct {
			Project string `json:"project"`
			// Alias tolerado: la interfaz puede mandar el slug con el nombre que
			// usa el resto de la API (`project_slug`). Aceptar los dos evita que
			// un desajuste de nombres haga que el override se ignore en silencio
			// y el archivo acabe en el destino original.
			ProjectSlug string `json:"project_slug"`
			Category    string `json:"category"`
			RelPath     string `json:"rel_path"`
			Title       string `json:"title"`
		} `json:"override"`
	}
	if !decodeBody(w, r, &body) {
		return
	}

	decision := service.Decision{Accepted: true, Via: domain.ResolvedViaUI}
	if body.Override != nil {
		decision.Project = body.Override.Project
		if strings.TrimSpace(decision.Project) == "" {
			decision.Project = body.Override.ProjectSlug
		}
		decision.Category = body.Override.Category
		decision.RelPath = body.Override.RelPath
		decision.Title = body.Override.Title
		if decision.Project != "" || decision.Category != "" || decision.RelPath != "" || decision.Title != "" {
			decision.Accepted = false
		}
	}
	switch strings.ToLower(strings.TrimSpace(body.Decision)) {
	case "", "accepted":
	case "modified":
		decision.Accepted = false
	case "cancelled", "canceled":
		decision.Cancelled = true
	default:
		writeErr(w, http.StatusBadRequest, "invalid_decision",
			`decision debe ser "accepted", "modified" o "cancelled"`)
		return
	}

	res, err := s.svc.Confirm(r.Context(), r.PathValue("token"), decision)
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	if res == nil {
		// Cancelada.
		writeJSON(w, http.StatusOK, map[string]any{"cancelled": true})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"summary":         res.Meta,
		"created":         res.Created,
		"rel_path":        res.RelPath,
		"abs_path":        res.AbsPath,
		"project_created": res.ProjectCreated,
		"resolved_via":    domain.ResolvedViaUI,
	})
}

func (s *Server) handleCancelProposal(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Reason string `json:"reason"`
	}
	if r.ContentLength > 0 && !decodeBody(w, r, &body) {
		return
	}
	if err := s.svc.Cancel(r.Context(), r.PathValue("token"), domain.ResolvedViaUI, body.Reason); err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// --- mantenimiento -----------------------------------------------------------

func (s *Server) handleReindex(w http.ResponseWriter, r *http.Request) {
	hard := r.URL.Query().Get("hard") == "true"
	var (
		res any
		err error
	)
	if hard {
		res, err = s.svc.ResetIndex(r.Context())
	} else {
		res, err = s.svc.Reindex(r.Context())
	}
	if err != nil {
		s.fail(w, r, "reindex_failed", err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// --- SSE ---------------------------------------------------------------------

func (s *Server) handleEvents(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		// Saber hacer streaming es cosa nuestra, no del cliente: pasa por `fail`
		// para que el fallo quede registrado con su causa.
		s.fail(w, r, "no_streaming", errors.New("el servidor no soporta streaming"))
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	ctx := r.Context()

	// Suscribirse ANTES de leer el histórico, y luego descartar por id lo que ya
	// se mandó: así ningún evento se pierde en la ventana entre "leo el
	// histórico" y "empiezo a escuchar".
	ch, cancel := s.hub.subscribe()
	defer cancel()

	// Un cliente que reconecta manda Last-Event-ID; se le reenvía lo que se
	// perdió. Si no lo manda, se empieza desde el presente.
	startID := int64(0)
	if raw := r.Header.Get("Last-Event-ID"); raw != "" {
		if v, err := strconv.ParseInt(raw, 10, 64); err == nil {
			startID = v
		}
	} else if v, err := s.svc.Store().LastEventID(ctx); err == nil {
		startID = v
	}

	sent := startID
	if startID > 0 {
		if missed, err := s.svc.Store().EventsSince(ctx, startID, 500); err == nil {
			for _, ev := range missed {
				if err := writeSSE(w, ev); err != nil {
					return
				}
				sent = ev.ID
			}
		}
	}

	// Saludo: confirma al cliente que el canal está vivo y le dice dónde está
	// parado, para que su barra de estado pueda mostrarlo.
	if err := writeSSE(w, store.Event{
		ID:      sent,
		TS:      time.Now().UTC(),
		Type:    store.EventHello,
		Payload: map[string]any{"root_dir": s.svc.Workspace().Root(), "resume_from": sent},
	}); err != nil {
		return
	}
	flusher.Flush()

	keepalive := time.NewTicker(25 * time.Second)
	defer keepalive.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case ev, ok := <-ch:
			if !ok {
				// El hub cerró la suscripción por ir lenta. El cliente
				// reconecta solo y reenvía lo perdido desde Last-Event-ID.
				return
			}
			if ev.ID <= sent {
				continue // ya lo mandamos en el histórico
			}
			if err := writeSSE(w, ev); err != nil {
				return
			}
			sent = ev.ID
			flusher.Flush()
		case <-keepalive.C:
			// Un comentario SSE mantiene viva la conexión a través de proxies
			// sin ensuciar el flujo de eventos del cliente.
			if _, err := io.WriteString(w, ": keepalive\n\n"); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

func writeSSE(w io.Writer, ev store.Event) error {
	payload, err := json.Marshal(ev)
	if err != nil {
		return err
	}
	if _, err := fmt.Fprintf(w, "id: %d\nevent: %s\ndata: %s\n\n", ev.ID, ev.Type, payload); err != nil {
		return err
	}
	return nil
}

// --- helpers -----------------------------------------------------------------

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if v == nil {
		return
	}
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(v)
}

func writeErr(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{
		"error": map[string]any{"code": code, "message": message},
	})
}

// fail es el único sitio que produce un 5xx. Hace las tres cosas que antes no
// hacía nadie: distinguir la cancelación del cliente de un fallo del servidor,
// dejar rastro de la causa, y responder.
//
// Lo de la cancelación importa más de lo que parece. La interfaz aborta
// peticiones —React monta los efectos dos veces en desarrollo y React Query
// cancela la que ya no necesita—, y eso llegaba aquí como un `context.Canceled`
// que se traducía a un 500. Salían 500 en cada arranque que no significaban
// nada; y como la causa no se registraba en ninguna parte, tapaban a los de
// verdad. Un 500 sin explicación en el log es peor que no tener log.
func (s *Server) fail(w http.ResponseWriter, r *http.Request, code string, err error) {
	// El cliente ya no está escuchando: no hay a quién contestar y no es un fallo
	// nuestro. No se escribe respuesta a propósito.
	if errors.Is(err, context.Canceled) {
		s.log.Debug("petición cancelada por el cliente",
			"method", r.Method, "path", r.URL.Path, "code", code)
		return
	}
	// Este se registra distinto: si el cliente se cansó de esperar, puede ser que
	// el servidor sea lento, y eso sí es cosa nuestra.
	if errors.Is(err, context.DeadlineExceeded) {
		s.log.Warn("el cliente agotó el tiempo de espera",
			"method", r.Method, "path", r.URL.Path, "code", code)
		return
	}

	// A partir de aquí es un fallo real. Se registra con la causa antes de
	// responder: el mensaje de la respuesta lo lee el usuario, esto lo lee quien
	// depura.
	s.log.Error("fallo del servidor",
		"method", r.Method, "path", r.URL.Path, "code", code, "err", err)

	writeErr(w, http.StatusInternalServerError, code, err.Error())
}

// writeServiceError traduce los errores de dominio a códigos HTTP. Es el único
// lugar donde se hace ese mapeo, para que todos los endpoints respondan igual.
func (s *Server) writeServiceError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, service.ErrInvalid):
		writeErr(w, http.StatusBadRequest, "invalid", err.Error())
	case errors.Is(err, service.ErrProposalNotFound):
		writeErr(w, http.StatusNotFound, "proposal_not_found", err.Error())
	case errors.Is(err, service.ErrProposalExpired):
		writeErr(w, http.StatusGone, "proposal_expired", err.Error())
	case errors.Is(err, service.ErrProposalResolved):
		writeErr(w, http.StatusConflict, "proposal_resolved", err.Error())
	// El destino ya está ocupado. Es un 409 y no un 500 porque no es un fallo del
	// servidor: es un conflicto con el estado del disco, y el cliente puede
	// resolverlo (mover o borrar lo que estorba) y reintentar.
	case errors.As(err, new(*workspace.ExistsError)):
		writeErr(w, http.StatusConflict, "already_exists", err.Error())
	// Mover una carpeta dentro de sí misma no es un fallo del servidor: es una
	// petición que no tiene sentido, y el cliente tiene que poder distinguirla.
	case errors.As(err, new(*workspace.IntoItselfError)):
		writeErr(w, http.StatusBadRequest, "into_itself", err.Error())
	case errors.Is(err, service.ErrNotFound), errors.Is(err, store.ErrNotFound):
		writeErr(w, http.StatusNotFound, "not_found", err.Error())
	default:
		s.fail(w, r, "internal", err)
	}
}

func decodeBody(w http.ResponseWriter, r *http.Request, dst any) bool {
	defer r.Body.Close()
	dec := json.NewDecoder(io.LimitReader(r.Body, 8<<20)) // 8 MiB: un resumen no es un binario
	if err := dec.Decode(dst); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_json", "cuerpo JSON inválido: "+err.Error())
		return false
	}
	return true
}

func atoiDefault(s string, def int) int {
	if s == "" {
		return def
	}
	v, err := strconv.Atoi(s)
	if err != nil {
		return def
	}
	return v
}

// withCORS permite que la UI servida por Vite en otro puerto hable con el core
// durante el desarrollo. El daemon solo escucha en loopback, así que abrir CORS
// no expone nada a la red.
func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" && isLocalOrigin(origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Last-Event-ID")
			w.Header().Set("Access-Control-Expose-Headers", "X-Saveme-Rel-Path, X-Saveme-Content-Hash")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func isLocalOrigin(origin string) bool {
	for _, prefix := range []string{
		"http://localhost:", "http://127.0.0.1:", "tauri://", "http://tauri.localhost",
		"https://tauri.localhost",
	} {
		if strings.HasPrefix(origin, prefix) {
			return true
		}
	}
	return false
}

func withLogging(next http.Handler, log *slog.Logger) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// El stream SSE es de larga duración: no tiene sentido medirlo.
		if r.URL.Path == "/api/events" {
			next.ServeHTTP(w, r)
			return
		}
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		log.Debug("http",
			"method", r.Method, "path", r.URL.Path,
			"status", rec.status, "ms", time.Since(start).Milliseconds())
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

// rootState resume si la raíz se acaba de crear o ya estaba.
//
// Se manda como cadena y no como booleano porque mañana puede haber más estados
// —raíz ilegible, raíz que no es un workspace— y un booleano obligaría a cambiar
// el contrato.
func rootState(cfg config.Config) string {
	if cfg.RootWasCreated {
		return "created"
	}
	return "ok"
}
