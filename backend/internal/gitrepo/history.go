package gitrepo

import (
	"context"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// Commit es un commit de la historia, lo justo para enseñarlo.
type Commit struct {
	SHA     string    `json:"sha"`
	Subject string    `json:"subject"`
	When    time.Time `json:"when"`
}

// Changes es lo que pasó en unos archivos desde un punto de la historia.
type Changes struct {
	// Count es cuántos commits los tocaron.
	Count int `json:"count"`
	// Latest son los más recientes, hasta el límite pedido.
	Latest []Commit `json:"latest"`
	// Files son los archivos que se miraron, ya relativos a la raíz del repo.
	Files []string `json:"files"`
}

// ChangesSince cuenta los commits que tocaron `files` después de un punto.
//
// El punto es `afterSHA` si se conoce y existe en este repo: «lo que vino
// después de este commit» es exacto. Si no, `since`, y entonces es una fecha:
// los commits del propio cambio suelen llegar un rato *después* de escribir el
// resumen, así que quien llama debe dejar un margen.
//
// `files` son rutas relativas a la raíz del repo, como las guarda el resumen.
// Las absolutas se aceptan si caen dentro del repo; las de fuera se ignoran.
func ChangesSince(ctx context.Context, top string, files []string, afterSHA string, since time.Time, limit int) (Changes, error) {
	out := Changes{Latest: []Commit{}, Files: []string{}}
	for _, f := range files {
		f = strings.TrimSpace(f)
		if f == "" {
			continue
		}
		if filepath.IsAbs(f) {
			rel, err := filepath.Rel(top, f)
			if err != nil || strings.HasPrefix(rel, "..") {
				continue
			}
			f = rel
		}
		out.Files = append(out.Files, filepath.ToSlash(filepath.Clean(f)))
	}
	if len(out.Files) == 0 {
		return out, nil
	}

	var rangeArgs []string
	if sha := strings.TrimSpace(afterSHA); sha != "" && !strings.HasPrefix(sha, "-") {
		if _, err := run(ctx, top, "cat-file", "-e", sha+"^{commit}"); err == nil {
			rangeArgs = []string{sha + "..HEAD"}
		}
	}
	if rangeArgs == nil {
		rangeArgs = []string{"--since=" + since.UTC().Format(time.RFC3339), "HEAD"}
	}
	// `--` separa los archivos de las opciones: un archivo que se llame como una
	// opción no puede cambiar lo que hace git.
	pathspec := append([]string{"--"}, out.Files...)

	countArgs := append(append([]string{"rev-list", "--count"}, rangeArgs...), pathspec...)
	raw, err := run(ctx, top, countArgs...)
	if err != nil {
		return out, err
	}
	out.Count, _ = strconv.Atoi(raw)
	if out.Count == 0 || limit <= 0 {
		return out, nil
	}

	logArgs := append([]string{"log", "-n", strconv.Itoa(limit), "--format=%H%x1f%cI%x1f%s"}, rangeArgs...)
	raw, err = run(ctx, top, append(logArgs, pathspec...)...)
	if err != nil {
		return out, err
	}
	out.Latest = parseLog(raw)
	return out, nil
}

// Log devuelve los últimos `limit` commits de la rama actual, el más reciente
// primero.
func Log(ctx context.Context, top string, limit int) ([]Commit, error) {
	if limit <= 0 {
		return []Commit{}, nil
	}
	raw, err := run(ctx, top, "log", "-n", strconv.Itoa(limit), "--format=%H%x1f%cI%x1f%s", "HEAD")
	if err != nil {
		return nil, err
	}
	return parseLog(raw), nil
}

// parseLog lee la salida de `git log --format=%H%x1f%cI%x1f%s`.
func parseLog(raw string) []Commit {
	out := []Commit{}
	for _, line := range strings.Split(raw, "\n") {
		parts := strings.SplitN(line, "\x1f", 3)
		if len(parts) != 3 {
			continue
		}
		when, _ := time.Parse(time.RFC3339, parts[1])
		out = append(out, Commit{SHA: parts[0], When: when, Subject: parts[2]})
	}
	return out
}
