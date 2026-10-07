package service

import (
	"context"
	"sort"

	"github.com/ismaelosuna/saveme/backend/internal/domain"
	"github.com/ismaelosuna/saveme/backend/internal/gitrepo"
	"github.com/ismaelosuna/saveme/backend/internal/store"
)

// Salud del diario.
//
// Un diario envejece sin hacer ruido: resúmenes cuyo código siguió cambiando,
// resúmenes que no dicen qué archivos tocaron —y por eso nunca podrán avisar de
// que se quedaron viejos—, proyectos sin repo vinculado. Cada cosa por separado
// se ve abriendo resumen por resumen; esto lo junta en un solo sitio, con la
// lista de lo que hay que mirar.

// HealthItem es un resumen que merece una mirada.
type HealthItem struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	// Count son los commits posteriores, en los desactualizados.
	Count int `json:"count,omitempty"`
}

// ProjectHealth es la salud de un proyecto.
type ProjectHealth struct {
	Slug  string `json:"slug"`
	Name  string `json:"name"`
	Total int    `json:"total"`
	// RepoLinked: tiene repo vinculado. RepoReachable: además está donde se vio
	// por última vez, que es lo que permite contar commits desde la app.
	RepoLinked    bool `json:"repo_linked"`
	RepoReachable bool `json:"repo_reachable"`
	// Stale son los resúmenes con StaleThreshold o más commits posteriores en sus
	// archivos, del más afectado al menos.
	Stale []HealthItem `json:"stale"`
	// NoFiles son los vigentes que no apuntan archivos: no pueden avisar si envejecen.
	NoFiles []HealthItem `json:"no_files"`
	// Superseded es cuántos ya están sustituidos por otro.
	Superseded int `json:"superseded"`
}

// HealthTotals suma los proyectos.
type HealthTotals struct {
	Projects            int `json:"projects"`
	Summaries           int `json:"summaries"`
	Stale               int `json:"stale"`
	NoFiles             int `json:"no_files"`
	Superseded          int `json:"superseded"`
	ProjectsWithoutRepo int `json:"projects_without_repo"`
}

// JournalHealth es el estado de todo el diario.
type JournalHealth struct {
	// GitAvailable: sin git no se puede contar nada contra los repos.
	GitAvailable bool            `json:"git_available"`
	Projects     []ProjectHealth `json:"projects"`
	Totals       HealthTotals    `json:"totals"`
}

// projectSummaries devuelve todos los resúmenes de un proyecto, con los
// sustituidos marcados. Pagina porque el índice acota cada consulta a 500.
func (s *Service) projectSummaries(ctx context.Context, slug string) ([]domain.SummaryMeta, error) {
	var out []domain.SummaryMeta
	for offset := 0; ; offset += exportPageSize {
		page, total, err := s.List(ctx, store.SummaryFilter{
			Project: slug, Sort: "recent", Limit: exportPageSize, Offset: offset,
		})
		if err != nil {
			return nil, err
		}
		out = append(out, page...)
		if len(page) < exportPageSize || len(out) >= total {
			return out, nil
		}
	}
}

// reachableRepo devuelve la raíz del repo vinculado a un proyecto, si sigue
// donde se vio por última vez y es el mismo repo. Es la única forma de mirar el
// código desde la app, que no tiene un agente que le diga dónde está.
func (s *Service) reachableRepo(ctx context.Context, slug string) (top string, linked bool) {
	links, err := s.ws.RepoLinks()
	if err != nil {
		return "", false
	}
	i := findProjectLink(links, slug)
	if i < 0 {
		return "", false
	}
	link := links[i]
	if link.LastPath == "" {
		return "", true
	}
	here, err := gitrepo.Detect(ctx, link.LastPath)
	if err != nil || !here.Same(gitrepo.Identity{Remote: link.Remote, RootCommit: link.RootCommit}) {
		return "", true
	}
	return here.Toplevel, true
}

// Health calcula la salud de todo el diario.
//
// Contar commits ejecuta git una vez por resumen con archivos, así que solo se
// hace en los proyectos cuyo repo está a mano; los demás dicen por qué no.
func (s *Service) Health(ctx context.Context) (*JournalHealth, error) {
	projects, err := s.ListProjects(ctx)
	if err != nil {
		return nil, err
	}
	_, gitErr := gitrepo.Available()
	out := &JournalHealth{GitAvailable: gitErr == nil, Projects: make([]ProjectHealth, 0, len(projects))}

	for _, p := range projects {
		metas, err := s.projectSummaries(ctx, p.Slug)
		if err != nil {
			return nil, err
		}
		ph := ProjectHealth{
			Slug: p.Slug, Name: p.Name, Total: len(metas),
			Stale: []HealthItem{}, NoFiles: []HealthItem{},
		}
		top := ""
		if out.GitAvailable {
			top, ph.RepoLinked = s.reachableRepo(ctx, p.Slug)
		} else {
			ph.RepoLinked = p.Repo != nil
		}
		ph.RepoReachable = top != ""

		for _, m := range metas {
			switch {
			case m.SupersededBy != "":
				ph.Superseded++
			case len(m.FilesTouched) == 0:
				ph.NoFiles = append(ph.NoFiles, HealthItem{ID: m.ID, Title: m.Title})
			case top != "":
				f := s.freshnessIn(ctx, m, top)
				if f.Available && f.Stale {
					ph.Stale = append(ph.Stale, HealthItem{ID: m.ID, Title: m.Title, Count: f.Count})
				}
			}
		}
		sort.SliceStable(ph.Stale, func(i, j int) bool { return ph.Stale[i].Count > ph.Stale[j].Count })

		out.Projects = append(out.Projects, ph)
		out.Totals.Projects++
		out.Totals.Summaries += ph.Total
		out.Totals.Stale += len(ph.Stale)
		out.Totals.NoFiles += len(ph.NoFiles)
		out.Totals.Superseded += ph.Superseded
		if !ph.RepoLinked {
			out.Totals.ProjectsWithoutRepo++
		}
	}
	// Primero lo que más atención pide: desactualizados, luego sin archivos.
	sort.SliceStable(out.Projects, func(i, j int) bool {
		a, b := out.Projects[i], out.Projects[j]
		if len(a.Stale) != len(b.Stale) {
			return len(a.Stale) > len(b.Stale)
		}
		return len(a.NoFiles) > len(b.NoFiles)
	})
	return out, nil
}
