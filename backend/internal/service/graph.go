package service

import (
	"context"
	"errors"
	"sort"
	"strings"
	"time"

	"github.com/ismaelosuna/saveme/backend/internal/domain"
	"github.com/ismaelosuna/saveme/backend/internal/gitrepo"
	"github.com/ismaelosuna/saveme/backend/internal/store"
)

// --- mapa de decisiones -------------------------------------------------------

// MaxGraphNodes acota el mapa. Más nodos no caben en una pantalla de forma que se
// lean: con más, se enseñan los más recientes y se dice cuántos se quedaron fuera.
const MaxGraphNodes = 60

// GraphNode es un resumen en el mapa.
type GraphNode struct {
	ID          string    `json:"id"`
	Title       string    `json:"title"`
	Category    string    `json:"category"`
	ProjectSlug string    `json:"project_slug"`
	CreatedAt   time.Time `json:"created_at"`
	// Superseded: otro lo deja sin vigencia.
	Superseded bool `json:"superseded"`
	// Stale: sus archivos tienen StaleThreshold o más commits posteriores. Solo se
	// calcula si el repo del proyecto está a mano.
	Stale bool `json:"stale"`
	// External: es de otro proyecto; está porque un resumen de este lo enlaza.
	External bool `json:"external"`
}

// GraphEdge une dos resúmenes. `From` es el que nombra al otro en su frontmatter.
type GraphEdge struct {
	From string `json:"from"`
	To   string `json:"to"`
	// Kind es `related` o `supersedes`.
	Kind string `json:"kind"`
}

// Graph es el mapa de decisiones de un proyecto.
type Graph struct {
	Nodes []GraphNode `json:"nodes"`
	Edges []GraphEdge `json:"edges"`
	// Isolated es cuántos resúmenes del proyecto no enlazan ni son enlazados.
	Isolated int `json:"isolated"`
	// Omitted es cuántos enlazados se quedaron fuera por MaxGraphNodes.
	Omitted int `json:"omitted"`
}

// ProjectGraph monta el mapa de un proyecto: los resúmenes que se enlazan entre
// sí (`related`) o se sustituyen (`supersedes`). Los que no tienen ningún enlace
// no aportan nada a un mapa y solo se cuentan.
func (s *Service) ProjectGraph(ctx context.Context, slug string) (*Graph, error) {
	if _, err := s.GetProject(ctx, slug); err != nil {
		return nil, err
	}
	metas, err := s.projectSummaries(ctx, slug)
	if err != nil {
		return nil, err
	}

	byRef := make(map[string]domain.SummaryMeta, len(metas)*2)
	for _, m := range metas {
		byRef[m.ID] = m
		byRef[m.RelPath] = m
	}
	// resolve encuentra el destino de una referencia del frontmatter, que puede
	// ser un id o una ruta, y puede estar en otro proyecto.
	resolve := func(ref string) (domain.SummaryMeta, bool) {
		if m, ok := byRef[ref]; ok {
			return m, true
		}
		m, err := s.st.GetSummary(ctx, ref)
		if errors.Is(err, store.ErrNotFound) {
			m, err = s.st.GetSummaryByRelPath(ctx, ref)
		}
		if err != nil {
			return domain.SummaryMeta{}, false
		}
		byRef[ref] = m
		return m, true
	}

	nodes := map[string]domain.SummaryMeta{}
	seen := map[[3]string]bool{}
	edges := []GraphEdge{}
	add := func(from domain.SummaryMeta, refs []string, kind string) {
		for _, ref := range refs {
			to, ok := resolve(strings.TrimSpace(ref))
			if !ok || to.ID == from.ID {
				continue
			}
			key := [3]string{from.ID, to.ID, kind}
			if seen[key] {
				continue
			}
			seen[key] = true
			nodes[from.ID], nodes[to.ID] = from, to
			edges = append(edges, GraphEdge{From: from.ID, To: to.ID, Kind: kind})
		}
	}
	for _, m := range metas {
		add(m, m.Supersedes, "supersedes")
		add(m, m.Related, "related")
	}

	g := &Graph{Nodes: []GraphNode{}, Edges: []GraphEdge{}}
	for _, m := range metas {
		if _, ok := nodes[m.ID]; !ok {
			g.Isolated++
		}
	}

	ordered := make([]domain.SummaryMeta, 0, len(nodes))
	for _, m := range nodes {
		ordered = append(ordered, m)
	}
	sort.Slice(ordered, func(i, j int) bool { return ordered[i].CreatedAt.After(ordered[j].CreatedAt) })
	if len(ordered) > MaxGraphNodes {
		g.Omitted = len(ordered) - MaxGraphNodes
		ordered = ordered[:MaxGraphNodes]
	}
	// Del más antiguo al más nuevo: el mapa se lee en el orden en que se decidió.
	sort.SliceStable(ordered, func(i, j int) bool { return ordered[i].CreatedAt.Before(ordered[j].CreatedAt) })

	// Los externos y los que vienen de otros proyectos llegan sin marcar.
	if err := s.markSuperseded(ctx, ordered); err != nil {
		return nil, err
	}
	top, _ := s.reachableRepo(ctx, slug)
	kept := make(map[string]bool, len(ordered))
	for _, m := range ordered {
		kept[m.ID] = true
		node := GraphNode{
			ID: m.ID, Title: m.Title, Category: m.Category, ProjectSlug: m.ProjectSlug,
			CreatedAt: m.CreatedAt, Superseded: m.SupersededBy != "", External: m.ProjectSlug != slug,
		}
		if top != "" && !node.External {
			node.Stale = s.freshnessIn(ctx, m, top).Stale
		}
		g.Nodes = append(g.Nodes, node)
	}
	for _, e := range edges {
		if kept[e.From] && kept[e.To] {
			g.Edges = append(g.Edges, e)
		}
	}
	return g, nil
}

// --- línea de tiempo ----------------------------------------------------------

// TimelineMaxCommits acota los commits que se cruzan con los resúmenes.
const TimelineMaxCommits = 300

// TimelineCommit es un commit del repo vinculado, en la línea de tiempo.
type TimelineCommit struct {
	gitrepo.Commit
	// URL es su página en GitHub, GitLab o Bitbucket; vacía en otros.
	URL string `json:"url,omitempty"`
	// DocumentedBy es el resumen que lo apunta en `commit`, si alguno lo hace.
	DocumentedBy string `json:"documented_by,omitempty"`
}

// Timeline es la historia de un proyecto: sus resúmenes y, si el repo está a
// mano, los commits del repo, para verlos juntos en el tiempo.
type Timeline struct {
	Summaries []domain.SummaryMeta `json:"summaries"`
	Commits   []TimelineCommit     `json:"commits"`
	// Repo dice si hay commits y, si no, por qué: `linked` (hay repo y está a
	// mano), `no_repo` o `repo_moved`.
	Repo string `json:"repo"`
}

// ProjectTimeline junta los resúmenes del proyecto y los últimos commits de su
// repo. Un commit que algún resumen apunta en `commit` sale marcado como
// documentado: los que no lo están son el trabajo del que no quedó nada escrito.
func (s *Service) ProjectTimeline(ctx context.Context, slug string) (*Timeline, error) {
	project, err := s.GetProject(ctx, slug)
	if err != nil {
		return nil, err
	}
	metas, err := s.projectSummaries(ctx, slug)
	if err != nil {
		return nil, err
	}
	for i := range metas {
		s.withCommitURL(&metas[i])
	}
	out := &Timeline{Summaries: metas, Commits: []TimelineCommit{}, Repo: "no_repo"}
	if out.Summaries == nil {
		out.Summaries = []domain.SummaryMeta{}
	}

	top, linked := s.reachableRepo(ctx, slug)
	switch {
	case !linked:
		return out, nil
	case top == "":
		out.Repo = "repo_moved"
		return out, nil
	}
	commits, err := gitrepo.Log(ctx, top, TimelineMaxCommits)
	if err != nil {
		// Sin poder leer el repo, la historia sigue siendo la de los resúmenes.
		out.Repo = "repo_moved"
		return out, nil
	}
	out.Repo = "linked"

	remote := ""
	if project.Repo != nil {
		remote = project.Repo.Remote
	}
	for _, c := range commits {
		tc := TimelineCommit{Commit: c, URL: gitrepo.CommitURL(remote, c.SHA)}
		for _, m := range metas {
			sha := strings.ToLower(strings.TrimSpace(m.CommitSHA))
			// El resumen puede apuntar el sha corto.
			if len(sha) >= 7 && strings.HasPrefix(strings.ToLower(c.SHA), sha) {
				tc.DocumentedBy = m.ID
				break
			}
		}
		out.Commits = append(out.Commits, tc)
	}
	return out, nil
}
