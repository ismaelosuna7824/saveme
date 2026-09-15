package domain

import (
	"fmt"
	"strings"
	"time"
)

// SchemaVersion es la versión del layout de la raíz del workspace. Se guarda en
// .saveme/root.json para poder migrar en el futuro.
const SchemaVersion = 1

// MaxSlugLen acota el largo de un slug de proyecto.
const MaxSlugLen = 64

// ValidateSlug comprueba que un slug sea seguro para usar como nombre de
// directorio de primer nivel.
//
// Es una validación de seguridad, no de estilo: un slug entra en una ruta del
// filesystem, así que se rechaza cualquier cosa que pueda escapar de la raíz,
// colisionar con el directorio de estado o ser un nombre reservado.
func ValidateSlug(slug string) error {
	if slug == "" {
		return fmt.Errorf("el slug del proyecto está vacío")
	}
	if len(slug) > MaxSlugLen {
		return fmt.Errorf("el slug %q supera los %d caracteres", slug, MaxSlugLen)
	}
	if slug != Slug(slug) {
		return fmt.Errorf("el slug %q no está normalizado; usa %q", slug, Slug(slug))
	}
	if strings.HasPrefix(slug, ".") {
		return fmt.Errorf("el slug %q no puede empezar con punto", slug)
	}
	// Nombres reservados: el directorio de estado de SaveMe y los dispositivos
	// heredados de Windows, que en macOS/Linux también dan problemas si el
	// workspace se sincroniza a otra máquina.
	switch slug {
	case StateDirName, "con", "prn", "aux", "nul",
		"com1", "com2", "com3", "com4", "lpt1", "lpt2":
		return fmt.Errorf("el slug %q es un nombre reservado", slug)
	}
	return nil
}

// StateDirName es el nombre del directorio interno de estado dentro de la raíz.
// Se declara aquí y no en workspace para que ValidateSlug pueda rechazarlo sin
// crear un ciclo de imports.
const StateDirName = ".saveme"

// Estados del ciclo de vida de un resumen.
const (
	// StatusConfirmed lo escribió SaveMe con frontmatter completo y validado.
	StatusConfirmed = "confirmed"
	// StatusDraft es un archivo de SaveMe que un humano (o la UI) todavía no
	// confirmó.
	StatusDraft = "draft"
	// StatusUnmanaged es un .md que existe en el workspace pero no tiene
	// frontmatter de SaveMe. Se indexa para poder leerlo y buscarlo, pero
	// SaveMe nunca lo sobrescribe.
	StatusUnmanaged = "unmanaged"
)

// Project es un directorio de primer nivel dentro de la raíz del workspace.
type Project struct {
	Slug         string         `json:"slug"`
	Name         string         `json:"name"`
	Path         string         `json:"path"`
	CreatedAt    time.Time      `json:"created_at"`
	UpdatedAt    time.Time      `json:"updated_at"`
	Counts       map[string]int `json:"counts"`
	Total        int            `json:"total"`
	LastActivity *time.Time     `json:"last_activity,omitempty"`
}

// SummaryMeta es la fila indexada de un archivo markdown. No incluye el
// contenido: para eso está el endpoint de detalle, que lee el archivo del disco
// en vez de confiar en el índice.
type SummaryMeta struct {
	ID           string    `json:"id"`
	ProjectSlug  string    `json:"project_slug"`
	Category     string    `json:"category"`
	Title        string    `json:"title"`
	SummaryLine  string    `json:"summary_line"`
	RelPath      string    `json:"rel_path"`
	AbsPath      string    `json:"abs_path"`
	Status       string    `json:"status"`
	Author       string    `json:"author"`
	Agent        string    `json:"agent,omitempty"`
	CommitSHA    string    `json:"commit_sha,omitempty"`
	Tags         []string  `json:"tags"`
	FilesTouched []string  `json:"files_touched"`
	Related      []string  `json:"related"`
	WordCount    int       `json:"word_count"`
	SizeBytes    int64     `json:"size_bytes"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
	ContentHash  string    `json:"content_hash"`
}

// Frontmatter es el bloque YAML que encabeza cada archivo gestionado.
type Frontmatter struct {
	ID           string    `yaml:"id"`
	Title        string    `yaml:"title"`
	Category     string    `yaml:"category"`
	Project      string    `yaml:"project"`
	CreatedAt    time.Time `yaml:"created_at"`
	UpdatedAt    time.Time `yaml:"updated_at"`
	Author       string    `yaml:"author"`
	Agent        string    `yaml:"agent,omitempty"`
	Status       string    `yaml:"status"`
	Summary      string    `yaml:"summary,omitempty"`
	Tags         []string  `yaml:"tags,omitempty"`
	FilesTouched []string  `yaml:"files_touched,omitempty"`
	Commit       string    `yaml:"commit,omitempty"`
	Related      []string  `yaml:"related,omitempty"`
}

// Alternative es un destino concreto que se le ofrece al usuario además de la
// categoría inferida.
type Alternative struct {
	Category string `json:"category"`
	Folder   string `json:"folder"`
	Label    string `json:"label"`
	RelPath  string `json:"rel_path"`
}

// Proposal es una escritura propuesta que todavía NO ocurrió.
//
// Es el corazón de la garantía "siempre preguntar": existe en la base de datos,
// tiene TTL y es de un solo uso. Sin una Proposal viva no hay forma de escribir
// un resumen a través del MCP.
type Proposal struct {
	Token        string        `json:"token"`
	ProjectSlug  string        `json:"project_slug"`
	Category     string        `json:"category"`
	Title        string        `json:"title"`
	RelPath      string        `json:"rel_path"`
	AbsPath      string        `json:"abs_path"`
	Filename     string        `json:"filename"`
	ExpiresAt    time.Time     `json:"expires_at"`
	CreatedAt    time.Time     `json:"created_at"`
	Status       string        `json:"status"`
	Inference    Inference     `json:"inference"`
	Alternatives []Alternative `json:"alternatives"`
	Preview      string        `json:"preview"`
	BodyBytes    int           `json:"body_bytes"`
	Agent        string        `json:"agent,omitempty"`
	Tags         []string      `json:"tags"`
	FilesTouched []string      `json:"files_touched"`

	// Auditoría de la resolución. Es lo que permite responder después
	// "¿esto lo aprobó una persona o lo decidió el agente?".
	Decision    string     `json:"decision,omitempty"`
	ResolvedVia string     `json:"resolved_via,omitempty"`
	ResolvedAt  *time.Time `json:"resolved_at,omitempty"`
	SummaryID   string     `json:"summary_id,omitempty"`
}

// Estados de una propuesta.
const (
	ProposalPending   = "pending"
	ProposalConfirmed = "confirmed"
	ProposalCancelled = "cancelled"
	ProposalExpired   = "expired"
)

// Vías por las que se resolvió una propuesta. Se guardan para auditoría: es la
// diferencia entre "el usuario lo aprobó" y "el agente dijo que el usuario lo
// aprobó".
const (
	ResolvedViaElicitation = "elicitation"
	ResolvedViaAgentChat   = "agent_chat"
	ResolvedViaUI          = "ui"
	ResolvedViaCLI         = "cli"
)

// CreateRequest es la entrada del caso de uso de escritura de un resumen. La
// usan tanto el MCP como la API HTTP.
type CreateRequest struct {
	Project      string   `json:"project"`
	Title        string   `json:"title"`
	Body         string   `json:"body"`
	Category     string   `json:"category,omitempty"`
	Summary      string   `json:"summary,omitempty"`
	Tags         []string `json:"tags,omitempty"`
	FilesTouched []string `json:"files_touched,omitempty"`
	Agent        string   `json:"agent,omitempty"`
	Commit       string   `json:"commit,omitempty"`
	Related      []string `json:"related,omitempty"`
	Author       string   `json:"author,omitempty"`
	// Target es el resumen que esta petición **actualiza**, por id o por ruta
	// relativa. Vacío significa crear uno nuevo, que es el caso de siempre.
	//
	// Existe porque un diario que solo sabe añadir se degrada: iterando sobre la
	// misma funcionalidad acabas con diez entradas casi iguales y ninguna que
	// cuente la historia completa.
	Target string `json:"target,omitempty"`
}

// Validate comprueba lo mínimo indispensable para poder proponer algo.
func (r CreateRequest) Validate() error {
	if strings.TrimSpace(r.Project) == "" {
		return fmt.Errorf("falta el proyecto: indica a qué proyecto pertenece el resumen")
	}
	if strings.TrimSpace(r.Title) == "" {
		return fmt.Errorf("falta el título: es lo primero que verás en el historial")
	}
	if strings.TrimSpace(r.Body) == "" {
		return fmt.Errorf("falta el cuerpo del resumen")
	}
	return nil
}

// NoteMeta es lo que el índice sabe de una nota.
//
// No lleva el cuerpo: el cuerpo se lee del archivo cuando hace falta —al abrirla o
// al buscarla— porque el disco es la verdad. El índice solo guarda lo justo para
// listar y para buscar sin abrir nada.
type NoteMeta struct {
	// RelPath es relativo a la raíz del workspace, con el prefijo `notes/`.
	RelPath    string    `json:"rel_path"`
	Title      string    `json:"title"`
	SizeBytes  int64     `json:"size_bytes"`
	ModifiedAt time.Time `json:"modified_at"`
}
