package service

import (
	"context"
	"errors"
	"time"

	"github.com/ismaelosuna/saveme/backend/internal/domain"
	"github.com/ismaelosuna/saveme/backend/internal/gitrepo"
)

// Resúmenes que pueden estar desactualizados.
//
// Un resumen apunta los archivos que tocó. Si esos archivos siguieron cambiando
// en el repo después de escribirlo, lo que cuenta puede haber dejado de ser
// verdad: es la forma en que envejece cualquier documentación, sin que nadie lo
// note. Esto lo cuenta en commits, a partir del repo vinculado al proyecto.

// StaleThreshold es a partir de cuántos commits posteriores un resumen se marca
// como posiblemente desactualizado. Uno o dos suelen ser retoques —el commit del
// propio cambio, una errata—; tres ya son trabajo nuevo sobre lo mismo.
const StaleThreshold = 3

// FreshnessGrace es el margen tras escribir un resumen sin commit apuntado. El
// agente suele escribir el resumen **antes** de hacer el commit del cambio: sin
// margen, todo resumen nacería con un commit «posterior», el suyo.
const FreshnessGrace = 2 * time.Hour

// Motivos por los que no se pudo calcular. Son claves estables para la interfaz.
const (
	FreshnessNoFiles    = "no_files"   // el resumen no apunta archivos
	FreshnessNoRepo     = "no_repo"    // el proyecto no tiene repo vinculado
	FreshnessRepoMoved  = "repo_moved" // donde se vio el repo ya no está (o es otro)
	FreshnessNoGit      = "no_git"     // git no está disponible
	FreshnessOtherRepo  = "other_repo" // el repo del agente es de otro proyecto
	FreshnessSuperseded = "superseded" // ya lo sustituyó otro: no hace falta mirar
	FreshnessGitFailed  = "git_failed" // git falló al preguntar
)

// Freshness es lo que pasó en el código desde que se escribió un resumen.
type Freshness struct {
	// Available dice si se pudo calcular; si no, Reason dice por qué.
	Available bool   `json:"available"`
	Reason    string `json:"reason,omitempty"`
	// Count es cuántos commits tocaron sus archivos después de escribirlo.
	Count int `json:"count"`
	// Stale es Count >= StaleThreshold.
	Stale bool `json:"stale"`
	// Latest son los commits más recientes, para saber qué mirar.
	Latest []gitrepo.Commit `json:"latest"`
	// Since dice desde dónde se contó: el commit del resumen o su fecha más el margen.
	Since string `json:"since,omitempty"`
}

func unavailable(reason string) Freshness {
	return Freshness{Reason: reason, Latest: []gitrepo.Commit{}}
}

// freshnessIn calcula la frescura de un resumen en un repo ya localizado.
func (s *Service) freshnessIn(ctx context.Context, meta domain.SummaryMeta, top string) Freshness {
	if meta.SupersededBy != "" {
		return unavailable(FreshnessSuperseded)
	}
	if len(meta.FilesTouched) == 0 {
		return unavailable(FreshnessNoFiles)
	}
	since := meta.CreatedAt.Add(FreshnessGrace)
	changes, err := gitrepo.ChangesSince(ctx, top, meta.FilesTouched, meta.CommitSHA, since, 3)
	if err != nil {
		if errors.Is(err, gitrepo.ErrNoGit) {
			return unavailable(FreshnessNoGit)
		}
		return unavailable(FreshnessGitFailed)
	}
	out := Freshness{
		Available: true,
		Count:     changes.Count,
		Stale:     changes.Count >= StaleThreshold,
		Latest:    changes.Latest,
		Since:     since.UTC().Format(time.RFC3339),
	}
	if meta.CommitSHA != "" {
		out.Since = meta.CommitSHA
	}
	return out
}

// Freshness calcula la frescura de un resumen para la app, que no tiene un
// agente que le diga dónde está el repo: usa la última ruta en la que se vio el
// repo del proyecto, y solo si ahí sigue estando el mismo repo.
func (s *Service) Freshness(ctx context.Context, id string) (Freshness, error) {
	meta, _, err := s.ReadRaw(ctx, id)
	if err != nil {
		return Freshness{}, err
	}
	if len(meta.FilesTouched) == 0 {
		return unavailable(FreshnessNoFiles), nil
	}
	if meta.SupersededBy != "" {
		return unavailable(FreshnessSuperseded), nil
	}
	if _, err := gitrepo.Available(); err != nil {
		return unavailable(FreshnessNoGit), nil
	}
	top, linked := s.reachableRepo(ctx, meta.ProjectSlug)
	switch {
	case !linked:
		return unavailable(FreshnessNoRepo), nil
	case top == "":
		// La carpeta ya no existe, o ahora hay otro repo: contar commits de otro
		// repo sería inventarse la respuesta.
		return unavailable(FreshnessRepoMoved), nil
	}
	return s.freshnessIn(ctx, meta, top), nil
}

// FreshnessForAgent calcula la frescura de varios resúmenes desde el directorio
// del agente. Solo se calcula para los resúmenes del proyecto vinculado a ese
// repo: los archivos de un resumen de otro proyecto no son rutas de este repo.
func (s *Service) FreshnessForAgent(ctx context.Context, metas []domain.SummaryMeta, cwd string) map[string]Freshness {
	out := make(map[string]Freshness, len(metas))
	repo := s.detectRepo(ctx, cwd)
	for _, m := range metas {
		switch {
		case repo == nil:
			out[m.ID] = unavailable(FreshnessNoRepo)
		case repo.link == nil || repo.link.Project != m.ProjectSlug:
			out[m.ID] = unavailable(FreshnessOtherRepo)
		default:
			out[m.ID] = s.freshnessIn(ctx, m, repo.id.Toplevel)
		}
	}
	return out
}
