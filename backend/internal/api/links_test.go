package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// El editor pide los enlaces de un resumen en una sola petición: los que enlaza
// y los que lo citan, con su título ya resuelto.
func TestEndpointLinksDevuelveRelacionadosYEnlacesInversos(t *testing.T) {
	_, h := newTestServer(t)

	crear := func(title string, related []string) string {
		t.Helper()
		rec := postJSON(t, h, "/api/summaries", map[string]any{
			"project": "alfa", "title": title, "body": "Cuerpo de " + title + ".",
			"related": related,
		})
		if rec.Code != http.StatusCreated {
			t.Fatalf("crear %q: %d %s", title, rec.Code, rec.Body.String())
		}
		var res struct {
			Summary struct {
				ID string `json:"id"`
			} `json:"summary"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
			t.Fatal(err)
		}
		return res.Summary.ID
	}
	links := func(id string) (related, backlinks []string) {
		t.Helper()
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/summaries/"+id+"/links", nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("links de %s: %d %s", id, rec.Code, rec.Body.String())
		}
		var res struct {
			Related   []struct{ ID string } `json:"related"`
			Backlinks []struct{ ID string } `json:"backlinks"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
			t.Fatal(err)
		}
		if res.Related == nil || res.Backlinks == nil {
			t.Fatalf("las listas vacías deben ser [] y no null: %s", rec.Body.String())
		}
		for _, m := range res.Related {
			related = append(related, m.ID)
		}
		for _, m := range res.Backlinks {
			backlinks = append(backlinks, m.ID)
		}
		return related, backlinks
	}

	a := crear("Primero", nil)
	crear("Segundo", nil)
	c := crear("Tercero", []string{a})

	if rel, back := links(c); len(rel) != 1 || rel[0] != a || len(back) != 0 {
		t.Errorf("links del tercero: related=%v backlinks=%v", rel, back)
	}
	if rel, back := links(a); len(rel) != 0 || len(back) != 1 || back[0] != c {
		t.Errorf("links del primero: related=%v backlinks=%v", rel, back)
	}

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/summaries/sm_no_existe/links", nil))
	if rec.Code != http.StatusNotFound {
		t.Errorf("un resumen que no existe debe ser 404, fue %d", rec.Code)
	}
}
