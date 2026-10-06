package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/ismaelosuna/saveme/backend/internal/config"
)

// pngBytes es un PNG mínimo válido (1×1), suficiente para el sniffing.
var pngBytes = []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde")

func upload(t *testing.T, h http.Handler, body []byte) (*httptest.ResponseRecorder, string) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/backgrounds", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/octet-stream")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	var out struct {
		Image string `json:"image"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec, out.Image
}

// Subir una imagen la guarda con un nombre derivado de su contenido, y volver a
// subirla no la duplica: el nombre es el mismo y el archivo no se reescribe.
func TestUploadBackgroundGuardaPorContenido(t *testing.T) {
	srv, h := newTestServer(t)

	rec, name := upload(t, h, pngBytes)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if !config.ValidBackgroundImage(name) || filepath.Ext(name) != ".png" {
		t.Fatalf("nombre inesperado: %q", name)
	}
	stored, err := os.ReadFile(filepath.Join(srv.cfg.BackgroundsDir(), name))
	if err != nil || !bytes.Equal(stored, pngBytes) {
		t.Fatalf("la imagen guardada no coincide: %v", err)
	}

	again, second := upload(t, h, pngBytes)
	if again.Code != http.StatusOK || second != name {
		t.Errorf("la segunda subida debería reutilizar %q: %d %q", name, again.Code, second)
	}
	entries, _ := os.ReadDir(srv.cfg.BackgroundsDir())
	if len(entries) != 1 {
		t.Errorf("deberían quedar un archivo y sin temporales: %v", entries)
	}
}

// El formato se decide por los bytes: un texto con nombre de imagen, o algo
// vacío, no se guarda.
func TestUploadBackgroundRechazaLoQueNoEsImagen(t *testing.T) {
	_, h := newTestServer(t)
	for _, body := range [][]byte{nil, []byte("no soy una imagen"), []byte("<svg></svg>")} {
		rec, _ := upload(t, h, body)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("%q: status = %d, want 400", body, rec.Code)
		}
	}
}

// Servir solo acepta nombres con la forma exacta del import: cualquier otra cosa
// es un 404 antes de tocar el disco, para que `{name}` no sirva para leer otros
// archivos.
func TestGetBackgroundSoloSirveImportadas(t *testing.T) {
	srv, h := newTestServer(t)
	_, name := upload(t, h, pngBytes)

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/backgrounds/"+name, nil))
	if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("status = %d, type = %q", rec.Code, rec.Header().Get("Content-Type"))
	}
	if !bytes.Equal(rec.Body.Bytes(), pngBytes) {
		t.Error("el cuerpo no es la imagen")
	}

	// Un archivo junto a las imágenes, con otro nombre, no se sirve.
	if err := os.WriteFile(filepath.Join(srv.cfg.BackgroundsDir(), "config.json"), []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	for _, bad := range []string{"config.json", "..%2Fconfig.json", "0123456789abcdef.txt"} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/backgrounds/"+bad, nil))
		if rec.Code != http.StatusNotFound {
			t.Errorf("%s: status = %d, want 404", bad, rec.Code)
		}
	}
}

// Un fondo se pone con un objeto, se completa con el aspecto por defecto, se
// acota, y `null` lo quita. Lo que no se manda no se toca.
func TestConfigBackgroundPonerAcotarYQuitar(t *testing.T) {
	srv, h := newTestServer(t)
	_, name := upload(t, h, pngBytes)

	rec := putJSON(t, h, "/api/config", map[string]any{
		"background": map[string]any{"image": name, "blur": 99, "empty_visibility": 1.5, "effect": "inventado"},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	got := srv.cfg.Background
	if got == nil {
		t.Fatal("no se guardó el fondo")
	}
	want := config.Background{
		Image: name, Effect: "none", ShowOn: "all",
		EmptyVisibility: 1, DocumentVisibility: config.DefaultDocumentVisibility, Blur: config.MaxBackgroundBlur,
	}
	if *got != want {
		t.Errorf("fondo = %+v, want %+v", *got, want)
	}

	// Otro cambio cualquiera no toca el fondo.
	putJSON(t, h, "/api/config", map[string]any{"theme": "amber"})
	if srv.cfg.Background == nil {
		t.Error("cambiar el tema no debería quitar el fondo")
	}

	rec = putJSON(t, h, "/api/config", map[string]any{"background": nil})
	if rec.Code != http.StatusOK || srv.cfg.Background != nil {
		t.Errorf("null debería quitar el fondo: %d %+v", rec.Code, srv.cfg.Background)
	}
}

// Un fondo que apunta a una imagen que no está, o a un nombre que no es de
// import, se rechaza: se vería como un fallo en cada pantalla.
func TestConfigBackgroundExigeUnaImagenImportada(t *testing.T) {
	srv, h := newTestServer(t)
	for _, image := range []string{"0123456789abcdef.png", "../config.json", ""} {
		rec := putJSON(t, h, "/api/config", map[string]any{"background": map[string]any{"image": image}})
		if rec.Code != http.StatusBadRequest {
			t.Errorf("%q: status = %d, want 400", image, rec.Code)
		}
	}
	if srv.cfg.Background != nil {
		t.Error("un fondo rechazado no puede quedar guardado")
	}
}

// Los fondos de proyecto se fusionan por proyecto: poner uno no toca los demás y
// `null` quita solo ese.
func TestConfigProjectBackgroundsSeFusionan(t *testing.T) {
	srv, h := newTestServer(t)
	_, name := upload(t, h, pngBytes)

	putJSON(t, h, "/api/config", map[string]any{
		"project_backgrounds": map[string]any{"alfa": map[string]any{"image": name}},
	})
	putJSON(t, h, "/api/config", map[string]any{
		"project_backgrounds": map[string]any{"beta": map[string]any{"image": name, "show_on": "empty"}},
	})
	if len(srv.cfg.ProjectBackgrounds) != 2 || srv.cfg.ProjectBackgrounds["beta"].ShowOn != "empty" {
		t.Fatalf("fondos = %+v", srv.cfg.ProjectBackgrounds)
	}

	rec := putJSON(t, h, "/api/config", map[string]any{"project_backgrounds": map[string]any{"alfa": nil}})
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if _, still := srv.cfg.ProjectBackgrounds["alfa"]; still || len(srv.cfg.ProjectBackgrounds) != 1 {
		t.Errorf("null debería quitar solo alfa: %+v", srv.cfg.ProjectBackgrounds)
	}

	rec = putJSON(t, h, "/api/config", map[string]any{
		"project_backgrounds": map[string]any{"No Es Slug": map[string]any{"image": name}},
	})
	if rec.Code != http.StatusBadRequest {
		t.Errorf("un slug inválido debería rechazarse: %d", rec.Code)
	}

	// Lo que llega a la interfaz: siempre un objeto, aunque esté vacío.
	putJSON(t, h, "/api/config", map[string]any{"project_backgrounds": map[string]any{"beta": nil}})
	resp := httptest.NewRecorder()
	h.ServeHTTP(resp, httptest.NewRequest(http.MethodGet, "/api/config", nil))
	var cfg map[string]json.RawMessage
	_ = json.Unmarshal(resp.Body.Bytes(), &cfg)
	if string(cfg["project_backgrounds"]) != "{}" || string(cfg["background"]) != "null" {
		t.Errorf("background=%s project_backgrounds=%s", cfg["background"], cfg["project_backgrounds"])
	}
}
