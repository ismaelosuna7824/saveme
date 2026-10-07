// Package gitrepo identifica un repositorio git y pregunta por su historia.
//
// Es la única capa que ejecuta `git`. La identidad de un repo **no es su ruta**:
// un repo se mueve, se clona en otra carpeta o se abre en varios worktrees a la
// vez. Lo que no cambia es su remote (`origin`, normalizado) y su commit raíz, y
// eso es lo que se usa para reconocerlo. La ruta llega en cada llamada —el agente
// manda su directorio de trabajo— y solo sirve para ejecutar git ahí.
package gitrepo

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net/url"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"
)

var (
	// ErrNoGit: git no está disponible en esta máquina.
	ErrNoGit = errors.New("git no está disponible")
	// ErrNotRepo: la carpeta no está dentro de un repositorio git.
	ErrNotRepo = errors.New("no es un repositorio git")
)

// Identity es lo que reconoce a un repo aunque cambie de sitio.
type Identity struct {
	// Remote es el `origin` normalizado: `github.com/dueño/repo`, igual venga por
	// SSH o por HTTPS, con o sin `.git`. Vacío si el repo no tiene remote.
	Remote string `json:"remote,omitempty"`
	// RootCommit es el primer commit de la historia: el mismo en todos los clones.
	// Vacío en un repo sin commits.
	RootCommit string `json:"root_commit,omitempty"`
	// Toplevel es dónde está el repo **ahora**. No forma parte de la identidad.
	Toplevel string `json:"-"`
}

// Empty dice si no hay nada con lo que reconocer el repo.
func (id Identity) Empty() bool { return id.Remote == "" && id.RootCommit == "" }

// Same dice si dos identidades son el mismo repo.
//
// Manda el remote: dos forks comparten commit raíz pero no son el mismo
// proyecto. El commit raíz solo decide cuando a alguno de los dos le falta el
// remote (un repo local que luego se subió, o al revés).
func (id Identity) Same(other Identity) bool {
	if id.Remote != "" && other.Remote != "" {
		return id.Remote == other.Remote
	}
	return id.RootCommit != "" && id.RootCommit == other.RootCommit
}

// timeout acota cada llamada a git: un repo enorme o un disco de red no pueden
// dejar colgada una tool del agente.
const timeout = 5 * time.Second

var (
	availableOnce sync.Once
	gitPath       string
	gitErr        error
)

// Available dice si se puede ejecutar git sin efectos secundarios.
//
// En macOS, `/usr/bin/git` es un lanzador de las Command Line Tools: si no están
// instaladas, ejecutarlo abre un diálogo del sistema pidiendo instalarlas. La app
// no puede provocar eso cada vez que abres un resumen, así que ahí se exige que
// `xcode-select -p` diga que las herramientas existen.
func Available() (string, error) {
	availableOnce.Do(func() {
		path, err := exec.LookPath("git")
		if err != nil {
			gitErr = ErrNoGit
			return
		}
		if runtime.GOOS == "darwin" && path == "/usr/bin/git" {
			if err := exec.Command("/usr/bin/xcode-select", "-p").Run(); err != nil {
				gitErr = ErrNoGit
				return
			}
		}
		gitPath = path
	})
	return gitPath, gitErr
}

func run(ctx context.Context, dir string, args ...string) (string, error) {
	git, err := Available()
	if err != nil {
		return "", err
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, git, append([]string{"-C", dir}, args...)...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("git %s: %w: %s", strings.Join(args, " "), err, strings.TrimSpace(stderr.String()))
	}
	return strings.TrimSpace(stdout.String()), nil
}

// Detect identifica el repo que contiene `dir`.
func Detect(ctx context.Context, dir string) (Identity, error) {
	dir = strings.TrimSpace(dir)
	if dir == "" {
		return Identity{}, ErrNotRepo
	}
	if _, err := Available(); err != nil {
		return Identity{}, err
	}
	top, err := run(ctx, dir, "rev-parse", "--show-toplevel")
	if err != nil || top == "" {
		return Identity{}, fmt.Errorf("%w: %s", ErrNotRepo, dir)
	}
	id := Identity{Toplevel: filepath.Clean(top)}
	// Sin remote y sin commits sigue siendo un repo; simplemente no hay con qué
	// reconocerlo, y eso lo decide quien llama.
	if remote, err := run(ctx, top, "config", "--get", "remote.origin.url"); err == nil {
		id.Remote = NormalizeRemote(remote)
	}
	if roots, err := run(ctx, top, "rev-list", "--max-parents=0", "HEAD"); err == nil && roots != "" {
		// Una historia con varias raíces (un merge de dos repos) da varias líneas:
		// se elige la menor para que sea la misma en cualquier clon.
		lines := strings.Fields(roots)
		sort.Strings(lines)
		id.RootCommit = lines[0]
	}
	return id, nil
}

// NormalizeRemote reduce la URL de un remote a `host/ruta`, en minúsculas.
//
// `git@github.com:Dueño/Repo.git`, `https://github.com/dueño/repo` y
// `ssh://git@github.com/dueño/repo.git` son el mismo repo, y tienen que dar lo
// mismo. Se pasa a minúsculas porque los alojamientos conocidos no distinguen
// mayúsculas en el dueño ni en el nombre.
func NormalizeRemote(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	var host, path string
	if strings.Contains(raw, "://") {
		u, err := url.Parse(raw)
		if err != nil {
			return ""
		}
		host, path = u.Hostname(), u.Path
	} else if at := strings.Index(raw, "@"); at >= 0 && strings.Contains(raw[at:], ":") {
		// Sintaxis scp: usuario@host:ruta
		rest := raw[at+1:]
		colon := strings.Index(rest, ":")
		host, path = rest[:colon], rest[colon+1:]
	} else if colon := strings.Index(raw, ":"); colon > 0 && !strings.Contains(raw[:colon], "/") {
		// host:ruta sin usuario.
		host, path = raw[:colon], raw[colon+1:]
	} else {
		// Una ruta local: no hay host que comparar, pero sigue identificando.
		path = filepath.ToSlash(filepath.Clean(raw))
	}
	path = strings.Trim(path, "/")
	path = strings.TrimSuffix(path, ".git")
	if host == "" {
		return strings.ToLower(path)
	}
	return strings.ToLower(host + "/" + path)
}

// WebURL devuelve la página web del repo en los alojamientos conocidos, o "":
// es mejor no enlazar que enlazar a un 404.
func WebURL(remote string) string {
	host, path, ok := strings.Cut(remote, "/")
	if !ok || path == "" {
		return ""
	}
	switch host {
	case "github.com", "gitlab.com", "bitbucket.org":
		return "https://" + host + "/" + path
	}
	return ""
}

// CommitURL devuelve la página web de un commit en los alojamientos conocidos, o "".
func CommitURL(remote, sha string) string {
	sha = strings.TrimSpace(sha)
	web := WebURL(remote)
	if web == "" || sha == "" || strings.ContainsAny(sha, "/?#") {
		return ""
	}
	switch {
	case strings.HasPrefix(web, "https://gitlab.com/"):
		return web + "/-/commit/" + sha
	case strings.HasPrefix(web, "https://bitbucket.org/"):
		return web + "/commits/" + sha
	}
	return web + "/commit/" + sha
}
