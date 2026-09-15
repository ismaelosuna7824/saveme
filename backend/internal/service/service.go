// Package service contiene los casos de uso de SaveMe.
//
// Es la única capa que coordina el filesystem (workspace), el índice (store) y
// el formato de documento (markdown). Tanto la API HTTP como el servidor MCP
// entran por aquí, así que las reglas de negocio se aplican una sola vez y no
// pueden divergir entre las dos puertas de entrada.
package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/ismaelosuna/saveme/backend/internal/domain"
	"github.com/ismaelosuna/saveme/backend/internal/markdown"
	"github.com/ismaelosuna/saveme/backend/internal/store"
	"github.com/ismaelosuna/saveme/backend/internal/workspace"
)

// ProposalTTL es cuánto vive una propuesta sin resolver. Quince minutos son
// suficientes para que un humano lea, pregunte y decida, y suficientemente
// cortos para que un token olvidado no quede armado indefinidamente.
const ProposalTTL = 15 * time.Minute

// Errores de dominio, para que las capas de arriba puedan mapearlos a códigos
// HTTP o a mensajes para el agente sin inspeccionar strings.
var (
	// ErrProposalNotFound: el token no existe.
	ErrProposalNotFound = errors.New("la propuesta no existe o el token es inválido")
	// ErrProposalExpired: el token venció.
	ErrProposalExpired = errors.New("la propuesta expiró; vuelve a proponerla")
	// ErrProposalResolved: el token ya se usó.
	ErrProposalResolved = errors.New("la propuesta ya fue resuelta")
	// ErrHashMismatch: el archivo cambió en disco desde que se cargó.
	ErrHashMismatch = errors.New("el archivo cambió en disco desde que lo cargaste")
	// ErrNotFound: el recurso no existe.
	ErrNotFound = errors.New("no encontrado")
	// ErrInvalid: la entrada no es válida.
	ErrInvalid = errors.New("entrada inválida")
)

// Service orquesta el workspace, el índice y el formato de documento.
type Service struct {
	ws *workspace.Workspace
	st *store.Store

	// mu serializa las escrituras dentro del proceso. El token de un solo uso
	// ya protege contra dobles confirmaciones entre procesos (lo garantiza el
	// UPDATE condicional de SQLite), pero serializar aquí evita además que dos
	// escrituras simultáneas compitan por el mismo nombre de archivo.
	mu sync.Mutex
}

// New construye el servicio.
func New(ws *workspace.Workspace, st *store.Store) *Service {
	st.SetRoot(ws.Root())
	return &Service{ws: ws, st: st}
}

// Workspace expone el workspace subyacente.
func (s *Service) Workspace() *workspace.Workspace { return s.ws }

// Store expone el índice subyacente.
func (s *Service) Store() *store.Store { return s.st }

// --- proyectos ---------------------------------------------------------------

// EnsureProject crea las carpetas de un proyecto y lo registra en el índice.
//
// Si el proyecto ya existe en disco pero no en el índice (por ejemplo porque
// alguien copió la carpeta a mano), se registra igual: el índice es derivado y
// debe converger al disco, no al revés.
func (s *Service) EnsureProject(ctx context.Context, name, slug string) (domain.Project, error) {
	if strings.TrimSpace(name) == "" && strings.TrimSpace(slug) == "" {
		return domain.Project{}, fmt.Errorf("%w: hace falta el nombre del proyecto", ErrInvalid)
	}
	if slug == "" {
		slug = domain.SlugTruncated(name)
	}
	if err := domain.ValidateSlug(slug); err != nil {
		return domain.Project{}, fmt.Errorf("%w: %v", ErrInvalid, err)
	}
	if name == "" {
		name = slug
	}

	existed := s.ws.ProjectExists(slug)
	if existing, err := s.st.GetProject(ctx, slug); err == nil && existed {
		return existing, nil
	}

	if err := s.ws.EnsureProject(slug); err != nil {
		return domain.Project{}, err
	}

	now := time.Now().UTC()
	p := domain.Project{
		Slug:      slug,
		Name:      name,
		Path:      s.ws.ProjectDir(slug),
		CreatedAt: now,
		UpdatedAt: now,
		Counts:    map[string]int{},
	}
	if err := s.st.UpsertProject(ctx, p); err != nil {
		return domain.Project{}, err
	}
	if !existed {
		_, _ = s.st.AppendEvent(ctx, store.EventProjectCreated, map[string]any{
			"slug": slug,
			"name": name,
		})
	}
	return s.st.GetProject(ctx, slug)
}

// ListProjects devuelve todos los proyectos conocidos.
func (s *Service) ListProjects(ctx context.Context) ([]domain.Project, error) {
	return s.st.ListProjects(ctx)
}

// GetProject devuelve un proyecto por slug.
func (s *Service) GetProject(ctx context.Context, slug string) (domain.Project, error) {
	p, err := s.st.GetProject(ctx, slug)
	if errors.Is(err, store.ErrNotFound) {
		return p, fmt.Errorf("%w: el proyecto %q no existe", ErrNotFound, slug)
	}
	return p, err
}

// DeleteProject archiva un proyecto: mueve su carpeta a la papelera del
// workspace y lo saca del índice. Nunca borra archivos de forma irreversible.
func (s *Service) DeleteProject(ctx context.Context, slug string) error {
	if _, err := s.st.GetProject(ctx, slug); errors.Is(err, store.ErrNotFound) {
		return fmt.Errorf("%w: el proyecto %q no existe", ErrNotFound, slug)
	}
	// El proyecto son muchos archivos, así que se archiva el árbol completo.
	if _, err := s.ws.Delete(slug, false); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("archivar el proyecto %s: %w", slug, err)
	}
	return s.st.DeleteProject(ctx, slug)
}

// --- propuesta ---------------------------------------------------------------

// Prepare es el resultado de preparar una escritura sin ejecutarla.
type Prepare struct {
	Proposal *domain.Proposal
	// AlreadyProposed indica que ya había una propuesta pendiente idéntica. En
	// ese caso se devuelve la misma, para que un agente que reintenta no llene
	// el inbox de duplicados.
	AlreadyProposed bool
	// AlreadySaved indica que ese contenido exacto ya se escribió antes. Se
	// devuelve el resumen existente en vez de crear un duplicado.
	AlreadySaved *domain.SummaryMeta
}

// Propose prepara la escritura de un resumen y devuelve una propuesta que el
// usuario debe aprobar. NO escribe ningún archivo ni crea ninguna carpeta.
//
// Es el primer paso de la garantía "siempre preguntar": el único camino para
// escribir pasa por aquí, y aquí no se toca el disco.
func (s *Service) Propose(ctx context.Context, req domain.CreateRequest) (*Prepare, error) {
	if err := req.Validate(); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalid, err)
	}

	projectSlug := domain.Slug(req.Project)
	if projectSlug == "" {
		projectSlug = domain.SlugTruncated(req.Project)
	}
	if err := domain.ValidateSlug(projectSlug); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalid, err)
	}

	// Categoría: la que pidió el agente si es válida, o la inferida.
	var inference domain.Inference
	var category domain.Category
	if strings.TrimSpace(req.Category) != "" {
		c, ok := domain.CategoryByKey(req.Category)
		if !ok || c.Key == domain.CategoryUncategorized {
			return nil, fmt.Errorf("%w: %q no es una categoría válida; usa una de: %s",
				ErrInvalid, req.Category, strings.Join(domain.CategoryKeys(), ", "))
		}
		category = c
		inference = domain.Inference{
			Category:   c.Key,
			Reason:     "Lo pediste explícitamente.",
			Confidence: 1,
			Evidence:   []string{},
		}
	} else {
		inference = domain.InferCategory(req.Title, req.Body)
		c, _ := domain.CategoryByKey(inference.Category)
		category = c
	}

	now := time.Now().UTC()

	// ¿Esto actualiza un resumen que ya existe o crea uno nuevo?
	//
	// Se aceptan las dos formas de nombrarlo porque las dos son naturales: el id
	// es lo que devuelven las tools de lectura, y la ruta relativa es lo que el
	// agente ve en las propuestas anteriores.
	var target *domain.SummaryMeta
	if raw := strings.TrimSpace(req.Target); raw != "" {
		meta, err := s.st.GetSummary(ctx, raw)
		if errors.Is(err, store.ErrNotFound) {
			meta, err = s.st.GetSummaryByRelPath(ctx, raw)
		}
		if err != nil || meta.ID == "" {
			return nil, fmt.Errorf(
				"%w: no encuentro el resumen %q para actualizarlo; búscalo con saveme_summary_search",
				ErrNotFound, raw)
		}
		target = &meta
	}

	var relPath string
	filename := workspace.SummaryFilename(now, req.Title)
	if target != nil {
		// Una actualización no mueve el archivo: conserva su proyecto, su
		// categoría y su ruta. Moverlo sería un borrado más una escritura, y eso
		// no es lo que pidió nadie.
		projectSlug = target.ProjectSlug
		if c, ok := domain.CategoryByKey(target.Category); ok {
			category = c
		}
		relPath = target.RelPath
	} else {
		dirRel := projectSlug + "/" + category.Folder
		// Se reserva el nombre ahora (solo lectura del disco) para que la ruta que
		// ve el usuario en la propuesta sea exactamente la que se escribirá.
		var err error
		relPath, err = s.ws.UniqueRelPath(dirRel, filename)
		if err != nil {
			return nil, err
		}
	}

	payloadHash := payloadHash(req.Title, category.Key, req.Body)

	// Idempotencia: si este contenido exacto ya se guardó, no crear otro.
	if prev, found, err := s.st.ResolvedProposalExists(ctx, projectSlug, payloadHash); err != nil {
		return nil, err
	} else if found && prev.SummaryID != "" {
		if meta, err := s.st.GetSummary(ctx, prev.SummaryID); err == nil {
			return &Prepare{AlreadySaved: &meta}, nil
		}
	}

	// Y si ya hay una propuesta pendiente idéntica, devolver esa misma.
	if dup, found, err := s.st.FindDuplicateProposal(ctx, projectSlug, relPath, payloadHash); err != nil {
		return nil, err
	} else if found {
		p, err := s.toProposal(ctx, dup)
		if err != nil {
			return nil, err
		}
		return &Prepare{Proposal: p, AlreadyProposed: true}, nil
	}

	alts := domain.Alternatives(req.Title, req.Body, category.Key, 3)
	alternatives := make([]domain.Alternative, 0, len(alts))
	for _, a := range alts {
		altRel, err := s.ws.UniqueRelPath(projectSlug+"/"+a.Folder, filename)
		if err != nil {
			altRel = projectSlug + "/" + a.Folder + "/" + filename
		}
		alternatives = append(alternatives, domain.Alternative{
			Category: a.Key,
			Folder:   a.Folder,
			Label:    a.Label,
			RelPath:  altRel,
		})
	}

	tags := store.TagList(req.Tags)
	summaryLine := strings.TrimSpace(req.Summary)
	if summaryLine == "" {
		summaryLine = markdown.DeriveSummaryLine(req.Body)
	}
	author := req.Author
	if author == "" {
		author = "agent"
	}

	// Si actualiza, la propuesta guarda a quién y cómo estaba. El hash es lo que
	// permitirá detectar, al confirmar, que alguien tocó el archivo por medio.
	var targetID, baseHash string
	if target != nil {
		targetID = target.ID
		baseHash = target.ContentHash
	}

	rec := store.ProposalRecord{
		Token:           domain.NewToken(),
		ProjectSlug:     projectSlug,
		Category:        category.Key,
		Title:           strings.TrimSpace(req.Title),
		RelPath:         relPath,
		Body:            req.Body,
		SummaryLine:     summaryLine,
		PayloadHash:     payloadHash,
		InferenceReason: inference.Reason,
		Confidence:      inference.Confidence,
		Evidence:        inference.Evidence,
		Alternatives:    alternatives,
		CreatedAt:       now,
		ExpiresAt:       now.Add(ProposalTTL),
		Agent:           req.Agent,
		Tags:            tags,
		FilesTouched:    req.FilesTouched,
		CommitSHA:       req.Commit,
		TargetID:        targetID,
		BaseHash:        baseHash,
	}
	if err := s.st.InsertProposal(ctx, rec); err != nil {
		return nil, err
	}

	p, err := s.toProposal(ctx, rec)
	if err != nil {
		return nil, err
	}
	_, _ = s.st.AppendEvent(ctx, store.EventProposalNew, map[string]any{
		"token":        p.Token,
		"project_slug": p.ProjectSlug,
		"category":     p.Category,
		"rel_path":     p.RelPath,
		"title":        p.Title,
		"expires_at":   p.ExpiresAt,
	})
	return &Prepare{Proposal: p}, nil
}

// toProposal convierte la fila del índice en el tipo de dominio que se le
// muestra al usuario, resolviendo la ruta absoluta.
func (s *Service) toProposal(_ context.Context, rec store.ProposalRecord) (*domain.Proposal, error) {
	abs := filepath.Join(s.ws.Root(), filepath.FromSlash(rec.RelPath))
	return &domain.Proposal{
		Token:        rec.Token,
		ProjectSlug:  rec.ProjectSlug,
		Category:     rec.Category,
		Title:        rec.Title,
		RelPath:      rec.RelPath,
		AbsPath:      abs,
		Filename:     filepath.Base(rec.RelPath),
		ExpiresAt:    rec.ExpiresAt,
		CreatedAt:    rec.CreatedAt,
		Status:       rec.Status,
		Inference:    domain.Inference{Category: rec.Category, Reason: rec.InferenceReason, Confidence: rec.Confidence, Evidence: rec.Evidence},
		Alternatives: rec.Alternatives,
		Preview:      rec.Body,
		BodyBytes:    len(rec.Body),
		Agent:        rec.Agent,
		Tags:         rec.Tags,
		FilesTouched: rec.FilesTouched,
		Decision:     rec.Decision,
		ResolvedVia:  rec.ResolvedVia,
		ResolvedAt:   rec.ResolvedAt,
		SummaryID:    rec.SummaryID,
	}, nil
}

// --- confirmación ------------------------------------------------------------

// Decision es lo que el usuario resolvió sobre una propuesta.
type Decision struct {
	// Accepted: guardar tal cual. Modified: guardar con los cambios de Override.
	// Cancelled: no guardar.
	Accepted  bool
	Cancelled bool
	// Via registra cómo se obtuvo la decisión, para auditoría.
	Via string

	// Override permite redirigir el destino. Todos los campos son opcionales.
	Project  string
	Category string
	RelPath  string
	Title    string
}

// WriteResult es el resultado de confirmar una propuesta.
type WriteResult struct {
	Meta domain.SummaryMeta `json:"summary"`
	// Created indica si el archivo se escribió ahora (false si ya existía de una
	// confirmación previa, que es el caso idempotente).
	Created bool   `json:"created"`
	RelPath string `json:"rel_path"`
	AbsPath string `json:"abs_path"`
	// ProjectCreated indica que hubo que crear la carpeta del proyecto.
	ProjectCreated bool `json:"project_created"`
}

// Confirm ejecuta la escritura de una propuesta previamente creada.
//
// Orden de operaciones, que importa para la corrección:
//
//  1. Reclamar el token (UPDATE condicional en SQLite). Si otro proceso ganó la
//     carrera, no se escribe nada y se devuelve lo que ese otro escribió.
//  2. Escribir el archivo y indexarlo.
//  3. Si la escritura falla, liberar el token para que el usuario pueda
//     reintentar sin volver a proponer.
//
// Reclamar antes de escribir es lo que impide que dos confirmaciones
// concurrentes del mismo token produzcan dos archivos.
func (s *Service) Confirm(ctx context.Context, token string, d Decision) (*WriteResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	rec, err := s.st.GetProposal(ctx, token)
	if errors.Is(err, store.ErrNotFound) {
		return nil, ErrProposalNotFound
	}
	if err != nil {
		return nil, err
	}

	switch rec.Status {
	case domain.ProposalConfirmed:
		// Idempotencia: un agente que reintenta tras un timeout merece la
		// respuesta correcta, no un error.
		if rec.SummaryID != "" {
			if meta, err := s.st.GetSummary(ctx, rec.SummaryID); err == nil {
				return &WriteResult{Meta: meta, Created: false, RelPath: meta.RelPath, AbsPath: meta.AbsPath}, nil
			}
		}
		return nil, ErrProposalResolved
	case domain.ProposalCancelled:
		return nil, ErrProposalResolved
	case domain.ProposalExpired:
		// Una propuesta vencida **sí se puede aprobar**. El TTL acota lo que
		// espera el agente, no lo que tarda una persona: el cuerpo sigue en la
		// base, intacto, y rechazarlo convertía una decisión tardía en una
		// pérdida. Lo que de verdad la borra es la purga, y esa llega mucho
		// después; mientras esté, se puede salvar.
	}

	now := time.Now().UTC()
	// Vencida por el reloj **o** porque el barrendero ya la marcó: mirar solo la
	// marca de tiempo dejaría sin anotar el caso más común, que es el que pasó por
	// la limpieza periódica.
	tarde := rec.Status == domain.ProposalExpired || now.After(rec.ExpiresAt)

	// Quién puede aprobar tarde es la mitad que importa de esta regla.
	//
	// El TTL protege contra un **agente** que confirma algo que nadie llegó a
	// mirar: ese sigue rechazado, que es lo que promete el plazo. Pero una persona
	// decidiendo tarde **es** la aprobación —el cuerpo sigue en la base, intacto, y
	// lo que de verdad lo borra es la purga—, así que a esa no se le puede
	// contestar «llegas tarde» y tirar el trabajo. Y si el resumen que actualiza
	// cambió por el camino, el conflicto de hash lo detiene igual.
	if tarde && !viaHumana(d.Via) {
		return nil, ErrProposalExpired
	}

	if d.Cancelled {
		if _, err := s.st.ResolveProposal(ctx, token, domain.ProposalCancelled, "cancelled", d.Via, "", "", now); err != nil {
			return nil, err
		}
		_, _ = s.st.AppendEvent(ctx, store.EventProposalDone, map[string]any{
			"token": token, "status": domain.ProposalCancelled, "via": d.Via,
		})
		return nil, nil
	}

	// Resolver el destino final aplicando los override del usuario.
	projectSlug := rec.ProjectSlug
	if v := strings.TrimSpace(d.Project); v != "" {
		projectSlug = domain.Slug(v)
		if err := domain.ValidateSlug(projectSlug); err != nil {
			return nil, fmt.Errorf("%w: %v", ErrInvalid, err)
		}
	}

	categoryKey := rec.Category
	if v := strings.TrimSpace(d.Category); v != "" {
		c, ok := domain.CategoryByKey(v)
		if !ok || c.Key == domain.CategoryUncategorized {
			return nil, fmt.Errorf("%w: %q no es una categoría válida; usa una de: %s",
				ErrInvalid, v, strings.Join(domain.CategoryKeys(), ", "))
		}
		categoryKey = c.Key
	}
	category, _ := domain.CategoryByKey(categoryKey)

	title := rec.Title
	if v := strings.TrimSpace(d.Title); v != "" {
		title = v
	}

	// La ruta final: explícita si el usuario la dio, derivada si no.
	var relPath string
	if v := strings.TrimSpace(d.RelPath); v != "" {
		clean, err := s.ws.SafeRel(v)
		if err != nil {
			return nil, fmt.Errorf("%w: %v", ErrInvalid, err)
		}
		if !strings.EqualFold(filepath.Ext(clean), ".md") {
			clean += ".md"
		}
		// La ruta explícita es la intención más fuerte del usuario: de ahí se
		// derivan el proyecto (primer segmento) y la categoría (segundo
		// segmento, si es una carpeta conocida). Si dio una ruta hacia docs/,
		// quiere que sea docs aunque la propuesta dijera features/.
		parts := strings.Split(clean, "/")
		if len(parts) > 1 {
			if strings.TrimSpace(d.Project) == "" {
				projectSlug = parts[0]
				if err := domain.ValidateSlug(projectSlug); err != nil {
					return nil, fmt.Errorf("%w: %v", ErrInvalid, err)
				}
			}
			if strings.TrimSpace(d.Category) == "" {
				if c, ok := domain.CategoryByKey(parts[1]); ok && c.Key != domain.CategoryUncategorized {
					categoryKey = c.Key
					category = c
				}
			}
		}
		relPath = clean
	} else {
		dirRel := projectSlug + "/" + category.Folder
		relPath, err = s.ws.UniqueRelPath(dirRel, workspace.SummaryFilename(now, title))
		if err != nil {
			return nil, err
		}
	}

	// 1. Reclamar el token antes de tocar el disco.
	//
	// El UPDATE condicional de SQLite es lo que hace esto atómico: si dos
	// confirmaciones del mismo token llegan a la vez, solo una reclama y la
	// otra no escribe nada.
	summaryID := domain.NewID()
	if rec.TargetID != "" {
		// Al actualizar, el resumen ya tiene id: la propuesta queda apuntando a él
		// en vez de a uno inventado.
		summaryID = rec.TargetID
	}
	claim := func(path string) (bool, error) {
		via := d.Via
		if tarde {
			// Que quede registrado: no es lo mismo un agente que esperó su turno
			// que alguien que rescató la propuesta media hora después.
			via = d.Via + "+tarde"
		}
		return s.st.ResolveProposal(ctx, token, domain.ProposalConfirmed,
			decisionLabel(d), via, path, summaryID, now)
	}

	claimed, err := claim(relPath)
	if err != nil {
		return nil, err
	}
	if !claimed {
		// Perdimos la carrera contra otra confirmación del mismo token.
		return s.alreadyResolved(ctx, token)
	}

	release := func() {
		// Devolver el token a pendiente para que el usuario pueda reintentar
		// sin tener que volver a proponer.
		_ = s.st.ReleaseProposal(ctx, token)
	}

	// --- Actualización de un resumen que ya existe ---
	//
	// No se crea nada: se reescribe el archivo conservando su identidad (id y fecha
	// de creación) y se comprueba el hash antes, para no pisar lo que haya escrito
	// otra cosa entre la propuesta y la confirmación. Esa comprobación es la razón
	// de que `base_hash` viaje en la propuesta.
	if rec.TargetID != "" {
		return s.applyUpdate(ctx, token, rec, summaryID, now, release)
	}

	projectExisted := s.ws.ProjectExists(projectSlug)
	if _, err := s.EnsureProject(ctx, projectSlug, projectSlug); err != nil {
		release()
		return nil, err
	}

	fm := domain.Frontmatter{
		ID:           summaryID,
		Title:        title,
		Category:     category.Key,
		Project:      projectSlug,
		CreatedAt:    now,
		UpdatedAt:    now,
		Author:       authorFor(rec.Agent),
		Agent:        rec.Agent,
		Status:       domain.StatusConfirmed,
		Summary:      rec.SummaryLine,
		Tags:         rec.Tags,
		FilesTouched: rec.FilesTouched,
		Commit:       rec.CommitSHA,
	}
	content, err := markdown.Render(fm, rec.Body)
	if err != nil {
		release()
		return nil, err
	}

	// 2. Escribir sin pisar nada.
	//
	// Si aparece una colisión real (alguien creó ese archivo entre la propuesta
	// y la confirmación), se libera el token, se recalcula un nombre libre y se
	// vuelve a reclamar. Se libera y se reclama en vez de parchear la ruta
	// después porque la ruta registrada en la propuesta debe ser exactamente la
	// que se escribió, y eso solo se puede garantizar reclamando la definitiva.
	if err := s.ws.WriteAtomic(relPath, content, false); err != nil {
		var exists *workspace.ExistsError
		if !errors.As(err, &exists) {
			release()
			return nil, err
		}
		release()

		alt, altErr := s.ws.UniqueRelPath(filepath.ToSlash(filepath.Dir(relPath)), filepath.Base(relPath))
		if altErr != nil {
			return nil, altErr
		}
		claimed, err = claim(alt)
		if err != nil {
			return nil, err
		}
		if !claimed {
			return s.alreadyResolved(ctx, token)
		}
		if err := s.ws.WriteAtomic(alt, content, false); err != nil {
			release()
			return nil, err
		}
		relPath = alt
	}

	meta, err := s.indexFile(ctx, relPath, content, summaryID, projectSlug, category.Key, title, fm, rec.Body)
	if err != nil {
		release()
		return nil, err
	}

	_, _ = s.st.AppendEvent(ctx, store.EventSummaryCreated, map[string]any{
		"id": meta.ID, "project_slug": meta.ProjectSlug, "category": meta.Category,
		"title": meta.Title, "rel_path": meta.RelPath,
	})
	_, _ = s.st.AppendEvent(ctx, store.EventProposalDone, map[string]any{
		"token": token, "status": domain.ProposalConfirmed, "via": d.Via, "summary_id": summaryID,
	})

	return &WriteResult{
		Meta:           meta,
		Created:        true,
		RelPath:        relPath,
		AbsPath:        meta.AbsPath,
		ProjectCreated: !projectExisted,
	}, nil
}

// indexFile escribe la metadata de un archivo en el índice y registra su
// huella para que el reconciliador no lo vuelva a procesar.
func (s *Service) indexFile(
	ctx context.Context,
	relPath string,
	content []byte,
	summaryID, projectSlug, categoryKey, title string,
	fm domain.Frontmatter,
	body string,
) (domain.SummaryMeta, error) {
	now := time.Now().UTC()
	info, err := os.Stat(filepath.Join(s.ws.Root(), filepath.FromSlash(relPath)))
	var size int64
	var mtimeNs int64
	if err == nil {
		size = info.Size()
		mtimeNs = info.ModTime().UnixNano()
	}

	project, err := s.st.GetProject(ctx, projectSlug)
	if err != nil {
		// El proyecto puede no estar registrado si el archivo se escribió con
		// una ruta explícita hacia un directorio nuevo.
		project = domain.Project{
			Slug: projectSlug, Name: projectSlug,
			Path: s.ws.ProjectDir(projectSlug), CreatedAt: now, UpdatedAt: now,
		}
		if err := s.st.UpsertProject(ctx, project); err != nil {
			return domain.SummaryMeta{}, err
		}
	}

	meta := domain.SummaryMeta{
		ID:           summaryID,
		ProjectSlug:  projectSlug,
		Category:     categoryKey,
		Title:        title,
		SummaryLine:  fm.Summary,
		RelPath:      relPath,
		Status:       fm.Status,
		Author:       fm.Author,
		Agent:        fm.Agent,
		CommitSHA:    fm.Commit,
		Tags:         fm.Tags,
		FilesTouched: fm.FilesTouched,
		Related:      fm.Related,
		WordCount:    domain.WordCount(body),
		SizeBytes:    size,
		CreatedAt:    fm.CreatedAt,
		UpdatedAt:    now,
		ContentHash:  hashBytes(content),
	}
	if meta.CreatedAt.IsZero() {
		meta.CreatedAt = now
	}
	if meta.SummaryLine == "" {
		meta.SummaryLine = markdown.DeriveSummaryLine(body)
	}

	if err := s.st.UpsertSummary(ctx, meta, body); err != nil {
		return domain.SummaryMeta{}, err
	}
	if err := s.st.SetFileState(ctx, store.FileState{
		RelPath: relPath, MtimeNs: mtimeNs, SizeBytes: size,
		ContentHash: meta.ContentHash, IndexedAt: now,
	}); err != nil {
		return domain.SummaryMeta{}, err
	}
	meta.AbsPath = filepath.Join(s.ws.Root(), filepath.FromSlash(relPath))
	return meta, nil
}

// Cancel resuelve una propuesta como descartada.
func (s *Service) Cancel(ctx context.Context, token, via, reason string) error {
	rec, err := s.st.GetProposal(ctx, token)
	if errors.Is(err, store.ErrNotFound) {
		return ErrProposalNotFound
	}
	if err != nil {
		return err
	}
	if rec.Status != domain.ProposalPending {
		return ErrProposalResolved
	}
	ok, err := s.st.ResolveProposal(ctx, token, domain.ProposalCancelled, "cancelled", via, "", "", time.Now().UTC())
	if err != nil {
		return err
	}
	if !ok {
		return ErrProposalResolved
	}
	payload := map[string]any{"token": token, "status": domain.ProposalCancelled, "via": via}
	if reason != "" {
		payload["reason"] = reason
	}
	_, _ = s.st.AppendEvent(ctx, store.EventProposalDone, payload)
	return nil
}

// GetProposal lee una propuesta, marcándola expirada si su TTL ya venció.
func (s *Service) GetProposal(ctx context.Context, token string) (*domain.Proposal, error) {
	rec, err := s.st.GetProposal(ctx, token)
	if errors.Is(err, store.ErrNotFound) {
		return nil, ErrProposalNotFound
	}
	if err != nil {
		return nil, err
	}
	if rec.Status == domain.ProposalPending && time.Now().UTC().After(rec.ExpiresAt) {
		if ok, err := s.st.ResolveProposal(ctx, token, domain.ProposalExpired, "", "", "", "", time.Now().UTC()); err == nil && ok {
			rec.Status = domain.ProposalExpired
		}
	}
	return s.toProposal(ctx, rec)
}

// ProposalDiff es lo que hace falta para enseñar qué cambia una propuesta antes
// de aprobarla.
type ProposalDiff struct {
	RelPath string `json:"rel_path"`
	// Exists distingue «crear» de «actualizar». Sin esto, un archivo que no está
	// y un cuerpo propuesto vacío se leen igual, y son cosas muy distintas.
	Exists bool `json:"exists"`
	// Current es el contenido que hay ahora en disco; vacío si no hay archivo.
	Current string `json:"current"`
	// Proposed es el cuerpo entero que se escribiría al confirmar.
	Proposed string `json:"proposed"`
}

// ProposalDiff devuelve el antes y el después de una propuesta.
//
// El cuerpo completo no viaja en el listado del inbox a propósito: son varios
// kilobytes por propuesta y casi nunca se miran todas. Se pide solo cuando
// alguien despliega una.
//
// Que el archivo no exista **no es un error**: es el caso de una propuesta que
// crea un resumen nuevo, y es la mitad de las veces.
func (s *Service) ProposalDiff(ctx context.Context, token string) (*ProposalDiff, error) {
	rec, err := s.st.GetProposal(ctx, token)
	if errors.Is(err, store.ErrNotFound) {
		return nil, ErrProposalNotFound
	}
	if err != nil {
		return nil, err
	}

	diff := &ProposalDiff{RelPath: rec.RelPath, Proposed: rec.Body}

	current, err := s.ws.ReadFile(rec.RelPath)
	switch {
	case err == nil:
		diff.Exists = true
		diff.Current = string(current)
	case errors.Is(err, fs.ErrNotExist):
		// Todavía no hay archivo: la propuesta lo crea.
	default:
		return nil, err
	}

	return diff, nil
}

// ListProposals devuelve las propuestas de un estado.
func (s *Service) ListProposals(ctx context.Context, status string, limit int) ([]domain.Proposal, error) {
	recs, err := s.st.ListProposals(ctx, status, limit)
	if err != nil {
		return nil, err
	}
	out := make([]domain.Proposal, 0, len(recs))
	for _, rec := range recs {
		p, err := s.toProposal(ctx, rec)
		if err != nil {
			return nil, err
		}
		out = append(out, *p)
	}
	return out, nil
}

// ExpireProposals marca como vencidas las propuestas cuyo TTL pasó. Se llama al
// arrancar y periódicamente.
func (s *Service) ExpireProposals(ctx context.Context) (int, error) {
	return s.st.ExpireStaleProposals(ctx, time.Now().UTC())
}

// --- lectura y edición -------------------------------------------------------

// Read devuelve la metadata y el contenido de un resumen.
//
// El contenido se lee SIEMPRE del archivo, nunca del índice: si el usuario
// editó el markdown por fuera, lo que se muestra es lo que hay en disco.
func (s *Service) Read(ctx context.Context, id string) (domain.SummaryMeta, string, error) {
	meta, err := s.st.GetSummary(ctx, id)
	if errors.Is(err, store.ErrNotFound) {
		return meta, "", fmt.Errorf("%w: el resumen %q no existe", ErrNotFound, id)
	}
	if err != nil {
		return meta, "", err
	}
	data, err := s.ws.ReadFile(meta.RelPath)
	if err != nil {
		return meta, "", fmt.Errorf("leer %s: %w", meta.RelPath, err)
	}
	doc := markdown.Parse(data)
	return meta, doc.Body, nil
}

// ReadRaw devuelve el archivo completo, frontmatter incluido. Es lo que carga
// el editor en modo fuente, porque editar el frontmatter también es parte de
// "md first".
func (s *Service) ReadRaw(ctx context.Context, id string) (domain.SummaryMeta, string, error) {
	meta, err := s.st.GetSummary(ctx, id)
	if errors.Is(err, store.ErrNotFound) {
		return meta, "", fmt.Errorf("%w: el resumen %q no existe", ErrNotFound, id)
	}
	if err != nil {
		return meta, "", err
	}
	data, err := s.ws.ReadFile(meta.RelPath)
	if err != nil {
		return meta, "", fmt.Errorf("leer %s: %w", meta.RelPath, err)
	}
	return meta, string(data), nil
}

// SaveResult es el resultado de guardar una edición.
type SaveResult struct {
	Meta domain.SummaryMeta `json:"meta"`
	// Mismatch indica que el archivo cambió en disco y no se guardó nada.
	Mismatch bool `json:"mismatch"`
	// DiskContent es el contenido actual del disco cuando hay conflicto, para
	// que el editor pueda ofrecer "recargar" sin una segunda petición.
	DiskContent string `json:"disk_content,omitempty"`
}

// Save escribe el contenido editado de un resumen.
//
// El contenido se escribe verbatim: el editor manda el archivo completo,
// frontmatter incluido, y SaveMe no lo reformatea. La concurrencia optimista se
// resuelve con baseHash; si no coincide, no se escribe nada y se devuelve el
// contenido del disco para que el cliente decida.
func (s *Service) Save(ctx context.Context, id, content, baseHash string) (*SaveResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.saveLocked(ctx, id, content, baseHash)
}

// saveLocked es el cuerpo de `Save` para quien **ya tiene el mutex**.
//
// Mismo motivo que `reindexFileLocked`: `sync.Mutex` no es reentrante, así que
// `Confirm` —que bloquea para reclamar el token— no puede llamar a `Save` sin
// quedarse colgado con la app entera detrás.
func (s *Service) saveLocked(ctx context.Context, id, content, baseHash string) (*SaveResult, error) {
	meta, err := s.st.GetSummary(ctx, id)
	if errors.Is(err, store.ErrNotFound) {
		return nil, fmt.Errorf("%w: el resumen %q no existe", ErrNotFound, id)
	}
	if err != nil {
		return nil, err
	}

	current, err := s.ws.ReadFile(meta.RelPath)
	if err != nil {
		return nil, fmt.Errorf("leer %s: %w", meta.RelPath, err)
	}
	currentHash := hashBytes(current)

	if baseHash != "" && baseHash != currentHash {
		return &SaveResult{Mismatch: true, DiskContent: string(current)}, nil
	}
	if baseHash == "" && string(current) != content {
		// Sin hash base no se puede distinguir "el usuario editó" de "alguien
		// cambió el archivo por debajo". Se avisa igual, es lo seguro.
		if meta.ContentHash != "" && meta.ContentHash != currentHash {
			return &SaveResult{Mismatch: true, DiskContent: string(current)}, nil
		}
	}

	if err := s.ws.WriteAtomic(meta.RelPath, []byte(content), true); err != nil {
		return nil, err
	}

	doc := markdown.Parse([]byte(content))
	title := meta.Title
	categoryKey := meta.Category
	summaryLine := meta.SummaryLine
	status := meta.Status
	tags := meta.Tags
	filesTouched := meta.FilesTouched
	related := meta.Related
	agent := meta.Agent
	commit := meta.CommitSHA
	createdAt := meta.CreatedAt

	// Si el archivo mantiene nuestro frontmatter, se honra lo que el usuario
	// escribió ahí: es su archivo. Si lo perdió, se conserva lo que ya sabíamos
	// en vez de degradar el índice.
	if fm := doc.Frontmatter; fm != nil {
		if strings.TrimSpace(fm.Title) != "" {
			title = fm.Title
		}
		if c, ok := domain.CategoryByKey(fm.Category); ok && c.Key != domain.CategoryUncategorized {
			categoryKey = c.Key
		}
		if strings.TrimSpace(fm.Summary) != "" {
			summaryLine = fm.Summary
		}
		if fm.Status != "" {
			status = fm.Status
		}
		if fm.Tags != nil {
			tags = store.TagList(fm.Tags)
		}
		if fm.FilesTouched != nil {
			filesTouched = fm.FilesTouched
		}
		if fm.Related != nil {
			related = fm.Related
		}
		if fm.Agent != "" {
			agent = fm.Agent
		}
		if fm.Commit != "" {
			commit = fm.Commit
		}
		if !fm.CreatedAt.IsZero() {
			createdAt = fm.CreatedAt
		}
	} else {
		// Sin frontmatter: derivar lo que se pueda del cuerpo.
		title = markdown.DeriveTitle(doc.Body, filepath.Base(meta.RelPath))
		summaryLine = markdown.DeriveSummaryLine(doc.Body)
		status = domain.StatusUnmanaged
	}

	fm := domain.Frontmatter{
		ID: meta.ID, Title: title, Category: categoryKey, Project: meta.ProjectSlug,
		CreatedAt: createdAt, UpdatedAt: time.Now().UTC(), Author: meta.Author,
		Agent: agent, Status: status, Summary: summaryLine, Tags: tags,
		FilesTouched: filesTouched, Commit: commit, Related: related,
	}
	newMeta, err := s.indexFile(ctx, meta.RelPath, []byte(content),
		meta.ID, meta.ProjectSlug, categoryKey, title, fm, doc.Body)
	if err != nil {
		return nil, err
	}

	_, _ = s.st.AppendEvent(ctx, store.EventSummaryUpdated, map[string]any{
		"id": newMeta.ID, "project_slug": newMeta.ProjectSlug,
		"category": newMeta.Category, "title": newMeta.Title, "rel_path": newMeta.RelPath,
	})
	return &SaveResult{Meta: newMeta}, nil
}

// --- papelera -----------------------------------------------------------------

// Trash lista lo que se ha borrado, de lo más reciente a lo más antiguo.
func (s *Service) Trash(ctx context.Context) ([]workspace.TrashEntry, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return s.ws.Trash()
}

// Restore devuelve un archivo de la papelera a su sitio y lo reindexa.
//
// La reindexación es lo que hace que restaurar sirva de algo: sin ella el archivo
// estaría en disco pero la app seguiría sin verlo, y el usuario concluiría que
// restaurar no funciona.
func (s *Service) Restore(ctx context.Context, trashRel string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	rel, err := s.ws.Restore(trashRel)
	if err != nil {
		return "", err
	}
	// `Locked`: aquí ya tenemos el mutex, y `ReindexFile` volvería a pedirlo.
	if err := s.reindexFileLocked(ctx, rel); err != nil {
		return rel, fmt.Errorf("el archivo volvió a %s pero no pude indexarlo: %w", rel, err)
	}
	return rel, nil
}

// EmptyTrash borra la papelera de verdad y dice cuántos archivos se llevó.
func (s *Service) EmptyTrash(ctx context.Context) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if err := ctx.Err(); err != nil {
		return 0, err
	}
	return s.ws.EmptyTrash()
}

// Delete archiva (o borra definitivamente) un resumen.
func (s *Service) Delete(ctx context.Context, id string, hard bool) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	meta, err := s.st.GetSummary(ctx, id)
	if errors.Is(err, store.ErrNotFound) {
		return "", fmt.Errorf("%w: el resumen %q no existe", ErrNotFound, id)
	}
	if err != nil {
		return "", err
	}
	if err := s.st.DeleteSummary(ctx, id); err != nil {
		return "", err
	}
	if err := s.st.DeleteFileState(ctx, meta.RelPath); err != nil {
		return "", err
	}
	archived, err := s.ws.Delete(meta.RelPath, hard)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	_, _ = s.st.AppendEvent(ctx, store.EventSummaryDeleted, map[string]any{
		"id": id, "rel_path": meta.RelPath, "hard": hard,
	})
	return archived, nil
}

// List devuelve resúmenes según un filtro.
func (s *Service) List(ctx context.Context, f store.SummaryFilter) ([]domain.SummaryMeta, int, error) {
	if strings.TrimSpace(f.Query) != "" {
		return s.st.Search(ctx, f)
	}
	return s.st.ListSummaries(ctx, f)
}

// Stats devuelve los totales globales.
func (s *Service) Stats(ctx context.Context) (store.Stats, error) {
	return s.st.Stats(ctx)
}

// Tags devuelve las etiquetas en uso.
func (s *Service) Tags(ctx context.Context) (map[string]int, error) {
	return s.st.AllTags(ctx)
}

// --- helpers -----------------------------------------------------------------

func payloadHash(title, category, body string) string {
	h := sha256.New()
	h.Write([]byte(strings.TrimSpace(title)))
	h.Write([]byte{0})
	h.Write([]byte(category))
	h.Write([]byte{0})
	h.Write([]byte(strings.TrimSpace(body)))
	return hex.EncodeToString(h.Sum(nil))
}

func hashBytes(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func decisionLabel(d Decision) string {
	if d.Accepted {
		return "accepted"
	}
	return "modified"
}

// viaHumana dice si la decisión la tomó una persona y no un agente.
//
// La distinción no es cosmética: gobierna quién puede aprobar una propuesta
// vencida. Un agente actuando por su cuenta sobre un consentimiento caducado es
// justo lo que el TTL existe para impedir.
func viaHumana(via string) bool {
	switch via {
	case domain.ResolvedViaUI, domain.ResolvedViaCLI:
		return true
	}
	return false
}

// authorFor distingue el origen de un resumen. Un resumen que nació de una
// propuesta de agente queda marcado como tal para poder filtrarlo después.
//
// El `cli` es la excepción: lo lanza una persona desde la terminal, así que el
// resumen lo escribió un humano aunque entre por la misma puerta que un agente.
// El canal no se pierde —queda en el campo `agent`—, que es justo para lo que
// sirve ese campo.
func authorFor(agent string) string {
	switch strings.TrimSpace(agent) {
	case "", "cli":
		return "human"
	}
	return "agent"
}

// alreadyResolved responde a una confirmación sobre un token ya resuelto.
//
// Un agente que reintenta tras un timeout merece la respuesta correcta (el
// archivo ya está escrito) en vez de un error que lo lleve a proponer de nuevo
// y generar un duplicado.
func (s *Service) alreadyResolved(ctx context.Context, token string) (*WriteResult, error) {
	cur, err := s.st.GetProposal(ctx, token)
	if err != nil {
		return nil, ErrProposalResolved
	}
	if cur.SummaryID != "" {
		if meta, err := s.st.GetSummary(ctx, cur.SummaryID); err == nil {
			return &WriteResult{
				Meta:    meta,
				Created: false,
				RelPath: meta.RelPath,
				AbsPath: meta.AbsPath,
			}, nil
		}
	}
	return nil, ErrProposalResolved
}

// applyUpdate reescribe un resumen existente con el contenido de la propuesta.
//
// Va aparte de `Confirm` porque tiene su propia lista de cuidados y `Confirm` ya
// era largo. Recibe `release` en vez de tocar el token para que el camino de
// error sea el mismo que en la creación: si algo falla, el token vuelve a
// `pending` y el usuario puede reintentar sin volver a proponer.
func (s *Service) applyUpdate(
	ctx context.Context,
	token string,
	rec store.ProposalRecord,
	summaryID string,
	now time.Time,
	release func(),
) (*WriteResult, error) {
	target, err := s.st.GetSummary(ctx, rec.TargetID)
	if err != nil {
		release()
		return nil, fmt.Errorf(
			"%w: el resumen que se iba a actualizar ya no existe; propón otra vez", ErrNotFound)
	}

	raw, err := s.ws.ReadFile(target.RelPath)
	if err != nil {
		release()
		return nil, fmt.Errorf("leer %s: %w", target.RelPath, err)
	}
	previous := markdown.Parse(raw)

	fm := domain.Frontmatter{
		ID:           target.ID,
		Title:        rec.Title,
		Category:     target.Category,
		Project:      target.ProjectSlug,
		CreatedAt:    target.CreatedAt,
		UpdatedAt:    now,
		Author:       authorFor(rec.Agent),
		Agent:        rec.Agent,
		Status:       domain.StatusConfirmed,
		Summary:      rec.SummaryLine,
		Tags:         rec.Tags,
		FilesTouched: rec.FilesTouched,
		Commit:       rec.CommitSHA,
	}
	// Lo que la propuesta no trae se conserva de lo que ya había: el autor
	// original y los enlaces a otros resúmenes son del usuario, no de este cambio.
	if previous.Frontmatter != nil {
		if strings.TrimSpace(previous.Frontmatter.Author) != "" {
			fm.Author = previous.Frontmatter.Author
		}
		fm.Related = previous.Frontmatter.Related
	}

	content, err := markdown.Render(fm, rec.Body)
	if err != nil {
		release()
		return nil, err
	}

	// `saveLocked` y no `Save`: aquí ya tenemos el mutex del servicio, y `Save` lo
	// volvería a pedir. Es el mismo detalle que dejó la app colgada una vez.
	res, err := s.saveLocked(ctx, rec.TargetID, string(content), rec.BaseHash)
	if err != nil {
		release()
		return nil, err
	}
	if res.Mismatch {
		// Alguien escribió en el archivo entre la propuesta y la confirmación. No
		// se pisa: el token vuelve a `pending` y el agente tiene que releer.
		release()
		return nil, fmt.Errorf(
			"%w: el resumen cambió en disco desde que se propuso la actualización. "+
				" Léelo otra vez con saveme_summary_read y propón la actualización sobre "+
				"el contenido nuevo", ErrInvalid)
	}

	_, _ = s.st.AppendEvent(ctx, store.EventSummaryUpdated, map[string]any{
		"id": res.Meta.ID, "rel_path": res.Meta.RelPath, "via": rec.ResolvedVia,
		"token": token,
	})

	return &WriteResult{
		Meta:    res.Meta,
		Created: false,
		RelPath: res.Meta.RelPath,
		AbsPath: res.Meta.AbsPath,
	}, nil
}
