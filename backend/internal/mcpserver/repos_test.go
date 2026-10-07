package mcpserver

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ismaelosuna/saveme/backend/internal/gitrepo"
	"github.com/ismaelosuna/saveme/backend/internal/service"
)

// --- proyecto ↔ repo y resúmenes desactualizados -------------------------------

func gitRepoFor(t *testing.T, remote string) string {
	t.Helper()
	if _, err := gitrepo.Available(); err != nil {
		t.Skip("git no está disponible")
	}
	dir := t.TempDir()
	for _, args := range [][]string{
		{"init", "-q", "-b", "main"},
		{"config", "user.email", "test@saveme"},
		{"config", "user.name", "SaveMe"},
		{"config", "commit.gpgsign", "false"},
		{"remote", "add", "origin", remote},
	} {
		runGit(t, dir, args...)
	}
	commitIn(t, dir, "backend/index.go", "v1", "primer commit")
	return dir
}

func runGit(t *testing.T, dir string, args ...string) string {
	t.Helper()
	out, err := exec.Command("git", append([]string{"-C", dir}, args...)...).CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
	return strings.TrimSpace(string(out))
}

func commitIn(t *testing.T, dir, file, content, msg string) string {
	t.Helper()
	path := filepath.Join(dir, file)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	runGit(t, dir, "add", file)
	runGit(t, dir, "commit", "-q", "-m", msg)
	return runGit(t, dir, "rev-parse", "HEAD")
}

func (h *harness) proponerYConfirmar(t *testing.T, args map[string]any) (map[string]any, map[string]any) {
	t.Helper()
	out := h.callOK(t, "saveme_summary_propose", args)
	done := h.callOK(t, "saveme_summary_confirm", map[string]any{
		"token": out["token"], "decision": "accepted", "elicit": false,
	})
	return out, done
}

// El caso de la pregunta: el repo cambia de carpeta. El vínculo es por remote y
// commit raíz, así que el proyecto se sigue deduciendo del directorio nuevo.
func TestElProyectoSaleDelRepoAunqueSeMuevaDeCarpeta(t *testing.T) {
	h := newHarness(t, false)
	repo := gitRepoFor(t, "git@github.com:dueño/api-pagos.git")

	primera, _ := h.proponerYConfirmar(t, map[string]any{
		"project": "api-pagos", "cwd": filepath.Join(repo, "backend"),
		"title": "Reintentos", "body": "Añadimos reintentos.",
	})
	r, _ := primera["repo"].(map[string]any)
	if r["will_link"] != true || r["remote"] != "github.com/dueño/api-pagos" {
		t.Fatalf("la primera propuesta tenía que avisar de que vincula el repo: %v", primera["repo"])
	}

	movido := filepath.Join(t.TempDir(), "otra", "carpeta")
	if err := os.MkdirAll(filepath.Dir(movido), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(repo, movido); err != nil {
		t.Fatal(err)
	}

	// Sin project: sale del repo, que ahora está en otra ruta.
	segunda, _ := h.proponerYConfirmar(t, map[string]any{
		"cwd": movido, "title": "Idempotencia", "body": "Claves de idempotencia en los cobros.",
	})
	if segunda["project"] != "api-pagos" {
		t.Fatalf("el proyecto no salió del repo movido: %v", segunda["project"])
	}

	links, err := h.svc.Workspace().RepoLinks()
	if err != nil || len(links) != 1 {
		t.Fatalf("esperaba un vínculo: %+v %v", links, err)
	}
	if want, _ := filepath.EvalSymlinks(movido); links[0].LastPath != want && links[0].LastPath != movido {
		t.Errorf("la última ruta vista no se actualizó: %q", links[0].LastPath)
	}

	// Otro repo (otro remote) no es este proyecto, y sin project no hay a dónde ir.
	otro := gitRepoFor(t, "git@github.com:otra/api-pagos.git")
	msg := h.callErrText(t, "saveme_summary_propose", map[string]any{
		"cwd": otro, "title": "Algo", "body": "Cuerpo.",
	})
	if !strings.Contains(msg, "no está vinculado") {
		t.Errorf("un repo sin vincular y sin project tiene que decir qué hacer: %q", msg)
	}
}

// Con el repo a mano, cada resumen de saveme_context dice cuántos commits
// tocaron sus archivos después: con tres o más, puede estar desactualizado.
func TestContextCuentaLosCommitsPosterioresALosResumenes(t *testing.T) {
	h := newHarness(t, false)
	ctx := context.Background()
	repo := gitRepoFor(t, "https://github.com/dueño/api.git")
	base := runGit(t, repo, "rev-parse", "HEAD")

	// Con commit apuntado: se cuenta desde ese commit, exacto.
	_, done := h.proponerYConfirmar(t, map[string]any{
		"project": "api", "cwd": repo, "title": "Índice en memoria", "category": "design",
		"body": "Guardamos el índice en memoria.", "files_touched": []string{"backend/index.go"},
		"commit": base,
	})
	idConCommit, _ := done["summary"].(map[string]any)["id"].(string)
	// Sin commit: el margen evita contar el commit del propio cambio, que suele
	// llegar justo después de escribir el resumen.
	_, done = h.proponerYConfirmar(t, map[string]any{
		"project": "api", "cwd": repo, "title": "Notas del índice", "category": "docs",
		"body": "Cómo funciona el índice.", "files_touched": []string{"backend/index.go"},
	})
	idSinCommit, _ := done["summary"].(map[string]any)["id"].(string)

	for i, msg := range []string{"índice en sqlite", "arreglo", "otro arreglo"} {
		commitIn(t, repo, "backend/index.go", "v"+string(rune('2'+i)), msg)
	}
	commitIn(t, repo, "README.md", "x", "no toca el índice")

	out := h.callOK(t, "saveme_context", map[string]any{"files": []string{"backend/index.go"}, "cwd": repo})
	got := map[string]map[string]any{}
	for _, it := range out["items"].([]any) {
		m := it.(map[string]any)
		cs, _ := m["changed_since"].(map[string]any)
		got[m["id"].(string)] = cs
	}
	if cs := got[idConCommit]; cs == nil || cs["count"] != float64(3) || cs["stale"] != true {
		t.Errorf("con commit: esperaba 3 commits posteriores y stale, llegó %v", cs)
	}
	if cs := got[idSinCommit]; cs == nil || cs["count"] != float64(0) {
		t.Errorf("sin commit, lo de dentro del margen no cuenta: %v", cs)
	}
	if note, _ := out["note"].(string); !strings.Contains(note, "desactualizado") {
		t.Errorf("el aviso general no dice que hay resúmenes dudosos: %q", note)
	}

	// La app no tiene cwd: usa la última ruta vista, si ahí sigue el mismo repo.
	f, err := h.svc.Freshness(ctx, idConCommit)
	if err != nil || !f.Available || f.Count != 3 {
		t.Errorf("Freshness desde la app: %+v %v", f, err)
	}
	if err := os.RemoveAll(repo); err != nil {
		t.Fatal(err)
	}
	if f, _ := h.svc.Freshness(ctx, idConCommit); f.Available || f.Reason != service.FreshnessRepoMoved {
		t.Errorf("con el repo fuera de su sitio no se inventa una cuenta: %+v", f)
	}
}
