package mcpserver

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/ismaelosuna/saveme/backend/internal/service"
	"github.com/ismaelosuna/saveme/backend/internal/store"
	"github.com/ismaelosuna/saveme/backend/internal/workspace"
)

// harness monta un servidor MCP real conectado a un cliente MCP real por
// transportes en memoria.
//
// Esa es la razón de existir de esta prueba: ejercita el mismo camino que un
// agente de verdad (esquemas de entrada, validación, serialización de salida,
// elicitation) en vez de llamar a los handlers de Go directamente. Si el
// esquema JSON de una tool está mal, aquí se ve.
type harness struct {
	svc     *service.Service
	root    string
	client  *mcp.ClientSession
	elicitF func(context.Context, *mcp.ElicitRequest) (*mcp.ElicitResult, error)
}

func newHarness(t *testing.T, withElicitation bool) *harness {
	t.Helper()

	dir := t.TempDir()
	root := filepath.Join(dir, "workspace")
	ws, err := workspace.New(root)
	if err != nil {
		t.Fatalf("workspace.New: %v", err)
	}
	st, err := store.Open(filepath.Join(dir, "index.db"))
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { st.Close() })

	h := &harness{svc: service.New(ws, st), root: root}

	// El servidor MCP, tal como lo usaría un agente que lanza `saveme mcp`.
	server := New(h.svc, "test")
	serverTransport, clientTransport := mcp.NewInMemoryTransports()

	ctx := context.Background()
	if _, err := server.MCP().Connect(ctx, serverTransport, nil); err != nil {
		t.Fatalf("conectar el servidor MCP: %v", err)
	}

	opts := &mcp.ClientOptions{}
	if withElicitation {
		opts.ElicitationHandler = func(ctx context.Context, req *mcp.ElicitRequest) (*mcp.ElicitResult, error) {
			if h.elicitF == nil {
				return &mcp.ElicitResult{Action: "decline"}, nil
			}
			return h.elicitF(ctx, req)
		}
	}

	client := mcp.NewClient(&mcp.Implementation{Name: "test-agent", Version: "1.0.0"}, opts)
	session, err := client.Connect(ctx, clientTransport, nil)
	if err != nil {
		t.Fatalf("conectar el cliente MCP: %v", err)
	}
	t.Cleanup(func() { session.Close() })
	h.client = session
	return h
}

// call invoca una tool y devuelve la salida estructurada ya decodificada.
func (h *harness) call(t *testing.T, name string, args map[string]any) (map[string]any, bool) {
	t.Helper()
	res, err := h.client.CallTool(context.Background(), &mcp.CallToolParams{
		Name:      name,
		Arguments: args,
	})
	if err != nil {
		t.Fatalf("CallTool(%s) falló a nivel de protocolo: %v", name, err)
	}

	// StructuredContent llega como any; se re-serializa para decodificarlo, que
	// es exactamente lo que haría un cliente real.
	raw, err := json.Marshal(res.StructuredContent)
	if err != nil {
		t.Fatalf("serializar la salida de %s: %v", name, err)
	}
	out := map[string]any{}
	if len(raw) > 0 && string(raw) != "null" {
		if err := json.Unmarshal(raw, &out); err != nil {
			t.Fatalf("decodificar la salida de %s (%s): %v", name, raw, err)
		}
	}
	return out, res.IsError
}

func (h *harness) callOK(t *testing.T, name string, args map[string]any) map[string]any {
	t.Helper()
	out, isErr := h.call(t, name, args)
	if isErr {
		t.Fatalf("%s devolvió un error de tool: %v", name, out)
	}
	return out
}

func (h *harness) callErr(t *testing.T, name string, args map[string]any) map[string]any {
	t.Helper()
	out, isErr := h.call(t, name, args)
	if !isErr {
		t.Fatalf("%s debía fallar y devolvió: %v", name, out)
	}
	return out
}

// callErrText devuelve el mensaje de un error de tool.
//
// `callErr` devuelve el contenido **estructurado**, y en un error va vacío: el
// mensaje viaja como contenido de texto, que es lo que lee el agente. Para
// comprobar que el error explica algo hay que ir ahí.
func (h *harness) callErrText(t *testing.T, name string, args map[string]any) string {
	t.Helper()
	res, err := h.client.CallTool(context.Background(), &mcp.CallToolParams{
		Name: name, Arguments: args,
	})
	if err != nil {
		t.Fatalf("CallTool(%s) falló a nivel de protocolo: %v", name, err)
	}
	if !res.IsError {
		t.Fatalf("%s debía fallar y no falló", name)
	}
	var b strings.Builder
	for _, c := range res.Content {
		if text, ok := c.(*mcp.TextContent); ok {
			b.WriteString(text.Text)
		}
	}
	return b.String()
}

func (h *harness) markdownFiles(t *testing.T) []string {
	t.Helper()
	var out []string
	_ = filepath.WalkDir(h.root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() && strings.HasPrefix(d.Name(), ".") && path != h.root {
			return filepath.SkipDir
		}
		if !d.IsDir() && strings.EqualFold(filepath.Ext(d.Name()), ".md") {
			rel, _ := filepath.Rel(h.root, path)
			out = append(out, filepath.ToSlash(rel))
		}
		return nil
	})
	sort.Strings(out)
	return out
}

// TestToolSurface comprueba que el contrato de tools es el acordado. Si alguien
// renombra o quita una tool, esta prueba lo dice.
func TestToolSurface(t *testing.T) {
	h := newHarness(t, false)
	res, err := h.client.ListTools(context.Background(), &mcp.ListToolsParams{})
	if err != nil {
		t.Fatalf("ListTools: %v", err)
	}

	got := map[string]bool{}
	for _, tool := range res.Tools {
		got[tool.Name] = true
		if tool.Description == "" {
			t.Errorf("la tool %s no tiene descripción: el agente no sabría cuándo usarla", tool.Name)
		}
	}

	want := []string{
		"saveme_project_list", "saveme_project_create",
		"saveme_summary_propose", "saveme_summary_confirm", "saveme_summary_cancel",
		"saveme_summary_search", "saveme_summary_list", "saveme_summary_read",
		"saveme_pending",
	}
	for _, name := range want {
		if !got[name] {
			t.Errorf("falta la tool %s", name)
		}
	}

	// Las tools de solo lectura deben declararse como tales: es lo que permite a
	// un cliente no pedir permiso para consultar el historial.
	for _, tool := range res.Tools {
		if tool.Annotations == nil {
			continue
		}
		readOnly := tool.Annotations.ReadOnlyHint
		shouldBeReadOnly := tool.Name != "saveme_summary_confirm" && tool.Name != "saveme_project_create"
		if readOnly != shouldBeReadOnly {
			t.Errorf("%s: ReadOnlyHint = %v, want %v", tool.Name, readOnly, shouldBeReadOnly)
		}
	}
}

// TestEndToEndProposeConfirm es el flujo completo tal como lo vive un agente.
func TestEndToEndProposeConfirm(t *testing.T) {
	h := newHarness(t, false)
	ctx := context.Background()

	// 1. Proponer: no debe escribir nada.
	out := h.callOK(t, "saveme_summary_propose", map[string]any{
		"project": "saveme",
		"title":   "Editor markdown con preview sincronizado",
		"body":    "Implementamos el editor con CodeMirror.\n\n## Por qué\n\nNecesitábamos fidelidad del markdown.",
		"tags":    []string{"editor", "markdown"},
		"agent":   "claude-code",
	})

	token, _ := out["token"].(string)
	if !strings.HasPrefix(token, "pt_") {
		t.Fatalf("token inválido: %v", out["token"])
	}
	if files := h.markdownFiles(t); len(files) != 0 {
		t.Fatalf("propose no debe escribir archivos, escribió %v", files)
	}
	if out["category"] != "feature" {
		t.Errorf("categoría inferida = %v (razón: %v)", out["category"], out["why_this_category"])
	}
	if why, _ := out["why_this_category"].(string); why == "" {
		t.Error("la propuesta debe explicar por qué eligió esa categoría")
	}
	alts, _ := out["alternatives"].([]any)
	if len(alts) == 0 {
		t.Error("la propuesta debe ofrecer alternativas concretas")
	}
	next, _ := out["next_step"].(string)
	if !strings.Contains(next, "PREGÚNTALE AL USUARIO") {
		t.Errorf("next_step debe ordenar preguntarle al usuario, dice: %q", next)
	}

	// 2. Confirmar con la decisión declarada por el agente en el chat.
	out = h.callOK(t, "saveme_summary_confirm", map[string]any{
		"token":    token,
		"decision": "accepted",
		"elicit":   false, // el cliente no soporta elicitation en este harness
	})
	if written, _ := out["written"].(bool); !written {
		t.Fatalf("no se escribió nada: %v", out)
	}
	if out["resolved_via"] != "agent_chat" {
		t.Errorf("resolved_via = %v, want agent_chat", out["resolved_via"])
	}
	for _, key := range []string{"written", "written_path", "summary"} {
		if _, ok := out[key]; !ok {
			t.Errorf("falta %q en la respuesta de confirm", key)
		}
	}

	// 3. El archivo está en disco, en la ruta prometida.
	files := h.markdownFiles(t)
	if len(files) != 1 {
		t.Fatalf("esperaba 1 archivo, hay %d: %v", len(files), files)
	}
	relPath, _ := out["written_path"].(string)
	if files[0] != relPath {
		t.Errorf("el archivo está en %q pero confirm dijo %q", files[0], relPath)
	}
	if !strings.HasPrefix(relPath, "saveme/features/") {
		t.Errorf("ruta = %q", relPath)
	}
	data, err := os.ReadFile(filepath.Join(h.root, filepath.FromSlash(relPath)))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(string(data), "---\n") {
		t.Errorf("el archivo no tiene frontmatter:\n%s", data)
	}
	if !strings.Contains(string(data), "CodeMirror") {
		t.Error("el cuerpo no llegó al archivo")
	}

	// 4. Reconfirmar es idempotente y no duplica.
	out = h.callOK(t, "saveme_summary_confirm", map[string]any{
		"token": token, "decision": "accepted", "elicit": false,
	})
	if already, _ := out["already_there"].(bool); !already {
		t.Errorf("la segunda confirmación debería decir already_there: %v", out)
	}
	if files := h.markdownFiles(t); len(files) != 1 {
		t.Fatalf("se duplicó el archivo: %v", files)
	}
	_ = ctx
}

// TestElicitationAsksTheUserDirectly verifica la capa más fuerte de la garantía:
// cuando el cliente soporta elicitation, el usuario responde y su elección manda.
func TestElicitationAsksTheUserDirectly(t *testing.T) {
	h := newHarness(t, true)

	var seen *mcp.ElicitRequest
	h.elicitF = func(_ context.Context, req *mcp.ElicitRequest) (*mcp.ElicitResult, error) {
		seen = req
		// El usuario acepta, pero en otra carpeta.
		return &mcp.ElicitResult{
			Action: "accept",
			Content: map[string]any{
				"otra_ruta": "saveme/research/2026-02-14-spike-codemirror.md",
			},
		}, nil
	}

	proposal := h.callOK(t, "saveme_summary_propose", map[string]any{
		"project": "saveme",
		"title":   "Spike de editor markdown",
		"body":    "Evaluamos CodeMirror contra ProseMirror con un benchmark.",
	})

	out := h.callOK(t, "saveme_summary_confirm", map[string]any{
		"token":    proposal["token"],
		"decision": "accepted",
		"elicit":   true,
	})

	// 1. El servidor le preguntó al usuario.
	if seen == nil {
		t.Fatalf("el servidor no invocó elicitation aunque el cliente la soporta. elicit_error=%v", out["elicit_error"])
	}
	if !strings.Contains(seen.Params.Message, "Spike de editor markdown") {
		t.Errorf("el mensaje de elicitation no menciona el título: %q", seen.Params.Message)
	}
	if len(seen.Params.RequestedSchema.(map[string]any)) == 0 {
		t.Error("la elicitation debe pedir un esquema de respuesta")
	}

	// 2. Ganó la respuesta del usuario, no la propuesta del agente.
	if out["resolved_via"] != "elicitation" {
		t.Errorf("resolved_via = %v, want elicitation", out["resolved_via"])
	}
	written, _ := out["written_path"].(string)
	if written != "saveme/research/2026-02-14-spike-codemirror.md" {
		t.Errorf("se escribió en %q; debía mandar la elección del usuario", written)
	}
	if files := h.markdownFiles(t); len(files) != 1 || files[0] != written {
		t.Errorf("archivos = %v, want [%s]", files, written)
	}
}

// TestElicitationDeclineBlocksTheWrite: si el usuario dice que no en el diálogo,
// no se escribe aunque el agente haya mandado decision="accepted".
func TestElicitationDeclineBlocksTheWrite(t *testing.T) {
	h := newHarness(t, true)
	h.elicitF = func(context.Context, *mcp.ElicitRequest) (*mcp.ElicitResult, error) {
		return &mcp.ElicitResult{Action: "decline"}, nil
	}

	proposal := h.callOK(t, "saveme_summary_propose", map[string]any{
		"project": "saveme", "title": "Algo que el usuario no quiere guardar",
		"body": "Cuerpo del resumen.",
	})

	out := h.callOK(t, "saveme_summary_confirm", map[string]any{
		"token": proposal["token"], "decision": "accepted", "elicit": true,
	})
	if cancelled, _ := out["cancelled"].(bool); !cancelled {
		t.Fatalf("la negativa del usuario debía cancelar la escritura: %v", out)
	}
	if files := h.markdownFiles(t); len(files) != 0 {
		t.Fatalf("no debía escribir nada, escribió %v", files)
	}
}

// TestElicitationCancelChoice: el usuario elige "no lo guardes" en el enum.
func TestElicitationCancelChoice(t *testing.T) {
	h := newHarness(t, true)
	h.elicitF = func(context.Context, *mcp.ElicitRequest) (*mcp.ElicitResult, error) {
		return &mcp.ElicitResult{
			Action:  "accept",
			Content: map[string]any{"destino": cancelChoice},
		}, nil
	}

	proposal := h.callOK(t, "saveme_summary_propose", map[string]any{
		"project": "saveme", "title": "Otro que se descarta", "body": "Cuerpo.",
	})
	out := h.callOK(t, "saveme_summary_confirm", map[string]any{
		"token": proposal["token"], "decision": "accepted",
	})
	if cancelled, _ := out["cancelled"].(bool); !cancelled {
		t.Fatalf("esperaba cancelación: %v", out)
	}
	if files := h.markdownFiles(t); len(files) != 0 {
		t.Fatalf("no debía escribir nada: %v", files)
	}
}

// TestElicitationChoosingAnAlternative: el usuario elige una de las alternativas
// que ofreció la propuesta.
func TestElicitationChoosingAnAlternative(t *testing.T) {
	h := newHarness(t, true)
	var chosen string
	h.elicitF = func(_ context.Context, req *mcp.ElicitRequest) (*mcp.ElicitResult, error) {
		schema := req.Params.RequestedSchema.(map[string]any)
		props := schema["properties"].(map[string]any)
		destino := props["destino"].(map[string]any)
		enum := destino["enum"].([]any)
		// El usuario elige la primera alternativa, no la propuesta original.
		chosen = enum[1].(string)
		return &mcp.ElicitResult{Action: "accept", Content: map[string]any{"destino": chosen}}, nil
	}

	proposal := h.callOK(t, "saveme_summary_propose", map[string]any{
		"project": "saveme",
		"title":   "Decisión sobre el esquema del índice",
		"body":    "Elegimos guardar el cuerpo duplicado en el índice para poder buscar sin abrir archivos.",
	})
	original, _ := proposal["rel_path"].(string)

	out := h.callOK(t, "saveme_summary_confirm", map[string]any{
		"token": proposal["token"], "decision": "accepted",
	})
	written, _ := out["written_path"].(string)

	if chosen == "" || chosen == original {
		t.Fatalf("la prueba no eligió una alternativa distinta (chosen=%q original=%q)", chosen, original)
	}
	if written != chosen {
		t.Errorf("written_path = %q, want %q", written, chosen)
	}
}

// TestConfirmModifiedWithOverride: el agente declara que el usuario pidió otra
// ubicación, sin elicitation.
func TestConfirmModifiedWithOverride(t *testing.T) {
	h := newHarness(t, false)

	proposal := h.callOK(t, "saveme_summary_propose", map[string]any{
		"project": "saveme", "title": "Ajuste del watcher", "body": "Se corrigió una carrera.",
	})

	out := h.callOK(t, "saveme_summary_confirm", map[string]any{
		"token":    proposal["token"],
		"decision": "modified",
		"override": map[string]any{"category": "fix"},
		"elicit":   false,
	})
	written, _ := out["written_path"].(string)
	if !strings.HasPrefix(written, "saveme/fixes/") {
		t.Errorf("written_path = %q, debería estar en fixes/", written)
	}
	if out["resolved_via"] != "agent_chat" {
		t.Errorf("resolved_via = %v", out["resolved_via"])
	}
}

// TestConfirmRejectsLyingDecision: pasar accepted junto con override es una
// contradicción y el servidor la rechaza en vez de adivinar.
func TestConfirmRejectsLyingDecision(t *testing.T) {
	h := newHarness(t, false)
	proposal := h.callOK(t, "saveme_summary_propose", map[string]any{
		"project": "saveme", "title": "Contradicción", "body": "Cuerpo.",
	})
	h.callErr(t, "saveme_summary_confirm", map[string]any{
		"token":    proposal["token"],
		"decision": "accepted",
		"override": map[string]any{"category": "docs"},
		"elicit":   false,
	})
	if files := h.markdownFiles(t); len(files) != 0 {
		t.Errorf("no debía escribir nada: %v", files)
	}
}

func TestConfirmRejectsBadInput(t *testing.T) {
	h := newHarness(t, false)

	// Token inventado.
	h.callErr(t, "saveme_summary_confirm", map[string]any{
		"token": "pt_inventado", "decision": "accepted", "elicit": false,
	})
	// Decisión inválida.
	proposal := h.callOK(t, "saveme_summary_propose", map[string]any{
		"project": "saveme", "title": "Para probar validación", "body": "Cuerpo.",
	})
	h.callErr(t, "saveme_summary_confirm", map[string]any{
		"token": proposal["token"], "decision": "quizá", "elicit": false,
	})
	// La validación del esquema rechaza un propose sin cuerpo, antes del handler.
	h.callErr(t, "saveme_summary_propose", map[string]any{
		"project": "saveme", "title": "Sin cuerpo",
	})
	if files := h.markdownFiles(t); len(files) != 0 {
		t.Errorf("ninguna de estas llamadas debía escribir: %v", files)
	}
}

// TestReadOnlyTools recorre las tools de consulta.
func TestReadOnlyTools(t *testing.T) {
	h := newHarness(t, false)

	proposal := h.callOK(t, "saveme_summary_propose", map[string]any{
		"project": "saveme",
		"title":   "Búsqueda de texto completo",
		"body":    "Se indexó el cuerpo en SQLite para poder buscar la palabra murcielago sin abrir archivos.",
		"tags":    []string{"sqlite", "busqueda"},
	})
	h.callOK(t, "saveme_summary_confirm", map[string]any{
		"token": proposal["token"], "decision": "accepted", "elicit": false,
	})

	out := h.callOK(t, "saveme_project_list", map[string]any{})
	projects, _ := out["projects"].([]any)
	if len(projects) != 1 {
		t.Fatalf("projects = %v", out["projects"])
	}
	first := projects[0].(map[string]any)
	if first["slug"] != "saveme" {
		t.Errorf("slug = %v", first["slug"])
	}
	if n, _ := first["summaries"].(float64); n != 1 {
		t.Errorf("summaries = %v", first["summaries"])
	}

	out = h.callOK(t, "saveme_summary_list", map[string]any{"project": "saveme"})
	items, _ := out["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("list items = %v", out["items"])
	}
	item := items[0].(map[string]any)
	id, _ := item["id"].(string)
	if id == "" {
		t.Fatal("el item no tiene id")
	}

	out = h.callOK(t, "saveme_summary_search", map[string]any{"query": "murcielago"})
	if n, _ := out["total"].(float64); n != 1 {
		t.Errorf("la búsqueda por contenido no encontró el resumen: %v", out)
	}

	out = h.callOK(t, "saveme_summary_read", map[string]any{"id": id})
	content, _ := out["content"].(string)
	if !strings.Contains(content, "murcielago") {
		t.Errorf("read no devolvió el cuerpo: %q", content)
	}
	raw, _ := out["raw"].(string)
	if !strings.HasPrefix(raw, "---\n") {
		t.Error("raw debería incluir el frontmatter")
	}

	// pending está vacío porque ya se confirmó todo.
	out = h.callOK(t, "saveme_pending", map[string]any{})
	if proposals, _ := out["proposals"].([]any); len(proposals) != 0 {
		t.Errorf("no debería haber pendientes: %v", proposals)
	}
	if note, _ := out["note"].(string); note == "" {
		t.Error("sin pendientes debería explicarse con una nota")
	}
}

// TestCancelFlow y la visibilidad de una propuesta pendiente.
func TestCancelAndPending(t *testing.T) {
	h := newHarness(t, false)

	proposal := h.callOK(t, "saveme_summary_propose", map[string]any{
		"project": "saveme", "title": "Algo que no se guarda", "body": "Cuerpo.",
	})
	token, _ := proposal["token"].(string)

	out := h.callOK(t, "saveme_pending", map[string]any{})
	pending, _ := out["proposals"].([]any)
	if len(pending) != 1 {
		t.Fatalf("debería haber 1 pendiente: %v", out)
	}
	if p := pending[0].(map[string]any); p["token"] != token {
		t.Errorf("token en pending = %v, want %v", p["token"], token)
	}

	h.callOK(t, "saveme_summary_cancel", map[string]any{
		"token": token, "reason": "el usuario dijo que no",
	})

	// Confirmar después de cancelar debe fallar con un mensaje accionable.
	out = h.callErr(t, "saveme_summary_confirm", map[string]any{
		"token": token, "decision": "accepted", "elicit": false,
	})
	if files := h.markdownFiles(t); len(files) != 0 {
		t.Errorf("no debía escribir nada: %v", files)
	}

	out = h.callOK(t, "saveme_pending", map[string]any{})
	if p, _ := out["proposals"].([]any); len(p) != 0 {
		t.Errorf("la propuesta cancelada no debe seguir pendiente: %v", p)
	}
}

// TestIdempotentPropose: repetir la misma propuesta no llena el inbox.
func TestIdempotentPropose(t *testing.T) {
	h := newHarness(t, false)
	args := map[string]any{
		"project": "saveme", "title": "Misma cosa dos veces", "body": "Cuerpo idéntico.",
	}

	first := h.callOK(t, "saveme_summary_propose", args)
	second := h.callOK(t, "saveme_summary_propose", args)
	if second["token"] != first["token"] {
		t.Errorf("tokens distintos para el mismo contenido: %v vs %v", second["token"], first["token"])
	}
	if already, _ := second["already_proposed"].(bool); !already {
		t.Error("la segunda propuesta debería marcarse como ya propuesta")
	}

	// Y tras confirmar, volver a proponer avisa que ya está guardado.
	h.callOK(t, "saveme_summary_confirm", map[string]any{
		"token": first["token"], "decision": "accepted", "elicit": false,
	})
	third := h.callOK(t, "saveme_summary_propose", args)
	if third["already_saved"] == nil {
		t.Fatalf("debería avisar que ya está guardado: %v", third)
	}
	if files := h.markdownFiles(t); len(files) != 1 {
		t.Errorf("se duplicó: %v", files)
	}
}

// TestGuideResourceAndPrompt comprueba que el agente puede pedir las
// instrucciones por los dos canales que ofrece MCP.
func TestGuideResourceAndPrompt(t *testing.T) {
	h := newHarness(t, false)
	ctx := context.Background()

	res, err := h.client.ReadResource(ctx, &mcp.ReadResourceParams{URI: "saveme://guide"})
	if err != nil {
		t.Fatalf("ReadResource: %v", err)
	}
	if len(res.Contents) == 0 || !strings.Contains(res.Contents[0].Text, "propuesta") {
		t.Errorf("el recurso guía está vacío o no explica el flujo: %+v", res.Contents)
	}

	pr, err := h.client.GetPrompt(ctx, &mcp.GetPromptParams{Name: "saveme/human-summary"})
	if err != nil {
		t.Fatalf("GetPrompt: %v", err)
	}
	if len(pr.Messages) == 0 {
		t.Fatal("el prompt no devolvió mensajes")
	}
	text := pr.Messages[0].Content.(*mcp.TextContent).Text
	if !strings.Contains(text, "saveme_summary_confirm") {
		t.Errorf("el prompt debe mencionar el flujo de confirmación: %q", text)
	}
}

// TestProjectCreateTool.
func TestProjectCreateTool(t *testing.T) {
	h := newHarness(t, false)

	out := h.callOK(t, "saveme_project_create", map[string]any{"name": "API de Pagos"})
	if created, _ := out["created"].(bool); !created {
		t.Errorf("created = %v", out["created"])
	}
	project, _ := out["project"].(map[string]any)
	if project["slug"] != "api-de-pagos" {
		t.Errorf("slug = %v", project["slug"])
	}
	for _, folder := range []string{"features", "fixes", "chores"} {
		if _, err := os.Stat(filepath.Join(h.root, "api-de-pagos", folder)); err != nil {
			t.Errorf("falta la carpeta %s: %v", folder, err)
		}
	}

	out = h.callOK(t, "saveme_project_create", map[string]any{"name": "API de Pagos"})
	if created, _ := out["created"].(bool); created {
		t.Error("el segundo intento no debería reportar creación")
	}
}

// TestExpiredTokenIsRejectedFromTheAgentSide.
func TestExpiredTokenIsRejectedFromTheAgentSide(t *testing.T) {
	h := newHarness(t, false)
	proposal := h.callOK(t, "saveme_summary_propose", map[string]any{
		"project": "saveme", "title": "Va a expirar", "body": "Cuerpo.",
	})
	token, _ := proposal["token"].(string)

	if _, err := h.svc.Store().DB().ExecContext(context.Background(),
		`UPDATE proposals SET expires_at = ? WHERE token = ?`,
		time.Now().UTC().Add(-time.Minute).Format(time.RFC3339Nano), token); err != nil {
		t.Fatal(err)
	}

	h.callErr(t, "saveme_summary_confirm", map[string]any{
		"token": token, "decision": "accepted", "elicit": false,
	})
	if files := h.markdownFiles(t); len(files) != 0 {
		t.Errorf("un token vencido no debe escribir: %v", files)
	}
}

// --- actualizar un resumen existente -----------------------------------------

// escribirResumen deja un resumen confirmado y devuelve su id, su ruta y su
// contenido.
func (h *harness) escribirResumen(t *testing.T, project, title, body string) (string, string, string) {
	t.Helper()
	out := h.callOK(t, "saveme_summary_propose", map[string]any{
		"project": project, "title": title, "body": body,
	})
	token, _ := out["token"].(string)
	done := h.callOK(t, "saveme_summary_confirm", map[string]any{
		"token": token, "decision": "accepted", "elicit": false,
	})
	meta, _ := done["summary"].(map[string]any)
	id, _ := meta["id"].(string)
	relPath, _ := done["written_path"].(string)
	raw, err := os.ReadFile(filepath.Join(h.root, filepath.FromSlash(relPath)))
	if err != nil {
		t.Fatal(err)
	}
	return id, relPath, string(raw)
}

// Actualizar reescribe el archivo **en su sitio**: mismo id, misma ruta, cuerpo
// nuevo. Lo que no puede pasar es que cree un segundo archivo.
func TestActualizarUnResumenLoReescribeEnSuSitio(t *testing.T) {
	h := newHarness(t, false)

	id, relPath, original := h.escribirResumen(t, "saveme", "Editor markdown", "Primera versión del editor.")

	out := h.callOK(t, "saveme_summary_propose", map[string]any{
		"project": "saveme",
		"title":   "Editor markdown, con live preview",
		"body":    "El editor ahora renderiza mientras escribes.",
		"target":  id,
	})
	if got, _ := out["rel_path"].(string); got != relPath {
		t.Errorf("la propuesta apunta a %q, esperaba %q", got, relPath)
	}

	token, _ := out["token"].(string)
	h.callOK(t, "saveme_summary_confirm", map[string]any{
		"token": token, "decision": "accepted", "elicit": false,
	})

	// Un solo archivo: actualizar no duplica.
	if files := h.markdownFiles(t); len(files) != 1 {
		t.Fatalf("actualizar creó otro archivo: %v", files)
	}

	raw, err := os.ReadFile(filepath.Join(h.root, filepath.FromSlash(relPath)))
	if err != nil {
		t.Fatal(err)
	}
	text := string(raw)
	if !strings.Contains(text, "live preview") && !strings.Contains(text, "renderiza mientras escribes") {
		t.Errorf("el cuerpo nuevo no llegó al archivo:\n%s", text)
	}
	if strings.Contains(text, "Primera versión del editor.") {
		t.Error("el cuerpo viejo sigue ahí: se esperaba que el nuevo lo sustituya")
	}
	// La identidad se conserva: es el mismo resumen, no uno nuevo.
	if !strings.Contains(text, "id: "+id) {
		t.Errorf("cambió el id del resumen:\n%s", text)
	}
	// Y la fecha de creación original no se puede perder al actualizar.
	if !strings.Contains(original, "created_at:") || !strings.Contains(text, "created_at:") {
		t.Error("falta created_at en alguno de los dos")
	}
}

// Si el archivo cambió entre la propuesta y la confirmación, no se pisa.
//
// Es la razón de que el `base_hash` viaje dentro de la propuesta: sin él, la
// actualización escribiría encima de lo que otro acabara de hacer.
func TestActualizarNoPisaSiElArchivoCambioPorMedio(t *testing.T) {
	h := newHarness(t, false)
	id, relPath, _ := h.escribirResumen(t, "saveme", "Editor markdown", "Primera versión.")

	out := h.callOK(t, "saveme_summary_propose", map[string]any{
		"project": "saveme", "title": "Editor markdown", "body": "Segunda versión.", "target": id,
	})
	token, _ := out["token"].(string)

	// Alguien edita el archivo por medio: el usuario desde vim, u otro agente.
	abs := filepath.Join(h.root, filepath.FromSlash(relPath))
	raw, err := os.ReadFile(abs)
	if err != nil {
		t.Fatal(err)
	}
	editado := strings.Replace(string(raw), "Primera versión.", "Escrito a mano por el usuario.", 1)
	if err := os.WriteFile(abs, []byte(editado), 0o644); err != nil {
		t.Fatal(err)
	}

	msg := h.callErrText(t, "saveme_summary_confirm", map[string]any{
		"token": token, "decision": "accepted", "elicit": false,
	})
	if !strings.Contains(msg, "cambió en disco") {
		t.Errorf("el error no explica qué pasó: %q", msg)
	}

	// Y el trabajo del usuario sigue intacto.
	after, err := os.ReadFile(abs)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(after), "Escrito a mano por el usuario.") {
		t.Error("la actualización pisó la edición manual")
	}
	if strings.Contains(string(after), "Segunda versión.") {
		t.Error("se escribió la actualización a pesar del conflicto")
	}
}

// Un destino que no existe se dice claro y no se inventa nada.
func TestActualizarUnResumenQueNoExisteFalla(t *testing.T) {
	h := newHarness(t, false)
	msg := h.callErrText(t, "saveme_summary_propose", map[string]any{
		"project": "saveme",
		"title":   "Algo",
		"body":    "Cuerpo.",
		"target":  "sm_no_existe_esto",
	})
	if !strings.Contains(msg, "no encuentro el resumen") {
		t.Errorf("el error no dice qué falta: %q", msg)
	}
	if files := h.markdownFiles(t); len(files) != 0 {
		t.Errorf("no debería haber escrito nada: %v", files)
	}
}

// El caso donde el hash de la propuesta es imprescindible.
//
// `Save` ya tiene un respaldo: compara el archivo con el hash **del índice**. Pero
// si entre proponer y confirmar corre un reindexado —o el watcher ve el cambio— el
// índice pasa a reflejar la edición, y ese respaldo deja de ver nada. Lo que salva
// el trabajo del usuario entonces es el hash que la propuesta capturó al
// proponerse, que no se mueve.
func TestActualizarNoPisaAunqueSeReindexePorMedio(t *testing.T) {
	h := newHarness(t, false)
	ctx := context.Background()
	id, relPath, _ := h.escribirResumen(t, "saveme", "Nota viva", "Versión original.")

	out := h.callOK(t, "saveme_summary_propose", map[string]any{
		"project": "saveme", "title": "Nota viva", "body": "Versión del agente.", "target": id,
	})
	token, _ := out["token"].(string)

	// El usuario edita el archivo…
	abs := filepath.Join(h.root, filepath.FromSlash(relPath))
	raw, err := os.ReadFile(abs)
	if err != nil {
		t.Fatal(err)
	}
	editado := strings.Replace(string(raw), "Versión original.", "Escrito a mano.", 1)
	if err := os.WriteFile(abs, []byte(editado), 0o644); err != nil {
		t.Fatal(err)
	}
	// …y el índice se pone al día antes de que el agente confirme. Esto es lo que
	// hace el watcher solo, sin que nadie se lo pida.
	if _, err := h.svc.Reindex(ctx); err != nil {
		t.Fatalf("reindex: %v", err)
	}

	msg := h.callErrText(t, "saveme_summary_confirm", map[string]any{
		"token": token, "decision": "accepted", "elicit": false,
	})
	if !strings.Contains(msg, "cambió en disco") {
		t.Errorf("el conflicto no se detectó tras reindexar; el error fue: %q", msg)
	}

	after, err := os.ReadFile(abs)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(after), "Escrito a mano.") {
		t.Error("la edición del usuario se perdió")
	}
}
