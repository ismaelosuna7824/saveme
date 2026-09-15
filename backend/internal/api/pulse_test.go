package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// getJSON pide una ruta y devuelve la respuesta, para no repetir el ritual en cada
// prueba.
func getJSON(t *testing.T, h http.Handler, path string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
	return rec
}

// siembraResumen deja un resumen indexado en el proyecto `alfa` de la prueba.
func siembraResumen(t *testing.T, srv *Server, rel, id, titulo, categoria, fecha string) {
	t.Helper()
	contenido := "---\n" +
		"id: " + id + "\n" +
		"title: " + titulo + "\n" +
		"category: " + categoria + "\n" +
		"project: alfa\n" +
		"created_at: " + fecha + "\n" +
		"updated_at: " + fecha + "\n" +
		"author: human\n" +
		"status: active\n" +
		"---\n\nUn cuerpo.\n"

	if err := srv.svc.Workspace().WriteAtomic(rel, []byte(contenido), false); err != nil {
		t.Fatalf("escribir %s: %v", rel, err)
	}
}

// preparaAlfa deja el proyecto creado, con un resumen de hoy ya indexado.
func preparaAlfa(t *testing.T, srv *Server) {
	t.Helper()
	ctx := context.Background()
	if _, err := srv.svc.EnsureProject(ctx, "Alfa", "alfa"); err != nil {
		t.Fatalf("EnsureProject: %v", err)
	}
	siembraResumen(t, srv, "alfa/features/hoy.md", "sm_hoy", "Lo de hoy", "feature",
		time.Now().Format(time.RFC3339))
	if _, err := srv.svc.Reindex(ctx); err != nil {
		t.Fatalf("Reindex: %v", err)
	}
}

// `until` incluye el día entero. Cortando a medianoche, pedir el changelog de hoy
// devolvería un documento vacío y parecería que no se apuntó nada.
func TestEndpointChangelogIncluyeElDiaFinal(t *testing.T) {
	srv, h := newTestServer(t)
	preparaAlfa(t, srv)

	hoy := time.Now().Format("2006-01-02")
	rec := getJSON(t, h, "/api/projects/alfa/changelog?since="+hoy+"&until="+hoy)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var out struct {
		Count    int `json:"count"`
		Sections []struct {
			Category string `json:"category"`
		} `json:"sections"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("json: %v", err)
	}
	if out.Count != 1 {
		t.Fatalf("count = %d, esperaba 1: lo de hoy tiene que entrar con until=hoy", out.Count)
	}
	if len(out.Sections) != 1 || out.Sections[0].Category != "feature" {
		t.Errorf("secciones = %+v, esperaba una de feature", out.Sections)
	}
}

// Una fecha que no se entiende se rechaza con un 400 claro, en vez de caer a la
// ventana por defecto y devolver algo que parece correcto.
func TestEndpointChangelogFechaInvalida(t *testing.T) {
	srv, h := newTestServer(t)
	preparaAlfa(t, srv)

	rec := getJSON(t, h, "/api/projects/alfa/changelog?since=14/02/2026")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, esperaba 400", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "invalid_date") {
		t.Errorf("el error no dice que la fecha está mal: %s", rec.Body.String())
	}
}

// El briefing y el mapa responden con la forma que espera la interfaz: listas
// vacías y no nulas, y tantos días como se pidieron.
func TestEndpointBriefingYActivity(t *testing.T) {
	srv, h := newTestServer(t)
	preparaAlfa(t, srv)

	rec := getJSON(t, h, "/api/projects/alfa/briefing")
	if rec.Code != http.StatusOK {
		t.Fatalf("briefing status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var briefing struct {
		Project string            `json:"project"`
		Total   int               `json:"total"`
		Last    []json.RawMessage `json:"last"`
		Files   []json.RawMessage `json:"files"`
		Pending []json.RawMessage `json:"pending"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &briefing); err != nil {
		t.Fatalf("json briefing: %v", err)
	}
	if briefing.Total != 1 || len(briefing.Last) != 1 {
		t.Errorf("briefing = %+v, esperaba 1 resumen", briefing)
	}
	if briefing.Files == nil || briefing.Pending == nil {
		t.Error("las listas del briefing tienen que salir [] y no null")
	}

	rec = getJSON(t, h, "/api/projects/alfa/activity?days=7")
	if rec.Code != http.StatusOK {
		t.Fatalf("activity status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var activity struct {
		Days    int `json:"days"`
		Active  int `json:"active"`
		Total   int `json:"total"`
		Entries []struct {
			Date       string         `json:"date"`
			Count      int            `json:"count"`
			ByCategory map[string]int `json:"by_category"`
		} `json:"entries"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &activity); err != nil {
		t.Fatalf("json activity: %v", err)
	}
	if activity.Days != 7 || len(activity.Entries) != 7 {
		t.Errorf("days/entries = %d/%d, esperaba 7/7", activity.Days, len(activity.Entries))
	}
	if activity.Total != 1 || activity.Active != 1 {
		t.Errorf("total/active = %d/%d, esperaba 1/1", activity.Total, activity.Active)
	}
	for _, entrada := range activity.Entries {
		if entrada.ByCategory == nil {
			t.Fatalf("el día %s trae by_category nulo: tiene que salir {}", entrada.Date)
		}
	}
}

// Un proyecto que no existe es un 404 y no un documento vacío.
func TestEndpointDeProyectoDesconocido(t *testing.T) {
	_, h := newTestServer(t)

	for _, ruta := range []string{
		"/api/projects/no-existe/briefing",
		"/api/projects/no-existe/activity",
		"/api/projects/no-existe/changelog",
	} {
		rec := getJSON(t, h, ruta)
		if rec.Code != http.StatusNotFound {
			t.Errorf("%s → %d, esperaba 404", ruta, rec.Code)
		}
	}
}
