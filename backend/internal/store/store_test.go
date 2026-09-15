package store

import (
	"context"
	"errors"
	"io/fs"
	"path/filepath"
	"testing"
	"time"

	"github.com/ismaelosuna/saveme/backend/internal/domain"
)

func newTestStore(t *testing.T) *Store {
	t.Helper()
	dir := t.TempDir()
	root := filepath.Join(dir, "workspace")
	s, err := Open(filepath.Join(dir, "test.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { s.Close() })
	s.SetRoot(root)
	return s
}

func seedProject(t *testing.T, s *Store, slug string) domain.Project {
	t.Helper()
	now := time.Now().UTC()
	p := domain.Project{Slug: slug, Name: slug, Path: "/tmp/" + slug, CreatedAt: now, UpdatedAt: now}
	if err := s.UpsertProject(context.Background(), p); err != nil {
		t.Fatalf("UpsertProject: %v", err)
	}
	return p
}

// tagsFor da etiquetas distintas a cada resumen de prueba: si todos
// compartieran etiquetas, un acierto por etiqueta podría enmascarar el acierto
// por título que la prueba quiere medir.
func tagsFor(id string) []string {
	if id == "sm_1" {
		return []string{"editor", "markdown"}
	}
	return []string{"watcher", "mutex"}
}

func seedSummary(t *testing.T, s *Store, id, slug, category, title, body string) domain.SummaryMeta {
	t.Helper()
	now := time.Now().UTC()
	m := domain.SummaryMeta{
		ID:          id,
		ProjectSlug: slug,
		Category:    category,
		Title:       title,
		SummaryLine: title,
		RelPath:     slug + "/" + category + "/" + id + ".md",
		ContentHash: "hash-" + id,
		Status:      domain.StatusConfirmed,
		Author:      "agent",
		Tags:        tagsFor(id),
		WordCount:   len(body),
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if err := s.UpsertSummary(context.Background(), m, body); err != nil {
		t.Fatalf("UpsertSummary: %v", err)
	}
	return m
}

// latestMigrationVersion es la versión más alta de las migraciones embebidas.
func latestMigrationVersion(t *testing.T) int {
	t.Helper()
	names, err := fs.Glob(migrationFS, "migrations/*.sql")
	if err != nil {
		t.Fatalf("glob de migraciones: %v", err)
	}
	if len(names) == 0 {
		t.Fatal("no hay migraciones embebidas")
	}
	latest := 0
	for _, name := range names {
		v, err := parseMigrationVersion(name)
		if err != nil {
			t.Fatalf("versión de %s: %v", name, err)
		}
		if v > latest {
			latest = v
		}
	}
	return latest
}

func TestMigrationsRunOnce(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	path := filepath.Join(dir, "test.db")

	s, err := Open(path)
	if err != nil {
		t.Fatalf("primer Open: %v", err)
	}
	// La versión esperada se **deriva de las migraciones embebidas**, no se escribe
	// a mano: con un número fijo, añadir una migración rompía esta prueba aunque
	// todo funcionara, y el que la rompía se pasaba un rato mirando por qué.
	want := latestMigrationVersion(t)

	v, err := s.schemaVersion()
	if err != nil {
		t.Fatalf("schemaVersion: %v", err)
	}
	if v != want {
		t.Fatalf("schema_version = %d, want %d", v, want)
	}
	if err := s.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}

	// Reabrir no debe reaplicar la migración ni fallar.
	s2, err := Open(path)
	if err != nil {
		t.Fatalf("segundo Open: %v", err)
	}
	defer s2.Close()
	// Reabrir no vuelve a aplicarlas: la versión se queda donde estaba.
	if v2, _ := s2.schemaVersion(); v2 != want {
		t.Fatalf("schema_version tras reabrir = %d, want %d (¿se reaplicaron?)", v2, want)
	}
	if _, err := s2.Stats(ctx); err != nil {
		t.Fatalf("Stats tras reabrir: %v", err)
	}
}

func TestProjectAndSummaryRoundTrip(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	seedProject(t, s, "saveme")
	seedSummary(t, s, "sm_1", "saveme", "feature", "Editor markdown", "Un cuerpo con CodeMirror.")

	p, err := s.GetProject(ctx, "saveme")
	if err != nil {
		t.Fatalf("GetProject: %v", err)
	}
	if p.Counts["feature"] != 1 || p.Total != 1 {
		t.Fatalf("conteos = %+v total=%d", p.Counts, p.Total)
	}
	if p.LastActivity == nil {
		t.Fatal("LastActivity debería estar poblado")
	}

	m, err := s.GetSummary(ctx, "sm_1")
	if err != nil {
		t.Fatalf("GetSummary: %v", err)
	}
	if m.Title != "Editor markdown" {
		t.Errorf("title = %q", m.Title)
	}
	if len(m.Tags) != 2 {
		t.Errorf("tags = %v", m.Tags)
	}
	if m.AbsPath == "" {
		t.Error("AbsPath debería derivarse de la raíz")
	}

	if _, err := s.GetSummary(ctx, "no-existe"); !errors.Is(err, ErrNotFound) {
		t.Errorf("esperaba ErrNotFound, obtuve %v", err)
	}
}

func TestSearchFindsByBodyAndTitle(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	seedProject(t, s, "saveme")
	seedSummary(t, s, "sm_1", "saveme", "feature", "Editor markdown", "Integramos CodeMirror con preview.")
	seedSummary(t, s, "sm_2", "saveme", "fix", "Race en el watcher", "El watcher perdía eventos por un mutex.")

	t.Logf("búsqueda con FTS5: %v", s.UsesFTS())

	for _, tc := range []struct {
		query string
		want  string
	}{
		{"CodeMirror", "sm_1"},
		{"Editor", "sm_1"},
		{"mutex", "sm_2"},
		{"watcher", "sm_2"},
	} {
		items, total, err := s.Search(ctx, SummaryFilter{Query: tc.query})
		if err != nil {
			t.Fatalf("Search(%q): %v", tc.query, err)
		}
		if total == 0 {
			t.Errorf("Search(%q) no encontró nada", tc.query)
			continue
		}
		if items[0].ID != tc.want {
			t.Errorf("Search(%q) = %s, want %s", tc.query, items[0].ID, tc.want)
		}
	}

	// Una consulta con caracteres que romperían FTS5 no debe fallar nunca.
	for _, hostile := range []string{`"`, `***`, `AND`, `NEAR(`, `-x`, `a OR b`, `()`} {
		if _, _, err := s.Search(ctx, SummaryFilter{Query: hostile}); err != nil {
			t.Errorf("Search(%q) devolvió error: %v", hostile, err)
		}
	}
}

func TestSearchByTagAndCategoryFilter(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	seedProject(t, s, "saveme")
	seedSummary(t, s, "sm_1", "saveme", "feature", "Uno", "cuerpo")
	seedSummary(t, s, "sm_2", "saveme", "fix", "Dos", "cuerpo")

	items, total, err := s.Search(ctx, SummaryFilter{Category: "fix"})
	if err != nil {
		t.Fatalf("Search por categoría: %v", err)
	}
	if total != 1 || items[0].ID != "sm_2" {
		t.Fatalf("filtro por categoría falló: total=%d items=%+v", total, items)
	}

	items, total, err = s.Search(ctx, SummaryFilter{Tag: "editor"})
	if err != nil {
		t.Fatalf("Search por etiqueta: %v", err)
	}
	if total != 1 || items[0].ID != "sm_1" {
		t.Fatalf("filtro por etiqueta devolvió %d, want 1 (sm_1): %+v", total, items)
	}

	// La etiqueta no debe filtrar de más: otra etiqueta encuentra el otro.
	if items, total, err = s.Search(ctx, SummaryFilter{Tag: "mutex"}); err != nil || total != 1 || items[0].ID != "sm_2" {
		t.Fatalf("filtro por la etiqueta mutex: total=%d items=%+v err=%v", total, items, err)
	}
}

// TestProposalTokenIsSingleUse es la prueba de la garantía central del
// producto: un token solo puede resolver una vez, aunque haya carreras.
func TestProposalTokenIsSingleUse(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	seedProject(t, s, "saveme")

	now := time.Now().UTC()
	p := ProposalRecord{
		Token:       "pt_test1",
		ProjectSlug: "saveme",
		Category:    "feature",
		Title:       "Editor markdown",
		RelPath:     "saveme/features/2026-01-01-editor.md",
		Body:        "cuerpo",
		PayloadHash: "abc",
		CreatedAt:   now,
		ExpiresAt:   now.Add(15 * time.Minute),
	}
	if err := s.InsertProposal(ctx, p); err != nil {
		t.Fatalf("InsertProposal: %v", err)
	}

	got, err := s.GetProposal(ctx, "pt_test1")
	if err != nil {
		t.Fatalf("GetProposal: %v", err)
	}
	if got.Status != domain.ProposalPending {
		t.Fatalf("status = %q, want pending", got.Status)
	}

	ok, err := s.ResolveProposal(ctx, "pt_test1", domain.ProposalConfirmed,
		"accepted", domain.ResolvedViaElicitation, "", "sm_1", now)
	if err != nil || !ok {
		t.Fatalf("primer ResolveProposal: ok=%v err=%v", ok, err)
	}

	// Segunda resolución: debe ser rechazada sin efecto.
	ok, err = s.ResolveProposal(ctx, "pt_test1", domain.ProposalConfirmed,
		"accepted", domain.ResolvedViaAgentChat, "", "sm_2", now)
	if err != nil {
		t.Fatalf("segundo ResolveProposal devolvió error: %v", err)
	}
	if ok {
		t.Fatal("un token no puede resolver dos veces: la garantía de un solo uso se rompió")
	}

	final, _ := s.GetProposal(ctx, "pt_test1")
	if final.SummaryID != "sm_1" || final.ResolvedVia != domain.ResolvedViaElicitation {
		t.Fatalf("la segunda resolución mutó la fila: %+v", final)
	}

	// Y tampoco puede cancelarse después de confirmada.
	ok, _ = s.ResolveProposal(ctx, "pt_test1", domain.ProposalCancelled, "", "", "", "", now)
	if ok {
		t.Fatal("una propuesta ya resuelta no puede cancelarse")
	}
}

func TestExpireStaleProposals(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	seedProject(t, s, "saveme")

	now := time.Now().UTC()
	for i, tok := range []string{"pt_old", "pt_fresh"} {
		exp := now.Add(15 * time.Minute)
		if i == 0 {
			exp = now.Add(-time.Minute)
		}
		if err := s.InsertProposal(ctx, ProposalRecord{
			Token: tok, ProjectSlug: "saveme", Category: "feature", Title: "t",
			RelPath: "saveme/features/x.md", Body: "b", PayloadHash: "h",
			CreatedAt: now, ExpiresAt: exp,
		}); err != nil {
			t.Fatalf("InsertProposal: %v", err)
		}
	}

	n, err := s.ExpireStaleProposals(ctx, now)
	if err != nil {
		t.Fatalf("ExpireStaleProposals: %v", err)
	}
	if n != 1 {
		t.Fatalf("expiró %d, want 1", n)
	}
	old, _ := s.GetProposal(ctx, "pt_old")
	if old.Status != domain.ProposalExpired {
		t.Errorf("pt_old status = %q, want expired", old.Status)
	}
	fresh, _ := s.GetProposal(ctx, "pt_fresh")
	if fresh.Status != domain.ProposalPending {
		t.Errorf("pt_fresh status = %q, want pending", fresh.Status)
	}
}

func TestEventsAreOrderedAndResumable(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	for _, typ := range []string{EventSummaryCreated, EventSummaryUpdated, EventProposalNew} {
		if _, err := s.AppendEvent(ctx, typ, map[string]any{"k": typ}); err != nil {
			t.Fatalf("AppendEvent: %v", err)
		}
	}
	last, err := s.LastEventID(ctx)
	if err != nil {
		t.Fatalf("LastEventID: %v", err)
	}
	if last != 3 {
		t.Fatalf("LastEventID = %d, want 3", last)
	}

	events, err := s.EventsSince(ctx, 1, 10)
	if err != nil {
		t.Fatalf("EventsSince: %v", err)
	}
	if len(events) != 2 || events[0].ID != 2 || events[1].ID != 3 {
		t.Fatalf("eventos = %+v", events)
	}
	if events[0].Payload["k"] != EventSummaryUpdated {
		t.Errorf("payload no se decodificó: %+v", events[0].Payload)
	}

	// Reanudar desde el final no debe devolver nada: así el SSE no repite.
	fresh, err := s.EventsSince(ctx, last, 10)
	if err != nil || len(fresh) != 0 {
		t.Fatalf("EventsSince(last) = %+v, err=%v", fresh, err)
	}
}

func TestDuplicateAndResolvedDetection(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	seedProject(t, s, "saveme")

	now := time.Now().UTC()
	rec := ProposalRecord{
		Token: "pt_a", ProjectSlug: "saveme", Category: "feature", Title: "t",
		RelPath: "saveme/features/x.md", Body: "b", PayloadHash: "same",
		CreatedAt: now, ExpiresAt: now.Add(time.Minute),
	}
	if err := s.InsertProposal(ctx, rec); err != nil {
		t.Fatal(err)
	}

	if _, found, err := s.FindDuplicateProposal(ctx, "saveme", rec.RelPath, "same"); err != nil || !found {
		t.Fatalf("debería detectar el duplicado: found=%v err=%v", found, err)
	}
	if _, found, err := s.FindDuplicateProposal(ctx, "saveme", rec.RelPath, "otro"); err != nil || found {
		t.Fatalf("no debería detectar duplicado con otro hash: found=%v err=%v", found, err)
	}

	if _, err := s.ResolveProposal(ctx, "pt_a", domain.ProposalConfirmed, "accepted", "ui", "", "sm_9", now); err != nil {
		t.Fatal(err)
	}
	if _, found, err := s.FindDuplicateProposal(ctx, "saveme", rec.RelPath, "same"); err != nil || found {
		t.Fatalf("ya no es pendiente: found=%v err=%v", found, err)
	}
	if got, found, err := s.ResolvedProposalExists(ctx, "saveme", "same"); err != nil || !found || got.SummaryID != "sm_9" {
		t.Fatalf("debería detectar el resumen ya escrito: %+v found=%v err=%v", got, found, err)
	}
}

func TestClearIndexKeepsProposals(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	seedProject(t, s, "saveme")
	seedSummary(t, s, "sm_1", "saveme", "feature", "Uno", "cuerpo")

	now := time.Now().UTC()
	if err := s.InsertProposal(ctx, ProposalRecord{
		Token: "pt_keep", ProjectSlug: "saveme", Category: "feature", Title: "t",
		RelPath: "saveme/features/x.md", Body: "b", PayloadHash: "h",
		CreatedAt: now, ExpiresAt: now.Add(time.Minute),
	}); err != nil {
		t.Fatal(err)
	}

	if err := s.ClearIndex(ctx); err != nil {
		t.Fatalf("ClearIndex: %v", err)
	}
	if st, err := s.Stats(ctx); err != nil || st.Summaries != 0 || st.Projects != 0 {
		t.Fatalf("el índice no quedó vacío: %+v err=%v", st, err)
	}
	// Las propuestas son estado del protocolo, no índice derivado.
	if _, err := s.GetProposal(ctx, "pt_keep"); err != nil {
		t.Errorf("ClearIndex no debe tocar las propuestas: %v", err)
	}
}

// Una propuesta de actualización tiene que recordar **a qué** resumen actualiza y
// **cómo estaba** cuando se propuso.
//
// Las dos cosas viajan con la propuesta porque entre proponer y confirmar puede
// pasar cualquier cosa: el usuario edita el archivo, otro agente escribe encima.
// Sin el hash no habría forma de detectarlo y la actualización pisaría trabajo
// ajeno sin decir nada.
func TestProposalRecuerdaSuObjetivoYSuHash(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	seedProject(t, s, "saveme")

	now := time.Now().UTC()
	p := ProposalRecord{
		Token:       "pt_update1",
		ProjectSlug: "saveme",
		Category:    "feature",
		Title:       "Editor markdown (continuación)",
		RelPath:     "saveme/features/2026-01-01-editor.md",
		Body:        "cuerpo nuevo",
		PayloadHash: "abc",
		CreatedAt:   now,
		ExpiresAt:   now.Add(15 * time.Minute),
		TargetID:    "sm_01abc",
		BaseHash:    "hash-del-archivo-al-proponer",
	}
	if err := s.InsertProposal(ctx, p); err != nil {
		t.Fatalf("InsertProposal: %v", err)
	}

	got, err := s.GetProposal(ctx, "pt_update1")
	if err != nil {
		t.Fatalf("GetProposal: %v", err)
	}
	if got.TargetID != "sm_01abc" {
		t.Errorf("TargetID = %q, se perdió por el camino", got.TargetID)
	}
	if got.BaseHash != "hash-del-archivo-al-proponer" {
		t.Errorf("BaseHash = %q, se perdió por el camino", got.BaseHash)
	}
}

// Y una propuesta normal no puede quedar marcada como actualización: si el valor
// por defecto no fuera vacío, toda creación intentaría actualizar algo.
func TestProposalNormalNoTieneObjetivo(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	seedProject(t, s, "saveme")

	now := time.Now().UTC()
	p := ProposalRecord{
		Token:       "pt_create1",
		ProjectSlug: "saveme",
		Category:    "feature",
		Title:       "Algo nuevo",
		RelPath:     "saveme/features/2026-01-02-algo.md",
		Body:        "cuerpo",
		PayloadHash: "abc",
		CreatedAt:   now,
		ExpiresAt:   now.Add(15 * time.Minute),
	}
	if err := s.InsertProposal(ctx, p); err != nil {
		t.Fatalf("InsertProposal: %v", err)
	}
	got, err := s.GetProposal(ctx, "pt_create1")
	if err != nil {
		t.Fatal(err)
	}
	if got.TargetID != "" || got.BaseHash != "" {
		t.Errorf("una creación no debería tener objetivo: target=%q base=%q", got.TargetID, got.BaseHash)
	}
}
