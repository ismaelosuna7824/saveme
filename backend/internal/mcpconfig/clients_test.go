package mcpconfig

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func readJSON(t *testing.T, path string) map[string]any {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var doc map[string]any
	if err := json.Unmarshal(data, &doc); err != nil {
		t.Fatalf("%s no es JSON válido: %v\n%s", path, err, data)
	}
	return doc
}

// Z Code guarda los servidores dentro de `mcp.servers`. Escribir `servers` en la
// raíz, o pisar el resto de `mcp`, dejaría al cliente sin ver el servidor o sin
// su configuración.
func TestZCodeEscribeYQuitaDentroDeMcpServers(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	original := `{"theme": "dark", "mcp": {"timeout": 30, "servers": {"memory": {"command": "npx"}}}}`
	if err := os.WriteFile(path, []byte(original), 0o644); err != nil {
		t.Fatal(err)
	}
	p := mustFind(t, "zcode")

	if _, err := Apply(p, baseOpts(path)); err != nil {
		t.Fatalf("Apply: %v", err)
	}
	doc := readJSON(t, path)
	if _, ok := doc["servers"]; ok {
		t.Error("no debe escribir `servers` en la raíz")
	}
	mcp := doc["mcp"].(map[string]any)
	if mcp["timeout"] != float64(30) {
		t.Errorf("se perdió mcp.timeout: %v", mcp)
	}
	servers := mcp["servers"].(map[string]any)
	if _, ok := servers["memory"]; !ok {
		t.Error("se perdió el servidor que ya había")
	}
	if entry, ok := servers["saveme"].(map[string]any); !ok || entry["command"] != "/usr/local/bin/saveme" {
		t.Errorf("falta la entrada de saveme: %v", servers)
	}

	if _, err := Remove(p, baseOpts(path)); err != nil {
		t.Fatalf("Remove: %v", err)
	}
	if servers := readJSON(t, path)["mcp"].(map[string]any)["servers"].(map[string]any); servers["saveme"] != nil {
		t.Errorf("no se quitó: %v", servers)
	}
}

// Si `mcp` solo tenía lo nuestro, quitarlo no deja un `"mcp": {}` huérfano ni el
// archivo vacío: se borra, igual que con la clave plana.
func TestZCodeQuitarLoUnicoBorraElArchivo(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	p := mustFind(t, "zcode")
	if _, err := Apply(p, baseOpts(path)); err != nil {
		t.Fatal(err)
	}
	res, err := Remove(p, baseOpts(path))
	if err != nil {
		t.Fatal(err)
	}
	if res.Action != ActionRemoved {
		t.Errorf("action = %q", res.Action)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Errorf("el archivo debería haberse borrado: %v", err)
	}
}

// Amp usa `amp.mcpServers` como clave literal. Si se anidara (`amp` →
// `mcpServers`), Amp no lo leería.
func TestAmpUsaLaClaveConPunto(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.json")
	if _, err := Apply(mustFind(t, "amp"), baseOpts(path)); err != nil {
		t.Fatal(err)
	}
	doc := readJSON(t, path)
	if _, nested := doc["amp"]; nested {
		t.Error("no debe anidar la clave")
	}
	servers, ok := doc["amp.mcpServers"].(map[string]any)
	if !ok || servers["saveme"] == nil {
		t.Errorf("falta amp.mcpServers.saveme: %v", doc)
	}
}

// Kilo comparte la forma de OpenCode: `command` con los argumentos dentro y el
// entorno en `environment`.
func TestKiloBlockShape(t *testing.T) {
	s, err := Build(mustFind(t, "kilocode"), Options{
		Command: "saveme",
		Env:     map[string]string{"SAVEME_ROOT": "/tmp/ws"},
	})
	if err != nil {
		t.Fatal(err)
	}
	var doc map[string]any
	if err := json.Unmarshal([]byte(s.Body), &doc); err != nil {
		t.Fatalf("JSON inválido: %v\n%s", err, s.Body)
	}
	entry := doc["mcp"].(map[string]any)["saveme"].(map[string]any)
	if cmd, _ := entry["command"].([]any); len(cmd) != 2 || cmd[1] != "mcp" {
		t.Errorf("command = %v", entry["command"])
	}
	if entry["type"] != "local" || entry["enabled"] != true {
		t.Errorf("entrada = %v", entry)
	}
	if env, _ := entry["environment"].(map[string]any); env["SAVEME_ROOT"] != "/tmp/ws" {
		t.Errorf("el entorno va en `environment`: %v", entry)
	}
	if _, ok := doc["$schema"]; ok {
		t.Error("el $schema es de OpenCode, no de Kilo")
	}
}

// Hermes se configura con `hermes mcp add`, y `--args` tiene que ir al final.
// Su comando no admite entorno: si hace falta, se avisa en vez de perderlo.
func TestHermesEsUnComandoYAvisaDelEntorno(t *testing.T) {
	p := mustFind(t, "hermes")
	s, err := Build(p, Options{Command: "/opt/saveme", Env: map[string]string{"SAVEME_ROOT": "/tmp/ws"}})
	if err != nil {
		t.Fatal(err)
	}
	if want := "hermes mcp add saveme --command /opt/saveme --args mcp"; s.Body != want {
		t.Errorf("comando:\n got %s\nwant %s", s.Body, want)
	}
	warned := false
	for _, w := range s.Warnings {
		warned = warned || strings.Contains(w, "SAVEME_ROOT")
	}
	if !warned {
		t.Errorf("debería avisar de que SAVEME_ROOT hay que añadirlo a mano: %v", s.Warnings)
	}

	res, err := Remove(p, Options{Command: "/opt/saveme"})
	if err != nil {
		t.Fatal(err)
	}
	if res.Command != "hermes mcp remove saveme" {
		t.Errorf("baja = %q", res.Command)
	}
}

// El bloque de DeepSeek Harness es una fila de su plugin MCP. Los valores van
// entre comillas para que una ruta con espacios no rompa el YAML.
func TestDeepSeekRenderizaLaFilaDelPlugin(t *testing.T) {
	s, err := Build(mustFind(t, "deepseek"), Options{Command: "/Users/ana/Mis Apps/saveme"})
	if err != nil {
		t.Fatal(err)
	}
	if s.Language != "yaml" || s.Writable {
		t.Errorf("language=%q writable=%v", s.Language, s.Writable)
	}
	for _, want := range []string{
		"name: '@deepseek-ai/dsh-mcp-client'",
		`serverName: "saveme"`,
		"transport: stdio",
		`command: "/Users/ana/Mis Apps/saveme"`,
		`args: ["mcp"]`,
	} {
		if !strings.Contains(s.Body, want) {
			t.Errorf("falta %q:\n%s", want, s.Body)
		}
	}
}

// Un cliente que delega no se escribe: se dice qué agentes configurar, y cuenta
// como configurado en cuanto lo está uno de ellos.
func TestDelegadoSeConfiguraEnSusAgentes(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	if runtime.GOOS == "windows" {
		t.Setenv("USERPROFILE", home)
	}
	orca := mustFind(t, "orca")

	res, err := Apply(orca, baseOpts(""))
	if err != nil {
		t.Fatal(err)
	}
	if res.Action != ActionManual || !strings.Contains(res.Message, "Claude Code") {
		t.Errorf("resultado = %+v", res)
	}
	if StatusOf(orca, "saveme").Configured {
		t.Fatal("sin ningún agente configurado no puede contar como configurado")
	}

	// Cursor es uno de los agentes que lanza Orca.
	if _, err := Apply(mustFind(t, "cursor"), baseOpts(filepath.Join(home, ".cursor", "mcp.json"))); err != nil {
		t.Fatal(err)
	}
	if !StatusOf(orca, "saveme").Configured {
		t.Error("con Cursor configurado, Orca debería contar como configurado")
	}
}

// Cada cliente al que delega uno de estos tiene que existir en la tabla: si no,
// el mensaje diría «configura SaveMe en: » sin nombres.
func TestLosDelegadosApuntanAClientesConocidos(t *testing.T) {
	for _, p := range Providers() {
		if p.Format != FormatDelegated {
			continue
		}
		if len(p.Via) == 0 {
			t.Errorf("%s delega sin decir en quién", p.Key)
		}
		for _, key := range p.Via {
			if _, ok := Find(key); !ok {
				t.Errorf("%s delega en %q, que no existe", p.Key, key)
			}
		}
	}
}

func TestCustomValidaYDeduceElFormato(t *testing.T) {
	if _, err := Custom(CustomDef{}); err == nil {
		t.Error("sin ruta debería fallar")
	}
	if _, err := Custom(CustomDef{Path: "relativo/mcp.json"}); err == nil {
		t.Error("una ruta relativa debería fallar: no se sabría dónde escribe")
	}

	toml, err := Custom(CustomDef{Path: filepath.Join(t.TempDir(), "agent.toml"), ServersKey: "servers"})
	if err != nil {
		t.Fatal(err)
	}
	if toml.Format != FormatTOML {
		t.Errorf("un .toml debería escribirse como TOML: %q", toml.Format)
	}
	if _, err := Custom(CustomDef{Path: "/tmp/agent.toml", CommandArray: true}); err == nil {
		t.Error("TOML con command en array no se admite")
	}

	home, _ := os.UserHomeDir()
	tilde, err := Custom(CustomDef{Path: "~/.agent/mcp.json"})
	if err != nil {
		t.Fatal(err)
	}
	if got := tilde.Path(); got != filepath.Join(home, ".agent", "mcp.json") {
		t.Errorf("~ no se resolvió: %s", got)
	}
}

// Lo que describe el usuario se escribe con su forma: su clave, su `type`, el
// comando en array si lo pidió y su clave de entorno.
func TestCustomEscribeConLaFormaPedida(t *testing.T) {
	path := filepath.Join(t.TempDir(), "agent.json")
	p, err := Custom(CustomDef{
		Path:         path,
		ServersKey:   "tools",
		EntryType:    "local",
		CommandArray: true,
		EnvKey:       "environment",
	})
	if err != nil {
		t.Fatal(err)
	}
	opts := baseOpts("")
	opts.Env = map[string]string{"SAVEME_ROOT": "/tmp/ws"}
	if _, err := Apply(p, opts); err != nil {
		t.Fatal(err)
	}
	entry := readJSON(t, path)["tools"].(map[string]any)["saveme"].(map[string]any)
	if cmd, _ := entry["command"].([]any); len(cmd) != 2 {
		t.Errorf("command = %v", entry["command"])
	}
	if entry["type"] != "local" {
		t.Errorf("type = %v", entry["type"])
	}
	if env, _ := entry["environment"].(map[string]any); env["SAVEME_ROOT"] != "/tmp/ws" {
		t.Errorf("entorno = %v", entry)
	}
}

// containsServer también tiene que reconocer YAML: Hermes guarda su
// configuración ahí, y sin esto saldría siempre como «sin configurar».
func TestContainsServerReconoceYAML(t *testing.T) {
	yaml := "mcp_servers:\n  saveme:\n    command: saveme\n"
	if !containsServer([]byte(yaml), "saveme") {
		t.Error("no reconoció la entrada YAML")
	}
	if containsServer([]byte("mcp_servers:\n  otro:\n    command: x\n"), "saveme") {
		t.Error("falso positivo")
	}
}
