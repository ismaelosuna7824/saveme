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

// dateWindow traduce «los últimos N días» al rango que usan el digest, el
// briefing y el mapa de actividad.
//
// Se cuenta desde el **comienzo** del día de hace N-1 días y no desde esta hora
// exacta, para que el día de hoy entre entero: contando desde la hora exacta, lo
// de esta mañana entraría y lo de ayer a la misma hora no, que no es lo que nadie
// espera al pedir «los últimos 7 días».
//
// Devuelve también el número de días ya acotado, porque quien lo llama lo publica
// en su respuesta y no puede quedarse con el valor que le pidieron.
func dateWindow(days, defecto, maximo int) (desde, hasta time.Time, dias int) {
	dias = days
	if dias <= 0 {
		dias = defecto
	}
	if dias > maximo {
		dias = maximo
	}

	hasta = time.Now()
	hoy := time.Date(hasta.Year(), hasta.Month(), hasta.Day(), 0, 0, 0, 0, hasta.Location())
	desde = hoy.AddDate(0, 0, -(dias - 1))
	return desde, hasta, dias
}

// EndOfDay lleva una fecha al último instante de ese día.
//
// Existe porque «hasta el 14» significa el 14 entero, y cortar a medianoche del 14
// deja fuera justo lo escrito ese día, que es lo que nadie espera. Lo comparten la
// CLI y la API a propósito: es el error de fechas más fácil de repetir, y con una
// sola copia solo se puede arreglar en un sitio. Una fecha cero se devuelve tal
// cual, porque significa «lo que corresponda» y eso lo decide el servicio.
func EndOfDay(t time.Time) time.Time {
	if t.IsZero() {
		return t
	}
	return t.AddDate(0, 0, 1).Add(-time.Nanosecond)
}

// eachInWindow recorre los resúmenes de un proyecto que caen dentro de la ventana,
// de lo más nuevo a lo más viejo, y devuelve cuántos tiene el proyecto entero.
//
// El índice no acepta la fecha en el filtro, pero sí sabe ordenar por ella, así que
// se pide por fecha de creación descendente y se corta en cuanto aparece el primer
// resumen anterior a la ventana: en vez de recorrer el proyecto entero se recorre
// solo lo que se va a mirar. Sin ese corte, un proyecto de miles de entradas
// pagaría el recorrido completo para pintar treinta días.
//
// Se filtra por fecha de **creación** y no de modificación, por lo mismo que en el
// digest: un resumen viejo que alguien corrige hoy no es algo que pasara hoy, y
// colarlo llenaría de ruido lo reciente.
//
// Ojo con el criterio de orden: `recent` ordena por `updated_at`, y aquí hace falta
// `created`, que ordena por `created_at`. Con el primero, el corte por fecha sería
// incorrecto —una fila antigua recién editada aparecería la primera y cortaría el
// recorrido antes de tiempo—.
func (s *Service) eachInWindow(
	ctx context.Context,
	slug string,
	desde time.Time,
	fn func(domain.SummaryMeta),
) (int, error) {
	total := 0
	for offset := 0; ; offset += exportPageSize {
		page, count, err := s.List(ctx, store.SummaryFilter{
			Project: slug,
			Sort:    "created",
			Limit:   exportPageSize,
			Offset:  offset,
		})
		if err != nil {
			return 0, err
		}
		if offset == 0 {
			total = count
		}

		fin := false
		for _, meta := range page {
			if meta.CreatedAt.Before(desde) {
				fin = true
				break
			}
			fn(meta)
		}
		if fin || len(page) < exportPageSize || offset+len(page) >= count {
			break
		}
	}
	return total, nil
}

// canonicalOrder ordena un conjunto de claves de categoría como las lee una
// persona: primero la taxonomía en su orden, después lo que la taxonomía no conoce.
//
// El conjunto de conocidas se arma desde la lista canónica y **no** con
// `CategoryByKey`: esa función resuelve también nombres de carpeta y devuelve
// cierto para "uncategorized", que es justo el cajón donde caen las desconocidas.
// Usándola, un resumen huérfano se quedaba fuera del documento.
//
// Las desconocidas se ordenan alfabéticamente porque en Go iterar un mapa da un
// orden distinto cada vez, y el documento no puede cambiar de una exportación a
// otra.
func canonicalOrder(keys map[string]bool) []string {
	canonicas := domain.Categories()
	conocidas := make(map[string]bool, len(canonicas))

	out := make([]string, 0, len(keys))
	for _, category := range canonicas {
		conocidas[category.Key] = true
		if keys[category.Key] {
			out = append(out, category.Key)
		}
	}

	var desconocidas []string
	for key := range keys {
		if !conocidas[key] {
			desconocidas = append(desconocidas, key)
		}
	}
	sort.Strings(desconocidas)
	return append(out, desconocidas...)
}

// BriefingFile es un archivo que aparece en los resúmenes de la ventana.
type BriefingFile struct {
	Path string `json:"path"`
	// Count es en cuántos resúmenes de la ventana se menciona. Es la señal de
	// «aquí es donde se ha estado trabajando».
	Count int `json:"count"`
	// LastAt es cuándo se mencionó por última vez.
	LastAt time.Time `json:"last_at"`
}

// Briefing responde «¿dónde lo dejamos?» en un proyecto.
type Briefing struct {
	Project     string    `json:"project"`
	GeneratedAt time.Time `json:"generated_at"`
	From        time.Time `json:"from"`
	Days        int       `json:"days"`
	// Total es el proyecto entero, no la ventana: es lo que distingue un proyecto
	// de tres entradas de uno de trescientas.
	Total int `json:"total"`
	// ActiveDays son los días de la ventana con algo escrito.
	ActiveDays int `json:"active_days"`
	// LastAt es cuándo se escribió lo último de la ventana. Va como puntero porque
	// «nunca» y «el 1 de enero de 1970» no son lo mismo, y una ventana vacía es una
	// respuesta válida, no un error.
	LastAt *time.Time `json:"last_at,omitempty"`
	// Last es lo último que pasó, lo más reciente primero.
	Last []DigestEntry `json:"last"`
	// Files son los archivos tocados, por número de menciones.
	Files []BriefingFile `json:"files"`
	// Pending son las propuestas esperando decisión, incluidas las vencidas: son
	// justo las que se quedaron a medias, que es lo que hay que ver al volver.
	Pending []domain.Proposal `json:"pending"`
}

const (
	// BriefingDaysPorDefecto es la ventana del briefing: un mes es lo que cubre
	// «en qué andaba yo».
	BriefingDaysPorDefecto = 30
	// BriefingMaxDias acota la ventana. Sin tope, un `days=100000` obligaría a
	// recorrer el índice entero y devolver un documento enorme.
	BriefingMaxDias = 365
	// BriefingUltimos es cuántas entradas recientes se listan. El briefing es un
	// resumen para retomar el hilo, no una lista: para la lista está el proyecto.
	BriefingUltimos = 8
	// BriefingArchivos es cuántos archivos se listan, ya ordenados por menciones.
	// Un proyecto puede tocar cientos; los primeros son los que dicen dónde se
	// estuvo trabajando.
	BriefingArchivos = 12
	// BriefingPropuestas acota cuántas propuestas se miran antes de filtrar por
	// proyecto.
	BriefingPropuestas = 200
)

// Briefing reúne lo necesario para retomar un proyecto: lo último que pasó, los
// archivos que se tocaron y lo que está esperando decisión.
func (s *Service) Briefing(ctx context.Context, slug string, days int) (*Briefing, error) {
	slug = strings.TrimSpace(slug)
	if slug == "" {
		return nil, fmt.Errorf("%w: hace falta el proyecto", ErrInvalid)
	}
	if !s.ws.ProjectExists(slug) {
		return nil, fmt.Errorf("%w: el proyecto %q no existe", ErrNotFound, slug)
	}

	desde, hasta, dias := dateWindow(days, BriefingDaysPorDefecto, BriefingMaxDias)

	out := &Briefing{
		Project:     slug,
		GeneratedAt: hasta,
		From:        desde,
		Days:        dias,
		Last:        []DigestEntry{},
		Files:       []BriefingFile{},
		Pending:     []domain.Proposal{},
	}

	diasConAlgo := map[string]bool{}
	archivos := map[string]*BriefingFile{}

	total, err := s.eachInWindow(ctx, slug, desde, func(meta domain.SummaryMeta) {
		if len(out.Last) < BriefingUltimos {
			out.Last = append(out.Last, DigestEntry{
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
		}

		// El recorrido va de lo más nuevo a lo más viejo, así que el primero que
		// entra en la ventana es el último que se escribió.
		if out.LastAt == nil {
			cuando := meta.CreatedAt
			out.LastAt = &cuando
		}

		diasConAlgo[meta.CreatedAt.In(hasta.Location()).Format("2006-01-02")] = true

		for _, path := range meta.FilesTouched {
			path = strings.TrimSpace(path)
			if path == "" {
				continue
			}
			actual, ok := archivos[path]
			if !ok {
				actual = &BriefingFile{Path: path}
				archivos[path] = actual
			}
			actual.Count++
			if meta.CreatedAt.After(actual.LastAt) {
				actual.LastAt = meta.CreatedAt
			}
		}
	})
	if err != nil {
		return nil, err
	}

	out.Total = total
	out.ActiveDays = len(diasConAlgo)

	for _, archivo := range archivos {
		out.Files = append(out.Files, *archivo)
	}
	// Más menciones primero y, a igualdad, lo más reciente: dos archivos tocados
	// las mismas veces no valen lo mismo si uno se tocó ayer y el otro hace un mes.
	sort.Slice(out.Files, func(i, j int) bool {
		if out.Files[i].Count != out.Files[j].Count {
			return out.Files[i].Count > out.Files[j].Count
		}
		return out.Files[i].LastAt.After(out.Files[j].LastAt)
	})
	if len(out.Files) > BriefingArchivos {
		out.Files = out.Files[:BriefingArchivos]
	}

	// Las vencidas cuentan: son las propuestas que nadie resolvió a tiempo, y son
	// exactamente lo que hay que mirar al retomar el proyecto. `ListProposals` no
	// filtra por proyecto, así que se filtra aquí.
	for _, status := range []string{domain.ProposalPending, domain.ProposalExpired} {
		propuestas, err := s.ListProposals(ctx, status, BriefingPropuestas)
		if err != nil {
			return nil, err
		}
		for _, propuesta := range propuestas {
			if propuesta.ProjectSlug == slug {
				out.Pending = append(out.Pending, propuesta)
			}
		}
	}
	sort.SliceStable(out.Pending, func(i, j int) bool {
		return out.Pending[i].CreatedAt.After(out.Pending[j].CreatedAt)
	})

	return out, nil
}

// ActivityDay es lo escrito un día concreto.
type ActivityDay struct {
	// Date en AAAA-MM-DD, en la zona del servidor.
	Date  string `json:"date"`
	Count int    `json:"count"`
	// ByCategory reparte el día. Va vacío y no nil cuando no hubo nada, para que la
	// interfaz no tenga que distinguir «cero» de «sin dato».
	ByCategory map[string]int `json:"by_category"`
}

// Activity es el mapa de actividad de un proyecto: qué días se trabajó y cuánto.
type Activity struct {
	Project     string    `json:"project"`
	GeneratedAt time.Time `json:"generated_at"`
	From        time.Time `json:"from"`
	To          time.Time `json:"to"`
	Days        int       `json:"days"`
	Total       int       `json:"total"`
	// Active son los días de la ventana con algo escrito.
	Active int `json:"active"`
	// Max es el día más cargado. La interfaz lo necesita para escalar la
	// intensidad: sin él tendría que recorrer las 365 celdas otra vez, y está aquí
	// ya calculado.
	Max int `json:"max"`
	// ByCategory es el reparto de toda la ventana.
	ByCategory map[string]int `json:"by_category"`
	// Entries cubre **todos** los días de la ventana, del más viejo al más nuevo y
	// con los vacíos incluidos: así el mapa se pinta recorriendo el array y no
	// calculando fechas en la interfaz, que es donde se cuelan los errores de
	// husos y de cambios de mes.
	Entries []ActivityDay `json:"entries"`
}

const (
	// ActivityDaysPorDefecto es un año: el mapa se mira para ver la forma del
	// proyecto, y la forma solo aparece con el año entero.
	ActivityDaysPorDefecto = 365
	// ActivityMaxDias acota la ventana, por lo mismo que en el briefing.
	ActivityMaxDias = 730
)

// ActivityMap reúne el trabajo por día en un proyecto.
func (s *Service) ActivityMap(ctx context.Context, slug string, days int) (*Activity, error) {
	slug = strings.TrimSpace(slug)
	if slug == "" {
		return nil, fmt.Errorf("%w: hace falta el proyecto", ErrInvalid)
	}
	if !s.ws.ProjectExists(slug) {
		return nil, fmt.Errorf("%w: el proyecto %q no existe", ErrNotFound, slug)
	}

	desde, hasta, dias := dateWindow(days, ActivityDaysPorDefecto, ActivityMaxDias)

	porDia := map[string]*ActivityDay{}
	porCategoria := map[string]int{}

	_, err := s.eachInWindow(ctx, slug, desde, func(meta domain.SummaryMeta) {
		dia := meta.CreatedAt.In(hasta.Location()).Format("2006-01-02")
		actual, ok := porDia[dia]
		if !ok {
			actual = &ActivityDay{Date: dia, ByCategory: map[string]int{}}
			porDia[dia] = actual
		}
		actual.Count++
		actual.ByCategory[meta.Category]++
		porCategoria[meta.Category]++
	})
	if err != nil {
		return nil, err
	}

	// Se recorre el calendario y no el mapa: así salen todos los días, incluso los
	// que no tienen nada, y en orden.
	hoy := time.Date(hasta.Year(), hasta.Month(), hasta.Day(), 0, 0, 0, 0, hasta.Location())
	out := &Activity{
		Project:     slug,
		GeneratedAt: hasta,
		From:        desde,
		To:          hasta,
		Days:        dias,
		ByCategory:  porCategoria,
		Entries:     make([]ActivityDay, 0, dias),
	}
	for dia := desde; !dia.After(hoy); dia = dia.AddDate(0, 0, 1) {
		clave := dia.Format("2006-01-02")
		if entrada, ok := porDia[clave]; ok {
			out.Entries = append(out.Entries, *entrada)
			out.Active++
			out.Total += entrada.Count
			if entrada.Count > out.Max {
				out.Max = entrada.Count
			}
			continue
		}
		out.Entries = append(out.Entries, ActivityDay{Date: clave, ByCategory: map[string]int{}})
	}

	return out, nil
}
