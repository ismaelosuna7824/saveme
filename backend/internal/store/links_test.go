package store

import (
	"context"
	"testing"
	"time"
)

// Los enlaces inversos salen de `related_json`: quien apunta a un resumen
// aparece en sus backlinks, por id o por ruta, y quien no apunta no.
func TestBacklinksDevuelveQuienEnlazaAlResumen(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	seedProject(t, s, "saveme")

	destino := seedSummary(t, s, "sm_1", "saveme", "feature", "Editor markdown", "Cuerpo.")
	porID := seedSummary(t, s, "sm_2", "saveme", "fix", "Arreglo del editor", "Cuerpo.")
	porRuta := seedSummary(t, s, "sm_3", "saveme", "docs", "Guía del editor", "Cuerpo.")
	seedSummary(t, s, "sm_4", "saveme", "chore", "Sin relación", "Cuerpo.")

	porID.Related = []string{"sm_1"}
	porID.UpdatedAt = time.Now().UTC().Add(time.Minute)
	if err := s.UpsertSummary(ctx, porID, "Cuerpo."); err != nil {
		t.Fatalf("UpsertSummary: %v", err)
	}
	// Quien edita el frontmatter a mano escribe la ruta, y también cuenta.
	porRuta.Related = []string{destino.RelPath}
	if err := s.UpsertSummary(ctx, porRuta, "Cuerpo."); err != nil {
		t.Fatalf("UpsertSummary: %v", err)
	}

	got, err := s.Backlinks(ctx, destino.ID, destino.RelPath)
	if err != nil {
		t.Fatalf("Backlinks: %v", err)
	}
	if len(got) != 2 || got[0].ID != "sm_2" || got[1].ID != "sm_3" {
		t.Fatalf("backlinks = %+v, esperaba sm_2 (más reciente) y sm_3", got)
	}

	nadie, err := s.Backlinks(ctx, "sm_4", "saveme/chore/sm_4.md")
	if err != nil {
		t.Fatalf("Backlinks: %v", err)
	}
	if nadie == nil || len(nadie) != 0 {
		t.Fatalf("sin enlaces debe devolver una lista vacía, no %#v", nadie)
	}
}

// La propuesta guarda los relacionados resueltos y los devuelve tal cual: es lo
// que se escribirá en el frontmatter al confirmar.
func TestPropuestaGuardaLosRelacionados(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	seedProject(t, s, "saveme")

	now := time.Now().UTC()
	if err := s.InsertProposal(ctx, ProposalRecord{
		Token: "pt_rel", ProjectSlug: "saveme", Category: "feature", Title: "t",
		RelPath: "saveme/features/x.md", Body: "b", PayloadHash: "h",
		CreatedAt: now, ExpiresAt: now.Add(time.Hour),
		Related: []string{"sm_1", "sm_2"},
	}); err != nil {
		t.Fatalf("InsertProposal: %v", err)
	}
	got, err := s.GetProposal(ctx, "pt_rel")
	if err != nil {
		t.Fatalf("GetProposal: %v", err)
	}
	if len(got.Related) != 2 || got.Related[0] != "sm_1" || got.Related[1] != "sm_2" {
		t.Fatalf("related = %v, esperaba [sm_1 sm_2]", got.Related)
	}
}
