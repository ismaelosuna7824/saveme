package mcpconfig

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
)

func mustFind(t *testing.T, key string) Provider {
	t.Helper()
	p, ok := Find(key)
	if !ok {
		t.Fatalf("proveedor %q no encontrado", key)
	}
	return p
}

func baseOpts(path string) Options {
	return Options{
		Command: "/usr/local/bin/saveme",
		Name:    "saveme",
		Path:    path,
	}
}

func TestFind(t *testing.T) {
	for _, key := range []string{"opencode", "codex", "claude-code", "cursor", "generic"} {
		if _, ok := Find(key); !ok {
			t.Errorf("falta el proveedor %q", key)
		}
	}
	if _, ok := Find("OpenCode"); !ok {
		t.Error("debería encontrar por nombre visible")
	}
	if _, ok := Find("inventado"); ok {
		t.Error("no debería encontrar un proveedor inventado")
	}
}

// TestOpenCodeBlockShape: OpenCode exige `type: "local"` y `command` como array.
// Si esto se rompe, el MCP no arranca y el error que da OpenCode no explica por qué.
func TestOpenCodeBlockShape(t *testing.T) {
	p := mustFind(t, "opencode")
	s, err := Build(p, Options{Command: "saveme", Name: "saveme"})
	if err != nil {
		t.Fatal(err)
	}

	var doc map[string]any
	if err := json.Unmarshal([]byte(s.Body), &doc); err != nil {
		t.Fatalf("el bloque no es JSON válido: %v\n%s", err, s.Body)
	}
	mcp, ok := doc["mcp"].(map[string]any)
	if !ok {
		t.Fatalf("falta la clave `mcp`: %s", s.Body)
	}
	entry, ok := mcp["saveme"].(map[string]any)
	if !ok {
		t.Fatalf("falta la entrada saveme: %s", s.Body)
	}
	if entry["type"] != "local" {
		t.Errorf("type = %v, want local", entry["type"])
	}
	cmd, ok := entry["command"].([]any)
	if !ok {
		t.Fatalf("command debe ser un array: %T", entry["command"])
	}
	if len(cmd) != 2 || cmd[0] != "saveme" || cmd[1] != "mcp" {
		t.Errorf("command = %v, want [saveme mcp]", cmd)
	}
	if entry["enabled"] != true {
		t.Errorf("enabled = %v, want true", entry["enabled"])
	}
	if _, hasArgs := entry["args"]; hasArgs {
		t.Error("OpenCode no usa `args`: los argumentos van dentro de `command`")
	}
}

// TestCodexBlockShape: Codex sí usa `command` + `args` y una subsección para env.
func TestCodexBlockShape(t *testing.T) {
	p := mustFind(t, "codex")
	s, err := Build(p, Options{
		Command: "/usr/local/bin/saveme",
		Name:    "saveme",
		Env:     map[string]string{"SAVEME_ROOT": "/tmp/ws"},
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"[mcp_servers.saveme]",
		`command = "/usr/local/bin/saveme"`,
		`args = ["mcp"]`,
		"enabled = true",
		"[mcp_servers.saveme.env]",
		`SAVEME_ROOT = "/tmp/ws"`,
	} {
		if !strings.Contains(s.Body, want) {
			t.Errorf("falta %q en el bloque TOML:\n%s", want, s.Body)
		}
	}
}

// TestClaudeCodeIsACommand: Claude Code se configura con `claude mcp add`, no
// editando un archivo, y el ámbito correcto para "todos mis proyectos" es user.
func TestClaudeCodeIsACommand(t *testing.T) {
	p := mustFind(t, "claude-code")
	s, err := Build(p, Options{
		Command: "/usr/local/bin/saveme",
		Name:    "saveme",
		Env:     map[string]string{"SAVEME_ROOT": "/tmp/ws"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if s.Language != "sh" {
		t.Errorf("language = %q, want sh", s.Language)
	}
	if !strings.HasPrefix(s.Body, "claude mcp add --scope user saveme -- /usr/local/bin/saveme mcp") {
		t.Errorf("comando inesperado: %s", s.Body)
	}
	if !strings.Contains(s.Body, "-e SAVEME_ROOT=/tmp/ws") {
		t.Errorf("falta el entorno: %s", s.Body)
	}
	if s.Writable {
		t.Error("un proveedor por comando no debe declararse escribible")
	}
}

// TestApplyMergesAndPreserves es la prueba que más importa: configurar SaveMe no
// puede romper los MCP que el usuario ya tenía.
func TestApplyMergesAndPreserves(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "opencode.json")

	original := `{
  "model": "anthropic/claude-sonnet-4-5",
  "mcp": {
    "codegraph": {"type": "local", "command": ["codegraph", "mcp"]},
    "context7": {"type": "remote", "url": "https://mcp.context7.com"}
  }
}`
	if err := os.WriteFile(path, []byte(original), 0o644); err != nil {
		t.Fatal(err)
	}

	p := mustFind(t, "opencode")
	res, err := Apply(p, baseOpts(path))
	if err != nil {
		t.Fatalf("Apply: %v", err)
	}
	if res.Action != ActionMerged {
		t.Errorf("action = %q, want merged", res.Action)
	}
	if res.Backup == "" {
		t.Error("debería haber dejado copia de seguridad")
	}
	if _, err := os.Stat(res.Backup); err != nil {
		t.Errorf("la copia de seguridad no existe: %v", err)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var doc map[string]any
	if err := json.Unmarshal(data, &doc); err != nil {
		t.Fatal(err)
	}
	if doc["model"] != "anthropic/claude-sonnet-4-5" {
		t.Error("se perdió `model`")
	}
	mcp := doc["mcp"].(map[string]any)
	for _, keep := range []string{"codegraph", "context7", "saveme"} {
		if _, ok := mcp[keep]; !ok {
			t.Errorf("falta %q tras la fusión: %v", keep, mcp)
		}
	}
	if mcp["context7"].(map[string]any)["url"] != "https://mcp.context7.com" {
		t.Error("se alteró la entrada context7")
	}
}

// TestApplyRefusesJSONC: reescribir un JSONC borraría los comentarios, así que
// se rechaza y se le da el bloque al usuario.
func TestApplyRefusesJSONC(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "opencode.json")
	original := "{\n  // mi tema\n  \"model\": \"x\",\n  \"mcp\": {}\n}\n"
	if err := os.WriteFile(path, []byte(original), 0o644); err != nil {
		t.Fatal(err)
	}

	res, err := Apply(mustFind(t, "opencode"), baseOpts(path))
	if err != nil {
		t.Fatalf("Apply: %v", err)
	}
	if res.Action != ActionManual {
		t.Errorf("action = %q, want manual", res.Action)
	}
	after, _ := os.ReadFile(path)
	if string(after) != original {
		t.Fatal("el archivo con comentarios se modificó")
	}
}

func TestApplyCreatesWhenMissing(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "sub", "mcp.json")

	res, err := Apply(mustFind(t, "cursor"), baseOpts(path))
	if err != nil {
		t.Fatalf("Apply: %v", err)
	}
	if res.Action != ActionCreated {
		t.Errorf("action = %q, want created", res.Action)
	}
	if res.Backup != "" {
		t.Error("no debería haber copia si el archivo no existía")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var doc map[string]any
	if err := json.Unmarshal(data, &doc); err != nil {
		t.Fatalf("JSON inválido: %v", err)
	}
	if _, ok := doc["mcpServers"].(map[string]any)["saveme"]; !ok {
		t.Errorf("falta mcpServers.saveme: %s", data)
	}
}

// TestApplyTOMLAppendsOnce: en TOML no se reescribe, se añade; y una segunda
// ejecución no debe duplicar la sección.
func TestApplyTOMLAppendsOnce(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.toml")
	if err := os.WriteFile(path, []byte("model = \"gpt-5\"\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	p := mustFind(t, "codex")
	first, err := Apply(p, baseOpts(path))
	if err != nil {
		t.Fatal(err)
	}
	if first.Action != ActionMerged {
		t.Errorf("action = %q, want merged", first.Action)
	}

	second, err := Apply(p, baseOpts(path))
	if err != nil {
		t.Fatal(err)
	}
	if second.Action != ActionPresent {
		t.Errorf("la segunda vez action = %q, want already-configured", second.Action)
	}

	data, _ := os.ReadFile(path)
	if n := strings.Count(string(data), "[mcp_servers.saveme]"); n != 1 {
		t.Errorf("la sección aparece %d veces, want 1:\n%s", n, data)
	}
	if !strings.Contains(string(data), `model = "gpt-5"`) {
		t.Error("se perdió la configuración previa")
	}
}

// TestHasJSONCommentsNoConfundeURLs: la detección no puede confundir las barras
// de "https://" con un comentario, o rechazaría archivos perfectamente válidos.
func TestHasJSONCommentsNoConfundeURLs(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want bool
	}{
		{"url con doble barra", `{"url": "https://ejemplo.com/mcp"}`, false},
		{"url con ruta", `{"url": "https://x.com/a/b"}`, false},
		{"comentario de línea", "{\n // hola\n \"a\": 1\n}", true},
		{"comentario de bloque", "{ /* hola */ \"a\": 1 }", true},
		{"barras dentro de cadena", `{"a": "no // es comentario"}`, false},
		{"barra suelta", `{"a": "1/2"}`, false},
		{"json limpio", `{"a": {"b": [1, 2]}}`, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := hasJSONComments([]byte(tc.in)); got != tc.want {
				t.Errorf("hasJSONComments(%q) = %v, want %v", tc.in, got, tc.want)
			}
		})
	}
}

// TestBuildWarnsWhenRootIsNotDefault: el error más caro es que el MCP y la app
// apunten a raíces distintas. Si el bloque fija una raíz, hay que avisar.
func TestBuildWarnsWhenRootIsNotDefault(t *testing.T) {
	s, err := Build(mustFind(t, "opencode"), Options{
		Command: "saveme",
		Name:    "saveme",
		Env:     map[string]string{"SAVEME_ROOT": "/tmp/otro"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(s.Warnings) == 0 {
		t.Fatal("debería avisar de que la raíz no es la de por defecto")
	}
	if !strings.Contains(s.Warnings[0], "/tmp/otro") {
		t.Errorf("el aviso debería nombrar la raíz: %s", s.Warnings[0])
	}

	// Sin variables de entorno no hace falta ningún aviso: app y MCP coinciden.
	s2, err := Build(mustFind(t, "opencode"), Options{Command: "saveme", Name: "saveme"})
	if err != nil {
		t.Fatal(err)
	}
	if len(s2.Warnings) != 0 {
		t.Errorf("no debería avisar cuando no hay env: %v", s2.Warnings)
	}
	if strings.Contains(s2.Body, "environment") {
		t.Error("sin env no debería aparecer la clave environment")
	}
}

func TestStatusOf(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "opencode.json")
	p := mustFind(t, "opencode")

	st := StatusOf(p, "saveme")
	if st.Path == "" {
		t.Fatal("debería resolver una ruta")
	}

	// Simulamos un archivo propio pasando por Apply.
	if _, err := Apply(p, baseOpts(path)); err != nil {
		t.Fatal(err)
	}
	// StatusOf usa la ruta del proveedor, así que comprobamos la detección
	// textual directamente sobre el archivo escrito.
	data, _ := os.ReadFile(path)
	if !strings.Contains(string(data), `"saveme"`) {
		t.Fatalf("el archivo escrito no menciona saveme:\n%s", data)
	}
}

func TestShellQuote(t *testing.T) {
	cases := map[string]string{
		"saveme":             "saveme",
		"/usr/local/bin/x":   "/usr/local/bin/x",
		"/ruta con espacios": "'/ruta con espacios'",
		"a'b":                `'a'\''b'`,
	}
	for in, want := range cases {
		if got := shellQuote(in); got != want {
			t.Errorf("shellQuote(%q) = %q, want %q", in, got, want)
		}
	}
}

// TestAppliedEntryMatchesPrintedBlock es la prueba que faltaba.
//
// Existía una divergencia real: `Build` (lo que se imprime por pantalla) aplicaba
// los valores por defecto, y `Apply` (lo que se escribe) no. El resultado era que
// el bloque mostrado llevaba el argumento `mcp` y el archivo escrito no, así que
// la configuración se veía perfecta y el servidor MCP no arrancaba nunca. Los
// tests anteriores comprobaban que la clave existía, no su contenido.
func TestAppliedEntryMatchesPrintedBlock(t *testing.T) {
	for _, key := range []string{"opencode", "cursor", "claude-desktop"} {
		t.Run(key, func(t *testing.T) {
			p := mustFind(t, key)
			dir := t.TempDir()
			path := filepath.Join(dir, "config.json")

			opts := Options{Command: "/usr/local/bin/saveme", Name: "saveme", Path: path}

			snippet, err := Build(p, opts)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := Apply(p, opts); err != nil {
				t.Fatal(err)
			}

			printed := entryFrom(t, snippet.Body, p.ServersKey)
			written := entryFrom(t, string(mustRead(t, path)), p.ServersKey)

			if !reflect.DeepEqual(printed, written) {
				t.Fatalf("lo impreso y lo escrito difieren:\nimpreso: %v\nescrito: %v",
					printed, written)
			}

			// Y en concreto: el subcomando tiene que estar, donde el cliente lo
			// espere. Si falta, el servidor arranca sin subcomando y muere.
			switch p.Style {
			case CommandArray:
				cmd, _ := written["command"].([]any)
				if len(cmd) != 2 || cmd[1] != "mcp" {
					t.Fatalf("este cliente necesita el subcomando dentro de command: %v", cmd)
				}
			default:
				if _, isArray := written["command"].([]any); isArray {
					t.Fatalf("este cliente usa command como cadena: %v", written)
				}
				args, _ := written["args"].([]any)
				if len(args) != 1 || args[0] != "mcp" {
					t.Fatalf("falta el argumento mcp: %v", written)
				}
			}
		})
	}
}

// TestTOMLWrittenHasMCPArgument: el mismo cuidado para el formato TOML.
func TestTOMLWrittenHasMCPArgument(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.toml")
	p := mustFind(t, "codex")

	if _, err := Apply(p, Options{Command: "saveme", Name: "saveme", Path: path}); err != nil {
		t.Fatal(err)
	}
	data := string(mustRead(t, path))
	if !strings.Contains(data, `args = ["mcp"]`) {
		t.Fatalf("el archivo escrito no lanza el subcomando mcp:\n%s", data)
	}
}

func entryFrom(t *testing.T, body, serversKey string) map[string]any {
	t.Helper()
	var doc map[string]any
	if err := json.Unmarshal([]byte(body), &doc); err != nil {
		t.Fatalf("JSON inválido: %v\n%s", err, body)
	}
	servers, ok := doc[serversKey].(map[string]any)
	if !ok {
		t.Fatalf("falta %q: %s", serversKey, body)
	}
	entry, ok := servers["saveme"].(map[string]any)
	if !ok {
		t.Fatalf("falta la entrada saveme: %s", body)
	}
	return entry
}

func mustRead(t *testing.T, path string) []byte {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

// TestReportOrdena lo accionable primero: el onboarding debe enseñar arriba los
// clientes que están instalados y sin configurar.
func TestReportOrdena(t *testing.T) {
	report := Report("saveme")
	if len(report) == 0 {
		t.Fatal("el informe no puede estar vacío")
	}
	prev := -1
	for _, r := range report {
		rank := 3
		switch {
		case r.Installed && !r.Configured:
			rank = 0
		case r.Installed && r.Configured:
			rank = 1
		case !r.Installed && r.Key == "generic":
			rank = 2
		}
		if rank < prev {
			t.Errorf("el orden se rompe en %q: rank %d tras %d", r.Key, rank, prev)
		}
		prev = rank
	}
}

// TestFormatosPorCliente fija las diferencias que hacen que una configuración
// "razonable" no funcione: OpenCode, VS Code y los demás no comparten forma.
func TestFormatosPorCliente(t *testing.T) {
	cases := []struct {
		key        string
		serversKey string
		entryType  string
		arrayCmd   bool
		format     Format
	}{
		{"opencode", "mcp", "local", true, FormatJSON},
		{"vscode-copilot", "servers", "stdio", false, FormatJSON},
		{"cursor", "mcpServers", "", false, FormatJSON},
		{"gemini-cli", "mcpServers", "", false, FormatJSON},
		{"qwen", "mcpServers", "", false, FormatJSON},
		{"kiro", "mcpServers", "", false, FormatJSON},
		{"codex", "mcp_servers", "", false, FormatTOML},
		{"claude-code", "mcpServers", "", false, FormatCLI},
	}
	for _, tc := range cases {
		t.Run(tc.key, func(t *testing.T) {
			p := mustFind(t, tc.key)
			if p.ServersKey != tc.serversKey {
				t.Errorf("ServersKey = %q, want %q", p.ServersKey, tc.serversKey)
			}
			if p.EntryType != tc.entryType {
				t.Errorf("EntryType = %q, want %q", p.EntryType, tc.entryType)
			}
			if (p.Style == CommandArray) != tc.arrayCmd {
				t.Errorf("Style = %q", p.Style)
			}
			if p.Format != tc.format {
				t.Errorf("Format = %q, want %q", p.Format, tc.format)
			}
		})
	}
}

// TestVSCodeBlockShape: VS Code es el caso raro y merece su propia comprobación.
func TestVSCodeBlockShape(t *testing.T) {
	s, err := Build(mustFind(t, "vscode-copilot"), Options{Command: "saveme", Name: "saveme"})
	if err != nil {
		t.Fatal(err)
	}
	var doc map[string]any
	if err := json.Unmarshal([]byte(s.Body), &doc); err != nil {
		t.Fatalf("JSON inválido: %v\n%s", err, s.Body)
	}
	servers, ok := doc["servers"].(map[string]any)
	if !ok {
		t.Fatalf("VS Code usa la clave `servers`: %s", s.Body)
	}
	entry := servers["saveme"].(map[string]any)
	if entry["type"] != "stdio" {
		t.Errorf("type = %v, want stdio", entry["type"])
	}
	if _, ok := entry["args"]; !ok {
		t.Error("debería usar command + args")
	}
	if _, ok := doc["mcpServers"]; ok {
		t.Error("no debe emitir mcpServers para VS Code")
	}
}

// TestSelfInstallEsIdempotenteYEjecutable: instalar dos veces no puede fallar ni
// dejar un binario sin permisos de ejecución, porque el cliente lo lanzará.
func TestSelfInstallEsIdempotenteYEjecutable(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	if runtime.GOOS == "windows" {
		t.Setenv("USERPROFILE", home)
	}

	first, err := SelfInstall()
	if err != nil {
		t.Fatalf("SelfInstall: %v", err)
	}
	info, err := os.Stat(first)
	if err != nil {
		t.Fatalf("el binario instalado no existe: %v", err)
	}
	if info.Mode().Perm()&0o100 == 0 {
		t.Errorf("el binario no es ejecutable: %v", info.Mode())
	}
	if info.Size() == 0 {
		t.Error("el binario quedó vacío")
	}

	second, err := SelfInstall()
	if err != nil {
		t.Fatalf("la segunda instalación falló: %v", err)
	}
	if first != second {
		t.Errorf("rutas distintas: %q y %q", first, second)
	}
	if !strings.Contains(first, filepath.Join(".saveme", "bin")) {
		t.Errorf("la instalación debe vivir en una carpeta propia de SaveMe: %s", first)
	}
}

// Las notas de los clientes se escriben en el código como varias cadenas
// concatenadas: la primera línea suelta y las continuaciones con el prefijo
// `# `, que `cleanNote` convierte en espacios. Si a una primera línea se le
// olvida terminar en salto de línea, el prefijo no se reconoce y el `#` se cuela
// a mitad de frase.
//
// Pasó con las cuatro notas que empiezan por «La ruta y el formato salen de la
// convención de …»: se veían como «no de # documentación». Esta prueba no
// comprueba el estilo, comprueba que no vuelva a pasar.
func TestNotesHaveNoLeakedCommentMarkers(t *testing.T) {
	providers := defaultProviders()
	if len(providers) == 0 {
		t.Fatal("no hay clientes que revisar")
	}

	for _, p := range providers {
		note := cleanNote(p.Note)
		if strings.Contains(note, "# ") {
			t.Errorf("la nota de %q deja un marcador de comentario a la vista: %q", p.Key, note)
		}
		if strings.Contains(note, "\n") {
			t.Errorf("la nota de %q conserva saltos de línea sin normalizar: %q", p.Key, note)
		}
		if note != strings.TrimSpace(note) {
			t.Errorf("la nota de %q tiene espacios sobrantes en los extremos: %q", p.Key, note)
		}
	}
}

// Un fallo de permisos al preparar la carpeta del binario es de los que dejan al
// usuario mirando una ruta sin saber qué hacer. Esta prueba comprueba el caso
// real —una carpeta personal en la que no se puede escribir— y que el mensaje
// lleva la pista, no solo el error del sistema.
func TestSelfInstallExplicaUnFalloDePermisos(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("como root los permisos no se aplican")
	}

	readOnly := t.TempDir()
	if err := os.Chmod(readOnly, 0o555); err != nil {
		t.Fatalf("no pude dejar la carpeta sin permiso de escritura: %v", err)
	}
	t.Cleanup(func() { _ = os.Chmod(readOnly, 0o755) })
	t.Setenv("HOME", readOnly)

	_, err := SelfInstall()
	if err == nil {
		t.Fatal("esperaba un fallo al crear la carpeta del binario")
	}
	if !errors.Is(err, fs.ErrPermission) {
		t.Fatalf("el error debería envolver fs.ErrPermission: %v", err)
	}
	if !strings.Contains(err.Error(), "carpeta personal") {
		t.Errorf("el mensaje no explica qué pasa: %q", err.Error())
	}
}

func TestPermissionHintSoloCuandoEsDePermisos(t *testing.T) {
	if hint := permissionHint(fs.ErrPermission); hint == "" {
		t.Error("esperaba una pista para un error de permisos")
	}
	if hint := permissionHint(os.ErrNotExist); hint != "" {
		t.Errorf("no debería opinar sobre un error que no es de permisos: %q", hint)
	}
}

// Aplicar dos veces la misma configuración JSON no puede reportar `updated` la
// segunda: no hay nada que actualizar. Antes sí lo hacía —la comprobación era
// «¿existe la clave?», y tras la primera vez siempre existe—, así que el botón
// «configurar otra vez» reescribía el archivo con su copia de seguridad y su
// fecha nueva, y decía haber actualizado algo que ya estaba bien.
func TestApplyJSONEsIdempotenteYNoTocaElArchivo(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "opencode.json")
	if err := os.WriteFile(path, []byte("{\n  \"mcp\": {}\n}\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	p, ok := Find("opencode")
	if !ok {
		t.Fatal("no encontré el cliente opencode")
	}
	opts := WithDefaults(Options{Command: "saveme", Name: "saveme", Path: path})

	first, err := Apply(p, opts)
	if err != nil {
		t.Fatalf("primera aplicación: %v", err)
	}
	if first.Action != ActionMerged {
		t.Errorf("la primera vez debería fusionar, no %q", first.Action)
	}

	written, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}

	second, err := Apply(p, opts)
	if err != nil {
		t.Fatalf("segunda aplicación: %v", err)
	}
	if second.Action != ActionPresent {
		t.Errorf("la segunda vez debería decir %q, dijo %q", ActionPresent, second.Action)
	}
	if second.Backup != "" {
		t.Errorf("no debería haber copia de seguridad si no se escribe: %q", second.Backup)
	}

	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(after) != string(written) {
		t.Error("el archivo cambió aunque el contenido era el mismo")
	}
	if info2, err := os.Stat(path); err == nil && !info2.ModTime().Equal(info.ModTime()) {
		t.Error("el archivo se reescribió: cambió la fecha de modificación")
	}
}

// --- quitar la configuración -------------------------------------------------

// Quitar la entrada no puede llevarse por delante los demás servidores del
// archivo: es el mismo archivo donde el usuario tiene sus otros MCP.
func TestRemoveJSONConservaLosDemasServidores(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "opencode.json")
	original := `{
  "mcp": {
    "otro": { "type": "local", "command": ["otro"] },
    "saveme": { "type": "local", "command": ["saveme", "mcp"] }
  },
  "theme": "dark"
}
`
	if err := os.WriteFile(path, []byte(original), 0o644); err != nil {
		t.Fatal(err)
	}

	p, _ := Find("opencode")
	result, err := Remove(p, WithDefaults(Options{Command: "saveme", Name: "saveme", Path: path}))
	if err != nil {
		t.Fatalf("quitar: %v", err)
	}
	if result.Action != ActionRemoved {
		t.Fatalf("acción = %q, esperaba %q", result.Action, ActionRemoved)
	}
	if result.Backup == "" {
		t.Error("debería dejar copia de seguridad")
	}

	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var root map[string]any
	if err := json.Unmarshal(after, &root); err != nil {
		t.Fatalf("el resultado no es JSON válido: %v", err)
	}
	servers := root["mcp"].(map[string]any)
	if _, present := servers["saveme"]; present {
		t.Error("la entrada saveme sigue ahí")
	}
	if _, present := servers["otro"]; !present {
		t.Error("se llevó por delante el servidor «otro»")
	}
	if root["theme"] != "dark" {
		t.Error("se perdió el resto de la configuración")
	}
}

// Quitar algo que no está no puede reescribir el archivo ni dejar copia: no hay
// nada que hacer y el usuario no debería ver un «hecho» que no ocurrió.
func TestRemoveJSONCuandoNoEstaNoTocaNada(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "opencode.json")
	original := []byte("{\n  \"mcp\": {\n    \"otro\": {}\n  }\n}\n")
	if err := os.WriteFile(path, original, 0o644); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}

	p, _ := Find("opencode")
	result, err := Remove(p, WithDefaults(Options{Command: "saveme", Name: "saveme", Path: path}))
	if err != nil {
		t.Fatalf("quitar: %v", err)
	}
	if result.Action != ActionAbsent {
		t.Errorf("acción = %q, esperaba %q", result.Action, ActionAbsent)
	}
	if result.Backup != "" {
		t.Errorf("no debería haber copia si no se escribe: %q", result.Backup)
	}
	after, _ := os.ReadFile(path)
	if string(after) != string(original) {
		t.Error("el archivo cambió sin haber nada que quitar")
	}
	if info2, err := os.Stat(path); err == nil && !info2.ModTime().Equal(info.ModTime()) {
		t.Error("el archivo se reescribió")
	}
}

// Si el archivo solo tenía nuestra entrada, dejarlo con un `{}` dentro es basura
// que escribimos nosotros: se borra, con copia.
func TestRemoveJSONBorraElArchivoSiSoloEstabaLoNuestro(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "saveme.json")
	p, _ := Find("opencode")
	opts := WithDefaults(Options{Command: "saveme", Name: "saveme", Path: path})

	if _, err := Apply(p, opts); err != nil {
		t.Fatalf("configurar: %v", err)
	}
	result, err := Remove(p, opts)
	if err != nil {
		t.Fatalf("quitar: %v", err)
	}
	if result.Action != ActionRemoved {
		t.Fatalf("acción = %q", result.Action)
	}
	if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
		t.Error("el archivo debería haberse borrado")
	}
	if _, err := os.Stat(result.Backup); err != nil {
		t.Errorf("la copia de seguridad debería existir: %v", err)
	}
}

// En TOML se quita la sección y su subsección, y también el comentario que
// escribimos encima. Lo demás queda igual, con su formato.
func TestRemoveTOMLQuitaLaSeccionYSuComentario(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.toml")
	original := `model = "gpt-5"

[mcp_servers.otro]
command = "otro"

# SaveMe: diario técnico de proyecto (servidor MCP por stdio).
# Generado con ` + "`saveme mcp-config --provider codex --write`" + `.
[mcp_servers.saveme]
command = "/Users/x/.saveme/bin/saveme"
args = ["mcp"]

[mcp_servers.saveme.env]
SAVEME_ROOT = "/tmp/x"

[features]
x = true
`
	if err := os.WriteFile(path, []byte(original), 0o644); err != nil {
		t.Fatal(err)
	}

	p, _ := Find("codex")
	result, err := Remove(p, WithDefaults(Options{Command: "saveme", Name: "saveme", Path: path}))
	if err != nil {
		t.Fatalf("quitar: %v", err)
	}
	if result.Action != ActionRemoved {
		t.Fatalf("acción = %q, esperaba %q", result.Action, ActionRemoved)
	}

	after, _ := os.ReadFile(path)
	text := string(after)
	for _, unwanted := range []string{
		"[mcp_servers.saveme]",
		"[mcp_servers.saveme.env]",
		"SAVEME_ROOT",
		"# SaveMe:",
		"args = [\"mcp\"]",
	} {
		if strings.Contains(text, unwanted) {
			t.Errorf("quedó %q en el archivo:\n%s", unwanted, text)
		}
	}
	for _, wanted := range []string{"model = \"gpt-5\"", "[mcp_servers.otro]", "[features]", "x = true"} {
		if !strings.Contains(text, wanted) {
			t.Errorf("se perdió %q:\n%s", wanted, text)
		}
	}
}

func TestRemoveTOMLCuandoNoEstaNoTocaNada(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.toml")
	original := []byte("model = \"gpt-5\"\n")
	if err := os.WriteFile(path, original, 0o644); err != nil {
		t.Fatal(err)
	}
	p, _ := Find("codex")
	result, err := Remove(p, WithDefaults(Options{Command: "saveme", Name: "saveme", Path: path}))
	if err != nil {
		t.Fatalf("quitar: %v", err)
	}
	if result.Action != ActionAbsent {
		t.Errorf("acción = %q, esperaba %q", result.Action, ActionAbsent)
	}
	after, _ := os.ReadFile(path)
	if string(after) != string(original) {
		t.Error("el archivo cambió sin haber nada que quitar")
	}
}

// Un archivo con comentarios no se reescribe (se perderían). Quitar tampoco es
// excepción: se dice que hay que hacerlo a mano.
func TestRemoveJSONCNoReescribeYLoExplica(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.jsonc")
	original := []byte("{\n  // mi nota\n  \"mcp\": { \"saveme\": {} }\n}\n")
	if err := os.WriteFile(path, original, 0o644); err != nil {
		t.Fatal(err)
	}
	p, _ := Find("opencode")
	result, err := Remove(p, WithDefaults(Options{Command: "saveme", Name: "saveme", Path: path}))
	if err != nil {
		t.Fatalf("quitar: %v", err)
	}
	if result.Action != ActionManual {
		t.Errorf("acción = %q, esperaba %q", result.Action, ActionManual)
	}
	if !strings.Contains(result.Message, "comentarios") {
		t.Errorf("el mensaje no explica el motivo: %q", result.Message)
	}
	after, _ := os.ReadFile(path)
	if string(after) != string(original) {
		t.Error("no debería haber tocado el archivo")
	}
}

// Quitar y volver a poner tiene que dejar el mismo contenido que la primera vez:
// es lo que se espera de un botón que se puede deshacer.
func TestRemoveYVolverAPonerEsEstable(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "opencode.json")
	if err := os.WriteFile(path, []byte("{\n  \"theme\": \"dark\"\n}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	p, _ := Find("opencode")
	opts := WithDefaults(Options{Command: "saveme", Name: "saveme", Path: path})

	if _, err := Apply(p, opts); err != nil {
		t.Fatal(err)
	}
	first, _ := os.ReadFile(path)
	if _, err := Remove(p, opts); err != nil {
		t.Fatal(err)
	}
	if _, err := Apply(p, opts); err != nil {
		t.Fatal(err)
	}
	second, _ := os.ReadFile(path)
	if string(first) != string(second) {
		t.Errorf("el contenido tras volver a poner no coincide:\n%s\n---\n%s", first, second)
	}
}
