package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Lo que hace el editor: pide el resumen, cambia el texto y guarda lo que tiene.
// Ese ciclo no puede costarle al resumen su frontmatter. Cuando el detalle
// devolvía solo el cuerpo, el primer autoguardado escribía el archivo sin
// frontmatter y el resumen quedaba `unmanaged`, sin título, categoría ni enlaces.
func TestEditarDesdeElEditorConservaElFrontmatter(t *testing.T) {
	_, h := newTestServer(t)

	rec := postJSON(t, h, "/api/summaries", map[string]any{
		"project": "alfa", "title": "Editor con preview", "category": "feature",
		"body": "Primera versión.", "tags": []string{"editor"},
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("crear: %d %s", rec.Code, rec.Body.String())
	}
	var created struct {
		Summary struct{ ID string } `json:"summary"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	id := created.Summary.ID

	type detail struct {
		Meta struct {
			Status      string   `json:"status"`
			Title       string   `json:"title"`
			Category    string   `json:"category"`
			Tags        []string `json:"tags"`
			ContentHash string   `json:"content_hash"`
		} `json:"meta"`
		Content string `json:"content"`
	}
	get := func() detail {
		t.Helper()
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/summaries/"+id, nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("leer: %d %s", rec.Code, rec.Body.String())
		}
		var d detail
		if err := json.Unmarshal(rec.Body.Bytes(), &d); err != nil {
			t.Fatal(err)
		}
		return d
	}

	before := get()
	if !strings.HasPrefix(before.Content, "---\n") {
		t.Fatalf("el editor tiene que recibir el archivo entero, con frontmatter:\n%s", before.Content)
	}

	edited := strings.Replace(before.Content, "Primera versión.", "Segunda versión.", 1)
	if rec := putJSON(t, h, "/api/summaries/"+id, map[string]any{
		"content": edited, "base_hash": before.Meta.ContentHash,
	}); rec.Code != http.StatusOK {
		t.Fatalf("guardar: %d %s", rec.Code, rec.Body.String())
	}

	after := get()
	if after.Meta.Status != "confirmed" || after.Meta.Title != "Editor con preview" ||
		after.Meta.Category != "feature" || len(after.Meta.Tags) != 1 {
		t.Errorf("guardar desde el editor perdió metadatos: %+v", after.Meta)
	}
	if !strings.HasPrefix(after.Content, "---\n") || !strings.Contains(after.Content, "Segunda versión.") {
		t.Errorf("el archivo guardado no conserva frontmatter y cambio:\n%s", after.Content)
	}
}
