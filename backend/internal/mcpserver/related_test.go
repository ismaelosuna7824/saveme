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

// --- resúmenes relacionados ---------------------------------------------------

// relatedEnDisco lee el `related` del frontmatter tal como quedó en el archivo,
// que es la verdad: el índice es solo una copia.
func (h *harness) relatedEnDisco(t *testing.T, relPath string) []string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(h.root, filepath.FromSlash(relPath)))
	if err != nil {
		t.Fatal(err)
	}
	doc := markdown.Parse(raw)
	if doc.Frontmatter == nil {
		t.Fatalf("%s no tiene frontmatter", relPath)
	}
	return doc.Frontmatter.Related
}

// Un relacionado se puede nombrar por id o por ruta, como `target`. Lo que se
// escribe son siempre ids, sin repetir aunque se nombre dos veces el mismo.
func TestProponerConRelacionadosPorIDYRutaLosEscribeAlConfirmar(t *testing.T) {
	h := newHarness(t, false)
	idA, _, _ := h.escribirResumen(t, "saveme", "Editor markdown", "Primera pieza.")
	idB, relB, _ := h.escribirResumen(t, "saveme", "Watcher del disco", "Segunda pieza.")

	out := h.callOK(t, "saveme_summary_propose", map[string]any{
		"project": "saveme",
		"title":   "Guardado sin conflictos",
		"body":    "Continúa el editor y depende del watcher.",
		"related": []string{idA, relB, idB},
	})
	propuestos := toStrings(out["related"])
	if !slices.Equal(propuestos, []string{idA, idB}) {
		t.Fatalf("la propuesta resolvió related = %v, esperaba [%s %s]", propuestos, idA, idB)
	}

	token, _ := out["token"].(string)
	done := h.callOK(t, "saveme_summary_confirm", map[string]any{
		"token": token, "decision": "accepted", "elicit": false,
	})
	relPath, _ := done["written_path"].(string)
	if got := h.relatedEnDisco(t, relPath); !slices.Equal(got, []string{idA, idB}) {
		t.Fatalf("frontmatter related = %v, esperaba [%s %s]", got, idA, idB)
	}
}

// Un relacionado que no existe se rechaza al proponer, diciendo cuál y cómo
// encontrar el bueno, y no se escribe nada.
func TestProponerConUnRelacionadoQueNoExisteFalla(t *testing.T) {
	h := newHarness(t, false)
	idA, _, _ := h.escribirResumen(t, "saveme", "Editor markdown", "Primera pieza.")

	msg := h.callErrText(t, "saveme_summary_propose", map[string]any{
		"project": "saveme",
		"title":   "Algo",
		"body":    "Cuerpo.",
		"related": []string{idA, "sm_no_existe_esto"},
	})
	if !strings.Contains(msg, "sm_no_existe_esto") || !strings.Contains(msg, "saveme_summary_search") {
		t.Errorf("el error no dice cuál falta ni cómo buscarlo: %q", msg)
	}
	if files := h.markdownFiles(t); len(files) != 1 {
		t.Errorf("no debería haber escrito nada más: %v", files)
	}
}

// Más de diez relacionados no enlazan nada en particular: se rechaza.
func TestProponerConDemasiadosRelacionadosFalla(t *testing.T) {
	h := newHarness(t, false)
	var ids []string
	for i := range 11 {
		id, _, _ := h.escribirResumen(t, "saveme", "Pieza "+string(rune('a'+i)), "Cuerpo "+string(rune('a'+i))+".")
		ids = append(ids, id)
	}
	msg := h.callErrText(t, "saveme_summary_propose", map[string]any{
		"project": "saveme", "title": "Todo junto", "body": "Cuerpo.", "related": ids,
	})
	if !strings.Contains(msg, "como mucho 10") {
		t.Errorf("el error no explica el límite: %q", msg)
	}
}

// Al actualizar, omitir `related` conserva los enlaces que ya había; pasarlo los
// reemplaza. Y el propio resumen nunca queda enlazado a sí mismo.
func TestActualizarConservaOReemplazaLosRelacionados(t *testing.T) {
	h := newHarness(t, false)
	idA, _, _ := h.escribirResumen(t, "saveme", "Editor markdown", "Primera pieza.")
	idB, _, _ := h.escribirResumen(t, "saveme", "Watcher del disco", "Segunda pieza.")

	out := h.callOK(t, "saveme_summary_propose", map[string]any{
		"project": "saveme", "title": "Guardado", "body": "Versión uno.", "related": []string{idA},
	})
	token, _ := out["token"].(string)
	done := h.callOK(t, "saveme_summary_confirm", map[string]any{
		"token": token, "decision": "accepted", "elicit": false,
	})
	relPath, _ := done["written_path"].(string)
	meta, _ := done["summary"].(map[string]any)
	id, _ := meta["id"].(string)

	confirmar := func(args map[string]any) {
		t.Helper()
		out := h.callOK(t, "saveme_summary_propose", args)
		token, _ := out["token"].(string)
		h.callOK(t, "saveme_summary_confirm", map[string]any{
			"token": token, "decision": "accepted", "elicit": false,
		})
	}

	// Sin related: se conserva el anterior.
	confirmar(map[string]any{
		"project": "saveme", "title": "Guardado", "body": "Versión dos.", "target": id,
	})
	if got := h.relatedEnDisco(t, relPath); !slices.Equal(got, []string{idA}) {
		t.Fatalf("al actualizar sin related se perdieron los enlaces: %v", got)
	}

	// Con related: se reemplaza, y el propio id se descarta.
	confirmar(map[string]any{
		"project": "saveme", "title": "Guardado", "body": "Versión tres.", "target": id,
		"related": []string{idB, id},
	})
	if got := h.relatedEnDisco(t, relPath); !slices.Equal(got, []string{idB}) {
		t.Fatalf("al actualizar con related = [%s] quedó %v", idB, got)
	}
}

// Los enlaces se ven en los dos sentidos: el resumen nuevo lista al que enlaza, y
// el enlazado lista al nuevo entre quienes lo citan.
func TestLinksDevuelveRelacionadosYEnlacesInversos(t *testing.T) {
	h := newHarness(t, false)
	ctx := context.Background()
	idA, _, _ := h.escribirResumen(t, "saveme", "Editor markdown", "Primera pieza.")
	h.escribirResumen(t, "saveme", "Watcher del disco", "Segunda pieza.")

	out := h.callOK(t, "saveme_summary_propose", map[string]any{
		"project": "saveme", "title": "Guardado", "body": "Continúa el editor.", "related": []string{idA},
	})
	token, _ := out["token"].(string)
	done := h.callOK(t, "saveme_summary_confirm", map[string]any{
		"token": token, "decision": "accepted", "elicit": false,
	})
	meta, _ := done["summary"].(map[string]any)
	idC, _ := meta["id"].(string)

	deC, err := h.svc.Links(ctx, idC)
	if err != nil {
		t.Fatalf("Links: %v", err)
	}
	if len(deC.Related) != 1 || deC.Related[0].ID != idA || deC.Related[0].Title != "Editor markdown" {
		t.Errorf("related de C = %+v, esperaba el editor", deC.Related)
	}
	if len(deC.Backlinks) != 0 {
		t.Errorf("nadie enlaza a C, pero backlinks = %+v", deC.Backlinks)
	}

	deA, err := h.svc.Links(ctx, idA)
	if err != nil {
		t.Fatalf("Links: %v", err)
	}
	if len(deA.Backlinks) != 1 || deA.Backlinks[0].ID != idC {
		t.Errorf("backlinks de A = %+v, esperaba %s", deA.Backlinks, idC)
	}
	if len(deA.Related) != 0 {
		t.Errorf("A no enlaza a nadie, pero related = %+v", deA.Related)
	}
}

func toStrings(v any) []string {
	list, _ := v.([]any)
	out := make([]string, 0, len(list))
	for _, item := range list {
		if s, ok := item.(string); ok {
			out = append(out, s)
		}
	}
	return out
}
