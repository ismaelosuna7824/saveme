package service

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ismaelosuna/saveme/backend/internal/domain"
	"github.com/ismaelosuna/saveme/backend/internal/gitrepo"
)

func guardar(t *testing.T, svc *Service, req domain.CreateRequest) domain.SummaryMeta {
	t.Helper()
	ctx := context.Background()
	prep, err := svc.Propose(ctx, req)
	if err != nil {
		t.Fatalf("Propose %q: %v", req.Title, err)
	}
	res, err := svc.Confirm(ctx, prep.Proposal.Token, Decision{Accepted: true, Via: domain.ResolvedViaUI})
	if err != nil {
		t.Fatalf("Confirm %q: %v", req.Title, err)
	}
	return res.Meta
}

// El mapa enseña solo lo que está enlazado, con la dirección y el tipo de cada
// enlace, y marca lo sustituido: es lo que permite leer cómo se llegó a una
// decisión.
func TestElMapaEnseñaEnlacesYSustituciones(t *testing.T) {
	ctx := context.Background()
	svc, _ := newTestService(t)
	a := guardar(t, svc, domain.CreateRequest{Project: "alfa", Title: "Índice en memoria", Body: "A."})
	b := guardar(t, svc, domain.CreateRequest{Project: "alfa", Title: "Caché del índice", Body: "B.", Related: []string{a.ID}})
	c := guardar(t, svc, domain.CreateRequest{Project: "alfa", Title: "Índice en SQLite", Body: "C.", Supersedes: []string{a.RelPath}})
	guardar(t, svc, domain.CreateRequest{Project: "alfa", Title: "Algo suelto", Body: "D."})

	g, err := svc.ProjectGraph(ctx, "alfa")
	if err != nil {
		t.Fatalf("ProjectGraph: %v", err)
	}
	if len(g.Nodes) != 3 || g.Isolated != 1 {
		t.Fatalf("esperaba 3 nodos enlazados y 1 suelto: %+v", g)
	}
	want := map[string]bool{b.ID + ">" + a.ID + ":related": true, c.ID + ">" + a.ID + ":supersedes": true}
	for _, e := range g.Edges {
		if !want[e.From+">"+e.To+":"+e.Kind] {
			t.Errorf("enlace inesperado %+v", e)
		}
		delete(want, e.From+">"+e.To+":"+e.Kind)
	}
	if len(want) != 0 {
		t.Errorf("faltan enlaces: %v", want)
	}
	for _, n := range g.Nodes {
		if (n.ID == a.ID) != n.Superseded {
			t.Errorf("solo el índice en memoria está sustituido: %+v", n)
		}
	}
	if g.Nodes[0].ID != a.ID {
		t.Errorf("el mapa va del más antiguo al más nuevo: %+v", g.Nodes)
	}
}

func repoDePrueba(t *testing.T) (string, func(file, content, msg string) string) {
	t.Helper()
	if _, err := gitrepo.Available(); err != nil {
		t.Skip("git no está disponible")
	}
	dir := t.TempDir()
	git := func(args ...string) string {
		out, err := exec.Command("git", append([]string{"-C", dir}, args...)...).CombinedOutput()
		if err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
		return strings.TrimSpace(string(out))
	}
	git("init", "-q", "-b", "main")
	git("config", "user.email", "t@saveme")
	git("config", "user.name", "SaveMe")
	git("config", "commit.gpgsign", "false")
	git("remote", "add", "origin", "git@github.com:dueño/alfa.git")
	commit := func(file, content, msg string) string {
		path := filepath.Join(dir, file)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
		git("add", file)
		git("commit", "-q", "-m", msg)
		return git("rev-parse", "HEAD")
	}
	return dir, commit
}

// La línea de tiempo cruza los resúmenes con los commits del repo, y un commit
// que algún resumen apunta sale como documentado: los demás son trabajo del que
// no quedó nada escrito.
func TestLaLineaDeTiempoMarcaLosCommitsDocumentados(t *testing.T) {
	ctx := context.Background()
	svc, _ := newTestService(t)
	repo, commit := repoDePrueba(t)
	documentado := commit("a.go", "1", "cambio documentado")
	m := guardar(t, svc, domain.CreateRequest{
		Project: "alfa", Cwd: repo, Title: "El cambio", Body: "Cuerpo.", Commit: documentado[:7],
	})
	suelto := commit("b.go", "2", "cambio sin resumen")

	tl, err := svc.ProjectTimeline(ctx, "alfa")
	if err != nil {
		t.Fatalf("ProjectTimeline: %v", err)
	}
	if tl.Repo != "linked" || len(tl.Commits) != 2 || len(tl.Summaries) != 1 {
		t.Fatalf("esperaba el repo a mano, 2 commits y 1 resumen: %+v", tl)
	}
	por := map[string]TimelineCommit{}
	for _, c := range tl.Commits {
		por[c.SHA] = c
	}
	if por[documentado].DocumentedBy != m.ID {
		t.Errorf("el commit apuntado (sha corto) debería salir documentado: %+v", por[documentado])
	}
	if por[suelto].DocumentedBy != "" {
		t.Errorf("el commit sin resumen no está documentado: %+v", por[suelto])
	}
	if !strings.HasPrefix(por[suelto].URL, "https://github.com/dueño/alfa/commit/") {
		t.Errorf("el commit enlaza a su página: %q", por[suelto].URL)
	}

	if err := os.RemoveAll(repo); err != nil {
		t.Fatal(err)
	}
	if tl, _ := svc.ProjectTimeline(ctx, "alfa"); tl.Repo != "repo_moved" || len(tl.Commits) != 0 {
		t.Errorf("con el repo fuera de su sitio no hay commits que enseñar: %+v", tl)
	}
}

// La salud junta lo que hay que mirar: desactualizados (con su cuenta), los que
// no apuntan archivos y los proyectos sin repo.
func TestLaSaludDelDiarioListaLoQueHayQueMirar(t *testing.T) {
	ctx := context.Background()
	svc, _ := newTestService(t)
	repo, commit := repoDePrueba(t)
	base := commit("index.go", "1", "índice")
	viejo := guardar(t, svc, domain.CreateRequest{
		Project: "alfa", Cwd: repo, Title: "Índice", Body: "Cuerpo.",
		FilesTouched: []string{"index.go"}, Commit: base,
	})
	sinArchivos := guardar(t, svc, domain.CreateRequest{Project: "alfa", Title: "Notas", Body: "Cuerpo."})
	guardar(t, svc, domain.CreateRequest{Project: "beta", Title: "Otro", Body: "Cuerpo."})
	for i := 2; i <= 4; i++ {
		commit("index.go", strings.Repeat("x", i), "cambio")
	}

	h, err := svc.Health(ctx)
	if err != nil {
		t.Fatalf("Health: %v", err)
	}
	if h.Totals.Projects != 2 || h.Totals.ProjectsWithoutRepo != 1 {
		t.Errorf("dos proyectos, uno sin repo: %+v", h.Totals)
	}
	alfa := h.Projects[0]
	if alfa.Slug != "alfa" || !alfa.RepoReachable {
		t.Fatalf("el proyecto con más que mirar va primero, con su repo a mano: %+v", h.Projects)
	}
	if len(alfa.Stale) != 1 || alfa.Stale[0].ID != viejo.ID || alfa.Stale[0].Count != 3 {
		t.Errorf("el índice tiene 3 commits posteriores: %+v", alfa.Stale)
	}
	if len(alfa.NoFiles) != 1 || alfa.NoFiles[0].ID != sinArchivos.ID {
		t.Errorf("las notas no apuntan archivos: %+v", alfa.NoFiles)
	}
}
