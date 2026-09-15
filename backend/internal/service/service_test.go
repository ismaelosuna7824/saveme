package service

import (
	"context"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/ismaelosuna/saveme/backend/internal/domain"
	"github.com/ismaelosuna/saveme/backend/internal/markdown"
	"github.com/ismaelosuna/saveme/backend/internal/store"
	"github.com/ismaelosuna/saveme/backend/internal/workspace"
)

func newTestService(t *testing.T) (*Service, string) {
	t.Helper()
	dir := t.TempDir()
	root := filepath.Join(dir, "workspace")

	ws, err := workspace.New(root)
	if err != nil {
		t.Fatalf("workspace.New: %v", err)
	}
	st, err := store.Open(filepath.Join(dir, "index.db"))
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { st.Close() })

	return New(ws, st), root
}

// markdownFiles devuelve los .md del workspace, sin el directorio de estado.
func markdownFiles(t *testing.T, root string) []string {
	t.Helper()
	var out []string
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if strings.HasPrefix(d.Name(), ".") && path != root {
				return fs.SkipDir
			}
			return nil
		}
		if strings.EqualFold(filepath.Ext(d.Name()), ".md") {
			rel, _ := filepath.Rel(root, path)
			out = append(out, filepath.ToSlash(rel))
		}
		return nil
	})
	if err != nil {
		t.Fatalf("walk: %v", err)
	}
	sort.Strings(out)
	return out
}

func readBody(t *testing.T, root, rel string) string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(rel)))
	if err != nil {
		t.Fatalf("leer %s: %v", rel, err)
	}
	return string(data)
}

func sampleRequest() domain.CreateRequest {
	return domain.CreateRequest{
		Project: "SaveMe App",
		Title:   "Editor markdown con preview sincronizado",
		Body:    "Implementamos el editor con CodeMirror y un panel de preview.\n\n## Detalles\n\nEl scroll se sincroniza por bloque.",
		Tags:    []string{"editor", "Markdown", "editor"},
		Agent:   "claude-code",
	}
}

// TestProposeWritesNothing verifica la primera mitad de la garantía central:
// preparar una escritura no toca el disco.
func TestProposeWritesNothing(t *testing.T) {
	ctx := context.Background()
	svc, root := newTestService(t)

	prep, err := svc.Propose(ctx, sampleRequest())
	if err != nil {
		t.Fatalf("Propose: %v", err)
	}
	if prep.Proposal == nil {
		t.Fatal("esperaba una propuesta")
	}

	if files := markdownFiles(t, root); len(files) != 0 {
		t.Fatalf("Propose no debe escribir archivos, escribió: %v", files)
	}
	if _, err := os.Stat(filepath.Join(root, "saveme-app")); !errors.Is(err, fs.ErrNotExist) {
		t.Fatal("Propose no debe crear la carpeta del proyecto")
	}

	p := prep.Proposal
	if p.Category != "feature" {
		t.Errorf("categoría inferida = %q, want feature (razón: %s)", p.Category, p.Inference.Reason)
	}
	if p.Inference.Reason == "" {
		t.Error("la propuesta debe explicar por qué eligió esa categoría")
	}
	if len(p.Alternatives) != 3 {
		t.Errorf("esperaba 3 alternativas, hay %d", len(p.Alternatives))
	}
	if !strings.HasPrefix(p.RelPath, "saveme-app/features/") {
		t.Errorf("ruta propuesta = %q", p.RelPath)
	}
	if p.Token == "" || !strings.HasPrefix(p.Token, "pt_") {
		t.Errorf("token inválido: %q", p.Token)
	}
	if p.BodyBytes != len(sampleRequest().Body) {
		t.Errorf("BodyBytes = %d", p.BodyBytes)
	}

	// Los tags se normalizan y se deduplican.
	rec, err := svc.Store().GetProposal(ctx, p.Token)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"editor", "markdown"}
	if len(rec.Tags) != len(want) {
		t.Fatalf("tags = %v, want %v", rec.Tags, want)
	}
	for i := range want {
		if rec.Tags[i] != want[i] {
			t.Errorf("tags = %v, want %v", rec.Tags, want)
		}
	}
}

// TestConfirmWritesFileAndIndexesIt cierra el ciclo completo.
func TestConfirmWritesFileAndIndexesIt(t *testing.T) {
	ctx := context.Background()
	svc, root := newTestService(t)

	prep, err := svc.Propose(ctx, sampleRequest())
	if err != nil {
		t.Fatalf("Propose: %v", err)
	}
	token := prep.Proposal.Token

	res, err := svc.Confirm(ctx, token, Decision{Accepted: true, Via: domain.ResolvedViaElicitation})
	if err != nil {
		t.Fatalf("Confirm: %v", err)
	}
	if res == nil || !res.Created {
		t.Fatal("esperaba una escritura nueva")
	}

	// 1. El archivo existe y es markdown con frontmatter.
	raw := readBody(t, root, res.RelPath)
	if !strings.HasPrefix(raw, "---\n") {
		t.Fatalf("el archivo no empieza con frontmatter:\n%s", raw)
	}
	doc := markdown.Parse([]byte(raw))
	if doc.Frontmatter == nil {
		t.Fatal("el frontmatter no se pudo interpretar")
	}
	if doc.Frontmatter.ID != res.Meta.ID {
		t.Errorf("id del frontmatter = %q, meta = %q", doc.Frontmatter.ID, res.Meta.ID)
	}
	if doc.Frontmatter.Status != domain.StatusConfirmed {
		t.Errorf("status = %q", doc.Frontmatter.Status)
	}
	if doc.Frontmatter.Project != "saveme-app" {
		t.Errorf("project = %q", doc.Frontmatter.Project)
	}
	if !strings.Contains(doc.Body, "CodeMirror") {
		t.Errorf("el cuerpo se perdió: %q", doc.Body)
	}

	// 2. El proyecto se creó con sus nueve carpetas.
	entries, err := os.ReadDir(filepath.Join(root, "saveme-app"))
	if err != nil {
		t.Fatal(err)
	}
	var dirs []string
	for _, e := range entries {
		if e.IsDir() {
			dirs = append(dirs, e.Name())
		}
	}
	if len(dirs) != 9 {
		t.Errorf("esperaba 9 carpetas de categoría, hay %d: %v", len(dirs), dirs)
	}

	// 3. El índice lo conoce y la huella quedó registrada.
	meta, err := svc.Store().GetSummary(ctx, res.Meta.ID)
	if err != nil {
		t.Fatalf("el índice no tiene el resumen: %v", err)
	}
	if meta.RelPath != res.RelPath || meta.Title != sampleRequest().Title {
		t.Errorf("meta = %+v", meta)
	}
	if _, known, err := svc.Store().GetFileState(ctx, res.RelPath); err != nil || !known {
		t.Errorf("falta la huella del archivo: known=%v err=%v", known, err)
	}

	// 4. La propuesta quedó auditada con la vía de resolución.
	rec, _ := svc.Store().GetProposal(ctx, token)
	if rec.Status != domain.ProposalConfirmed {
		t.Errorf("status de la propuesta = %q", rec.Status)
	}
	if rec.ResolvedVia != domain.ResolvedViaElicitation {
		t.Errorf("via = %q", rec.ResolvedVia)
	}
	if rec.SummaryID != res.Meta.ID {
		t.Errorf("summary_id = %q, want %q", rec.SummaryID, res.Meta.ID)
	}
}

// TestConfirmTwiceIsIdempotent: un agente que reintenta no debe duplicar.
func TestConfirmTwiceIsIdempotent(t *testing.T) {
	ctx := context.Background()
	svc, root := newTestService(t)

	prep, _ := svc.Propose(ctx, sampleRequest())
	token := prep.Proposal.Token

	first, err := svc.Confirm(ctx, token, Decision{Accepted: true, Via: domain.ResolvedViaAgentChat})
	if err != nil {
		t.Fatalf("primer Confirm: %v", err)
	}
	second, err := svc.Confirm(ctx, token, Decision{Accepted: true, Via: domain.ResolvedViaAgentChat})
	if err != nil {
		t.Fatalf("segundo Confirm debe ser idempotente, dio error: %v", err)
	}
	if second.Created {
		t.Error("el segundo Confirm no debe crear nada")
	}
	if second.Meta.ID != first.Meta.ID {
		t.Errorf("ids distintos: %q vs %q", second.Meta.ID, first.Meta.ID)
	}
	if files := markdownFiles(t, root); len(files) != 1 {
		t.Fatalf("esperaba 1 archivo, hay %d: %v", len(files), files)
	}
}

func TestConfirmWithOverrides(t *testing.T) {
	ctx := context.Background()

	t.Run("categoría distinta", func(t *testing.T) {
		svc, root := newTestService(t)
		prep, _ := svc.Propose(ctx, sampleRequest())

		res, err := svc.Confirm(ctx, prep.Proposal.Token, Decision{
			Accepted: true, Via: domain.ResolvedViaUI, Category: "docs",
		})
		if err != nil {
			t.Fatalf("Confirm: %v", err)
		}
		if !strings.HasPrefix(res.RelPath, "saveme-app/docs/") {
			t.Errorf("rel_path = %q, want prefijo saveme-app/docs/", res.RelPath)
		}
		if res.Meta.Category != "docs" {
			t.Errorf("category = %q", res.Meta.Category)
		}
		if len(markdownFiles(t, root)) != 1 {
			t.Error("debería haber exactamente un archivo")
		}
	})

	t.Run("ruta explícita en otro proyecto", func(t *testing.T) {
		svc, root := newTestService(t)
		prep, _ := svc.Propose(ctx, sampleRequest())

		res, err := svc.Confirm(ctx, prep.Proposal.Token, Decision{
			Accepted: true, Via: domain.ResolvedViaUI,
			RelPath: "otro-proyecto/research/2026-02-14-mi-nota.md",
		})
		if err != nil {
			t.Fatalf("Confirm: %v", err)
		}
		if res.RelPath != "otro-proyecto/research/2026-02-14-mi-nota.md" {
			t.Errorf("rel_path = %q", res.RelPath)
		}
		if res.Meta.ProjectSlug != "otro-proyecto" {
			t.Errorf("project = %q, debería derivarse de la ruta", res.Meta.ProjectSlug)
		}
		if res.Meta.Category != "research" {
			t.Errorf("category = %q", res.Meta.Category)
		}
		if _, err := os.Stat(filepath.Join(root, "otro-proyecto", "research", "2026-02-14-mi-nota.md")); err != nil {
			t.Errorf("el archivo no se escribió: %v", err)
		}
	})

	t.Run("extensión .md se añade sola", func(t *testing.T) {
		svc, _ := newTestService(t)
		prep, _ := svc.Propose(ctx, sampleRequest())
		res, err := svc.Confirm(ctx, prep.Proposal.Token, Decision{
			Accepted: true, Via: domain.ResolvedViaUI, RelPath: "saveme-app/docs/nota",
		})
		if err != nil {
			t.Fatalf("Confirm: %v", err)
		}
		if !strings.HasSuffix(res.RelPath, ".md") {
			t.Errorf("rel_path = %q, debería terminar en .md", res.RelPath)
		}
	})
}

// TestConfirmRejectsTraversal es una prueba de seguridad: la ruta de un override
// viene de un agente y no puede escapar del workspace.
func TestConfirmRejectsTraversal(t *testing.T) {
	ctx := context.Background()
	for _, hostile := range []string{
		"../../etc/passwd",
		"../fuera.md",
		"/etc/passwd",
		"saveme-app/../../fuera.md",
		".saveme/saveme.db",
		`..\..\windows.md`,
	} {
		t.Run(hostile, func(t *testing.T) {
			svc, root := newTestService(t)
			prep, _ := svc.Propose(ctx, sampleRequest())

			_, err := svc.Confirm(ctx, prep.Proposal.Token, Decision{
				Accepted: true, Via: domain.ResolvedViaAgentChat, RelPath: hostile,
			})
			if err == nil {
				t.Fatalf("debía rechazar la ruta %q", hostile)
			}
			if !errors.Is(err, ErrInvalid) {
				t.Errorf("error = %v, want ErrInvalid", err)
			}
			if files := markdownFiles(t, root); len(files) != 0 {
				t.Errorf("no debía escribir nada, escribió %v", files)
			}
			// El token debe seguir disponible para reintentar correctamente.
			rec, _ := svc.Store().GetProposal(ctx, prep.Proposal.Token)
			if rec.Status != domain.ProposalPending {
				t.Errorf("el token quedó en %q, debería seguir pendiente", rec.Status)
			}
		})
	}
}

func TestCancelWritesNothing(t *testing.T) {
	ctx := context.Background()
	svc, root := newTestService(t)

	prep, _ := svc.Propose(ctx, sampleRequest())
	if err := svc.Cancel(ctx, prep.Proposal.Token, domain.ResolvedViaUI, "no era el lugar"); err != nil {
		t.Fatalf("Cancel: %v", err)
	}
	if files := markdownFiles(t, root); len(files) != 0 {
		t.Errorf("no debía escribir nada: %v", files)
	}
	if _, err := svc.Confirm(ctx, prep.Proposal.Token, Decision{Accepted: true, Via: domain.ResolvedViaUI}); !errors.Is(err, ErrProposalResolved) {
		t.Errorf("confirmar una propuesta cancelada debe fallar, dio: %v", err)
	}
	rec, _ := svc.Store().GetProposal(ctx, prep.Proposal.Token)
	if rec.Status != domain.ProposalCancelled {
		t.Errorf("status = %q", rec.Status)
	}
}

func TestExpiredProposalCannotBeConfirmed(t *testing.T) {
	ctx := context.Background()
	svc, root := newTestService(t)

	prep, _ := svc.Propose(ctx, sampleRequest())
	token := prep.Proposal.Token

	// Envejecer la propuesta directamente en el índice.
	if _, err := svc.Store().DB().ExecContext(ctx,
		`UPDATE proposals SET expires_at = ? WHERE token = ?`,
		time.Now().UTC().Add(-time.Minute).Format(time.RFC3339Nano), token); err != nil {
		t.Fatal(err)
	}

	if _, err := svc.Confirm(ctx, token, Decision{Accepted: true, Via: domain.ResolvedViaUI}); !errors.Is(err, ErrProposalExpired) {
		t.Fatalf("esperaba ErrProposalExpired, obtuve %v", err)
	}
	if files := markdownFiles(t, root); len(files) != 0 {
		t.Errorf("una propuesta vencida no debe escribir: %v", files)
	}
}

func TestUnknownTokenRejected(t *testing.T) {
	ctx := context.Background()
	svc, _ := newTestService(t)
	if _, err := svc.Confirm(ctx, "pt_inventado", Decision{Accepted: true, Via: "ui"}); !errors.Is(err, ErrProposalNotFound) {
		t.Fatalf("esperaba ErrProposalNotFound, obtuve %v", err)
	}
}

func TestProposeIsIdempotentForSamePayload(t *testing.T) {
	ctx := context.Background()
	svc, _ := newTestService(t)

	first, err := svc.Propose(ctx, sampleRequest())
	if err != nil {
		t.Fatal(err)
	}
	second, err := svc.Propose(ctx, sampleRequest())
	if err != nil {
		t.Fatal(err)
	}
	if !second.AlreadyProposed {
		t.Fatal("la segunda propuesta idéntica debería reutilizar la primera")
	}
	if second.Proposal.Token != first.Proposal.Token {
		t.Errorf("tokens distintos: %q vs %q", second.Proposal.Token, first.Proposal.Token)
	}

	// Y tras confirmarla, una tercera propuesta del mismo contenido avisa que ya
	// está guardado en vez de crear un duplicado.
	if _, err := svc.Confirm(ctx, first.Proposal.Token, Decision{Accepted: true, Via: "ui"}); err != nil {
		t.Fatal(err)
	}
	third, err := svc.Propose(ctx, sampleRequest())
	if err != nil {
		t.Fatal(err)
	}
	if third.AlreadySaved == nil {
		t.Fatal("debería detectar que ese contenido ya se guardó")
	}
	if third.AlreadySaved.Title != sampleRequest().Title {
		t.Errorf("resumen existente = %+v", third.AlreadySaved)
	}
}

// TestReindexPicksUpFilesWrittenWhileAppWasClosed es la garantía de "el MCP
// escribe aunque la app esté cerrada": basta con que el archivo esté en disco.
func TestReindexPicksUpFilesWrittenWhileAppWasClosed(t *testing.T) {
	ctx := context.Background()
	svc, root := newTestService(t)

	// Alguien (otra máquina, un compañero, el propio usuario con vim) dejó un
	// markdown y no pasó por SaveMe.
	dir := filepath.Join(root, "proyecto-externo", "features")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	content := "---\nid: sm_externo\ntitle: Nota escrita por fuera\ncategory: feature\nproject: proyecto-externo\nstatus: confirmed\ntags: [manual]\n---\n\nUn cuerpo escrito a mano con la palabra murcielago.\n"
	if err := os.WriteFile(filepath.Join(dir, "2026-01-02-nota.md"), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	// Y un archivo sin frontmatter, que debe indexarse pero no gestionarse.
	if err := os.WriteFile(filepath.Join(root, "proyecto-externo", "suelta.md"),
		[]byte("# Nota suelta\n\nSin frontmatter.\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	res, err := svc.Reindex(ctx)
	if err != nil {
		t.Fatalf("Reindex: %v", err)
	}
	if res.Added != 2 {
		t.Fatalf("added = %d, want 2 (%+v)", res.Added, res)
	}
	if res.Projects != 1 {
		t.Errorf("projects_discovered = %d, want 1", res.Projects)
	}

	items, total, err := svc.List(ctx, store.SummaryFilter{Project: "proyecto-externo"})
	if err != nil {
		t.Fatal(err)
	}
	if total != 2 {
		t.Fatalf("total = %d, want 2", total)
	}

	var managed, unmanaged *domain.SummaryMeta
	for i := range items {
		switch items[i].Status {
		case domain.StatusConfirmed:
			managed = &items[i]
		case domain.StatusUnmanaged:
			unmanaged = &items[i]
		}
	}
	if managed == nil {
		t.Fatal("no se indexó el archivo con frontmatter")
	}
	if managed.ID != "sm_externo" {
		t.Errorf("id = %q, debería respetar el del frontmatter", managed.ID)
	}
	if len(managed.Tags) != 1 || managed.Tags[0] != "manual" {
		t.Errorf("tags = %v", managed.Tags)
	}

	if unmanaged == nil {
		t.Fatal("no se indexó el archivo suelto")
	}
	if unmanaged.Title != "Nota suelta" {
		t.Errorf("título derivado = %q", unmanaged.Title)
	}

	// La búsqueda por contenido indexado también lo encuentra.
	found, total, err := svc.List(ctx, store.SummaryFilter{Query: "murcielago"})
	if err != nil {
		t.Fatal(err)
	}
	if total != 1 || found[0].ID != "sm_externo" {
		t.Errorf("búsqueda por contenido del archivo externo: total=%d %+v", total, found)
	}
}

func TestReindexIsIncrementalAndIdempotent(t *testing.T) {
	ctx := context.Background()
	svc, _ := newTestService(t)

	prep, _ := svc.Propose(ctx, sampleRequest())
	if _, err := svc.Confirm(ctx, prep.Proposal.Token, Decision{Accepted: true, Via: "ui"}); err != nil {
		t.Fatal(err)
	}

	first, err := svc.Reindex(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if first.Unchanged != 1 || first.Indexed != 0 {
		t.Fatalf("la primera reindexación no debería releer nada: %+v", first)
	}

	// El id debe sobrevivir a una reindexación completa.
	before, _, _ := svc.Read(ctx, prep.Proposal.Token)
	_ = before
	items, _, _ := svc.List(ctx, store.SummaryFilter{Project: "saveme-app"})
	if len(items) != 1 {
		t.Fatalf("items = %+v", items)
	}
	originalID := items[0].ID

	if _, err := svc.ResetIndex(ctx); err != nil {
		t.Fatalf("ResetIndex: %v", err)
	}
	after, _, err := svc.List(ctx, store.SummaryFilter{Project: "saveme-app"})
	if err != nil {
		t.Fatal(err)
	}
	if len(after) != 1 {
		t.Fatalf("tras ResetIndex hay %d items", len(after))
	}
	if after[0].ID != originalID {
		t.Errorf("el id cambió tras reconstruir el índice: %q -> %q", originalID, after[0].ID)
	}
	if after[0].Title != sampleRequest().Title {
		t.Errorf("title = %q", after[0].Title)
	}
}

func TestReindexRemovesDeletedFiles(t *testing.T) {
	ctx := context.Background()
	svc, root := newTestService(t)

	prep, _ := svc.Propose(ctx, sampleRequest())
	res, _ := svc.Confirm(ctx, prep.Proposal.Token, Decision{Accepted: true, Via: "ui"})

	if err := os.Remove(filepath.Join(root, filepath.FromSlash(res.RelPath))); err != nil {
		t.Fatal(err)
	}
	rr, err := svc.Reindex(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if rr.Removed != 1 {
		t.Fatalf("removed = %d, want 1 (%+v)", rr.Removed, rr)
	}
	if st, err := svc.Stats(ctx); err != nil || st.Summaries != 0 {
		t.Errorf("el índice debería quedar vacío: %+v err=%v", st, err)
	}
}

func TestSaveRoundTripAndConflictDetection(t *testing.T) {
	ctx := context.Background()
	svc, root := newTestService(t)

	prep, _ := svc.Propose(ctx, sampleRequest())
	res, _ := svc.Confirm(ctx, prep.Proposal.Token, Decision{Accepted: true, Via: "ui"})
	id := res.Meta.ID

	_, raw, err := svc.ReadRaw(ctx, id)
	if err != nil {
		t.Fatal(err)
	}

	// Guardar con el hash correcto funciona.
	edited := strings.Replace(raw, "CodeMirror", "CodeMirror 6", 1)
	out, err := svc.Save(ctx, id, edited, res.Meta.ContentHash)
	if err != nil {
		t.Fatalf("Save: %v", err)
	}
	if out.Mismatch {
		t.Fatal("no debería haber conflicto con el hash correcto")
	}
	if !strings.Contains(readBody(t, root, res.RelPath), "CodeMirror 6") {
		t.Error("el archivo en disco no tiene la edición")
	}
	if out.Meta.ContentHash == res.Meta.ContentHash {
		t.Error("el hash de contenido debería haber cambiado")
	}

	// Guardar con un hash viejo debe fallar sin escribir.
	stale := strings.Replace(edited, "CodeMirror 6", "PISADO", 1)
	conflict, err := svc.Save(ctx, id, stale, res.Meta.ContentHash)
	if err != nil {
		t.Fatalf("Save con hash viejo: %v", err)
	}
	if !conflict.Mismatch {
		t.Fatal("esperaba un conflicto de hash")
	}
	if conflict.DiskContent == "" {
		t.Error("el conflicto debe devolver el contenido del disco")
	}
	if strings.Contains(readBody(t, root, res.RelPath), "PISADO") {
		t.Fatal("un conflicto no debe escribir nada")
	}
}

func TestSaveWithoutFrontmatterKeepsTheID(t *testing.T) {
	ctx := context.Background()
	svc, _ := newTestService(t)

	prep, _ := svc.Propose(ctx, sampleRequest())
	res, _ := svc.Confirm(ctx, prep.Proposal.Token, Decision{Accepted: true, Via: "ui"})

	// El usuario borra el frontmatter desde el editor: no debe perder el archivo.
	out, err := svc.Save(ctx, res.Meta.ID, "# Solo el cuerpo\n\nSin frontmatter.\n", res.Meta.ContentHash)
	if err != nil {
		t.Fatalf("Save: %v", err)
	}
	if out.Mismatch {
		t.Fatal("no debería ser un conflicto")
	}
	if out.Meta.ID != res.Meta.ID {
		t.Errorf("el id cambió: %q -> %q", res.Meta.ID, out.Meta.ID)
	}
	if out.Meta.Status != domain.StatusUnmanaged {
		t.Errorf("status = %q, want unmanaged", out.Meta.Status)
	}
	if out.Meta.Title != "Solo el cuerpo" {
		t.Errorf("el título debería derivarse del encabezado, dio %q", out.Meta.Title)
	}
}

func TestReadFallsBackToDisk(t *testing.T) {
	ctx := context.Background()
	svc, root := newTestService(t)

	prep, _ := svc.Propose(ctx, sampleRequest())
	res, _ := svc.Confirm(ctx, prep.Proposal.Token, Decision{Accepted: true, Via: "ui"})

	// Alguien edita el archivo por fuera, sin pasar por Save.
	abs := filepath.Join(root, filepath.FromSlash(res.RelPath))
	raw := readBody(t, root, res.RelPath)
	// Se edita una frase que solo existe en el CUERPO. Si se reemplazara una
	// palabra que también aparece en el frontmatter (la línea `summary` se
	// deriva de la primera línea del cuerpo), el cambio caería en el
	// frontmatter y la prueba no probaría nada sobre la lectura del cuerpo.
	if !strings.Contains(raw, "El scroll se sincroniza") {
		t.Fatalf("el archivo no contiene la frase esperada:\n%s", raw)
	}
	edited := strings.Replace(raw, "El scroll se sincroniza", "El scroll fue editado por fuera", 1)
	if err := os.WriteFile(abs, []byte(edited), 0o644); err != nil {
		t.Fatal(err)
	}

	// Read debe devolver lo que hay en disco, no lo que recuerda el índice.
	_, body, err := svc.Read(ctx, res.Meta.ID)
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if !strings.Contains(body, "El scroll fue editado por fuera") {
		t.Errorf("Read devolvió contenido del índice en vez del disco: %q", body)
	}
}

func TestDeleteArchivesByDefault(t *testing.T) {
	ctx := context.Background()
	svc, root := newTestService(t)

	prep, _ := svc.Propose(ctx, sampleRequest())
	res, _ := svc.Confirm(ctx, prep.Proposal.Token, Decision{Accepted: true, Via: "ui"})

	archived, err := svc.Delete(ctx, res.Meta.ID, false)
	if err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if archived == "" {
		t.Error("esperaba la ruta de la papelera")
	}
	if files := markdownFiles(t, root); len(files) != 0 {
		t.Errorf("el archivo debería salir del workspace: %v", files)
	}
	if _, err := os.Stat(filepath.Join(root, filepath.FromSlash(archived))); err != nil {
		t.Errorf("el archivo archivado no existe: %v", err)
	}
	if st, _ := svc.Stats(ctx); st.Summaries != 0 {
		t.Error("el resumen debería salir del índice")
	}
}

func TestEnsureProjectIsIdempotent(t *testing.T) {
	ctx := context.Background()
	svc, _ := newTestService(t)

	first, err := svc.EnsureProject(ctx, "Mi Proyecto Ñandú", "")
	if err != nil {
		t.Fatalf("EnsureProject: %v", err)
	}
	if first.Slug != "mi-proyecto-nandu" {
		t.Errorf("slug = %q", first.Slug)
	}
	second, err := svc.EnsureProject(ctx, "Mi Proyecto Ñandú", "")
	if err != nil {
		t.Fatalf("segundo EnsureProject: %v", err)
	}
	if second.CreatedAt != first.CreatedAt {
		t.Error("created_at no debe cambiar al re-registrar")
	}
	if projects, _ := svc.ListProjects(ctx); len(projects) != 1 {
		t.Errorf("esperaba 1 proyecto, hay %d", len(projects))
	}
}

func TestConfirmRejectsInvalidCategory(t *testing.T) {
	ctx := context.Background()
	svc, _ := newTestService(t)
	prep, _ := svc.Propose(ctx, sampleRequest())

	if _, err := svc.Confirm(ctx, prep.Proposal.Token, Decision{
		Accepted: true, Via: "ui", Category: "banana",
	}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("esperaba ErrInvalid para una categoría inexistente, obtuve %v", err)
	}
	if _, err := svc.Confirm(ctx, prep.Proposal.Token, Decision{
		Accepted: true, Via: "ui", Category: "uncategorized",
	}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("uncategorized no debe poder elegirse como destino, obtuve %v", err)
	}
}

func TestProposeRejectsInvalidInput(t *testing.T) {
	ctx := context.Background()
	svc, _ := newTestService(t)

	for name, req := range map[string]domain.CreateRequest{
		"sin proyecto": {Title: "t", Body: "b"},
		"sin título":   {Project: "p", Body: "b"},
		"sin cuerpo":   {Project: "p", Title: "t", Body: "  "},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := svc.Propose(ctx, req); !errors.Is(err, ErrInvalid) {
				t.Errorf("esperaba ErrInvalid, obtuve %v", err)
			}
		})
	}
}

func TestConcurrentConfirmsProduceOneFile(t *testing.T) {
	ctx := context.Background()
	svc, root := newTestService(t)

	prep, _ := svc.Propose(ctx, sampleRequest())
	token := prep.Proposal.Token

	const n = 8
	results := make(chan *WriteResult, n)
	errs := make(chan error, n)
	for i := 0; i < n; i++ {
		go func() {
			res, err := svc.Confirm(ctx, token, Decision{Accepted: true, Via: domain.ResolvedViaUI})
			results <- res
			errs <- err
		}()
	}
	for i := 0; i < n; i++ {
		if err := <-errs; err != nil {
			t.Errorf("Confirm concurrente falló: %v", err)
		}
		<-results
	}

	if files := markdownFiles(t, root); len(files) != 1 {
		t.Fatalf("ocho confirmaciones concurrentes produjeron %d archivos: %v", len(files), files)
	}
	if st, _ := svc.Stats(ctx); st.Summaries != 1 {
		t.Errorf("el índice tiene %d resúmenes, want 1", st.Summaries)
	}
}

// Quitar un archivo de la papelera y reindexarlo no puede bloquearse.
//
// `Restore` toma el mutex del servicio para mover el archivo y `ReindexFile`
// también lo toma. El `sync.Mutex` de Go **no es reentrante**, así que llamar al
// segundo desde el primero deja la petición colgada para siempre y, peor, deja el
// mutex tomado: la app entera deja de responder. Esta prueba falla por tiempo de
// espera si alguien vuelve a anidarlos.
func TestRestoreNoSeBloqueaAlReindexar(t *testing.T) {
	svc, root := newTestService(t)
	ctx := context.Background()
	ws := svc.Workspace()

	const rel = "p/docs/nota.md"
	abs := filepath.Join(root, "p", "docs", "nota.md")
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		t.Fatal(err)
	}
	body := "---\nid: sm_prueba_restore\ntitle: Nota restaurada\ncategory: docs\nproject: p\nstatus: confirmed\n---\n\nUn cuerpo con la palabra murcielago.\n"
	if err := os.WriteFile(abs, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Reindex(ctx); err != nil {
		t.Fatalf("Reindex: %v", err)
	}

	if _, err := ws.Delete(rel, false); err != nil {
		t.Fatalf("borrar: %v", err)
	}
	if _, err := svc.Reindex(ctx); err != nil {
		t.Fatalf("Reindex tras borrar: %v", err)
	}

	entries, err := ws.Trash()
	if err != nil {
		t.Fatalf("listar papelera: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("esperaba 1 entrada en la papelera, hay %d", len(entries))
	}

	done := make(chan error, 1)
	go func() {
		_, err := svc.Restore(ctx, entries[0].TrashRel)
		done <- err
	}()

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("restaurar: %v", err)
		}
	case <-time.After(15 * time.Second):
		t.Fatal("Restore se quedó colgado: el mutex no es reentrante")
	}

	// Y el archivo tiene que quedar indexado: para eso se reindexa.
	items, _, err := svc.List(ctx, store.SummaryFilter{Query: "murcielago"})
	if err != nil {
		t.Fatalf("listar: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("el archivo restaurado no quedó indexado: %d resultados", len(items))
	}
	if items[0].RelPath != rel {
		t.Errorf("rel_path = %q, esperaba %q", items[0].RelPath, rel)
	}
}

// Y lo mismo para vaciar: no puede quedarse colgado con el mutex tomado.
func TestEmptyTrashNoSeBloquea(t *testing.T) {
	svc, root := newTestService(t)
	ctx := context.Background()
	ws := svc.Workspace()

	abs := filepath.Join(root, "p", "docs", "nota.md")
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(abs, []byte("# x\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := ws.Delete("p/docs/nota.md", false); err != nil {
		t.Fatal(err)
	}

	done := make(chan struct{})
	var removed int
	var err error
	go func() {
		removed, err = svc.EmptyTrash(ctx)
		close(done)
	}()

	select {
	case <-done:
		if err != nil {
			t.Fatalf("EmptyTrash: %v", err)
		}
		if removed != 1 {
			t.Errorf("removed = %d, esperaba 1", removed)
		}
	case <-time.After(15 * time.Second):
		t.Fatal("EmptyTrash se quedó colgado")
	}
}
