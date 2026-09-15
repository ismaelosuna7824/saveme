package service

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/ismaelosuna/saveme/backend/internal/domain"
)

// ChangelogEntry es un resumen dentro de unas notas de versión.
type ChangelogEntry struct {
	ID           string    `json:"id"`
	Category     string    `json:"category"`
	Title        string    `json:"title"`
	SummaryLine  string    `json:"summary_line"`
	RelPath      string    `json:"rel_path"`
	CreatedAt    time.Time `json:"created_at"`
	Author       string    `json:"author"`
	CommitSHA    string    `json:"commit_sha,omitempty"`
	FilesTouched []string  `json:"files_touched"`
	Tags         []string  `json:"tags"`
}

// ChangelogSection agrupa por categoría, que es como está organizado el diario en
// disco y como se lee un changelog: features, fixes, chores.
type ChangelogSection struct {
	Category string           `json:"category"`
	Entries  []ChangelogEntry `json:"entries"`
}

// Changelog es lo escrito en un proyecto entre dos fechas, agrupado como unas notas
// de versión.
//
// Devuelve **datos y no un markdown montado**, por lo mismo que la exportación: los
// títulos de sección son texto que lee una persona y el idioma solo se conoce en la
// interfaz. El subcomando `saveme changelog` sí monta el markdown, porque un
// programa de línea de órdenes no tiene idioma de interfaz al que preguntar:
// escribe en el suyo, igual que escribe su propia ayuda.
type Changelog struct {
	Project  string             `json:"project"`
	From     time.Time          `json:"from"`
	To       time.Time          `json:"to"`
	Count    int                `json:"count"`
	Sections []ChangelogSection `json:"sections"`
}

// ChangelogDaysPorDefecto es la ventana cuando no se piden fechas: lo que cabría en
// una entrega normal.
const ChangelogDaysPorDefecto = 30

// ChangelogProject reúne lo escrito en un proyecto entre dos fechas, por categoría.
//
// Una fecha cero significa «lo que corresponda»: `to` vacío es ahora y `from` vacío
// son los últimos `ChangelogDaysPorDefecto` días. Se filtra por fecha de **creación**
// y no de modificación, por lo mismo que en el digest: unas notas de versión cuentan
// lo que pasó en ese rango, no lo que alguien editó en ese rango.
//
// Cada entrada lleva el título y la línea de resumen, no el cuerpo: lo que hace útil
// un changelog es que se lee de un tirón, y volcarlo entero lo convertiría en el
// diario otra vez. Para el diario completo está la exportación.
func (s *Service) ChangelogProject(
	ctx context.Context,
	slug string,
	from, to time.Time,
) (*Changelog, error) {
	slug = strings.TrimSpace(slug)
	if slug == "" {
		return nil, fmt.Errorf("%w: hace falta el proyecto", ErrInvalid)
	}
	if !s.ws.ProjectExists(slug) {
		return nil, fmt.Errorf("%w: el proyecto %q no existe", ErrNotFound, slug)
	}

	if to.IsZero() {
		to = time.Now()
	}
	if from.IsZero() {
		from = to.AddDate(0, 0, -ChangelogDaysPorDefecto)
	}
	if from.After(to) {
		return nil, fmt.Errorf("%w: la fecha de inicio (%s) es posterior a la de fin (%s)",
			ErrInvalid, from.Format("2006-01-02"), to.Format("2006-01-02"))
	}

	out := &Changelog{Project: slug, From: from, To: to, Sections: []ChangelogSection{}}
	entradas := map[string][]ChangelogEntry{}

	_, err := s.eachInWindow(ctx, slug, from, func(meta domain.SummaryMeta) {
		// `eachInWindow` recorre de lo más nuevo a lo más viejo, así que lo que cae
		// después del final del rango se salta en vez de cortar: el rango puede
		// terminar antes de hoy, que es justo el caso de unas notas ya publicadas.
		if meta.CreatedAt.After(to) {
			return
		}
		entradas[meta.Category] = append(entradas[meta.Category], ChangelogEntry{
			ID:           meta.ID,
			Category:     meta.Category,
			Title:        meta.Title,
			SummaryLine:  meta.SummaryLine,
			RelPath:      meta.RelPath,
			CreatedAt:    meta.CreatedAt,
			Author:       meta.Author,
			CommitSHA:    meta.CommitSHA,
			FilesTouched: meta.FilesTouched,
			Tags:         meta.Tags,
		})
	})
	if err != nil {
		return nil, err
	}

	presentes := make(map[string]bool, len(entradas))
	for key := range entradas {
		presentes[key] = true
	}

	for _, key := range canonicalOrder(presentes) {
		items := entradas[key]
		// Dentro de la sección, del más viejo al más nuevo: un changelog se lee como
		// una historia, y al revés obliga a leerlo de abajo arriba. `eachInWindow`
		// los deja al revés, así que se le da la vuelta aquí y no se reordena con un
		// criterio distinto por el camino.
		sort.SliceStable(items, func(i, j int) bool {
			return items[i].CreatedAt.Before(items[j].CreatedAt)
		})
		out.Sections = append(out.Sections, ChangelogSection{Category: key, Entries: items})
		out.Count += len(items)
	}

	return out, nil
}
