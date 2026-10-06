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
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"
)

// Format es cómo se escribe la configuración de cada cliente.
type Format string

const (
	// FormatJSON: un archivo JSON con una clave que agrupa los servidores.
	FormatJSON Format = "json"
	// FormatTOML: un archivo TOML con una sección por servidor (Codex).
	FormatTOML Format = "toml"
	// FormatCLI: se configura con un comando, no editando un archivo (Claude
	// Code, Hermes).
	FormatCLI Format = "cli"
	// FormatManual: no se escribe solo, porque el formato no está confirmado o
	// porque el archivo exige fusionar a mano (el YAML de DeepSeek Harness). Se le
	// da al usuario el bloque y su ruta para que lo coloque él.
	FormatManual Format = "manual"
	// FormatDelegated: el cliente no tiene configuración de MCP propia; lanza
	// otros agentes (Orca, T3 Code…) y cada uno carga la suya. Configurarlo es
	// configurar esos.
	FormatDelegated Format = "delegated"
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
	// ServersKey es la clave o sección que agrupa los servidores. Es literal:
	// Amp usa `amp.mcpServers`, con el punto dentro de la clave.
	ServersKey string
	// ServersParent, si no está vacío, es la clave de primer nivel que contiene a
	// ServersKey. Z Code guarda los servidores en `mcp` → `servers`.
	ServersParent string
	// EntryType, si no está vacío, se emite como `"type"` en la entrada.
	// OpenCode y Kilo quieren "local"; VS Code y Copilot, "stdio".
	EntryType string
	// Enabled emite `"enabled": true` en la entrada (OpenCode, Kilo).
	Enabled bool
	// Style indica dónde van los argumentos.
	Style CommandStyle
	// EnvKey es el nombre de la clave de variables de entorno, si la tiene.
	EnvKey string
	// CLIAdd arma el comando de alta de un cliente FormatCLI, entorno incluido.
	CLIAdd func(opts Options) []string
	// CLIRemove arma el comando de baja simétrico.
	CLIRemove func(opts Options) []string
	// CLINoEnv indica que el comando de alta no admite variables de entorno: si
	// hacen falta, el usuario tiene que añadirlas a mano y se le avisa.
	CLINoEnv bool
	// Render sustituye el bloque JSON estándar de la vía manual cuando el cliente
	// usa otro formato. RenderLanguage es su lenguaje, para el resaltado.
	Render         func(opts Options) string
	RenderLanguage string
	// Via son las claves de los clientes cuya configuración usa un cliente
	// FormatDelegated.
	Via []string
	// DetectDirs son directorios cuya existencia indica que el cliente está
	// instalado (también sirven los `.app` de macOS, que son directorios).
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

// under devuelve una ruta dentro de la carpeta que fija la variable de entorno
// envVar o, si no está, dentro de la carpeta por defecto. Varios clientes dejan
// mover su carpeta así (COPILOT_HOME, HERMES_HOME, DSH_HOME…), y escribir en la
// de por defecto cuando el usuario la movió sería escribir donde nadie lee.
func under(envVar string, base func() string, parts ...string) func() string {
	return func() string {
		dir := strings.TrimSpace(os.Getenv(envVar))
		if dir == "" {
			dir = base()
		}
		if dir == "" {
			return ""
		}
		return filepath.Join(append([]string{dir}, parts...)...)
	}
}

// firstExisting devuelve el primer candidato que existe y, si no existe
// ninguno, el último. Sirve para clientes que aceptan `.jsonc` y `.json`: si el
// usuario ya tiene uno, es ese el que hay que tocar; si no tiene ninguno, se crea
// el que crea el propio cliente.
func firstExisting(candidates ...func() string) func() string {
	return func() string {
		last := ""
		for _, candidate := range candidates {
			last = candidate()
			if last == "" {
				continue
			}
			if _, err := os.Stat(last); err == nil {
				return last
			}
		}
		return last
	}
}

// macApp devuelve la ruta de una aplicación de macOS, o "" en otros sistemas.
func macApp(name string) func() string {
	return func() string {
		if runtime.GOOS != "darwin" {
			return ""
		}
		return filepath.Join("/Applications", name)
	}
}

// hermesHome es la carpeta de Hermes: `%LOCALAPPDATA%\hermes` en Windows y
// `~/.hermes` en el resto.
func hermesHome() string {
	if runtime.GOOS == "windows" {
		if dir := os.Getenv("LOCALAPPDATA"); dir != "" {
			return filepath.Join(dir, "hermes")
		}
	}
	return home(".hermes")()
}

// devinHome es la carpeta de configuración de Devin: `%APPDATA%\devin` en
// Windows y `~/.config/devin` en el resto (también en macOS, que aquí no usa
// Library/Application Support).
func devinHome() string {
	if runtime.GOOS == "windows" {
		return configDir("devin")()
	}
	return home(".config", "devin")()
}

// mcpServersJSON es la forma más común: un JSON con `mcpServers` y entradas
// `command` + `args` + `env`. La comparten Claude Desktop, Cursor, Gemini CLI,
// Qwen, Kiro, omp, pi, Antigravity, Kimi Code, Devin y otros.
func mcpServersJSON(p Provider) Provider {
	p.Format = FormatJSON
	if p.ServersKey == "" {
		p.ServersKey = "mcpServers"
	}
	p.Style = CommandSplit
	if p.EnvKey == "" {
		p.EnvKey = "env"
	}
	return p
}

// delegated arma un cliente sin configuración de MCP propia: lanza los agentes
// de `via` y cada uno carga la suya.
func delegated(p Provider, via ...string) Provider {
	p.Format = FormatDelegated
	p.Via = via
	p.Verified = true
	return p
}

// Las rutas y formatos de esta tabla salen de la documentación oficial de cada
// cliente o de su código fuente (revisados en octubre de 2026). Los que siguen
// con `Verified: false` son los que no se han podido confirmar.
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
			Enabled:    true,
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
			// Las opciones van antes del nombre: lo que sigue a `--` se le pasa
			// tal cual al servidor, así que un `--env` puesto detrás acabaría como
			// argumento de `saveme mcp` y el entorno no se fijaría.
			CLIAdd: func(opts Options) []string {
				argv := []string{"claude", "mcp", "add", "--scope", "user"}
				for _, k := range sortedKeys(opts.Env) {
					argv = append(argv, "--env", k+"="+opts.Env[k])
				}
				argv = append(argv, opts.Name, "--", opts.Command)
				return append(argv, opts.Args...)
			},
			CLIRemove: func(opts Options) []string {
				return []string{"claude", "mcp", "remove", "--scope", "user", opts.Name}
			},
			Verified: true,
			Note: "Claude Code tiene tres ámbitos: local (solo este proyecto), project (se\n" +
				"# comparte por git) y user (todos tus proyectos). Para que funcione en\n" +
				"# cualquier proyecto, este último es el que quieres. Se configura con su\n" +
				"# propio comando, no editando ~/.claude.json, que es su archivo de estado.",
		},
		mcpServersJSON(Provider{
			Key:        "claude-desktop",
			Name:       "Claude Desktop",
			Path:       configDir("Claude", "claude_desktop_config.json"),
			DetectDirs: []func() string{configDir("Claude")},
			Verified:   true,
		}),
		mcpServersJSON(Provider{
			Key:        "cursor",
			Name:       "Cursor",
			Path:       home(".cursor", "mcp.json"),
			DetectDirs: []func() string{home(".cursor")},
			DetectBins: []string{"cursor"},
			Verified:   true,
		}),
		{
			Key:        "copilot",
			Name:       "GitHub Copilot (CLI y VS Code)",
			Format:     FormatJSON,
			Path:       under("COPILOT_HOME", home(".copilot"), "mcp-config.json"),
			DetectDirs: []func() string{home(".copilot")},
			DetectBins: []string{"copilot"},
			ServersKey: "mcpServers",
			EntryType:  "stdio",
			Style:      CommandSplit,
			EnvKey:     "env",
			Verified:   true,
			Note: "Lo leen GitHub Copilot CLI y VS Code: es el destino «Copilot Global» que\n" +
				"# VS Code recomienda. Si defines COPILOT_HOME, el archivo va en esa carpeta.",
		},
		{
			Key:        "vscode-copilot",
			Name:       "VS Code (perfil de usuario)",
			Format:     FormatJSON,
			Path:       configDir("Code", "User", "mcp.json"),
			DetectDirs: []func() string{configDir("Code", "User")},
			DetectBins: []string{"code"},
			// VS Code es el raro: la clave es `servers` y cada entrada lleva
			// `type: "stdio"`.
			ServersKey: "servers",
			EntryType:  "stdio",
			Style:      CommandSplit,
			EnvKey:     "env",
			Verified:   false,
			Note: "VS Code usa `servers` en vez de `mcpServers` y exige `type: \"stdio\"`. VS Code\n" +
				"# ya marca este destino como antiguo y recomienda el de GitHub Copilot\n" +
				"# (~/.copilot/mcp-config.json): usa ese si puedes.",
		},
		mcpServersJSON(Provider{
			Key:        "gemini-cli",
			Name:       "Gemini CLI",
			Path:       home(".gemini", "settings.json"),
			DetectDirs: []func() string{home(".gemini")},
			DetectBins: []string{"gemini"},
			Verified:   true,
		}),
		mcpServersJSON(Provider{
			Key:  "antigravity",
			Name: "Antigravity (app, IDE y CLI)",
			Path: home(".gemini", "config", "mcp_config.json"),
			DetectDirs: []func() string{
				home(".gemini", "antigravity-cli"),
				home(".gemini", "antigravity"),
				macApp("Antigravity.app"),
				macApp("Antigravity IDE.app"),
			},
			DetectBins: []string{"agy"},
			Verified:   true,
			Note:       "Un solo archivo para Antigravity, Antigravity IDE y su CLI (`agy`).",
		}),
		mcpServersJSON(Provider{
			Key:        "qwen",
			Name:       "Qwen Code",
			Path:       home(".qwen", "settings.json"),
			DetectDirs: []func() string{home(".qwen")},
			DetectBins: []string{"qwen"},
			Verified:   true,
		}),
		mcpServersJSON(Provider{
			Key:        "kiro",
			Name:       "Kiro",
			Path:       home(".kiro", "settings", "mcp.json"),
			DetectDirs: []func() string{home(".kiro")},
			DetectBins: []string{"kiro", "kiro-cli"},
			Verified:   true,
		}),
		mcpServersJSON(Provider{
			Key:        "omp",
			Name:       "omp",
			Path:       home(".omp", "agent", "mcp.json"),
			DetectDirs: []func() string{home(".omp")},
			DetectBins: []string{"omp"},
			Verified:   true,
			Note: "omp también lee la configuración de Claude Code, Codex, Gemini CLI, OpenCode\n" +
				"# y Cursor. Si SaveMe ya está en alguno no sale repetido: gana este archivo.",
		}),
		mcpServersJSON(Provider{
			Key:        "pi",
			Name:       "pi",
			Path:       home(".pi", "agent", "mcp.json"),
			DetectDirs: []func() string{home(".pi", "agent")},
			DetectBins: []string{"pi"},
			Verified:   true,
			Note: "El MCP viene integrado en pi desde la 0.99. Si usas una extensión que\n" +
				"# registra /mcp (como pi-mcp-adapter), esa sustituye a la integrada y este\n" +
				"# archivo no se lee.",
		}),
		{
			Key:    "kilocode",
			Name:   "Kilo Code (CLI y extensiones)",
			Format: FormatJSON,
			// La CLI escribe en el primero que exista de estos y crea kilo.json si
			// no hay ninguno; se hace lo mismo.
			Path: firstExisting(
				under("KILO_CONFIG_DIR", home(".config", "kilo"), "kilo.jsonc"),
				under("KILO_CONFIG_DIR", home(".config", "kilo"), "kilo.json"),
			),
			DetectDirs: []func() string{home(".config", "kilo"), home(".kilocode")},
			DetectBins: []string{"kilo"},
			ServersKey: "mcp",
			EntryType:  "local",
			Enabled:    true,
			Style:      CommandArray,
			EnvKey:     "environment",
			Verified:   true,
			Note: "La CLI y las extensiones de VS Code y JetBrains comparten este archivo. Como\n" +
				"# en OpenCode, los argumentos van dentro de `command` y el entorno en\n" +
				"# `environment`. Si el archivo tiene comentarios, se te da el bloque para pegar.",
		},
		{
			Key:  "amp",
			Name: "Amp",
			Path: firstExisting(
				home(".config", "amp", "settings.jsonc"),
				home(".config", "amp", "settings.json"),
			),
			Format:     FormatJSON,
			DetectDirs: []func() string{home(".config", "amp")},
			DetectBins: []string{"amp"},
			ServersKey: "amp.mcpServers",
			Style:      CommandSplit,
			EnvKey:     "env",
			Verified:   true,
			Note: "Amp usa la clave `amp.mcpServers` tal cual, con el punto dentro. Si tu\n" +
				"# archivo tiene comentarios, se te da el bloque para pegar.",
		},
		{
			Key:           "zcode",
			Name:          "Z Code",
			Format:        FormatJSON,
			Path:          home(".zcode", "cli", "config.json"),
			DetectDirs:    []func() string{home(".zcode"), macApp("ZCode.app")},
			ServersParent: "mcp",
			ServersKey:    "servers",
			Style:         CommandSplit,
			EnvKey:        "env",
			Verified:      true,
			Note: "Los servidores van dentro de `mcp.servers`. Si este archivo tiene alguno,\n" +
				"# Z Code deja de leer ~/.agents/mcp.json.",
		},
		mcpServersJSON(Provider{
			Key:        "kimi-code",
			Name:       "Kimi Code",
			Path:       under("KIMI_CODE_HOME", home(".kimi-code"), "mcp.json"),
			DetectDirs: []func() string{home(".kimi-code")},
			Verified:   true,
			Note: "Es el archivo de Kimi Code CLI. El Kimi CLI antiguo (~/.kimi) está archivado;\n" +
				"# `kimi migrate` pasa su configuración a este.",
		}),
		mcpServersJSON(Provider{
			Key:        "devin",
			Name:       "Devin (CLI y Desktop)",
			Path:       func() string { return filepath.Join(devinHome(), "mcp_config.json") },
			DetectDirs: []func() string{devinHome, macApp("Devin.app")},
			DetectBins: []string{"devin"},
			Verified:   true,
			Note: "Lo comparten Devin CLI y Devin Desktop (antes Windsurf). Devin en la nube no\n" +
				"# puede lanzar un programa de tu equipo, así que ahí no aplica.",
		}),
		mcpServersJSON(Provider{
			Key:        "windsurf",
			Name:       "Windsurf (versiones antiguas)",
			Path:       home(".codeium", "windsurf", "mcp_config.json"),
			DetectDirs: []func() string{home(".codeium", "windsurf"), macApp("Windsurf.app")},
			DetectBins: []string{"windsurf"},
			Verified:   false,
			Note: "Windsurf ahora es Devin Desktop, que lee la configuración de «Devin (CLI y\n" +
				"# Desktop)». Esta ruta solo sirve en instalaciones antiguas; Devin la sigue\n" +
				"# importando, así que no estorba.",
		}),
		{
			Key:        "hermes",
			Name:       "Hermes Agent",
			Format:     FormatCLI,
			Path:       under("HERMES_HOME", hermesHome, "config.yaml"),
			DetectDirs: []func() string{hermesHome, macApp("Hermes.app")},
			DetectBins: []string{"hermes"},
			ServersKey: "mcp_servers",
			EnvKey:     "env",
			// `--args` tiene que ir el último: se traga todo lo que viene detrás.
			CLIAdd: func(opts Options) []string {
				argv := []string{"hermes", "mcp", "add", opts.Name, "--command", opts.Command, "--args"}
				return append(argv, opts.Args...)
			},
			CLIRemove: func(opts Options) []string {
				return []string{"hermes", "mcp", "remove", opts.Name}
			},
			CLINoEnv: true,
			Verified: true,
			Note: "Hermes guarda su configuración en YAML y se configura con su propio comando.\n" +
				"# El comando no admite variables de entorno: si hace falta alguna, añádela a\n" +
				"# mano en mcp_servers.saveme.env de ~/.hermes/config.yaml.",
		},
		{
			Key:            "deepseek",
			Name:           "DeepSeek Harness",
			Format:         FormatManual,
			Path:           under("DSH_HOME", home(".dsh"), "cordis.patch.yml"),
			DetectDirs:     []func() string{home(".dsh")},
			DetectBins:     []string{"dsh"},
			ServersKey:     "mcpServers",
			Render:         renderDeepSeek,
			RenderLanguage: "yaml",
			Verified:       true,
			Note: "DeepSeek Harness registra cada servidor como una fila de su plugin MCP en\n" +
				"# cordis.patch.yml. No se escribe solo: ese archivo puede tener otras\n" +
				"# personalizaciones y la fila hay que fusionarla, no sustituir el archivo.",
		},
		delegated(Provider{
			Key:        "orca",
			Name:       "Orca",
			DetectDirs: []func() string{home(".orca"), macApp("Orca.app")},
			DetectBins: []string{"orca", "orca-ide"},
			Note: "Orca lanza otros agentes y cada uno carga su propia configuración de MCP:\n" +
				"# configura SaveMe en los que uses dentro de Orca.",
		}, "claude-code", "codex", "opencode", "gemini-cli", "cursor", "pi", "omp"),
		delegated(Provider{
			Key:        "monocode",
			Name:       "Mono",
			DetectDirs: []func() string{macApp("MonoCode.app")},
			Note: "Mono lanza otros agentes y cada uno carga su propia configuración de MCP:\n" +
				"# configura SaveMe en los que uses dentro de Mono.",
		}, "claude-code", "codex", "opencode", "cursor", "pi", "omp", "hermes", "antigravity"),
		delegated(Provider{
			Key:        "t3code",
			Name:       "T3 Code",
			DetectDirs: []func() string{macApp("T3 Code.app")},
			DetectBins: []string{"t3"},
			Note: "T3 Code usa la configuración de los agentes que controla (Codex, Claude\n" +
				"# Code…): configura SaveMe en esos.",
		}, "codex", "claude-code", "cursor", "opencode", "antigravity"),
		delegated(Provider{
			Key:        "omnigent",
			Name:       "Omnigent",
			DetectDirs: []func() string{home(".omnigent")},
			DetectBins: []string{"omni", "omnigent"},
			Note: "Omnigent no tiene un registro global de MCP: los servidores se declaran por\n" +
				"# agente en su YAML (`tools:` con `type: mcp`). Los agentes que envuelve\n" +
				"# cargan su propia configuración, así que basta con configurar esos.",
		}, "claude-code", "codex", "opencode", "copilot"),
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

// renderDeepSeek arma la fila del plugin MCP de DeepSeek Harness.
//
// Los valores van en JSON, que también es YAML válido: así una ruta con espacios
// o dos puntos no rompe el archivo, y no hace falta una librería de YAML para
// escribir cinco líneas. `serverName` tiene que casar con [A-Za-z0-9_-]{1,32},
// que el nombre por defecto cumple.
func renderDeepSeek(opts Options) string {
	var b strings.Builder
	b.WriteString("- insert:\n")
	fmt.Fprintf(&b, "    - id: mcp-%s\n", opts.Name)
	b.WriteString("      name: '@deepseek-ai/dsh-mcp-client'\n")
	b.WriteString("      config:\n")
	fmt.Fprintf(&b, "        serverName: %s\n", jsonInline(opts.Name))
	b.WriteString("        transport: stdio\n")
	fmt.Fprintf(&b, "        command: %s\n", jsonInline(opts.Command))
	fmt.Fprintf(&b, "        args: %s\n", jsonInline(opts.Args))
	env := opts.Env
	if env == nil {
		env = map[string]string{}
	}
	fmt.Fprintf(&b, "        env: %s\n", jsonInline(env))
	return b.String()
}

// jsonInline serializa un valor en una línea. Con tipos simples no puede fallar.
func jsonInline(v any) string {
	raw, _ := json.Marshal(v)
	return string(raw)
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
	if p.Format == FormatCLI && p.CLINoEnv && len(opts.Env) > 0 {
		s.Warnings = append(s.Warnings, fmt.Sprintf(
			"El comando de %s no admite variables de entorno. Añade a mano %s en la "+
				"entrada «%s» de su configuración.", p.Name, strings.Join(sortedKeys(opts.Env), ", "), opts.Name))
	}

	switch p.Format {
	case FormatCLI:
		if p.CLIAdd == nil {
			return Snippet{}, fmt.Errorf("%s se configura por comando, pero no tiene comando de alta", p.Key)
		}
		s.Body = shellJoin(p.CLIAdd(opts))
		s.Language = "sh"
	case FormatTOML:
		s.Writable = true
		s.Body = buildTOML(p, opts)
	case FormatJSON:
		s.Writable = true
		s.Body = buildJSON(p, opts)
	case FormatManual:
		s.Body = buildManual(p, opts)
		if p.Render != nil {
			s.Language = p.RenderLanguage
		}
	case FormatDelegated:
		s.Body = delegatedMessage(p)
		s.Language = "text"
	default:
		return Snippet{}, fmt.Errorf("formato desconocido: %q", p.Format)
	}
	return s, nil
}

// delegatedMessage explica qué hay que configurar en lugar de un cliente que no
// tiene configuración de MCP propia.
func delegatedMessage(p Provider) string {
	names := make([]string, 0, len(p.Via))
	for _, key := range p.Via {
		if via, ok := Find(key); ok {
			names = append(names, via.Name)
		}
	}
	return fmt.Sprintf("%s no tiene configuración de MCP propia: lanza otros agentes y cada uno "+
		"carga la suya.\nConfigura SaveMe en los que uses con %s: %s.",
		p.Name, p.Name, strings.Join(names, ", "))
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
	if p.EnvKey != "" && len(opts.Env) > 0 {
		env := map[string]any{}
		for k, v := range opts.Env {
			env[k] = v
		}
		entry[p.EnvKey] = env
	}
	if p.Enabled {
		entry["enabled"] = true
	}
	return entry
}

// serversLabel nombra la clave de los servidores tal como la verá el usuario en
// su archivo: `mcpServers`, o `mcp.servers` cuando va anidada.
func serversLabel(p Provider) string {
	if p.ServersParent == "" {
		return p.ServersKey
	}
	return p.ServersParent + "." + p.ServersKey
}

// serversHolder devuelve el objeto que contiene la clave de servidores: el
// documento entero o, si va anidada, su clave padre. Con create, crea el padre si
// no existe; sin él, devuelve nil.
func serversHolder(p Provider, root map[string]any, create bool) map[string]any {
	if p.ServersParent == "" {
		return root
	}
	parent, _ := root[p.ServersParent].(map[string]any)
	if parent == nil && create {
		parent = map[string]any{}
		root[p.ServersParent] = parent
	}
	return parent
}

func buildJSON(p Provider, opts Options) string {
	doc := map[string]any{}
	serversHolder(p, doc, true)[p.ServersKey] = map[string]any{
		opts.Name: serverEntry(p, opts),
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

// shellJoin junta un comando en una línea que se puede pegar en la terminal.
func shellJoin(argv []string) string {
	quoted := make([]string, len(argv))
	for i, part := range argv {
		quoted[i] = shellQuote(part)
	}
	return strings.Join(quoted, " ")
}

// buildManual da el bloque para los clientes que no se escriben solos, con su
// ruta habitual como pista: el formato propio del cliente si lo tiene (Render),
// o el bloque `mcpServers` estándar.
func buildManual(p Provider, opts Options) string {
	var b strings.Builder
	if p.Path != nil {
		if path := p.Path(); path != "" {
			fmt.Fprintf(&b, "# archivo habitual de este cliente: %s\n", path)
		}
	}
	if p.Render != nil {
		b.WriteString(p.Render(opts))
		return b.String()
	}

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
	b.WriteString(renderJSON(map[string]any{p.ServersKey: map[string]any{opts.Name: entry}}))
	return b.String()
}

// CustomDef describe un cliente que SaveMe no conoce, con los datos que da el
// usuario: dónde está su archivo y qué forma tiene la entrada.
type CustomDef struct {
	// Path es el archivo de configuración. Obligatorio y absoluto (se admite `~`).
	Path string `json:"path"`
	// ServersKey es la clave que agrupa los servidores. Por defecto `mcpServers`.
	ServersKey string `json:"servers_key,omitempty"`
	// EntryType, si no está vacío, se emite como `type` (`stdio`, `local`…).
	EntryType string `json:"entry_type,omitempty"`
	// CommandArray pone el ejecutable y sus argumentos juntos en `command`, como
	// OpenCode, en vez de `command` + `args`.
	CommandArray bool `json:"command_array,omitempty"`
	// EnvKey es la clave del entorno. Por defecto `env`.
	EnvKey string `json:"env_key,omitempty"`
}

// Custom arma un proveedor a partir de lo que describe el usuario.
//
// Es la vía para los clientes que no están en la tabla: no hace falta esperar a
// una versión nueva de SaveMe para escribir en ellos. El formato se deduce de la
// extensión —`.toml` es TOML; cualquier otra cosa, JSON— y se escribe con las
// mismas garantías que los conocidos: copia de seguridad, no se pisa un JSONC y
// no se toca nada si ya estaba igual.
func Custom(def CustomDef) (Provider, error) {
	path := strings.TrimSpace(def.Path)
	if path == "" {
		return Provider{}, errors.New("falta el archivo de configuración del cliente")
	}
	if path == "~" || strings.HasPrefix(path, "~/") {
		base, err := os.UserHomeDir()
		if err != nil {
			return Provider{}, fmt.Errorf("no pude resolver ~: %w", err)
		}
		path = filepath.Join(base, strings.TrimPrefix(path, "~"))
	}
	if !filepath.IsAbs(path) {
		return Provider{}, fmt.Errorf("la ruta tiene que ser absoluta: %s", def.Path)
	}
	path = filepath.Clean(path)

	serversKey := strings.TrimSpace(def.ServersKey)
	if serversKey == "" {
		serversKey = "mcpServers"
	}
	envKey := strings.TrimSpace(def.EnvKey)
	if envKey == "" {
		envKey = "env"
	}

	p := Provider{
		Key:        "custom",
		Name:       "Personalizado",
		Format:     FormatJSON,
		Path:       func() string { return path },
		ServersKey: serversKey,
		EntryType:  strings.TrimSpace(def.EntryType),
		Style:      CommandSplit,
		EnvKey:     envKey,
		// Lo describe el usuario: no hay convención de nadie que confirmar.
		Verified: true,
	}
	if def.CommandArray {
		p.Style = CommandArray
	}
	if strings.EqualFold(filepath.Ext(path), ".toml") {
		if def.CommandArray {
			return Provider{}, errors.New("en TOML solo se admite `command` + `args`")
		}
		p.Format = FormatTOML
	}
	return p, nil
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

// SyncResult cuenta qué pasó al poner al día la copia instalada.
type SyncResult struct {
	Path string
	// Replaced indica que había copia, estaba en otra versión, y se reemplazó.
	Replaced bool
	// Before es la versión que tenía la copia; vacía si no se pudo leer.
	Before string
}

// SyncInstalled deja la copia instalada en la misma versión que este binario.
//
// Existe porque el actualizador reemplaza el binario de dentro de la app y **no
// esta copia**, que es la que lanzan los clientes MCP: sin esto, tras cada
// actualización los agentes seguirían usando las herramientas viejas contra una
// app nueva, y el producto promete justo lo contrario —que la app y el MCP son el
// mismo programa—. Dejar ese arreglo en un botón es trasladarle al usuario un
// problema que el programa sabe resolver solo.
//
// **No instala si no había copia.** Que el MCP esté instalado o no es una decisión
// del usuario y tiene su sitio en el onboarding; esto solo evita dejar
// desactualizado algo que ya existe.
//
// Un error aquí no puede tumbar un arranque: en Windows no se puede reemplazar un
// ejecutable en marcha, y eso es una situación normal —un cliente MCP abierto—,
// no una avería. Quien llame decide qué hacer con el aviso.
func SyncInstalled(currentVersion string) (SyncResult, error) {
	target, err := InstallPath()
	if err != nil {
		return SyncResult{}, err
	}

	if _, statErr := os.Stat(target); statErr != nil {
		// No hay copia: crearla no es asunto nuestro.
		return SyncResult{Path: target}, nil
	}

	// Si no se deja preguntar —truncada, sin permiso de ejecución— se trata como
	// «no está al día»: reemplazarla es exactamente lo que la arregla.
	installed, err := VersionOf(target)
	if err != nil {
		installed = ""
	}
	if installed == currentVersion {
		return SyncResult{Path: target, Before: installed}, nil
	}

	if _, err := SelfInstall(); err != nil {
		return SyncResult{Path: target, Before: installed}, err
	}
	return SyncResult{Path: target, Replaced: true, Before: installed}, nil
}

// VersionOf le pregunta a un binario de SaveMe qué versión dice ser.
//
// Se ejecuta en vez de dejar un fichero con la versión al instalar. La diferencia
// importa: lo que hay que saber es qué hará el cliente MCP cuando lo lance, y la
// copia instalada puede haber sido reemplazada por fuera —a mano, por un gestor de
// paquetes, por una versión antigua restaurada—. Un fichero de versión diría lo
// que se instaló, no lo que hay.
//
// El plazo es corto a propósito: esto se ejecuta mientras alguien mira Ajustes, y
// un binario que no responde no puede dejar la pantalla colgada.
func VersionOf(path string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	out, err := exec.CommandContext(ctx, path, "version").Output()
	if err != nil {
		return "", fmt.Errorf("no pude preguntarle la versión a %s: %w", path, err)
	}

	// El formato es «saveme 0.1.0»: se toma el último campo para no depender de
	// cómo se llame el binario.
	fields := strings.Fields(string(out))
	if len(fields) == 0 {
		return "", fmt.Errorf("%s no dijo ninguna versión", path)
	}
	return fields[len(fields)-1], nil
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
	// Un cliente que delega cuenta como configurado si lo está alguno de los
	// agentes que lanza: es ahí donde vive la entrada que va a usar.
	if p.Format == FormatDelegated {
		for _, key := range p.Via {
			if via, ok := Find(key); ok && StatusOf(via, name).Configured {
				st.Configured = true
				break
			}
		}
	}
	return st
}

// containsServer busca el nombre del servidor en un archivo de configuración.
//
// Es textual a propósito: parsear la configuración de cada cliente exigiría
// replicar sus reglas de fusión (OpenCode, por ejemplo, combina varios archivos),
// y para un diagnóstico basta con saber si el nombre aparece. Cubre JSON
// (`"saveme"`), TOML (`[mcp_servers.saveme]`) y YAML (`saveme:`).
func containsServer(data []byte, name string) bool {
	text := string(data)
	return strings.Contains(text, `"`+name+`"`) ||
		strings.Contains(text, "."+name+"]") ||
		strings.Contains(text, name+" ") ||
		strings.Contains(text, name+":")
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
