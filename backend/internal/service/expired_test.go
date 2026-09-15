package service

import (
	"context"
	"testing"
	"time"

	"github.com/ismaelosuna/saveme/backend/internal/domain"
)

// Una propuesta vencida se puede aprobar igual.
//
// El TTL acota lo que espera el agente, no lo que tarda una persona. Antes,
// aprobar tarde la rechazaba y el trabajo del agente se perdía aunque el cuerpo
// siguiera en la base, intacto: quince minutos de margen convertían una decisión
// tardía en una pérdida.
func TestUnaPropuestaVencidaSePuedeAprobar(t *testing.T) {
	svc, _ := newTestService(t)
	ctx := context.Background()

	if _, err := svc.EnsureProject(ctx, "Tarde", "tarde"); err != nil {
		t.Fatalf("EnsureProject: %v", err)
	}

	prep, err := svc.Propose(ctx, domain.CreateRequest{Project: "tarde", Title: "Rescatada a tiempo", Body: "Un cuerpo."})
	if err != nil {
		t.Fatalf("Propose: %v", err)
	}
	token := prep.Proposal.Token

	// Se fuerza el vencimiento moviendo el reloj de la propuesta hacia atrás, que
	// es lo que hace el barrendero cuando pasa el TTL.
	if _, err := svc.st.ResolveProposal(ctx, token, "expired", "", "", "", "", time.Now().UTC()); err != nil {
		t.Fatalf("marcar como vencida: %v", err)
	}

	res, err := svc.Confirm(ctx, token, Decision{Accepted: true, Via: "ui"})
	if err != nil {
		t.Fatalf("aprobar una vencida no debería fallar: %v", err)
	}
	if res == nil || res.Meta.ID == "" {
		t.Fatal("no se escribió nada")
	}

	// Y queda dicho que se aprobó fuera de plazo.
	rec, err := svc.st.GetProposal(ctx, token)
	if err != nil {
		t.Fatalf("GetProposal: %v", err)
	}
	if rec.ResolvedVia != "ui+tarde" {
		t.Errorf("via = %q, esperaba ui+tarde", rec.ResolvedVia)
	}
}

// Una cancelada sigue cancelada: «no» es una decisión, no una demora.
func TestUnaPropuestaCanceladaNoSePuedeAprobar(t *testing.T) {
	svc, _ := newTestService(t)
	ctx := context.Background()

	if _, err := svc.EnsureProject(ctx, "Tarde", "tarde"); err != nil {
		t.Fatalf("EnsureProject: %v", err)
	}
	prep, err := svc.Propose(ctx, domain.CreateRequest{Project: "tarde", Title: "Rechazada", Body: "Otro cuerpo."})
	if err != nil {
		t.Fatalf("Propose: %v", err)
	}

	if _, err := svc.Confirm(ctx, prep.Proposal.Token, Decision{Cancelled: true, Via: "ui"}); err != nil {
		t.Fatalf("cancelar: %v", err)
	}
	if _, err := svc.Confirm(ctx, prep.Proposal.Token, Decision{Accepted: true, Via: "ui"}); err == nil {
		t.Fatal("una cancelada no debería poder aprobarse después")
	}
}
