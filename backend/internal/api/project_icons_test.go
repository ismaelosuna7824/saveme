package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ismaelosuna/saveme/backend/internal/config"
)

// Los iconos se fusionan por proyecto: poner uno no toca los demás, y `null` o
// los dos campos vacíos lo devuelven al automático sin dejar una entrada vacía.
func TestConfigProjectIconsSeFusionan(t *testing.T) {
	srv, h := newTestServer(t)

	putJSON(t, h, "/api/config", map[string]any{
		"project_icons": map[string]any{"alfa": map[string]any{"sprite": "squid", "color": "green"}},
	})
	putJSON(t, h, "/api/config", map[string]any{
		"project_icons": map[string]any{"beta": map[string]any{"color": "pink"}},
	})
	want := map[string]config.ProjectIcon{
		"alfa": {Sprite: "squid", Color: "green"},
		"beta": {Color: "pink"},
	}
	if len(srv.cfg.ProjectIcons) != 2 || srv.cfg.ProjectIcons["alfa"] != want["alfa"] || srv.cfg.ProjectIcons["beta"] != want["beta"] {
		t.Fatalf("iconos = %+v", srv.cfg.ProjectIcons)
	}

	putJSON(t, h, "/api/config", map[string]any{"project_icons": map[string]any{"alfa": nil}})
	putJSON(t, h, "/api/config", map[string]any{
		"project_icons": map[string]any{"beta": map[string]any{"sprite": "", "color": ""}},
	})
	if len(srv.cfg.ProjectIcons) != 0 {
		t.Errorf("deberían haber vuelto al automático: %+v", srv.cfg.ProjectIcons)
	}

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/config", nil))
	var cfg map[string]json.RawMessage
	_ = json.Unmarshal(rec.Body.Bytes(), &cfg)
	if string(cfg["project_icons"]) != "{}" {
		t.Errorf("project_icons = %s, want {}", cfg["project_icons"])
	}
}

// Un nombre que no tiene forma de clave, o un slug inválido, se rechaza y no se
// guarda nada.
func TestConfigProjectIconsRechazaNombresRaros(t *testing.T) {
	srv, h := newTestServer(t)
	for _, body := range []map[string]any{
		{"alfa": map[string]any{"sprite": "<svg>"}},
		{"alfa": map[string]any{"color": "#ff0000"}},
		{"No Es Slug": map[string]any{"sprite": "squid"}},
	} {
		rec := putJSON(t, h, "/api/config", map[string]any{"project_icons": body})
		if rec.Code != http.StatusBadRequest {
			t.Errorf("%v: status = %d, want 400", body, rec.Code)
		}
	}
	if len(srv.cfg.ProjectIcons) != 0 {
		t.Errorf("no debería haberse guardado nada: %+v", srv.cfg.ProjectIcons)
	}
}
