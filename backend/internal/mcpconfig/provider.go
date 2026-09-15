// Package mcpconfig genera la configuración del servidor MCP para los distintos
// clientes (OpenCode, Claude Code, Codex, Cursor…) y la escribe de forma segura.
//
// Existe porque hay tres errores fáciles de cometer y difíciles de diagnosticar:
//
//  1. Apuntar el cliente a una ruta equivocada del binario.
//  2. Que el MCP y la app resuelvan raíces de workspace distintas, con lo que el
//     agente escribe resúmenes que la interfaz nunca muestra.
//  3. Dar por bueno un formato de configuración que el cliente no acepta.
//
// Para el tercero la regla es no inventar: cada proveedor declara si su formato
// está verificado contra su documentación, y los que no lo están se ofrecen por
// la vía manual en vez de escribirse a ciegas.
package mcpconfig

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
)

// Format es cómo se escribe la configuración de cada cliente.
type Format string

const (
	// FormatJSON: un archivo JSON con una clave que agrupa los servidores.
	FormatJSON Format = "json"
	// FormatTOML: un archivo TOML con una sección por servidor (Codex).
	FormatTOML Format = "toml"
	// FormatCLI: se configura con un comando, no editando un archivo (Claude Code).
	FormatCLI Format = "cli"
	// FormatManual: no se conoce el formato con suficiente confianza. Se le da al
	// usuario el bloque genérico y su ruta para que lo coloque él.
	FormatManual Format = "manual"
)

// CommandStyle describe cómo espera el cliente el ejecutable y sus argumentos.
type CommandStyle string

const (
	// CommandSplit: `command` es una cadena y `args` es un array (lo más común).
	CommandSplit CommandStyle = "split"
	// CommandArray: todo junto en `command` (OpenCode).
	CommandArray CommandStyle = "array"
)

// Provider describe cómo se configura un cliente MCP.
type Provider struct {
	Key  string
	Name string
	// Format indica cómo se escribe.
	Format Format
	// Path resuelve el archivo de configuración global. Puede ser nil.
	Path func() string
	// ServersKey es la clave o sección que agrupa los servidores.
	ServersKey string
	// EntryType, si no está vacío, se emite como `"type"` en la entrada.
	// OpenCode quiere "local"; VS Code quiere "stdio".
	EntryType string
	// Style indica dónde van los argumentos.
	Style CommandStyle
	// EnvKey es el nombre de la clave de variables de entorno, si la tiene.
	EnvKey string
	// EnvInline indica que el entorno se pasa con `-e VAR=valor` en el comando
	// (Claude Code) en vez de dentro del bloque.
	EnvInline bool
	// DetectDirs son directorios cuya existencia indica que el cliente está
	// instalado.
	DetectDirs []func() string
	// DetectBins son ejecutables cuya presencia en el PATH indica lo mismo.
	DetectBins []string
	// Verified indica que la ruta y el formato están confirmados contra la
	// documentación del cliente. Los no verificados no se escriben solos.
	Verified bool
	// Note es un aviso que se imprime junto al bloque.
	Note string
}

// home devuelve una ruta bajo la carpeta personal.
func home(parts ...string) func() string {
	return func() string {
		base, err := os.UserHomeDir()
		if err != nil {
			return ""
		}
		return filepath.Join(append([]string{base}, parts...)...)
	}
}

// configDir devuelve una ruta bajo la carpeta de configuración del sistema.
func configDir(parts ...string) func() string {
	return func() string {
		base, err := os.UserConfigDir()
		if err != nil {
			return ""
		}
		return filepath.Join(append([]string{base}, parts...)...)
	}
}

func defaultProviders() []Provider {
	return []Provider{
		{
			Key:    "opencode",
			Name:   "OpenCode",
			Format: FormatJSON,
			Path:   home(".config", "opencode", "opencode.json"),
			DetectDirs: []func() string{
				home(".config", "opencode"),
			},
			DetectBins: []string{"opencode"},
			ServersKey: "mcp",
			EntryType:  "local",
			Style:      CommandArray,
			EnvKey:     "environment",
			Verified:   true,
			Note: "OpenCode fusiona los archivos de configuración en vez de reemplazarlos, así\n" +
				"# que este bloque convive con los MCP que ya tengas. Exige `type: \"local\"` y\n" +
				"# los argumentos dentro de `command`. Si el archivo es JSONC con comentarios,\n" +
				"# no se reescribe: se te da el bloque para pegar.",
		},
		{
			Key:        "codex",
			Name:       "Codex CLI",
			Format:     FormatTOML,
			Path:       home(".codex", "config.toml"),
			DetectDirs: []func() string{home(".codex")},
			DetectBins: []string{"codex"},
			ServersKey: "mcp_servers",
			Style:      CommandSplit,
			EnvKey:     "env",
			Verified:   true,
			Note: "En TOML la sección es [mcp_servers.saveme] y el entorno va en\n" +
				"# una subsección [mcp_servers.saveme.env].",
		},
		{
			Key:        "claude-code",
			Name:       "Claude Code",
			Format:     FormatCLI,
			Path:       home(".claude.json"),
			DetectDirs: []func() string{home(".claude")},
			DetectBins: []string{"claude"},
			ServersKey: "mcpServers",
			EnvKey:     "env",
			EnvInline:  true,
			Verified:   true,
			Note: "Claude Code tiene tres ámbitos: local (solo este proyecto), project (se\n" +
				"# comparte por git) y user (todos tus proyectos). Para que funcione en\n" +
				"# cualquier proyecto, este último es el que quieres. Se configura con su\n" +
				"# propio comando, no editando ~/.claude.json, que es su archivo de estado.",
		},
		{
			Key:        "claude-desktop",
			Name:       "Claude Desktop",
			Format:     FormatJSON,
			Path:       configDir("Claude", "claude_desktop_config.json"),
			DetectDirs: []func() string{configDir("Claude")},
			ServersKey: "mcpServers",
			Style:      CommandSplit,
			EnvKey:     "env",
			Verified:   true,
		},
		{
			Key:        "cursor",
			Name:       "Cursor",
			Format:     FormatJSON,
			Path:       home(".cursor", "mcp.json"),
			DetectDirs: []func() string{home(".cursor")},
			DetectBins: []string{"cursor"},
			ServersKey: "mcpServers",
			Style:      CommandSplit,
			EnvKey:     "env",
			Verified:   true,
		},
		{
			Key:        "windsurf",
			Name:       "Windsurf",
			Format:     FormatJSON,
			Path:       home(".codeium", "windsurf", "mcp_config.json"),
			DetectDirs: []func() string{home(".codeium", "windsurf")},
			ServersKey: "mcpServers",
			Style:      CommandSplit,
			EnvKey:     "env",
			Verified:   false,
			Note: "La ruta y el formato salen de la convención de Windsurf, no de\n" +
				"# documentación que haya podido confirmar. Si no lo detecta, revisa su doc.",
		},
		{
			Key:        "gemini-cli",
			Name:       "Gemini CLI",
			Format:     FormatJSON,
			Path:       home(".gemini", "settings.json"),
			DetectDirs: []func() string{home(".gemini")},
			DetectBins: []string{"gemini"},
			ServersKey: "mcpServers",
			Style:      CommandSplit,
			EnvKey:     "env",
			Verified:   false,
			Note: "La ruta y el formato salen de la convención de Gemini CLI, no de\n" +
				"# documentación que haya podido confirmar. Si no lo detecta, revisa su doc.",
		},
		{
			Key:        "qwen",
			Name:       "Qwen Code",
			Format:     FormatJSON,
			Path:       home(".qwen", "settings.json"),
			DetectDirs: []func() string{home(".qwen")},
			DetectBins: []string{"qwen"},
			ServersKey: "mcpServers",
			Style:      CommandSplit,
			EnvKey:     "env",
			Verified:   false,
			Note: "La ruta y el formato salen de la convención de Qwen Code, no de\n" +
				"# documentación que haya podido confirmar. Si no lo detecta, revisa su doc.",
		},
		{
			Key:        "kiro",
			Name:       "Kiro",
			Format:     FormatJSON,
			Path:       home(".kiro", "settings", "mcp.json"),
			DetectDirs: []func() string{home(".kiro")},
			DetectBins: []string{"kiro"},
			ServersKey: "mcpServers",
			Style:      CommandSplit,
			EnvKey:     "env",
			Verified:   false,
			Note: "La ruta y el formato salen de la convención de Kiro, no de\n" +
				"# documentación que haya podido confirmar. Si no lo detecta, revisa su doc.",
		},
		{
			Key:        "vscode-copilot",
			Name:       "VS Code (Copilot)",
			Format:     FormatJSON,
			Path:       home(".config", "Code", "User", "mcp.json"),
			DetectDirs: []func() string{configDir("Code", "User")},
			DetectBins: []string{"code"},
			// VS Code es el raro: la clave es `servers` y cada entrada lleva
			// `type: "stdio"`.
			ServersKey: "servers",
			EntryType:  "stdio",
			Style:      CommandSplit,
			EnvKey:     "env",
			Verified:   false,
			Note: "VS Code usa `servers` en vez de `mcpServers` y exige `type: \"stdio\"`.\n" +
				"# Este bloque es para tu configuración de usuario; también puedes ponerlo\n" +
				"# en .vscode/mcp.json dentro de un proyecto concreto.",
		},
		{
			Key:        "kilocode",
			Name:       "Kilo Code",
			Format:     FormatManual,
			DetectDirs: []func() string{home(".kilocode")},
			ServersKey: "mcpServers",
			Style:      CommandSplit,
			EnvKey:     "env",
			Verified:   false,
			Note: "Kilo Code es una extensión de VS Code y guarda sus MCP en el almacén\n" +
				"# interno de la extensión, que cambia entre versiones. Se te da el bloque\n" +
				"# estándar para que lo pegues donde corresponda.",
		},
		{
			Key:        "generic",
			Name:       "Otro agente compatible con MCP",
			Format:     FormatManual,
			ServersKey: "mcpServers",
			Style:      CommandSplit,
			EnvKey:     "env",
			Verified:   false,
			Note: "El bloque `mcpServers` es el formato de facto. Si tu cliente usa otro,\n" +
				"# revisa su documentación.",
		},
	}
}

// Providers devuelve la tabla de clientes soportados.
func Providers() []Provider { return defaultProviders() }

// Find busca un proveedor por clave, tolerando mayúsculas y el nombre visible.
func Find(key string) (Provider, bool) {
	norm := strings.ToLower(strings.TrimSpace(key))
	for _, p := range defaultProviders() {
		if p.Key == norm || strings.EqualFold(p.Name, key) {
			return p, true
		}
	}
	return Provider{}, false
}

// Options son los datos que se interpolan en el bloque.
type Options struct {
	// Command es el ejecutable que el cliente debe lanzar.
	Command string
	// Name es el nombre con el que se registra el servidor en el cliente.
	Name string
	// Args son los argumentos. Por defecto ["mcp"].
	Args []string
	// Env son variables de entorno extra.
	Env map[string]string
	// Path sobrescribe el archivo de configuración del proveedor.
	Path string
}

// WithDefaults rellena los valores por defecto.
//
// Se aplica tanto al construir el bloque como al escribirlo. Tenerlo en un solo
// sitio no es cuestión de estilo: cuando la normalización vivía solo en Build, el
// bloque impreso llevaba el argumento `mcp` y el archivo escrito no, así que la
// configuración se veía bien y el servidor no arrancaba.
func WithDefaults(opts Options) Options {
	if opts.Name == "" {
		opts.Name = "saveme"
	}
	if len(opts.Args) == 0 {
		opts.Args = []string{"mcp"}
	}
	return opts
}

// Snippet es un bloque de configuración listo para pegar o escribir.
type Snippet struct {
	Provider Provider
	// Path es el archivo destino, o "" si se configura por comando.
	Path string
	// Body es el texto exacto que el usuario pegaría.
	Body string
	// Language es para el resaltado: json, toml o sh.
	Language string
	// Writable indica si `--write` puede aplicarlo automáticamente.
	Writable bool
	// Warnings son avisos que el usuario debería leer antes de aplicar nada.
	Warnings []string
}

// Build genera el bloque de configuración de un proveedor.
func Build(p Provider, opts Options) (Snippet, error) {
	if opts.Command == "" {
		return Snippet{}, errors.New("falta el ejecutable: no pude determinar la ruta del binario")
	}
	opts = WithDefaults(opts)

	path := opts.Path
	if path == "" && p.Path != nil {
		path = p.Path()
	}

	s := Snippet{Provider: p, Path: path, Language: string(p.Format)}

	// Un aviso que vale para todos: si la raíz no es la de por defecto, la app
	// tiene que estar configurada igual o el agente escribirá donde nadie mira.
	if root := opts.Env["SAVEME_ROOT"]; root != "" {
		s.Warnings = append(s.Warnings, fmt.Sprintf(
			"Este bloque fija SAVEME_ROOT=%s. La app tiene que usar la misma raíz "+
				"(o el MCP escribirá resúmenes que la interfaz no verá). Para uso normal, "+
				"quita SAVEME_ROOT y deja que ambos usen ~/Documents/SaveMe.", root))
	}
	if !p.Verified {
		if p.Format == FormatManual {
			s.Warnings = append(s.Warnings, "El formato de este cliente no está confirmado, "+
				"así que no se escribe solo: pega el bloque donde corresponda.")
		} else {
			s.Warnings = append(s.Warnings, "La ruta y el formato de este cliente vienen de su "+
				"convención y no los he confirmado contra su documentación. Se escribirá igual; "+
				"si el cliente no lo detecta, revisa su doc o pásale otra ruta con --path.")
		}
	}

	switch p.Format {
	case FormatCLI:
		s.Writable = false
		s.Body = buildCLI(p, opts)
		s.Language = "sh"
	case FormatTOML:
		s.Writable = true
		s.Body = buildTOML(p, opts)
	case FormatJSON:
		s.Writable = true
		s.Body = buildJSON(p, opts)
	case FormatManual:
		s.Writable = false
		s.Body = buildManual(p, opts)
	default:
		return Snippet{}, fmt.Errorf("formato desconocido: %q", p.Format)
	}
	return s, nil
}

// serverEntry arma la entrada del servidor con la forma que espera el cliente.
func serverEntry(p Provider, opts Options) map[string]any {
	entry := map[string]any{}

	switch p.Style {
	case CommandArray:
		entry["command"] = append([]string{opts.Command}, opts.Args...)
	default:
		entry["command"] = opts.Command
		entry["args"] = opts.Args
	}
	if p.EntryType != "" {
		entry["type"] = p.EntryType
	}
	if p.EnvKey != "" && len(opts.Env) > 0 && !p.EnvInline {
		env := map[string]any{}
		for k, v := range opts.Env {
			env[k] = v
		}
		entry[p.EnvKey] = env
	}
	if p.Key == "opencode" {
		entry["enabled"] = true
	}
	return entry
}

func buildJSON(p Provider, opts Options) string {
	doc := map[string]any{
		p.ServersKey: map[string]any{
			opts.Name: serverEntry(p, opts),
		},
	}
	if p.Key == "opencode" {
		doc["$schema"] = "https://opencode.ai/config.json"
	}
	return renderJSON(doc)
}

func buildTOML(p Provider, opts Options) string {
	var b strings.Builder
	fmt.Fprintf(&b, "[%s.%s]\n", p.ServersKey, opts.Name)
	fmt.Fprintf(&b, "command = %q\n", opts.Command)
	b.WriteString("args = [")
	for i, a := range opts.Args {
		if i > 0 {
			b.WriteString(", ")
		}
		fmt.Fprintf(&b, "%q", a)
	}
	b.WriteString("]\n")
	b.WriteString("enabled = true\n")
	if len(opts.Env) > 0 {
		fmt.Fprintf(&b, "\n[%s.%s.%s]\n", p.ServersKey, opts.Name, p.EnvKey)
		for _, k := range sortedKeys(opts.Env) {
			fmt.Fprintf(&b, "%s = %q\n", k, opts.Env[k])
		}
	}
	return b.String()
}

func buildCLI(p Provider, opts Options) string {
	parts := []string{"claude", "mcp", "add", "--scope", "user", opts.Name, "--", opts.Command}
	parts = append(parts, opts.Args...)
	quoted := make([]string, len(parts))
	for i, part := range parts {
		quoted[i] = shellQuote(part)
	}
	var b strings.Builder
	b.WriteString(strings.Join(quoted, " "))
	for _, k := range sortedKeys(opts.Env) {
		fmt.Fprintf(&b, " \\\n  -e %s=%s", k, shellQuote(opts.Env[k]))
	}
	return b.String()
}

// buildManual da el bloque estándar para los clientes cuyo formato no está
// confirmado, con su ruta habitual como pista.
func buildManual(p Provider, opts Options) string {
	entry := map[string]any{
		"command": opts.Command,
		"args":    opts.Args,
	}
	if len(opts.Env) > 0 && p.EnvKey != "" {
		env := map[string]any{}
		for k, v := range opts.Env {
			env[k] = v
		}
		entry[p.EnvKey] = env
	}
	doc := map[string]any{p.ServersKey: map[string]any{opts.Name: entry}}

	var b strings.Builder
	if p.Path != nil {
		if path := p.Path(); path != "" {
			fmt.Fprintf(&b, "# archivo habitual de este cliente: %s\n", path)
		}
	}
	b.WriteString(renderJSON(doc))
	return b.String()
}

func shellQuote(s string) string {
	if s != "" && !strings.ContainsAny(s, " \t\n\"'$`\\*?[]#&|;<>(){}") {
		return s
	}
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

// ResolveCommand decide qué poner en `command`.
//
// Prefiere el nombre pelado —`saveme`— cuando el binario está en el PATH: así la
// configuración sobrevive a mover o reinstalar el binario. Si no está en el
// PATH, usa la ruta absoluta, que es lo único que funcionará.
func ResolveCommand() (string, error) {
	if onPath, err := exec.LookPath("saveme"); err == nil && onPath != "" {
		return "saveme", nil
	}
	exe, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("no pude averiguar mi propia ruta: %w", err)
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	return exe, nil
}

// LooksInstalled indica si el binario está en el PATH con el nombre "saveme".
func LooksInstalled() bool {
	_, err := exec.LookPath("saveme")
	return err == nil
}

// --- instalación del propio binario ------------------------------------------

// InstallDir es dónde la app deja su servidor MCP: una carpeta suya, para no
// pisar nada del usuario y poder desinstalarlo borrando un directorio.
func InstallDir() (string, error) {
	base, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("no pude averiguar tu carpeta personal: %w", err)
	}
	return filepath.Join(base, ".saveme", "bin"), nil
}

// InstallPath es la ruta completa del binario instalado.
func InstallPath() (string, error) {
	dir, err := InstallDir()
	if err != nil {
		return "", err
	}
	name := "saveme"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	return filepath.Join(dir, name), nil
}

// permissionHint añade una frase cuando el fallo es de permisos.
//
// Un «operation not permitted» a secas deja al usuario con la ruta delante y sin
// saber qué hacer con ella. Y este fallo tiene causa conocida: la carpeta
// personal no deja escribir en `.saveme`, típicamente en un Mac gestionado por
// la empresa, en una cuenta con el `$HOME` de solo lectura, o dentro de un
// sandbox. El detalle del sistema se conserva; esto solo lo interpreta.
func permissionHint(err error) string {
	if !errors.Is(err, fs.ErrPermission) {
		return ""
	}
	return ". Tu carpeta personal no deja crear esa carpeta: revisa sus permisos, " +
		"o ejecuta SaveMe con una cuenta que sí pueda escribir en ella"
}

// SelfInstall copia el binario en ejecución a una ubicación estable.
//
// Hace falta porque el binario que va dentro del .app desaparece si el usuario
// mueve o borra la aplicación, y una configuración de MCP que apunta a una ruta
// muerta falla en silencio. Instalarlo aparte lo desacopla de la app: los
// clientes siguen funcionando aunque la app no esté.
//
// No descarga nada: el binario es autocontenido (Go puro, sin CGO), así que no
// necesita Go, Node ni ninguna dependencia en la máquina del usuario.
func SelfInstall() (string, error) {
	source, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("no pude averiguar mi propia ruta: %w", err)
	}
	if resolved, err := filepath.EvalSymlinks(source); err == nil {
		source = resolved
	}

	target, err := InstallPath()
	if err != nil {
		return "", err
	}
	if same, err := sameFile(source, target); err == nil && same {
		return target, nil
	}

	data, err := os.ReadFile(source)
	if err != nil {
		return "", fmt.Errorf("leer el binario de origen %s: %w", source, err)
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return "", fmt.Errorf("crear %s: %w%s", filepath.Dir(target), err, permissionHint(err))
	}

	// Escritura atómica: un cliente que arranque a mitad de la copia no puede
	// encontrarse un binario truncado.
	tmp, err := os.CreateTemp(filepath.Dir(target), ".saveme-install-*")
	if err != nil {
		return "", err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return "", err
	}
	if err := tmp.Close(); err != nil {
		return "", err
	}
	if err := os.Chmod(tmpName, 0o755); err != nil {
		return "", err
	}
	if err := os.Rename(tmpName, target); err != nil {
		return "", fmt.Errorf("instalar en %s: %w", target, err)
	}
	return target, nil
}

func sameFile(a, b string) (bool, error) {
	infoA, err := os.Stat(a)
	if err != nil {
		return false, err
	}
	infoB, err := os.Stat(b)
	if err != nil {
		return false, err
	}
	return os.SameFile(infoA, infoB), nil
}

// --- detección y estado ------------------------------------------------------

// Status describe si un cliente está instalado y si tiene a SaveMe configurado.
type Status struct {
	Provider Provider
	// Path es el archivo de configuración, o "" si no aplica.
	Path string
	// Exists indica que el archivo de configuración existe.
	Exists bool
	// Installed indica que el cliente parece estar en esta máquina.
	Installed bool
	// Configured indica que ya tiene a SaveMe.
	Configured bool
}

// StatusOf revisa el estado de un cliente.
//
// La detección es heurística —carpetas y ejecutables— porque cada cliente guarda
// sus cosas donde quiere. Es deliberadamente conservadora: preferimos no ofrecer
// un cliente que no está antes que ofrecer uno que sí y equivocarnos de ruta.
func StatusOf(p Provider, name string) Status {
	if name == "" {
		name = "saveme"
	}
	st := Status{Provider: p}

	if p.Path != nil {
		st.Path = p.Path()
	}
	if st.Path != "" {
		if data, err := os.ReadFile(st.Path); err == nil {
			st.Exists = true
			st.Configured = containsServer(data, name)
		}
	}

	for _, dir := range p.DetectDirs {
		if path := dir(); path != "" {
			if info, err := os.Stat(path); err == nil && info.IsDir() {
				st.Installed = true
				break
			}
		}
	}
	if !st.Installed {
		for _, bin := range p.DetectBins {
			if _, err := exec.LookPath(bin); err == nil {
				st.Installed = true
				break
			}
		}
	}
	// Tener el archivo de configuración ya cuenta como instalado, aunque la
	// carpeta no se llame como esperábamos.
	if st.Exists {
		st.Installed = true
	}
	return st
}

// containsServer busca el nombre del servidor en un archivo de configuración.
//
// Es textual a propósito: parsear la configuración de cada cliente exigiría
// replicar sus reglas de fusión (OpenCode, por ejemplo, combina varios archivos),
// y para un diagnóstico basta con saber si el nombre aparece.
func containsServer(data []byte, name string) bool {
	text := string(data)
	return strings.Contains(text, `"`+name+`"`) ||
		strings.Contains(text, "."+name+"]") ||
		strings.Contains(text, name+" ")
}

// ProviderReport es lo que se le enseña al usuario en el onboarding.
type ProviderReport struct {
	Key        string `json:"key"`
	Name       string `json:"name"`
	Path       string `json:"path,omitempty"`
	Format     string `json:"format"`
	Installed  bool   `json:"installed"`
	Configured bool   `json:"configured"`
	Verified   bool   `json:"verified"`
	Writable   bool   `json:"writable"`
	Note       string `json:"note,omitempty"`
}

// cleanNote convierte las notas escritas en el código a una sola línea.
//
// Las notas se escriben como varias cadenas concatenadas: la primera suelta y las
// continuaciones con el prefijo `# `. Aquí el prefijo se cambia por un espacio.
// Si a una primera línea se le olvida terminar en salto de línea, el prefijo no
// se reconoce y el `#` se cuela a mitad de frase, así que la prueba
// `TestNotesHaveNoLeakedCommentMarkers` vigila el resultado de esta función.
func cleanNote(note string) string {
	return strings.TrimSpace(strings.ReplaceAll(note, "\n# ", " "))
}

// Report arma la lista para el onboarding, ordenada para que lo accionable salga
// primero: instalado y sin configurar, luego instalado y configurado, y al final
// lo que no parece estar en la máquina.
func Report(name string) []ProviderReport {
	providers := defaultProviders()
	out := make([]ProviderReport, 0, len(providers))

	for _, p := range providers {
		st := StatusOf(p, name)
		snippet, err := Build(p, WithDefaults(Options{Command: "saveme", Name: name, Path: st.Path}))
		out = append(out, ProviderReport{
			Key:        p.Key,
			Name:       p.Name,
			Path:       st.Path,
			Format:     string(p.Format),
			Installed:  st.Installed,
			Configured: st.Configured,
			Verified:   p.Verified,
			Writable:   err == nil && snippet.Writable,
			Note:       cleanNote(p.Note),
		})
	}

	sort.SliceStable(out, func(i, j int) bool { return rank(out[i]) < rank(out[j]) })
	return out
}

func rank(r ProviderReport) int {
	switch {
	case r.Installed && !r.Configured:
		return 0
	case r.Installed && r.Configured:
		return 1
	case !r.Installed && r.Key == "generic":
		return 2
	default:
		return 3
	}
}
