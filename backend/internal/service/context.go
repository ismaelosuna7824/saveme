package service

import (
	"context"
	"sort"
	"strings"

	"github.com/ismaelosuna/saveme/backend/internal/domain"
	"github.com/ismaelosuna/saveme/backend/internal/store"
)

// ContextoMax es cuántos resúmenes devuelve la consulta de contexto.
const ContextoMax = 20

// ContextForFiles devuelve los resúmenes que tocaron estos archivos.
//
// Responde a la pregunta que un agente se hace de verdad antes de ponerse:
// «voy a tocar `watch.go`, ¿qué se hizo aquí?». Las piezas ya estaban —los
// archivos se guardan desde el principio y se indexan—, pero no había ninguna
// puerta pensada para eso: había que ocurrírsele buscar, formular bien la consulta
// y cruzar resultados a mano. Esto convierte el diario en algo que el agente
// consulta, no solo en algo que alimenta.
//
// Se admiten varios archivos porque un cambio rara vez toca uno solo, y se
// deduplica: un resumen que menciona tres de ellos aparece una vez.
func (s *Service) ContextForFiles(ctx context.Context, files []string, limit int) ([]domain.SummaryMeta, error) {
	if limit <= 0 || limit > ContextoMax {
		limit = ContextoMax
	}

	vistos := make(map[string]bool)
	out := make([]domain.SummaryMeta, 0, limit)

	for _, file := range files {
		file = strings.TrimSpace(file)
		if file == "" {
			continue
		}
		metas, _, err := s.List(ctx, store.SummaryFilter{File: file, Sort: "recent", Limit: limit})
		if err != nil {
			return nil, err
		}
		for _, meta := range metas {
			if vistos[meta.ID] {
				continue
			}
			vistos[meta.ID] = true
			out = append(out, meta)
		}
	}

	// Lo más reciente primero: si algo se hizo tres veces sobre el mismo archivo,
	// lo que importa es lo último.
	sort.SliceStable(out, func(i, j int) bool {
		return out[i].CreatedAt.After(out[j].CreatedAt)
	})
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}
