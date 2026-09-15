package service

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/ismaelosuna/saveme/backend/internal/domain"
	"github.com/ismaelosuna/saveme/backend/internal/store"
)

// ProjectExport es todo un proyecto, listo para que la interfaz lo componga.
//
// Devuelve **datos y no un markdown ya montado** a propósito. Los títulos de
// sección son texto que lee una persona, y el idioma solo se conoce en la
// interfaz: si el documento se montara aquí, las secciones saldrían en el idioma
// que estuviera escrito en Go —que es ninguno— o habría que duplicar las
// traducciones en el núcleo. Montarlo en la interfaz deja cada cosa en su sitio.
type ProjectExport struct {
	Project     string    `json:"project"`
	GeneratedAt time.Time `json:"generated_at"`
	Count       int       `json:"count"`
	// Skipped son los resúmenes que el índice conocía pero ya no se pudieron leer
	// (los borró alguien entre la consulta y la lectura). Va aparte para que quien
	// exporta sepa que el documento no está completo, en vez de recibir uno que
	// parece completo y no lo es.
	Skipped  int             `json:"skipped"`
	Sections []ExportSection `json:"sections"`
}

// ExportSection agrupa por categoría, que es como está organizado el diario en
// disco y como se lee mejor.
type ExportSection struct {
	Category  string        `json:"category"`
	Summaries []ExportEntry `json:"summaries"`
}

// ExportEntry es un resumen con su cuerpo ya sin frontmatter.
type ExportEntry struct {
	ID           string    `json:"id"`
	Title        string    `json:"title"`
	RelPath      string    `json:"rel_path"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
	Tags         []string  `json:"tags"`
	FilesTouched []string  `json:"files_touched"`
	CommitSHA    string    `json:"commit_sha,omitempty"`
	Body         string    `json:"body"`
}

// exportPageSize es el tope que acepta el índice por consulta.
const exportPageSize = 500

// ExportProject reúne todos los resúmenes de un proyecto, por categoría y en
// orden cronológico, con el cuerpo de cada uno.
//
// Se lee del índice pero **el cuerpo sale del disco** (vía `Read`), así que el
// documento refleja lo que hay escrito y no lo que se indexó en su día.
func (s *Service) ExportProject(ctx context.Context, slug string) (*ProjectExport, error) {
	slug = strings.TrimSpace(slug)
	if slug == "" {
		return nil, fmt.Errorf("%w: hace falta el proyecto", ErrInvalid)
	}
	if !s.ws.ProjectExists(slug) {
		return nil, fmt.Errorf("%w: el proyecto %q no existe", ErrNotFound, slug)
	}

	// Se pagina a propósito: el índice acota cada consulta a 500 filas, así que
	// sin esto un proyecto con más resúmenes se exportaría a medias y sin decir
	// nada. Un documento incompleto que parece completo es peor que un error.
	var metas []domain.SummaryMeta
	for offset := 0; ; offset += exportPageSize {
		page, total, err := s.List(ctx, store.SummaryFilter{
			Project: slug,
			Sort:    "oldest",
			Limit:   exportPageSize,
			Offset:  offset,
		})
		if err != nil {
			return nil, err
		}
		metas = append(metas, page...)
		if len(page) < exportPageSize || len(metas) >= total {
			break
		}
	}

	out := &ProjectExport{
		Project:     slug,
		GeneratedAt: time.Now().UTC(),
	}

	entries := make(map[string][]ExportEntry, len(metas))
	for _, meta := range metas {
		_, body, err := s.Read(ctx, meta.ID)
		if err != nil {
			// Un resumen que desapareció entre la consulta y la lectura no puede
			// tumbar la exportación, pero tampoco puede desaparecer sin dejar
			// rastro: se cuenta, y quien exporta decide si le vale así.
			out.Skipped++
			continue
		}
		entries[meta.Category] = append(entries[meta.Category], ExportEntry{
			ID:           meta.ID,
			Title:        meta.Title,
			RelPath:      meta.RelPath,
			CreatedAt:    meta.CreatedAt,
			UpdatedAt:    meta.UpdatedAt,
			Tags:         meta.Tags,
			FilesTouched: meta.FilesTouched,
			CommitSHA:    meta.CommitSHA,
			Body:         strings.TrimRight(body, "\n"),
		})
	}

	// Las categorías se recorren en el orden canónico de la taxonomía y no en el que
	// devuelva la consulta: así el documento sale siempre igual, los proyectos se
	// leen en el mismo orden y las categorías sin nada no aparecen. Lo que la
	// taxonomía no conoce se añade al final en vez de perderse por el camino; el
	// porqué de las dos cosas está en `canonicalOrder`.
	presentes := make(map[string]bool, len(entries))
	for key := range entries {
		presentes[key] = true
	}
	for _, key := range canonicalOrder(presentes) {
		items := entries[key]
		out.Sections = append(out.Sections, ExportSection{Category: key, Summaries: items})
		out.Count += len(items)
	}

	return out, nil
}
