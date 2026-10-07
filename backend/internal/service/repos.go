package service

import (
	"context"
	"fmt"
	"time"

	"github.com/ismaelosuna/saveme/backend/internal/domain"
	"github.com/ismaelosuna/saveme/backend/internal/gitrepo"
	"github.com/ismaelosuna/saveme/backend/internal/store"
	"github.com/ismaelosuna/saveme/backend/internal/workspace"
)

// Proyectos y repositorios de código.
//
// Un proyecto de SaveMe habla de un repo, y el agente trabaja dentro de ese repo.
// Unirlos permite deducir el proyecto del directorio del agente (sin adivinar el
// slug), enlazar cada commit a su página y saber qué cambió en el código desde
// que se escribió un resumen.
//
// El repo se reconoce por su remote y su commit raíz, nunca por su ruta: se
// mueve, se clona y se abre en varios worktrees. La ruta llega en cada llamada
// del agente y solo se guarda como la última vista.

// repoContext es lo que se sabe del repo de un directorio.
type repoContext struct {
	id gitrepo.Identity
	// link es el vínculo de ese repo con un proyecto, o nil si no está vinculado.
	link *workspace.RepoLink
}

func findRepoLink(links []workspace.RepoLink, id gitrepo.Identity) int {
	for i, l := range links {
		if id.Same(gitrepo.Identity{Remote: l.Remote, RootCommit: l.RootCommit}) {
			return i
		}
	}
	return -1
}

func findProjectLink(links []workspace.RepoLink, project string) int {
	for i, l := range links {
		if l.Project == project {
			return i
		}
	}
	return -1
}

// detectRepo identifica el repo de `cwd` y su vínculo, si lo tiene.
//
// Devuelve nil cuando no hay nada que identificar —sin cwd, sin git, fuera de un
// repo, un repo sin remote ni commits—: el directorio es una ayuda opcional, y no
// tenerlo nunca impide guardar un resumen. Si el repo está vinculado y ahora está
// en otro sitio, se apunta la ruta nueva.
func (s *Service) detectRepo(ctx context.Context, cwd string) *repoContext {
	if cwd == "" {
		return nil
	}
	id, err := gitrepo.Detect(ctx, cwd)
	if err != nil || id.Empty() {
		return nil
	}
	rc := &repoContext{id: id}

	s.reposMu.Lock()
	defer s.reposMu.Unlock()
	links, err := s.ws.RepoLinks()
	if err != nil {
		return rc
	}
	i := findRepoLink(links, id)
	if i < 0 {
		return rc
	}
	if links[i].LastPath != id.Toplevel {
		links[i].LastPath = id.Toplevel
		links[i].SeenAt = time.Now().UTC()
		// Si no se puede apuntar, la ruta vieja sigue siendo solo una pista: no
		// merece romper la llamada del agente.
		_ = s.ws.SaveRepoLinks(links)
	}
	link := links[i]
	rc.link = &link
	return rc
}

// linkRepo vincula un repo a un proyecto si ninguno de los dos lo está ya.
//
// Lo llama la confirmación: la primera vez que alguien guarda un resumen de un
// proyecto desde un repo, ese repo pasa a ser el del proyecto. No pisa nada: un
// vínculo que ya existe solo se cambia quitándolo a mano.
func (s *Service) linkRepo(project string, id gitrepo.Identity, path string) error {
	if project == "" || id.Empty() {
		return nil
	}
	s.reposMu.Lock()
	defer s.reposMu.Unlock()
	links, err := s.ws.RepoLinks()
	if err != nil {
		return err
	}
	if findRepoLink(links, id) >= 0 || findProjectLink(links, project) >= 0 {
		return nil
	}
	now := time.Now().UTC()
	links = append(links, workspace.RepoLink{
		Project: project, Remote: id.Remote, RootCommit: id.RootCommit,
		LastPath: path, LinkedAt: now, SeenAt: now,
	})
	return s.ws.SaveRepoLinks(links)
}

// linkAfterConfirm vincula el repo desde el que se propuso, si lo hay. Es lo
// último de una confirmación que ya escribió: si falla, el resumen está guardado
// igual, y el vínculo se intentará en la siguiente.
func (s *Service) linkAfterConfirm(rec store.ProposalRecord, project string) {
	id := gitrepo.Identity{Remote: rec.RepoRemote, RootCommit: rec.RepoRootCommit}
	_ = s.linkRepo(project, id, rec.RepoPath)
}

// UnlinkRepo quita el vínculo de un proyecto con su repo. No toca ningún archivo
// del repo ni de SaveMe.
func (s *Service) UnlinkRepo(ctx context.Context, project string) error {
	if _, err := s.GetProject(ctx, project); err != nil {
		return err
	}
	s.reposMu.Lock()
	defer s.reposMu.Unlock()
	links, err := s.ws.RepoLinks()
	if err != nil {
		return err
	}
	i := findProjectLink(links, project)
	if i < 0 {
		return fmt.Errorf("%w: el proyecto %q no tiene repo vinculado", ErrNotFound, project)
	}
	return s.ws.SaveRepoLinks(append(links[:i], links[i+1:]...))
}

// proposalRepo describe el repo de una propuesta para quien decide: a qué
// proyecto está vinculado ya y si confirmarla lo vinculará.
func (s *Service) proposalRepo(rec store.ProposalRecord) *domain.ProposalRepo {
	id := gitrepo.Identity{Remote: rec.RepoRemote, RootCommit: rec.RepoRootCommit}
	if id.Empty() {
		return nil
	}
	out := &domain.ProposalRepo{Remote: id.Remote, RootCommit: id.RootCommit}
	links, err := s.ws.RepoLinks()
	if err != nil {
		return out
	}
	if i := findRepoLink(links, id); i >= 0 {
		out.LinkedProject = links[i].Project
	} else {
		out.WillLink = findProjectLink(links, rec.ProjectSlug) < 0
	}
	return out
}

// attachRepos añade a cada proyecto su repo vinculado.
func (s *Service) attachRepos(projects []domain.Project) ([]domain.Project, error) {
	links, err := s.ws.RepoLinks()
	if err != nil {
		return nil, err
	}
	for i := range projects {
		if j := findProjectLink(links, projects[i].Slug); j >= 0 {
			l := links[j]
			projects[i].Repo = &domain.ProjectRepo{
				Remote: l.Remote, RootCommit: l.RootCommit,
				WebURL: gitrepo.WebURL(l.Remote), LastPath: l.LastPath,
			}
		}
	}
	return projects, nil
}

// forgetProjectRepo quita el vínculo de un proyecto que se archiva: si se dejara,
// el próximo resumen desde ese repo resucitaría el proyecto borrado.
func (s *Service) forgetProjectRepo(project string) error {
	s.reposMu.Lock()
	defer s.reposMu.Unlock()
	links, err := s.ws.RepoLinks()
	if err != nil {
		return err
	}
	i := findProjectLink(links, project)
	if i < 0 {
		return nil
	}
	return s.ws.SaveRepoLinks(append(links[:i], links[i+1:]...))
}

// withCommitURL rellena la página del commit de un resumen, si su proyecto tiene
// un repo en un alojamiento que se sabe enlazar.
func (s *Service) withCommitURL(meta *domain.SummaryMeta) {
	if meta.CommitSHA == "" {
		return
	}
	links, err := s.ws.RepoLinks()
	if err != nil {
		return
	}
	if i := findProjectLink(links, meta.ProjectSlug); i >= 0 {
		meta.CommitURL = gitrepo.CommitURL(links[i].Remote, meta.CommitSHA)
	}
}
