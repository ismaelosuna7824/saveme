// Package mcpserver expone SaveMe como servidor Model Context Protocol.
//
// Es la puerta por la que un agente (Claude Code, Codex, Cursor…) registra
// resúmenes. La regla que gobierna todo este paquete: **el MCP no escribe sin
// una decisión explícita del usuario**. Eso se consigue con tres capas:
//
//  1. Estructural: `saveme_summary_propose` no toca el disco y devuelve un
//     token de un solo uso con TTL. El único escritor es
//     `saveme_summary_confirm`, y sin token vivo no escribe nada.
//  2. Elicitation: si el cliente declara soportarla, el servidor le pregunta
//     directamente al usuario y su respuesta manda sobre lo que diga el agente.
//  3. Protocolo: si no hay elicitation, la descripción de la tool obliga al
//     agente a preguntar en el chat y a declarar la decisión, que queda
//     auditada en la base de datos.
package mcpserver

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/ismaelosuna/saveme/backend/internal/domain"
	"github.com/ismaelosuna/saveme/backend/internal/service"
	"github.com/ismaelosuna/saveme/backend/internal/store"
)

// Server envuelve el servidor MCP y el servicio de dominio.
type Server struct {
	svc     *service.Service
	version string
	srv     *mcp.Server
}

// New construye el servidor MCP con todas sus tools registradas.
func New(svc *service.Service, version string) *Server {
	s := &Server{svc: svc, version: version}

	s.srv = mcp.NewServer(&mcp.Implementation{
		Name:    "saveme",
		Title:   "SaveMe — resúmenes humanos de proyecto",
		Version: version,
	}, &mcp.ServerOptions{
		Instructions: instructions(svc.Workspace().Root()),
	})

	s.registerTools()
	s.registerPrompt()
	s.registerResource()
	return s
}

// MCP devuelve el servidor subyacente, para pruebas y para montarlo en HTTP.
func (s *Server) MCP() *mcp.Server { return s.srv }

// RunStdio sirve el MCP por stdio. Es el modo que usa un cliente local: el
// cliente lanza `saveme mcp` como subproceso.
func (s *Server) RunStdio(ctx context.Context) error {
	return s.srv.Run(ctx, &mcp.StdioTransport{})
}

// HTTPHandler devuelve el handler Streamable HTTP, para agentes que se conectan
// por red en vez de por stdio.
func (s *Server) HTTPHandler() http.Handler {
	return mcp.NewStreamableHTTPHandler(
		func(*http.Request) *mcp.Server { return s.srv },
		&mcp.StreamableHTTPOptions{},
	)
}

// --- DTOs para el agente -----------------------------------------------------
//
// Los tipos que ve el modelo son planos y con nombres explícitos, en vez de
// reutilizar los tipos de dominio: el esquema JSON que se genera es más
// predecible y el agente recibe solo lo que necesita, sin ruido.

type projectDTO struct {
	Slug         string         `json:"slug" jsonschema:"slug de la carpeta del proyecto"`
	Name         string         `json:"name" jsonschema:"nombre visible del proyecto"`
	Summaries    int            `json:"summaries" jsonschema:"cuántos resúmenes tiene"`
	ByCategory   map[string]int `json:"by_category" jsonschema:"conteo de resúmenes por categoría"`
	LastActivity string         `json:"last_activity,omitempty" jsonschema:"fecha ISO-8601 del último resumen"`
}

type summaryDTO struct {
	ID        string   `json:"id" jsonschema:"identificador estable del resumen"`
	Project   string   `json:"project"`
	Category  string   `json:"category"`
	Title     string   `json:"title"`
	Summary   string   `json:"summary_line,omitempty" jsonschema:"una línea que resume el contenido"`
	RelPath   string   `json:"rel_path" jsonschema:"ruta relativa dentro del workspace"`
	Tags      []string `json:"tags,omitempty"`
	Status    string   `json:"status" jsonschema:"confirmed, draft o unmanaged"`
	CreatedAt string   `json:"created_at"`
	UpdatedAt string   `json:"updated_at"`
}

func toSummaryDTO(m domain.SummaryMeta) summaryDTO {
	return summaryDTO{
		ID:        m.ID,
		Project:   m.ProjectSlug,
		Category:  m.Category,
		Title:     m.Title,
		Summary:   m.SummaryLine,
		RelPath:   m.RelPath,
		Tags:      m.Tags,
		Status:    m.Status,
		CreatedAt: m.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt: m.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

func toProjectDTO(p domain.Project) projectDTO {
	dto := projectDTO{
		Slug:       p.Slug,
		Name:       p.Name,
		Summaries:  p.Total,
		ByCategory: p.Counts,
	}
	if dto.ByCategory == nil {
		dto.ByCategory = map[string]int{}
	}
	if p.LastActivity != nil {
		dto.LastActivity = p.LastActivity.UTC().Format(time.RFC3339)
	}
	return dto
}

// --- tools -------------------------------------------------------------------

func (s *Server) registerTools() {
	mcp.AddTool(s.srv, &mcp.Tool{
		Name:  "saveme_project_list",
		Title: "Listar proyectos de SaveMe",
		Description: "Devuelve los proyectos que ya existen en el workspace de SaveMe, con " +
			"cuántos resúmenes tiene cada uno y de qué categorías. " +
			"Llámalo antes de proponer un resumen: si el proyecto ya existe, usa su slug " +
			"exacto en vez de inventar uno nuevo por un error de tipeo.",
		Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true},
	}, s.handleProjectList)

	mcp.AddTool(s.srv, &mcp.Tool{
		Name:  "saveme_project_create",
		Title: "Crear un proyecto en SaveMe",
		Description: "Crea la carpeta de un proyecto con sus nueve subcarpetas de categoría. " +
			"Normalmente NO necesitas llamar a esto: `saveme_summary_propose` ya crea el " +
			"proyecto cuando el usuario confirma. Úsalo solo si el usuario pide explícitamente " +
			"dar de alta un proyecto sin escribir ningún resumen todavía.",
		Annotations: &mcp.ToolAnnotations{ReadOnlyHint: false, IdempotentHint: true},
	}, s.handleProjectCreate)

	mcp.AddTool(s.srv, &mcp.Tool{
		Name:        "saveme_summary_propose",
		Title:       "Proponer un resumen humano",
		Description: proposeDescription,
		Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true, IdempotentHint: true},
	}, s.handlePropose)

	mcp.AddTool(s.srv, &mcp.Tool{
		Name:        "saveme_summary_confirm",
		Title:       "Confirmar y escribir un resumen",
		Description: confirmDescription,
		Annotations: &mcp.ToolAnnotations{ReadOnlyHint: false, IdempotentHint: true},
	}, s.handleConfirm)

	mcp.AddTool(s.srv, &mcp.Tool{
		Name:  "saveme_summary_cancel",
		Title: "Descartar una propuesta",
		Description: "Descarta una propuesta que no se va a guardar, para que no quede " +
			"ocupando el inbox del usuario. Úsalo cuando el usuario diga que no quiere " +
			"guardar el resumen. No escribe nada.",
		Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true},
	}, s.handleCancel)

	mcp.AddTool(s.srv, &mcp.Tool{
		Name:  "saveme_summary_search",
		Title: "Buscar en el historial de resúmenes",
		Description: "Busca texto libre en el historial de resúmenes (título, resumen y cuerpo). " +
			"Úsalo antes de proponer: si ya hay un resumen de eso, es mejor ampliarlo o " +
			"preguntar al usuario si esto es una continuación. " +
			"También sirve para que el usuario recupere contexto de algo que hizo hace meses.",
		Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true},
	}, s.handleSearch)

	mcp.AddTool(s.srv, &mcp.Tool{
		Name:  "saveme_summary_list",
		Title: "Listar resúmenes recientes",
		Description: "Lista los resúmenes de un proyecto y/o categoría, del más reciente al más " +
			"antiguo. Úsalo para orientarte sobre en qué se ha estado trabajando.",
		Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true},
	}, s.handleList)

	mcp.AddTool(s.srv, &mcp.Tool{
		Name:  "saveme_summary_read",
		Title: "Leer un resumen completo",
		Description: "Devuelve el markdown completo de un resumen, frontmatter incluido. " +
			"Llámalo cuando el usuario pregunte por algo del pasado o cuando necesites " +
			"contexto de una decisión anterior.",
		Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true},
	}, s.handleRead)

	mcp.AddTool(s.srv, &mcp.Tool{
		Name:  "saveme_pending",
		Title: "Ver propuestas pendientes de aprobación",
		Description: "Lista las propuestas que están esperando que el usuario decida dónde " +
			"guardarlas. Úsalo si el usuario pregunta qué quedó pendiente, o si perdiste el " +
			"token de una propuesta anterior.",
		Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true},
	}, s.handlePending)
}

// --- saveme_project_list -----------------------------------------------------

type projectListIn struct{}

type projectListOut struct {
	Projects []projectDTO `json:"projects"`
	RootDir  string       `json:"root_dir" jsonschema:"carpeta raíz del workspace de SaveMe"`
}

func (s *Server) handleProjectList(ctx context.Context, _ *mcp.CallToolRequest, _ projectListIn) (*mcp.CallToolResult, projectListOut, error) {
	projects, err := s.svc.ListProjects(ctx)
	if err != nil {
		return nil, projectListOut{}, err
	}
	out := projectListOut{
		Projects: make([]projectDTO, 0, len(projects)),
		RootDir:  s.svc.Workspace().Root(),
	}
	for _, p := range projects {
		out.Projects = append(out.Projects, toProjectDTO(p))
	}
	return nil, out, nil
}

// --- saveme_project_create ---------------------------------------------------

type projectCreateIn struct {
	Name string `json:"name" jsonschema:"Nombre visible del proyecto, tal como lo escribiría una persona. Ejemplo: \"API de pagos\"."`
	Slug string `json:"slug,omitempty" jsonschema:"Slug de la carpeta, en minúsculas con guiones. Opcional: si no lo pasas se deriva del nombre."`
}

type projectCreateOut struct {
	Project projectDTO `json:"project"`
	Created bool       `json:"created" jsonschema:"false si el proyecto ya existía"`
}

func (s *Server) handleProjectCreate(ctx context.Context, _ *mcp.CallToolRequest, in projectCreateIn) (*mcp.CallToolResult, projectCreateOut, error) {
	if strings.TrimSpace(in.Name) == "" && strings.TrimSpace(in.Slug) == "" {
		return nil, projectCreateOut{}, errors.New("hace falta el nombre del proyecto")
	}
	before, _ := s.svc.ListProjects(ctx)
	existed := false
	for _, p := range before {
		if p.Slug == domain.Slug(in.Name) || (in.Slug != "" && p.Slug == in.Slug) {
			existed = true
			break
		}
	}

	project, err := s.svc.EnsureProject(ctx, in.Name, in.Slug)
	if err != nil {
		return nil, projectCreateOut{}, err
	}
	return nil, projectCreateOut{Project: toProjectDTO(project), Created: !existed}, nil
}

// --- saveme_summary_propose --------------------------------------------------

type proposeIn struct {
	Project string `json:"project" jsonschema:"Proyecto al que pertenece el resumen. Es el nombre de la carpeta de primer nivel, en minúsculas y con guiones, por ejemplo \"saveme-app\". Si el proyecto no existe, SaveMe lo crea al confirmar."`
	Title   string `json:"title" jsonschema:"Título corto y descriptivo, en el idioma del usuario. Es lo primero que se ve en el historial: que diga QUÉ se hizo, no cómo. Ejemplo: \"Editor markdown con preview sincronizado\"."`
	Body    string `json:"body" jsonschema:"El resumen en markdown. Escríbelo para una persona que lo leerá en seis meses: qué se hizo, por qué, cómo funciona y qué falta. NO es un changelog ni un diff. Ver las instrucciones del servidor para la estructura recomendada."`

	Category     string   `json:"category,omitempty" jsonschema:"Categoría: feature, fix, chore, refactor, docs, infra, design, research o incident. OMÍTELO si no estás seguro: SaveMe la infiere del título y el cuerpo, y se la propone al usuario junto con alternativas."`
	Summary      string   `json:"summary,omitempty" jsonschema:"Una sola línea que resuma el cambio, para las listas. Si no la pasas se toma la primera frase del cuerpo."`
	Tags         []string `json:"tags,omitempty" jsonschema:"Etiquetas para agrupar y buscar, en minúsculas. Dos o tres bastan: [\"editor\", \"markdown\"]."`
	FilesTouched []string `json:"files_touched,omitempty" jsonschema:"Archivos que de verdad importan para entender el cambio, como rutas relativas al repositorio. No listes todo lo que tocaste: para eso está git."`
	Agent        string   `json:"agent,omitempty" jsonschema:"Nombre del agente que lo escribe, por ejemplo \"claude-code\". Se guarda para poder auditar después."`
	Commit       string   `json:"commit,omitempty" jsonschema:"SHA del commit relacionado, si lo hay."`
	Target       string   `json:"target,omitempty" jsonschema:"Si esto CONTINÚA un resumen que ya existe, su id (el que devuelven saveme_summary_search, saveme_summary_list o saveme_pending) o su ruta relativa. Déjalo vacío para crear uno nuevo. Con target, el resumen se reescribe en su sitio: no se mueve ni se duplica."`
}

type alternativeDTO struct {
	Category string `json:"category"`
	Label    string `json:"label"`
	RelPath  string `json:"rel_path" jsonschema:"ruta concreta donde quedaría el archivo si el usuario elige esta opción"`
}

type proposeOut struct {
	Token string `json:"token" jsonschema:"token de un solo uso. Pásalo a saveme_summary_confirm. Vale 15 minutos."`
	// Ya propuesto: el agente reintentó y se reutiliza la propuesta pendiente.
	AlreadyProposed bool `json:"already_proposed,omitempty"`
	// Ya guardado: este contenido exacto ya se escribió antes.
	AlreadySaved *summaryDTO `json:"already_saved,omitempty"`

	Project          string           `json:"project,omitempty"`
	Category         string           `json:"category,omitempty"`
	RelPath          string           `json:"rel_path,omitempty" jsonschema:"ruta relativa donde se guardaría el archivo"`
	AbsPath          string           `json:"abs_path,omitempty"`
	Title            string           `json:"title,omitempty"`
	WhyCategory      string           `json:"why_this_category,omitempty" jsonschema:"explicación en lenguaje natural de por qué se eligió esa categoría"`
	Confidence       float64          `json:"confidence,omitempty" jsonschema:"confianza de la inferencia, de 0 a 1"`
	Alternatives     []alternativeDTO `json:"alternatives,omitempty" jsonschema:"otros destinos concretos que puedes ofrecerle al usuario"`
	ExpiresInMinutes int              `json:"expires_in_minutes,omitempty" jsonschema:"minutos de vida que le quedan al token"`
	NextStep         string           `json:"next_step" jsonschema:"qué hacer ahora. Léelo y síguelo."`
}

func (s *Server) handlePropose(ctx context.Context, _ *mcp.CallToolRequest, in proposeIn) (*mcp.CallToolResult, proposeOut, error) {
	prep, err := s.svc.Propose(ctx, domain.CreateRequest{
		Project:      in.Project,
		Title:        in.Title,
		Body:         in.Body,
		Category:     in.Category,
		Summary:      in.Summary,
		Tags:         in.Tags,
		FilesTouched: in.FilesTouched,
		Agent:        in.Agent,
		Commit:       in.Commit,
		Target:       in.Target,
	})
	if err != nil {
		return nil, proposeOut{}, translate(err)
	}

	if prep.AlreadySaved != nil {
		dto := toSummaryDTO(*prep.AlreadySaved)
		return nil, proposeOut{
			AlreadySaved: &dto,
			RelPath:      dto.RelPath,
			AbsPath:      prep.AlreadySaved.AbsPath,
			Title:        dto.Title,
			NextStep: "Este contenido exacto YA está guardado en " + dto.RelPath + " (" + dto.UpdatedAt + "). " +
				"No lo propongas otra vez y no escribas nada. Dile al usuario que ya existe y " +
				"pregúntale si quiere que lo actualices en vez de crear otro.",
		}, nil
	}

	p := prep.Proposal
	out := proposeOut{
		Token:            p.Token,
		AlreadyProposed:  prep.AlreadyProposed,
		Project:          p.ProjectSlug,
		Category:         p.Category,
		RelPath:          p.RelPath,
		AbsPath:          p.AbsPath,
		Title:            p.Title,
		WhyCategory:      p.Inference.Reason,
		Confidence:       p.Inference.Confidence,
		ExpiresInMinutes: int(math.Ceil(time.Until(p.ExpiresAt).Minutes())),
	}
	for _, a := range p.Alternatives {
		out.Alternatives = append(out.Alternatives, alternativeDTO{
			Category: a.Category, Label: a.Label, RelPath: a.RelPath,
		})
	}

	if prep.AlreadyProposed {
		out.NextStep = "Ya había una propuesta pendiente idéntica; reutiliza este token. " +
			"Pregúntale al usuario si la guarda en " + p.RelPath + " y luego llama a " +
			"saveme_summary_confirm con decision=\"accepted\"."
		return nil, out, nil
	}

	var alt strings.Builder
	for _, a := range p.Alternatives {
		fmt.Fprintf(&alt, "\n  - %s (%s): %s", a.Label, a.Category, a.RelPath)
	}

	out.NextStep = fmt.Sprintf(
		"AHORA PREGÚNTALE AL USUARIO. Todavía no se escribió nada.\n\n"+
			"Dile algo así: «Voy a guardar el resumen en %s, dentro de %s. ¿Te parece bien o prefieres otra carpeta?»\n\n"+
			"Si quiere otra ubicación, estas son las opciones concretas que puedes ofrecerle:%s\n"+
			"También puede darte cualquier otra ruta relativa dentro del workspace.\n\n"+
			"Cuando responda, llama a saveme_summary_confirm con este token:\n"+
			"  - si acepta la propuesta: decision=\"accepted\"\n"+
			"  - si quiere otra ubicación: decision=\"modified\" y override.rel_path (o override.category)\n"+
			"  - si no quiere guardarlo: saveme_summary_cancel\n\n"+
			"El token vale %d minutos y solo funciona una vez.",
		p.RelPath, p.ProjectSlug, alt.String(), out.ExpiresInMinutes,
	)
	return nil, out, nil
}

// --- saveme_summary_confirm --------------------------------------------------

type overrideIn struct {
	Project  string `json:"project,omitempty" jsonschema:"Otro proyecto. Opcional."`
	Category string `json:"category,omitempty" jsonschema:"Otra categoría. Opcional. Usa una de: feature, fix, chore, refactor, docs, infra, design, research, incident."`
	RelPath  string `json:"rel_path,omitempty" jsonschema:"Ruta relativa exacta donde guardar, por ejemplo \"api-pagos/docs/2026-02-14-mi-nota.md\". Es la forma más directa de decir \"guárdalo aquí\". No puede salirse del workspace."`
	Title    string `json:"title,omitempty" jsonschema:"Corregir el título. Opcional."`
}

type confirmIn struct {
	Token    string      `json:"token" jsonschema:"El token que devolvió saveme_summary_propose."`
	Decision string      `json:"decision" jsonschema:"\"accepted\" si el usuario aprobó la ubicación propuesta, \"modified\" si pidió otra. Solo puedes pasar \"accepted\" si de verdad le preguntaste y aceptó."`
	Override *overrideIn `json:"override,omitempty" jsonschema:"Cambios de destino, cuando decision=\"modified\"."`
	Elicit   *bool       `json:"elicit,omitempty" jsonschema:"Si es true (por defecto) y el cliente soporta elicitation, SaveMe le pregunta al usuario directamente y su respuesta manda. Déjalo en true: es la forma más segura de que el usuario decida."`
}

type confirmOut struct {
	Written        bool        `json:"written"`
	Cancelled      bool        `json:"cancelled,omitempty"`
	Summary        *summaryDTO `json:"summary,omitempty"`
	WrittenPath    string      `json:"written_path,omitempty" jsonschema:"ruta relativa del archivo escrito"`
	AlreadyThere   bool        `json:"already_there,omitempty" jsonschema:"true si este token ya se había confirmado antes y no se escribió nada nuevo"`
	ProjectCreated bool        `json:"project_created,omitempty" jsonschema:"true si hubo que crear la carpeta del proyecto"`
	ResolvedVia    string      `json:"resolved_via,omitempty" jsonschema:"elicitation si el usuario respondió al diálogo, agent_chat si el agente declaró la decisión tras preguntar en el chat"`
	Message        string      `json:"message" jsonschema:"qué pasó, en una frase"`
	ElicitError    string      `json:"elicit_error,omitempty" jsonschema:"si el diálogo con el usuario falló, por qué. Cuando aparece, la decisión la declaró el agente y no el usuario."`
}

func (s *Server) handleConfirm(ctx context.Context, req *mcp.CallToolRequest, in confirmIn) (*mcp.CallToolResult, *confirmOut, error) {
	token := strings.TrimSpace(in.Token)
	if token == "" {
		return nil, nil, errors.New("falta el token; consíguelo con saveme_summary_propose")
	}

	decision := strings.ToLower(strings.TrimSpace(in.Decision))
	if decision != "accepted" && decision != "modified" {
		return nil, nil, fmt.Errorf(
			"decision debe ser \"accepted\" o \"modified\", llegó %q. "+
				"Si el usuario no quiere guardarlo, usa saveme_summary_cancel", in.Decision)
	}
	if decision == "accepted" && in.Override != nil && hasOverride(*in.Override) {
		return nil, nil, errors.New(
			`pasa decision="modified" cuando mandes override; "accepted" significa "tal cual se propuso"`)
	}

	via := domain.ResolvedViaAgentChat
	d := service.Decision{Accepted: decision == "accepted", Via: via}
	if in.Override != nil {
		d.Project = in.Override.Project
		d.Category = in.Override.Category
		d.RelPath = in.Override.RelPath
		d.Title = in.Override.Title
	}

	// Capa 2 de la garantía: preguntarle al usuario por el canal del protocolo.
	//
	// Se implementa con InputRequests (SEP-2322, "multi round-trip") y no
	// llamando a Elicit directamente, por dos razones:
	//
	//   - En el protocolo 2026-07-28 y posteriores una petición de servidor a
	//     cliente a mitad de una llamada ya no está permitida; el mecanismo es
	//     devolver la petición de input y esperar una re-invocación.
	//   - Para clientes de protocolos anteriores, el propio SDK traduce esto a
	//     una llamada a Elicit y re-invoca el handler. Una sola implementación
	//     cubre las dos generaciones de clientes.
	//
	// El resultado del usuario, cuando llega, viaja en InputResponses y manda
	// sobre lo que haya declarado el agente.
	shouldAsk := in.Elicit == nil || *in.Elicit
	if shouldAsk && supportsElicitation(req) {
		raw, answered := req.Params.InputResponses[elicitRequestKey]
		if !answered {
			requests, err := s.buildElicitRequest(ctx, token)
			if err != nil {
				return nil, nil, translate(err)
			}
			// Devolver solo InputRequests, sin contenido: el SDK rechaza un
			// resultado que traiga las dos cosas.
			return &mcp.CallToolResult{InputRequests: requests}, nil, nil
		}

		// Hace falta la ruta propuesta para distinguir "eligió lo mismo" de
		// "eligió otra cosa": si el usuario acepta el destino sugerido, la
		// decisión debe quedar registrada como accepted y no como modified.
		proposal, err := s.svc.GetProposal(ctx, token)
		if err != nil {
			return nil, nil, translate(err)
		}
		answer, err := interpretElicitResponse(raw, proposal.RelPath)
		if err != nil {
			return nil, nil, err
		}
		switch {
		case answer.dismissed:
			// El usuario cerró el diálogo sin elegir. No se escribe nada y el
			// token sigue vivo: el agente debe preguntar en el chat y volver a
			// confirmar. Es un error de tool a propósito, para que el agente no
			// lo confunda con un guardado exitoso.
			return nil, nil, errors.New(
				"el usuario cerró el diálogo sin decidir; no se guardó nada. " +
					"Pregúntale en el chat dónde quiere el resumen y vuelve a llamar a " +
					"saveme_summary_confirm con elicit=false y su decisión explícita")
		case answer.cancelled:
			if err := s.svc.Cancel(ctx, token, domain.ResolvedViaElicitation, "descartado en el diálogo"); err != nil {
				return nil, nil, translate(err)
			}
			return nil, &confirmOut{
				Cancelled:   true,
				ResolvedVia: domain.ResolvedViaElicitation,
				Message:     "El usuario decidió no guardar el resumen en el diálogo. No se escribió nada.",
			}, nil
		case answer.answered:
			via = domain.ResolvedViaElicitation
			d.Via = via
			if answer.relPath != "" {
				d.RelPath = answer.relPath
				d.Accepted = false
			}
		}
	}

	res, err := s.svc.Confirm(ctx, token, d)
	if err != nil {
		return nil, nil, translate(err)
	}
	if res == nil {
		return nil, &confirmOut{
			Cancelled:   true,
			ResolvedVia: via,
			Message:     "Propuesta descartada. No se escribió nada.",
		}, nil
	}

	dto := toSummaryDTO(res.Meta)
	msg := "Guardado en " + res.RelPath + "."
	switch {
	case !res.Created:
		msg = "Ya estaba guardado en " + res.RelPath + "; no se escribió nada nuevo."
	case res.ProjectCreated:
		msg = "Guardado en " + res.RelPath + ". Se creó el proyecto " + res.Meta.ProjectSlug + " con sus carpetas de categoría."
	}
	return nil, &confirmOut{
		Written:        res.Created,
		Summary:        &dto,
		WrittenPath:    res.RelPath,
		AlreadyThere:   !res.Created,
		ProjectCreated: res.ProjectCreated,
		ResolvedVia:    via,
		Message:        msg,
	}, nil
}

func hasOverride(o overrideIn) bool {
	return strings.TrimSpace(o.Project) != "" || strings.TrimSpace(o.Category) != "" ||
		strings.TrimSpace(o.RelPath) != "" || strings.TrimSpace(o.Title) != ""
}

// elicitRequestKey es la clave con la que se identifica la pregunta al usuario
// dentro de InputRequests. El cliente la devuelve tal cual en InputResponses.
const elicitRequestKey = "donde_guardar"

// cancelChoice es el valor centinela del enum que significa "no lo guardes".
const cancelChoice = "__no_guardar__"

// elicitAnswer es la decisión del usuario, ya interpretada.
type elicitAnswer struct {
	// answered: el usuario eligió un destino.
	answered bool
	// cancelled: el usuario dijo explícitamente que no lo guarde.
	cancelled bool
	// dismissed: cerró el diálogo sin elegir.
	dismissed bool
	// relPath: destino elegido, si difiere del propuesto.
	relPath string
}

// buildElicitRequest arma la pregunta que el cliente le mostrará al usuario.
//
// El enum ofrece la ruta propuesta y las alternativas concretas, más la opción
// de no guardar. El campo libre `otra_ruta` cubre "quiero una carpeta que no
// está en la lista", que es un requisito explícito del producto.
func (s *Server) buildElicitRequest(ctx context.Context, token string) (mcp.InputRequestMap, error) {
	p, err := s.svc.GetProposal(ctx, token)
	if err != nil {
		return nil, err
	}

	choices := []any{p.RelPath}
	labels := []any{"Sí: " + p.RelPath}
	for _, a := range p.Alternatives {
		choices = append(choices, a.RelPath)
		labels = append(labels, "Mejor en "+a.Label+": "+a.RelPath)
	}
	choices = append(choices, cancelChoice)
	labels = append(labels, "No lo guardes")

	schema := map[string]any{
		"type": "object",
		"properties": map[string]any{
			"destino": map[string]any{
				"type":        "string",
				"title":       "¿Dónde guardo este resumen?",
				"description": "Elige uno de los destinos, o escribe una ruta en el campo siguiente.",
				"enum":        choices,
				"enumNames":   labels,
			},
			"otra_ruta": map[string]any{
				"type":        "string",
				"title":       "Otra carpeta (opcional)",
				"description": "Ruta relativa dentro del workspace, por ejemplo \"otro-proyecto/docs/mi-nota.md\". Si la escribes, tiene prioridad sobre la elección anterior.",
			},
		},
		// Deliberadamente sin `required`: los clientes difieren en si mandan
		// todos los campos o solo los que el usuario tocó, y exigir uno haría
		// fallar la validación del lado del cliente antes de llegar aquí. La
		// ausencia de elección se interpreta como "no decidió".
	}

	preview := p.Preview
	if len(preview) > 600 {
		preview = preview[:600] + "…"
	}
	message := fmt.Sprintf(
		"SaveMe quiere guardar un resumen tuyo.\n\nTítulo: %s\nCategoría propuesta: %s (%s)\nDestino: %s\n\n---\n%s\n---\n\n¿Dónde lo guardo?",
		p.Title, p.Category, p.Inference.Reason, p.RelPath, preview,
	)

	return mcp.InputRequestMap{
		elicitRequestKey: &mcp.ElicitParams{
			Message:         message,
			RequestedSchema: schema,
		},
	}, nil
}

// interpretElicitResponse traduce la respuesta del usuario.
//
// El token se usa para comparar la elección contra la ruta propuesta: si el
// usuario eligió exactamente lo propuesto, la decisión es "tal cual".
func interpretElicitResponse(raw mcp.InputResponse, proposedRelPath string) (elicitAnswer, error) {
	result, ok := raw.(*mcp.ElicitResult)
	if !ok {
		return elicitAnswer{}, fmt.Errorf("respuesta de elicitación con tipo inesperado: %T", raw)
	}

	switch result.Action {
	case "decline":
		return elicitAnswer{cancelled: true}, nil
	case "cancel":
		return elicitAnswer{dismissed: true}, nil
	case "accept":
		ans := elicitAnswer{answered: true}
		if v, ok := result.Content["otra_ruta"].(string); ok && strings.TrimSpace(v) != "" {
			ans.relPath = strings.TrimSpace(v)
			return ans, nil
		}
		destino, hadDestino := result.Content["destino"].(string)
		destino = strings.TrimSpace(destino)
		switch {
		case !hadDestino || destino == "":
			// Aceptó el formulario sin elegir nada: no hay decisión que valga,
			// así que se trata como diálogo cerrado y no se escribe.
			return elicitAnswer{dismissed: true}, nil
		case destino == cancelChoice:
			return elicitAnswer{cancelled: true}, nil
		case destino == proposedRelPath:
			// Eligió lo propuesto: se guarda tal cual.
		default:
			ans.relPath = destino
		}
		return ans, nil
	default:
		return elicitAnswer{dismissed: true}, nil
	}
}

// supportsElicitation comprueba si el cliente declaró soportar elicitation.
//
// Se consulta en cada llamada y no se cachea: la sesión puede inicializarse
// después del registro de las tools, y un cliente que no la soporta debe
// recibir el camino de respaldo sin que el servidor falle.
func supportsElicitation(req *mcp.CallToolRequest) bool {
	if req == nil || req.Session == nil {
		return false
	}
	params := req.Session.InitializeParams()
	if params == nil || params.Capabilities == nil {
		return false
	}
	return params.Capabilities.Elicitation != nil
}

// --- saveme_summary_cancel ---------------------------------------------------

type cancelIn struct {
	Token  string `json:"token" jsonschema:"El token de la propuesta a descartar."`
	Reason string `json:"reason,omitempty" jsonschema:"Por qué no se guarda. Queda en la auditoría y ayuda a entender después qué se descartó."`
}

type cancelOut struct {
	Cancelled bool   `json:"cancelled"`
	Message   string `json:"message"`
}

func (s *Server) handleCancel(ctx context.Context, _ *mcp.CallToolRequest, in cancelIn) (*mcp.CallToolResult, cancelOut, error) {
	err := s.svc.Cancel(ctx, strings.TrimSpace(in.Token), domain.ResolvedViaAgentChat, in.Reason)
	if err != nil {
		return nil, cancelOut{}, translate(err)
	}
	return nil, cancelOut{Cancelled: true, Message: "Propuesta descartada. No se escribió nada."}, nil
}

// --- saveme_summary_search ---------------------------------------------------

type searchIn struct {
	Query    string `json:"query" jsonschema:"Texto a buscar. Se compara contra el título, la línea de resumen y el cuerpo completo."`
	Project  string `json:"project,omitempty" jsonschema:"Limitar a un proyecto."`
	Category string `json:"category,omitempty" jsonschema:"Limitar a una categoría."`
	Limit    int    `json:"limit,omitempty" jsonschema:"Cuántos resultados devolver. Por defecto 10."`
}

type searchOut struct {
	Items []summaryDTO `json:"items"`
	Total int          `json:"total"`
	Note  string       `json:"note,omitempty"`
}

func (s *Server) handleSearch(ctx context.Context, _ *mcp.CallToolRequest, in searchIn) (*mcp.CallToolResult, searchOut, error) {
	if strings.TrimSpace(in.Query) == "" {
		return nil, searchOut{}, errors.New("la búsqueda necesita un texto")
	}
	limit := in.Limit
	if limit <= 0 || limit > 50 {
		limit = 10
	}
	items, total, err := s.svc.List(ctx, store.SummaryFilter{
		Query:    in.Query,
		Project:  in.Project,
		Category: in.Category,
		Limit:    limit,
	})
	if err != nil {
		return nil, searchOut{}, err
	}
	out := searchOut{Total: total, Items: make([]summaryDTO, 0, len(items))}
	for _, m := range items {
		out.Items = append(out.Items, toSummaryDTO(m))
	}
	if total == 0 {
		out.Note = "No hay nada en el historial sobre esto."
	}
	return nil, out, nil
}

// --- saveme_summary_list -----------------------------------------------------

type listIn struct {
	Project  string `json:"project,omitempty" jsonschema:"Proyecto del que listar. Si lo omites, lista de todos."`
	Category string `json:"category,omitempty" jsonschema:"Filtrar por categoría: feature, fix, chore, refactor, docs, infra, design, research o incident."`
	Limit    int    `json:"limit,omitempty" jsonschema:"Cuántos devolver. Por defecto 15."`
}

type listOut struct {
	Items []summaryDTO `json:"items"`
	Total int          `json:"total"`
}

func (s *Server) handleList(ctx context.Context, _ *mcp.CallToolRequest, in listIn) (*mcp.CallToolResult, listOut, error) {
	limit := in.Limit
	if limit <= 0 || limit > 100 {
		limit = 15
	}
	items, total, err := s.svc.List(ctx, store.SummaryFilter{
		Project:  in.Project,
		Category: in.Category,
		Limit:    limit,
	})
	if err != nil {
		return nil, listOut{}, err
	}
	out := listOut{Total: total, Items: make([]summaryDTO, 0, len(items))}
	for _, m := range items {
		out.Items = append(out.Items, toSummaryDTO(m))
	}
	return nil, out, nil
}

// --- saveme_summary_read -----------------------------------------------------

type readIn struct {
	ID string `json:"id" jsonschema:"El id del resumen, tal como lo devuelve saveme_summary_search o saveme_summary_list."`
}

type readOut struct {
	Summary summaryDTO `json:"summary"`
	Content string     `json:"content" jsonschema:"El markdown completo del cuerpo, sin el frontmatter."`
	Raw     string     `json:"raw" jsonschema:"El archivo tal cual está en disco, frontmatter incluido."`
}

func (s *Server) handleRead(ctx context.Context, _ *mcp.CallToolRequest, in readIn) (*mcp.CallToolResult, readOut, error) {
	if strings.TrimSpace(in.ID) == "" {
		return nil, readOut{}, errors.New("falta el id del resumen")
	}
	meta, raw, err := s.svc.ReadRaw(ctx, strings.TrimSpace(in.ID))
	if err != nil {
		return nil, readOut{}, translate(err)
	}
	_, body, err := s.svc.Read(ctx, meta.ID)
	if err != nil {
		return nil, readOut{}, translate(err)
	}
	return nil, readOut{Summary: toSummaryDTO(meta), Content: body, Raw: raw}, nil
}

// --- saveme_pending ----------------------------------------------------------

type pendingIn struct {
	Project string `json:"project,omitempty" jsonschema:"Limitar a un proyecto."`
}

type pendingOut struct {
	Proposals []pendingDTO `json:"proposals"`
	Note      string       `json:"note,omitempty"`
}

type pendingDTO struct {
	Token        string           `json:"token"`
	Project      string           `json:"project"`
	Category     string           `json:"category"`
	Title        string           `json:"title"`
	RelPath      string           `json:"rel_path"`
	WhyCategory  string           `json:"why_this_category"`
	Alternatives []alternativeDTO `json:"alternatives,omitempty"`
	CreatedAt    string           `json:"created_at"`
	ExpiresAt    string           `json:"expires_at"`
}

func (s *Server) handlePending(ctx context.Context, _ *mcp.CallToolRequest, in pendingIn) (*mcp.CallToolResult, pendingOut, error) {
	proposals, err := s.svc.ListProposals(ctx, domain.ProposalPending, 50)
	if err != nil {
		return nil, pendingOut{}, err
	}
	out := pendingOut{Proposals: make([]pendingDTO, 0, len(proposals))}
	for _, p := range proposals {
		if in.Project != "" && p.ProjectSlug != in.Project {
			continue
		}
		dto := pendingDTO{
			Token: p.Token, Project: p.ProjectSlug, Category: p.Category, Title: p.Title,
			RelPath: p.RelPath, WhyCategory: p.Inference.Reason,
			CreatedAt: p.CreatedAt.UTC().Format(time.RFC3339),
			ExpiresAt: p.ExpiresAt.UTC().Format(time.RFC3339),
		}
		for _, a := range p.Alternatives {
			dto.Alternatives = append(dto.Alternatives, alternativeDTO{
				Category: a.Category, Label: a.Label, RelPath: a.RelPath,
			})
		}
		out.Proposals = append(out.Proposals, dto)
	}
	if len(out.Proposals) == 0 {
		out.Note = "No hay propuestas esperando decisión."
	}
	return nil, out, nil
}

// --- prompt y resource -------------------------------------------------------

func (s *Server) registerPrompt() {
	s.srv.AddPrompt(&mcp.Prompt{
		Name:        "saveme/human-summary",
		Title:       "Redactar un resumen humano para SaveMe",
		Description: "Instrucciones para escribir un resumen que una persona entienda dentro de seis meses, y guardarlo con el flujo de propuesta y confirmación.",
	}, func(ctx context.Context, _ *mcp.GetPromptRequest) (*mcp.GetPromptResult, error) {
		return &mcp.GetPromptResult{
			Description: "Cómo registrar un resumen humano en SaveMe",
			Messages: []*mcp.PromptMessage{{
				Role:    "user",
				Content: &mcp.TextContent{Text: promptBody(s.svc.Workspace().Root())},
			}},
		}, nil
	})
}

func (s *Server) registerResource() {
	s.srv.AddResource(&mcp.Resource{
		URI:         "saveme://guide",
		Name:        "Guía de SaveMe para agentes",
		Description: "El flujo completo de propuesta y confirmación, la estructura recomendada de un resumen y la taxonomía de categorías.",
		MIMEType:    "text/markdown",
	}, func(ctx context.Context, _ *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
		return &mcp.ReadResourceResult{
			Contents: []*mcp.ResourceContents{{
				URI:      "saveme://guide",
				MIMEType: "text/markdown",
				Text:     instructions(s.svc.Workspace().Root()),
			}},
		}, nil
	})
}

// --- errores -----------------------------------------------------------------

// translate convierte los errores del servicio en mensajes accionables para el
// agente. Un agente que recibe "token expirado" sabe qué hacer; uno que recibe
// un error interno, no.
func translate(err error) error {
	switch {
	case errors.Is(err, service.ErrProposalNotFound):
		return errors.New("ese token no existe. Consíguelo con saveme_summary_propose; " +
			"si crees que ya lo tenías, míralo con saveme_pending")
	case errors.Is(err, service.ErrProposalExpired):
		return errors.New("el token expiró (vale 15 minutos). Vuelve a llamar a " +
			"saveme_summary_propose con el mismo contenido y pregunta otra vez")
	case errors.Is(err, service.ErrProposalResolved):
		return errors.New("esa propuesta ya se resolvió: o el usuario la descartó, o ya se guardó. " +
			"No la confirmes otra vez; comprueba con saveme_pending o saveme_summary_search")
	case errors.Is(err, service.ErrInvalid):
		return err
	case errors.Is(err, service.ErrNotFound), errors.Is(err, store.ErrNotFound):
		return err
	default:
		return err
	}
}
