package gitrepo

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func TestNormalizeRemoteIgualaLasFormasDelMismoRepo(t *testing.T) {
	want := "github.com/ismaelosuna/saveme"
	for _, raw := range []string{
		"git@github.com:ismaelosuna/saveme.git",
		"git@github.com:IsmaelOsuna/SaveMe",
		"https://github.com/ismaelosuna/saveme",
		"https://github.com/ismaelosuna/saveme.git/",
		"https://user:token@github.com/ismaelosuna/saveme.git",
		"ssh://git@github.com/ismaelosuna/saveme.git",
		"ssh://git@github.com:22/ismaelosuna/saveme.git",
	} {
		if got := NormalizeRemote(raw); got != want {
			t.Errorf("NormalizeRemote(%q) = %q, esperaba %q", raw, got, want)
		}
	}
	if got := NormalizeRemote("https://gitlab.com/grupo/sub/repo.git"); got != "gitlab.com/grupo/sub/repo" {
		t.Errorf("subgrupos de GitLab: %q", got)
	}
}

// Dos forks comparten commit raíz y no son el mismo proyecto; un repo que aún no
// tenía remote sí es el mismo que su versión subida.
func TestSameDistingueForksYReconoceElMismoRepoSinRemote(t *testing.T) {
	original := Identity{Remote: "github.com/a/repo", RootCommit: "abc"}
	fork := Identity{Remote: "github.com/b/repo", RootCommit: "abc"}
	local := Identity{RootCommit: "abc"}
	if original.Same(fork) {
		t.Error("un fork no es el mismo repo")
	}
	if !original.Same(local) || !local.Same(fork) {
		t.Error("sin remote, el commit raíz tiene que reconocerlo")
	}
	if (Identity{}).Same(Identity{}) {
		t.Error("dos identidades vacías no son el mismo repo")
	}
}

func TestCommitURLSoloEnlazaAlojamientosConocidos(t *testing.T) {
	if got := CommitURL("github.com/a/b", "abc123"); got != "https://github.com/a/b/commit/abc123" {
		t.Errorf("GitHub: %q", got)
	}
	if got := CommitURL("gitlab.com/g/s/r", "abc"); got != "https://gitlab.com/g/s/r/-/commit/abc" {
		t.Errorf("GitLab: %q", got)
	}
	if got := CommitURL("git.empresa.local/a/b", "abc"); got != "" {
		t.Errorf("un alojamiento desconocido no se enlaza: %q", got)
	}
	if got := CommitURL("github.com/a/b", "../../x"); got != "" {
		t.Errorf("un sha con barras no compone una URL: %q", got)
	}
}

// gitRepo crea un repo de verdad en una carpeta temporal.
func gitRepo(t *testing.T) string {
	t.Helper()
	if _, err := Available(); err != nil {
		t.Skip("git no está disponible")
	}
	dir := t.TempDir()
	for _, args := range [][]string{
		{"init", "-q", "-b", "main"},
		{"config", "user.email", "test@saveme"},
		{"config", "user.name", "SaveMe"},
		{"config", "commit.gpgsign", "false"},
		{"remote", "add", "origin", "git@github.com:Dueño/Proyecto.git"},
	} {
		gitIn(t, dir, args...)
	}
	return dir
}

func gitIn(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	cmd.Env = append(os.Environ(), "GIT_CONFIG_NOSYSTEM=1")
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
	return string(out)
}

func commitFile(t *testing.T, dir, file, content, msg string) string {
	t.Helper()
	path := filepath.Join(dir, file)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	gitIn(t, dir, "add", file)
	gitIn(t, dir, "commit", "-q", "-m", msg)
	return gitIn(t, dir, "rev-parse", "HEAD")[:40]
}

// Mover el repo de carpeta no cambia su identidad: es lo que permite que el
// vínculo con el proyecto sobreviva a que lo muevan.
func TestDetectDaLaMismaIdentidadAunqueElRepoSeMueva(t *testing.T) {
	ctx := context.Background()
	dir := gitRepo(t)
	commitFile(t, dir, "a.txt", "uno", "primero")
	if err := os.MkdirAll(filepath.Join(dir, "sub", "carpeta"), 0o755); err != nil {
		t.Fatal(err)
	}

	before, err := Detect(ctx, filepath.Join(dir, "sub", "carpeta"))
	if err != nil {
		t.Fatalf("Detect: %v", err)
	}
	if before.Remote != "github.com/dueño/proyecto" || before.RootCommit == "" {
		t.Fatalf("identidad incompleta: %+v", before)
	}

	moved := filepath.Join(t.TempDir(), "en-otro-sitio")
	if err := os.Rename(dir, moved); err != nil {
		t.Fatal(err)
	}
	after, err := Detect(ctx, moved)
	if err != nil {
		t.Fatalf("Detect tras mover: %v", err)
	}
	if !after.Same(before) || after.Toplevel == before.Toplevel {
		t.Errorf("al moverlo debería ser el mismo repo en otro sitio: antes %+v, después %+v", before, after)
	}

	if _, err := Detect(ctx, t.TempDir()); err == nil {
		t.Error("una carpeta sin repo no debería identificarse")
	}
}

func TestChangesSinceCuentaLoQueVinoDespues(t *testing.T) {
	ctx := context.Background()
	dir := gitRepo(t)
	base := commitFile(t, dir, "backend/index.go", "v1", "índice en memoria")
	commitFile(t, dir, "otro.go", "x", "no toca el índice")
	commitFile(t, dir, "backend/index.go", "v2", "índice en sqlite")
	commitFile(t, dir, "backend/index.go", "v3", "arreglo del índice")

	got, err := ChangesSince(ctx, dir, []string{"backend/index.go", ""}, base, time.Time{}, 1)
	if err != nil {
		t.Fatalf("ChangesSince: %v", err)
	}
	if got.Count != 2 {
		t.Errorf("después de %s, index.go cambió 2 veces; dio %d", base[:7], got.Count)
	}
	if len(got.Latest) != 1 || got.Latest[0].Subject != "arreglo del índice" {
		t.Errorf("el más reciente primero, hasta el límite: %+v", got.Latest)
	}

	// Sin sha conocido, cuenta por fecha: desde el futuro no hay nada.
	got, err = ChangesSince(ctx, dir, []string{"backend/index.go"}, "no-existe", time.Now().Add(time.Hour), 5)
	if err != nil || got.Count != 0 {
		t.Errorf("desde una fecha futura no hay cambios: %+v %v", got, err)
	}
}
