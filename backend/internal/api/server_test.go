package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ismaelosuna/saveme/backend/internal/config"
	"github.com/ismaelosuna/saveme/backend/internal/service"
	"github.com/ismaelosuna/saveme/backend/internal/store"
	"github.com/ismaelosuna/saveme/backend/internal/workspace"
)

// newTestServer monta el handler con un workspace y un índice temporales.
func newTestServer(t *testing.T) (*Server, http.Handler) {
	t.Helper()
	dir := t.TempDir()
	root := filepath.Join(dir, "ws")

	ws, err := workspace.New(root)
	if err != nil {
		t.Fatalf("workspace.New: %v", err)
	}
	st, err := store.Open(filepath.Join(dir, "index.db"))
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { st.Close() })

	cfg := config.Defaults()
	cfg.RootDir = root
	cfg.Path = filepath.Join(dir, "config.json")

	srv := New(service.New(ws, st), cfg, "test", 7411, slog.Default())
	return srv, srv.Handler()
}

func putJSON(t *testing.T, h http.Handler, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPut, path, bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

// TestConfigPartialPatchKeepsOtherFields es una prueba de regresión.
//
// La interfaz manda parches parciales: al cambiar de modo de editor envía
// únicamente `{"editor":{"preview_mode":"live"}}`. Con un struct de valores, los
// campos ausentes llegaban como cero y el parche pisaba `wrap` a false y
// `autosave_ms` a 0 —lo que desactivaría el debounce del autoguardado—. Los
// punteros distinguen "no lo mandé" de "lo mandé con el valor cero".
func TestConfigPartialPatchKeepsOtherFields(t *testing.T) {
	srv, h := newTestServer(t)

	// Estado inicial conocido.
	srv.cfg.Editor.Wrap = true
	srv.cfg.Editor.AutosaveMs = 1200
	srv.cfg.Editor.PreviewMode = "split"
	srv.cfg.Editor.FontSize = 14

	rec := putJSON(t, h, "/api/config", map[string]any{
		"editor": map[string]any{"preview_mode": "live"},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}

	if srv.cfg.Editor.PreviewMode != "live" {
		t.Errorf("preview_mode = %q, want live", srv.cfg.Editor.PreviewMode)
	}
	if !srv.cfg.Editor.Wrap {
		t.Error("wrap se pisó a false con un parche que no lo mencionaba")
	}
	if srv.cfg.Editor.AutosaveMs != 1200 {
		t.Errorf("autosave_ms = %d, want 1200: un parche parcial no debe desactivar el autoguardado",
			srv.cfg.Editor.AutosaveMs)
	}
	if srv.cfg.Editor.FontSize != 14 {
		t.Errorf("font_size = %d, want 14", srv.cfg.Editor.FontSize)
	}
}

// Un parche sí puede poner un valor cero a propósito.
func TestConfigPatchCanSetZeroValues(t *testing.T) {
	srv, h := newTestServer(t)
	srv.cfg.Editor.Wrap = true

	rec := putJSON(t, h, "/api/config", map[string]any{
		"editor": map[string]any{"wrap": false, "autosave_ms": 0},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if srv.cfg.Editor.Wrap {
		t.Error("mandar wrap=false explícitamente debe desactivarlo")
	}
	if srv.cfg.Editor.AutosaveMs != 0 {
		t.Errorf("autosave_ms = %d, want 0 cuando se manda explícitamente", srv.cfg.Editor.AutosaveMs)
	}
}

// El modo vim se enciende y se apaga con un parche, sin tocar el resto del
// editor, y viene apagado de fábrica: es un modo en el que las letras dejan de
// escribir, y no se le impone a nadie que abra la app sin saberlo.
func TestConfigVimMode(t *testing.T) {
	srv, h := newTestServer(t)
	if srv.cfg.Editor.VimMode {
		t.Error("vim_mode debe venir apagado por defecto")
	}
	srv.cfg.Editor.Wrap = true
	srv.cfg.Editor.FontSize = 14

	rec := putJSON(t, h, "/api/config", map[string]any{
		"editor": map[string]any{"vim_mode": true},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if !srv.cfg.Editor.VimMode {
		t.Error("mandar vim_mode=true debe encenderlo")
	}
	if !srv.cfg.Editor.Wrap || srv.cfg.Editor.FontSize != 14 {
		t.Error("encender vim no debe tocar el resto de preferencias del editor")
	}

	// Y se apaga sin arrastrar nada más.
	rec = putJSON(t, h, "/api/config", map[string]any{
		"editor": map[string]any{"vim_mode": false},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if srv.cfg.Editor.VimMode {
		t.Error("mandar vim_mode=false debe apagarlo")
	}
}

// El tema y el modo conviven: cambiar uno no toca el otro.
func TestConfigThemeAndEditorAreIndependent(t *testing.T) {
	srv, h := newTestServer(t)
	srv.cfg.Editor.PreviewMode = "split"
	srv.cfg.Theme = "phosphor"

	putJSON(t, h, "/api/config", map[string]any{"theme": "plain"})
	if srv.cfg.Theme != "plain" {
		t.Errorf("theme = %q", srv.cfg.Theme)
	}
	if srv.cfg.Editor.PreviewMode != "split" {
		t.Errorf("cambiar el tema no debe tocar el modo del editor: %q", srv.cfg.Editor.PreviewMode)
	}
}

// El endpoint de salud reporta el puerto realmente abierto, no el configurado.
func TestHealthReportsBoundPort(t *testing.T) {
	_, h := newTestServer(t)
	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["port"] != float64(7411) {
		t.Errorf("port = %v, want 7411", body["port"])
	}
}

func postJSON(t *testing.T, h http.Handler, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

// Quitar sin decir a quién tiene que ser un 400, no un «hecho» vacío: si no, la
// interfaz diría que quitó algo cuando no se le pidió nada.
func TestUnconfigureSinClientesEsUnError(t *testing.T) {
	_, h := newTestServer(t)
	rec := postJSON(t, h, "/api/mcp/unconfigure", map[string]any{"providers": []string{}})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("código = %d, esperaba 400", rec.Code)
	}
	var body struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("respuesta ilegible: %v", err)
	}
	if body.Error.Code != "no_providers" {
		t.Errorf("código de error = %q, esperaba no_providers", body.Error.Code)
	}
}

// Un cliente que no conocemos se reporta como tal y no se toca ningún archivo.
func TestUnconfigureConClienteDesconocidoNoTocaNada(t *testing.T) {
	_, h := newTestServer(t)
	rec := postJSON(t, h, "/api/mcp/unconfigure", map[string]any{
		"providers": []string{"no-existe-este-cliente"},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("código = %d, esperaba 200", rec.Code)
	}
	var body struct {
		Results []struct {
			Key    string `json:"key"`
			Action string `json:"action"`
		} `json:"results"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("respuesta ilegible: %v", err)
	}
	if len(body.Results) != 1 {
		t.Fatalf("esperaba un resultado, hay %d", len(body.Results))
	}
	if body.Results[0].Action != "unknown" {
		t.Errorf("acción = %q, esperaba unknown", body.Results[0].Action)
	}
}

// Quitar de un cliente no puede llevarse el binario por delante: los demás
// clientes configurados siguen apuntando a él. La respuesta, además, no promete
// haber tocado el binario.
func TestUnconfigureNoDevuelveBinaryPath(t *testing.T) {
	_, h := newTestServer(t)
	rec := postJSON(t, h, "/api/mcp/unconfigure", map[string]any{
		"providers": []string{"no-existe-este-cliente"},
	})
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if _, present := body["binary_path"]; present {
		t.Error("la respuesta de quitar no debería hablar del binario")
	}
}

// Un destino ocupado no es un fallo del servidor: es un conflicto con el disco, y
// el cliente puede resolverlo. Si esto devolviera 500, la interfaz no podría
// distinguirlo de un error interno y enseñaría un mensaje genérico en vez de
// explicar qué archivo estorba.
func TestDestinoOcupadoEsUn409(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "nota.md")
	if err := os.WriteFile(path, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	exists := &workspace.ExistsError{RelPath: "p/docs/nota.md"}

	srv, _ := newTestServer(t)
	rec := httptest.NewRecorder()
	srv.writeServiceError(rec, httptest.NewRequest(http.MethodGet, "/api/x", nil), fmt.Errorf("envolviendo: %w", exists))

	if rec.Code != http.StatusConflict {
		t.Fatalf("código = %d, esperaba 409", rec.Code)
	}
	var body struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("respuesta ilegible: %v", err)
	}
	if body.Error.Code != "already_exists" {
		t.Errorf("code = %q, esperaba already_exists", body.Error.Code)
	}
}

// Un cliente que se va no es un fallo del servidor.
//
// Esto salía como 500 en cada arranque de la app: React monta los efectos dos
// veces en desarrollo, React Query aborta la petición que ya no necesita, y esa
// cancelación (`context.Canceled`) llegaba al handler y se traducía a un 500. Como
// además no se registraba la causa, el log se llenaba de 500 que no significaban
// nada y tapaban a los de verdad.
func TestPeticionCanceladaNoEsUn500(t *testing.T) {
	srv, _ := newTestServer(t)

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // el cliente ya se fue antes de que el handler empiece

	req := httptest.NewRequest(http.MethodGet, "/api/projects", nil).WithContext(ctx)
	rec := httptest.NewRecorder()

	handler := srv.Handler()
	handler.ServeHTTP(rec, req)

	if rec.Code == http.StatusInternalServerError {
		t.Fatalf("una petición cancelada por el cliente no puede ser un 500")
	}
	if rec.Body.Len() != 0 {
		t.Errorf("no hay a quién contestar, pero se escribió: %q", rec.Body.String())
	}
}

// Un fallo de verdad sí se registra con su causa. Sin esto, el 500 del arranque
// anterior era indepurable: el log decía el código y nada más.
func TestFalloDelServidorSeRegistra(t *testing.T) {
	dir := t.TempDir()
	root := filepath.Join(dir, "ws")
	ws, err := workspace.New(root)
	if err != nil {
		t.Fatalf("workspace.New: %v", err)
	}
	st, err := store.Open(filepath.Join(dir, "index.db"))
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { st.Close() })

	cfg := config.Defaults()
	cfg.RootDir = root
	cfg.Path = filepath.Join(dir, "config.json")

	var buf bytes.Buffer
	log := slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug}))
	srv := New(service.New(ws, st), cfg, "test", 7411, log)

	rec := httptest.NewRecorder()
	fallo := errors.New("la base de datos ardió")
	srv.fail(rec, httptest.NewRequest(http.MethodGet, "/api/projects", nil), "list_projects_failed", fallo)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("código = %d, esperaba 500", rec.Code)
	}
	registrado := buf.String()
	if !strings.Contains(registrado, "la base de datos ardió") {
		t.Errorf("el log no lleva la causa del fallo:\n%s", registrado)
	}
	if !strings.Contains(registrado, "/api/projects") {
		t.Errorf("el log no dice en qué ruta pasó:\n%s", registrado)
	}
}

// --- notas --------------------------------------------------------------------

// El ciclo completo por HTTP, que es como lo usa la interfaz.
func TestNotasPorHTTP(t *testing.T) {
	_, h := newTestServer(t)

	// Crear una carpeta y una nota dentro.
	rec := postJSON(t, h, "/api/notes/create", map[string]any{"path": "ideas", "kind": "dir"})
	if rec.Code != http.StatusCreated {
		t.Fatalf("crear carpeta: %d %s", rec.Code, rec.Body.String())
	}
	rec = postJSON(t, h, "/api/notes/create", map[string]any{"path": "ideas/nota.md", "title": "Mi nota"})
	if rec.Code != http.StatusCreated {
		t.Fatalf("crear nota: %d %s", rec.Code, rec.Body.String())
	}

	// El árbol las ve.
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/notes/tree", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("árbol: %d", rec.Code)
	}
	if body := rec.Body.String(); !strings.Contains(body, "ideas/nota.md") {
		t.Errorf("el árbol no trae la nota: %s", body)
	}

	// Guardar contenido.
	rec = putJSON(t, h, "/api/notes/file", map[string]any{
		"path": "ideas/nota.md", "content": "# Mi nota\n\ncon la palabra xilofono",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("guardar: %d %s", rec.Code, rec.Body.String())
	}

	// Leerla de vuelta.
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/notes/file?path=ideas/nota.md", nil))
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "xilofono") {
		t.Errorf("leer: %d %s", rec.Code, rec.Body.String())
	}

	// Buscarla.
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/notes/search?q=xilofono", nil))
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "ideas/nota.md") {
		t.Errorf("buscar: %d %s", rec.Code, rec.Body.String())
	}

	// Moverla.
	rec = postJSON(t, h, "/api/notes/move", map[string]any{"from": "ideas/nota.md", "to": "otra/nota.md"})
	if rec.Code != http.StatusOK {
		t.Fatalf("mover: %d %s", rec.Code, rec.Body.String())
	}

	// Y borrarla.
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodDelete, "/api/notes/file?path=otra/nota.md", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("borrar: %d %s", rec.Code, rec.Body.String())
	}
}

// Sin ruta no hay nada que borrar, y tiene que decirlo en vez de intentarlo.
func TestBorrarNotaSinRutaEsUnError(t *testing.T) {
	_, h := newTestServer(t)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodDelete, "/api/notes/file", nil))
	if rec.Code != http.StatusBadRequest {
		t.Errorf("código = %d, esperaba 400", rec.Code)
	}
}

// Las notas no son resúmenes: sus rutas no pueden aparecer en la API de resúmenes.
func TestLasNotasNoSalenEnLaApiDeResumenes(t *testing.T) {
	_, h := newTestServer(t)
	postJSON(t, h, "/api/notes/create", map[string]any{"path": "una-nota.md", "title": "Nota"})

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/summaries", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("resúmenes: %d", rec.Code)
	}
	if strings.Contains(rec.Body.String(), "notes/") {
		t.Errorf("una nota apareció en los resúmenes: %s", rec.Body.String())
	}
}

// Mover una carpeta dentro de sí misma es una petición imposible, no un fallo del
// servidor: el cliente tiene que poder distinguirlo para explicárselo al usuario.
func TestMoverCarpetaDentroDeSiMismaEsUn400(t *testing.T) {
	_, h := newTestServer(t)
	postJSON(t, h, "/api/notes/create", map[string]any{"path": "a", "kind": "dir"})
	postJSON(t, h, "/api/notes/create", map[string]any{"path": "a/nota.md", "title": "x"})

	rec := postJSON(t, h, "/api/notes/move", map[string]any{"from": "a", "to": "a/dentro"})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("código = %d, esperaba 400: %s", rec.Code, rec.Body.String())
	}
	if body := rec.Body.String(); !strings.Contains(body, "into_itself") {
		t.Errorf("el código de error no es el esperado: %s", body)
	}
}
