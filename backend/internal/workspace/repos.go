package workspace

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"time"
)

// RepoLink une un proyecto de SaveMe con el repositorio de código del que habla.
//
// Se reconoce al repo por lo que no cambia —su remote y su commit raíz—, no por
// su ruta: un repo se mueve, se clona en otra carpeta o se abre en varios
// worktrees. `LastPath` es solo dónde se vio por última vez, una pista para la app
// cuando no hay un agente que diga dónde está; antes de usarla se comprueba que
// ahí siga estando el mismo repo.
type RepoLink struct {
	Project    string    `json:"project"`
	Remote     string    `json:"remote,omitempty"`
	RootCommit string    `json:"root_commit,omitempty"`
	LastPath   string    `json:"last_path,omitempty"`
	LinkedAt   time.Time `json:"linked_at"`
	SeenAt     time.Time `json:"seen_at"`
}

type repoLinksFile struct {
	Links []RepoLink `json:"links"`
}

// El vínculo vive en disco y no en el índice: el índice se puede borrar y
// reconstruir desde los archivos, y el vínculo no se puede deducir de ellos.
func (w *Workspace) repoLinksPath() string {
	return filepath.Join(w.stateDir(), "repos.json")
}

// RepoLinks lee los vínculos. Sin archivo, no hay ninguno.
func (w *Workspace) RepoLinks() ([]RepoLink, error) {
	data, err := os.ReadFile(w.repoLinksPath())
	if errors.Is(err, fs.ErrNotExist) {
		return []RepoLink{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("leer los vínculos con repositorios: %w", err)
	}
	var f repoLinksFile
	if err := json.Unmarshal(data, &f); err != nil {
		return nil, fmt.Errorf("los vínculos con repositorios están corruptos (%s): %w", w.repoLinksPath(), err)
	}
	if f.Links == nil {
		f.Links = []RepoLink{}
	}
	return f.Links, nil
}

// SaveRepoLinks escribe los vínculos de una vez, con un temporal y un rename:
// el MCP y la app pueden leerlo a la vez, y ninguno puede ver un archivo a medias.
func (w *Workspace) SaveRepoLinks(links []RepoLink) error {
	data, err := json.MarshalIndent(repoLinksFile{Links: links}, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(w.stateDir(), ".repos-*.json")
	if err != nil {
		return fmt.Errorf("guardar los vínculos con repositorios: %w", err)
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(append(data, '\n')); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), w.repoLinksPath())
}
