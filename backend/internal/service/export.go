package service

import (
	"context"
	"fmt"
	"sort"
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
	Project     string          `json:"project"`
	GeneratedAt time.Time       `json:"generated_at"`
	Count       int             `json:"count"`
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

	// Las categorías se recorren en el orden canónico de la taxonomía, no en el
	// que devuelva la consulta: así el documento sale siempre igual, y las
	// categorías que no tienen nada no aparecen.
	//
	// El conjunto de conocidas se arma desde la lista canónica y **no** con
	// `CategoryByKey`: esa función resuelve también nombres de carpeta y devuelve
	// cierto para "uncategorized", que es justo el cajón donde caen las
	// desconocidas. Usándola, un resumen huérfano se quedaba fuera del documento.
	canonicas := domain.Categories()
	conocidas := make(map[string]bool, len(canonicas))
	for _, c := range canonicas {
		conocidas[c.Key] = true
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

	for _, category := range canonicas {
		items := entries[category.Key]
		if len(items) == 0 {
			continue
		}
		out.Sections = append(out.Sections, ExportSection{Category: category.Key, Summaries: items})
		out.Count += len(items)
	}

	// Lo que quedó en una categoría que la taxonomía no conoce (un archivo escrito
	// a mano, una categoría retirada) no se puede perder por el camino: se añade al
	// final en vez de desaparecer del documento.
	//
	// Se recorren las claves ordenadas para que el documento no cambie de una
	// exportación a otra: en Go, iterar un mapa da un orden distinto cada vez.
	var desconocidas []string
	for key := range entries {
		if !conocidas[key] {
			desconocidas = append(desconocidas, key)
		}
	}
	sort.Strings(desconocidas)
	for _, key := range desconocidas {
		out.Sections = append(out.Sections, ExportSection{Category: key, Summaries: entries[key]})
		out.Count += len(entries[key])
	}

	return out, nil
}
