package service

import (
	"context"
	"testing"

	"github.com/ismaelosuna/saveme/backend/internal/domain"
)

// Un resumen escrito desde la terminal lo escribió una persona, aunque entre por
// la misma puerta que un agente.
//
// El autor se deriva del agente, así que sin tratar `cli` como caso aparte todo
// lo que se apunta a mano quedaba marcado como «agent»: indistinguible de lo que
// propuso una máquina. Ese campo existe justo para poder separarlos.
func TestLoEscritoDesdeLaCLIEsDeAutorHumano(t *testing.T) {
	svc, _ := newTestService(t)
	ctx := context.Background()

	if _, err := svc.EnsureProject(ctx, "Cli", "cli"); err != nil {
		t.Fatalf("EnsureProject: %v", err)
	}

	prep, err := svc.Propose(ctx, domain.CreateRequest{
		Project: "cli",
		Title:   "Apuntado a mano",
		Body:    "Un cuerpo cualquiera.",
		Author:  "humano",
		Agent:   "cli",
	})
	if err != nil {
		t.Fatalf("Propose: %v", err)
	}
	if prep.Proposal == nil {
		t.Fatal("no se preparó ninguna propuesta")
	}

	res, err := svc.Confirm(ctx, prep.Proposal.Token, Decision{
		Accepted: true,
		Via:      domain.ResolvedViaCLI,
	})
	if err != nil {
		t.Fatalf("Confirm: %v", err)
	}

	if res.Meta.Author != "human" {
		t.Errorf("author = %q, esperaba human", res.Meta.Author)
	}
	// El canal no se pierde: sigue sabiéndose que entró por la CLI.
	if res.Meta.Agent != "cli" {
		t.Errorf("agent = %q, esperaba cli", res.Meta.Agent)
	}
}

// Un agente de verdad sigue marcándose como tal: el caso de la CLI es una
// excepción, no un cambio de criterio.
func TestLoPropuestoPorUnAgenteSigueSiendoDeAutorAgente(t *testing.T) {
	svc, _ := newTestService(t)
	ctx := context.Background()

	if _, err := svc.EnsureProject(ctx, "Cli", "cli"); err != nil {
		t.Fatalf("EnsureProject: %v", err)
	}

	prep, err := svc.Propose(ctx, domain.CreateRequest{
		Project: "cli",
		Title:   "Propuesto por un agente",
		Body:    "Otro cuerpo.",
		Agent:   "opencode",
	})
	if err != nil {
		t.Fatalf("Propose: %v", err)
	}

	res, err := svc.Confirm(ctx, prep.Proposal.Token, Decision{Accepted: true, Via: domain.ResolvedViaUI})
	if err != nil {
		t.Fatalf("Confirm: %v", err)
	}
	if res.Meta.Author != "agent" {
		t.Errorf("author = %q, esperaba agent", res.Meta.Author)
	}
}
