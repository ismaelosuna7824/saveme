package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestEndpointResumenesFiltraPorFechaLocalYRechazaFechasIlegibles(t *testing.T) {
	srv, h := newTestServer(t)
	preparaAlfa(t, srv)

	hoy := time.Now().Format("2006-01-02")
	ayer := time.Now().AddDate(0, 0, -1).Format("2006-01-02")
	for _, tc := range []struct {
		query string
		want  int
	}{
		{"from=" + hoy + "&to=" + hoy, 1},
		{"to=" + ayer, 0},
		{"from=" + hoy + "&q=cuerpo", 1},
	} {
		rec := getJSON(t, h, "/api/summaries?project=alfa&"+tc.query)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s: status = %d, body = %s", tc.query, rec.Code, rec.Body.String())
		}
		var out struct {
			Total int `json:"total"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
			t.Fatalf("json: %v", err)
		}
		if out.Total != tc.want {
			t.Errorf("%s: total = %d, want %d", tc.query, out.Total, tc.want)
		}
	}

	rec := getJSON(t, h, "/api/summaries?project=alfa&from=14/02/2026")
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "invalid_date") {
		t.Fatalf("una fecha ilegible debería dar 400 invalid_date: %d %s", rec.Code, rec.Body.String())
	}
}

func TestEndpointEtiquetasAcotaPorProyecto(t *testing.T) {
	_, h := newTestServer(t)
	rec := getJSON(t, h, "/api/tags?project=no-existe")
	if rec.Code != http.StatusOK || strings.TrimSpace(rec.Body.String()) != "{}" {
		t.Fatalf("un proyecto sin resúmenes no tiene etiquetas: %d %s", rec.Code, rec.Body.String())
	}
}
