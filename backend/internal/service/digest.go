package service

import (
	"context"
	"sort"
	"time"

	"github.com/ismaelosuna/saveme/backend/internal/domain"
	"github.com/ismaelosuna/saveme/backend/internal/store"
)

// DigestEntry es un resumen dentro de un digest.
type DigestEntry struct {
	ID          string    `json:"id"`
	ProjectSlug string    `json:"project_slug"`
	Category    string    `json:"category"`
	Title       string    `json:"title"`
	SummaryLine string    `json:"summary_line"`
	RelPath     string    `json:"rel_path"`
	CreatedAt   time.Time `json:"created_at"`
	Author      string    `json:"author"`
	CommitSHA   string    `json:"commit_sha,omitempty"`
}

// DigestDay agrupa lo de un día. Se agrupa por día y no por proyecto porque la
// pregunta que responde esto es «qué hice», y uno se acuerda de los días.
type DigestDay struct {
	// Date en AAAA-MM-DD, en la zona del servidor.
	Date    string        `json:"date"`
	Entries []DigestEntry `json:"entries"`
}

// Digest es lo hecho en un rango de fechas, en todos los proyectos.
type Digest struct {
	From  time.Time `json:"from"`
	To    time.Time `json:"to"`
	Days  int       `json:"days"`
	Count int       `json:"count"`
	// Projects cuenta en cuántos se trabajó, que es un dato que no se ve en la
	// lista pero cambia mucho la lectura de la semana.
	Projects int         `json:"projects"`
	Groups   []DigestDay `json:"groups"`
}

// DigestDaysPorDefecto es la ventana que se enseña si no se pide otra.
const DigestDaysPorDefecto = 7

// DigestMaxDias acota la ventana. Sin tope, un `days=100000` obligaría a recorrer
// el índice entero y devolver un documento enorme, que es una forma tonta de
// tumbar la app desde la barra de direcciones.
const DigestMaxDias = 365

// Digest reúne lo escrito en los últimos `days` días, de todos los proyectos.
//
// El filtro por fecha se hace aquí y no en SQL a propósito: el índice no tiene
// columna de fecha consultable en el filtro, y añadirla tocaría el esquema y las
// consultas para un caso que se resuelve recorriendo lo que ya se recorre al
// exportar. Si algún día el diario tiene decenas de miles de entradas, este es el
// sitio donde habrá que mirar.
func (s *Service) Digest(ctx context.Context, days int) (*Digest, error) {
	desde, ahora, days := dateWindow(days, DigestDaysPorDefecto, DigestMaxDias)

	// Se pagina porque el índice acota cada consulta a 500 filas.
	var metas []domain.SummaryMeta
	for offset := 0; ; offset += exportPageSize {
		page, total, err := s.List(ctx, store.SummaryFilter{
			Sort:   "recent",
			Limit:  exportPageSize,
			Offset: offset,
		})
		if err != nil {
			return nil, err
		}
		metas = append(metas, page...)
		if len(page) < exportPageSize || len(metas) >= total {
			break
		}
	}

	porDia := map[string][]DigestEntry{}
	proyectos := map[string]bool{}
	for _, meta := range metas {
		// Se mira la fecha de creación y no la de modificación: un resumen viejo
		// que alguien corrige hoy no es algo que hicieras hoy, y colarlo en el
		// digest de la semana lo llenaría de ruido.
		if meta.CreatedAt.Before(desde) {
			continue
		}
		dia := meta.CreatedAt.In(ahora.Location()).Format("2006-01-02")
		porDia[dia] = append(porDia[dia], DigestEntry{
			ID:          meta.ID,
			ProjectSlug: meta.ProjectSlug,
			Category:    meta.Category,
			Title:       meta.Title,
			SummaryLine: meta.SummaryLine,
			RelPath:     meta.RelPath,
			CreatedAt:   meta.CreatedAt,
			Author:      meta.Author,
			CommitSHA:   meta.CommitSHA,
		})
		proyectos[meta.ProjectSlug] = true
	}

	dias := make([]string, 0, len(porDia))
	for dia := range porDia {
		dias = append(dias, dia)
	}
	// El más reciente primero: un digest se lee de lo de hoy hacia atrás.
	sort.Sort(sort.Reverse(sort.StringSlice(dias)))

	out := &Digest{
		From:     desde,
		To:       ahora,
		Days:     days,
		Projects: len(proyectos),
		Groups:   make([]DigestDay, 0, len(dias)),
	}
	for _, dia := range dias {
		entries := porDia[dia]
		// Dentro del día, lo último primero, que es como se recuerda.
		sort.SliceStable(entries, func(i, j int) bool {
			return entries[i].CreatedAt.After(entries[j].CreatedAt)
		})
		out.Groups = append(out.Groups, DigestDay{Date: dia, Entries: entries})
		out.Count += len(entries)
	}

	if out.Count == 0 && len(out.Groups) == 0 {
		// Se devuelve igualmente el rango: un digest vacío es una respuesta válida
		// («no hiciste nada estos días»), no un error.
		out.Groups = []DigestDay{}
	}
	return out, nil
}
