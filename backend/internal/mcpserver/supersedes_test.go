package mcpserver

import (
	"context"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/ismaelosuna/saveme/backend/internal/markdown"
)

// --- resúmenes sustituidos ----------------------------------------------------

// El caso para el que existe: una decisión de diseño se revierte. El agente que
// pregunta qué se hizo en ese archivo tiene que recibir la vieja marcada como no
// vigente y saber cuál manda; el archivo viejo no se toca.
func TestUnaDecisionSustituidaLlegaMarcadaAlAgente(t *testing.T) {
	h := newHarness(t, false)
	ctx := context.Background()

	viejo := h.callOK(t, "saveme_summary_propose", map[string]any{
		"project": "saveme", "title": "Índice en memoria", "category": "design",
		"body": "Guardamos el índice en memoria.", "files_touched": []string{"backend/index.go"},
	})
	doneViejo := h.callOK(t, "saveme_summary_confirm", map[string]any{
		"token": viejo["token"], "decision": "accepted", "elicit": false,
	})
	idViejo, _ := doneViejo["summary"].(map[string]any)["id"].(string)
	relViejo, _ := doneViejo["written_path"].(string)
	antes, _ := os.ReadFile(filepath.Join(h.root, filepath.FromSlash(relViejo)))

	// Se nombra por ruta, que es lo natural a mano; se tiene que resolver al id.
	nuevo := h.callOK(t, "saveme_summary_propose", map[string]any{
		"project": "saveme", "title": "Índice en SQLite", "category": "design",
		"body":          "Revertimos el índice en memoria: no aguantaba reinicios.",
		"files_touched": []string{"backend/index.go"}, "supersedes": []string{relViejo},
	})
	if got := toStrings(nuevo["supersedes"]); !slices.Equal(got, []string{idViejo}) {
		t.Fatalf("la propuesta resolvió supersedes = %v, esperaba [%s]", got, idViejo)
	}
	doneNuevo := h.callOK(t, "saveme_summary_confirm", map[string]any{
		"token": nuevo["token"], "decision": "accepted", "elicit": false,
	})
	idNuevo, _ := doneNuevo["summary"].(map[string]any)["id"].(string)
	relNuevo, _ := doneNuevo["written_path"].(string)

	raw, _ := os.ReadFile(filepath.Join(h.root, filepath.FromSlash(relNuevo)))
	if fm := markdown.Parse(raw).Frontmatter; fm == nil || !slices.Equal(fm.Supersedes, []string{idViejo}) {
		t.Fatalf("el frontmatter del nuevo no dice a quién sustituye: %s", raw)
	}
	if despues, _ := os.ReadFile(filepath.Join(h.root, filepath.FromSlash(relViejo))); string(despues) != string(antes) {
		t.Fatal("sustituir no puede reescribir el resumen viejo")
	}

	contexto := h.callOK(t, "saveme_context", map[string]any{"files": []string{"backend/index.go"}})
	items, _ := contexto["items"].([]any)
	marcas := map[string]string{}
	for _, it := range items {
		m, _ := it.(map[string]any)
		id, _ := m["id"].(string)
		by, _ := m["superseded_by"].(string)
		marcas[id] = by
	}
	if marcas[idViejo] != idNuevo {
		t.Errorf("saveme_context no marca el viejo como sustituido por el nuevo: %v", marcas)
	}
	if marcas[idNuevo] != "" {
		t.Errorf("el nuevo sigue vigente, pero llega marcado: %v", marcas)
	}

	leido := h.callOK(t, "saveme_summary_read", map[string]any{"id": idViejo})
	if by, _ := leido["summary"].(map[string]any)["superseded_by"].(string); by != idNuevo {
		t.Errorf("saveme_summary_read no avisa de que está sustituido: %v", leido["summary"])
	}

	links, err := h.svc.Links(ctx, idViejo)
	if err != nil {
		t.Fatalf("Links: %v", err)
	}
	if len(links.SupersededBy) != 1 || links.SupersededBy[0].ID != idNuevo {
		t.Errorf("superseded_by del viejo = %+v", links.SupersededBy)
	}
	if links, _ := h.svc.Links(ctx, idNuevo); len(links.Supersedes) != 1 || links.Supersedes[0].ID != idViejo {
		t.Errorf("supersedes del nuevo = %+v", links.Supersedes)
	}
}

// Sustituir algo que no existe se rechaza al proponer, diciendo qué lista está mal.
func TestSustituirUnResumenQueNoExisteFalla(t *testing.T) {
	h := newHarness(t, false)
	msg := h.callErrText(t, "saveme_summary_propose", map[string]any{
		"project": "saveme", "title": "Algo", "body": "Cuerpo.",
		"supersedes": []string{"sm_no_existe_esto"},
	})
	if !strings.Contains(msg, "sustituido") || !strings.Contains(msg, "sm_no_existe_esto") {
		t.Errorf("el error no dice cuál falta ni de qué lista: %q", msg)
	}
	if files := h.markdownFiles(t); len(files) != 0 {
		t.Errorf("una propuesta rechazada no escribe nada: %v", files)
	}
}
