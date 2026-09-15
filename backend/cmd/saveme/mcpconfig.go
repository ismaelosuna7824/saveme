package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/ismaelosuna/saveme/backend/internal/config"
	"github.com/ismaelosuna/saveme/backend/internal/mcpconfig"
)

// --- mcp-config --------------------------------------------------------------

// runMCPConfig imprime (o aplica) la configuración del servidor MCP para el
// cliente que se le pida.
//
// El objetivo es que configurar el MCP en cualquier proveedor sea copiar un
// bloque o ejecutar un comando, sin tener que averiguar a mano la ruta del
// binario ni —lo que es más fácil de equivocar— la raíz del workspace.
func runMCPConfig(args []string) int {
	fs := flag.NewFlagSet("mcp-config", flag.ExitOnError)
	providerKey := fs.String("provider", "", "cliente: opencode, codex, claude-code, cursor, claude-desktop, windsurf, generic")
	write := fs.Bool("write", false, "aplicar la configuración al archivo del cliente (hace copia de seguridad)")
	path := fs.String("path", "", "ruta alternativa del archivo de configuración")
	root := fs.String("root", "", "raíz del workspace que debe usar el MCP (por defecto, la misma que la app)")
	name := fs.String("name", "saveme", "nombre con el que registrar el servidor")
	command := fs.String("command", "", "ejecutable a usar (por defecto, se averigua solo)")
	noEnv := fs.Bool("no-env", false, "no incluir variables de entorno en el bloque")
	list := fs.Bool("list", false, "listar los clientes soportados y su estado")
	remove := fs.Bool("remove", false, "quitar la configuración de SaveMe del cliente (hace copia de seguridad)")
	install := fs.Bool("install", false, "copiar este binario a la ruta estable que usan los clientes MCP")
	_ = fs.Parse(args)

	// Reinstalar el binario no necesita proveedor ni configuración: es la misma
	// operación que hace el botón de la app, y existe para poder arreglar una copia
	// desactualizada desde una terminal, sin abrir la interfaz.
	if *install {
		target, err := mcpconfig.SelfInstall()
		if err != nil {
			fmt.Fprintln(os.Stderr, "error:", err)
			return 1
		}
		fmt.Printf("binario instalado en %s\n", target)
		return 0
	}

	if *list || *providerKey == "" {
		return listProviders(*name)
	}

	provider, ok := mcpconfig.Find(*providerKey)
	if !ok {
		fmt.Fprintf(os.Stderr, "cliente desconocido: %q\n\n", *providerKey)
		listProviders(*name)
		return 2
	}

	opts, err := buildOptions(*command, *root, *name, *path, *noEnv)
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		return 1
	}

	// Quitar es la operación simétrica de escribir: no hace falta el bloque, solo
	// el archivo del cliente.
	if *remove {
		result, err := mcpconfig.Remove(provider, opts)
		if err != nil {
			fmt.Fprintln(os.Stderr, "error:", err)
			return 1
		}
		printWriteResult(result)
		if result.Action == mcpconfig.ActionManual {
			return 0
		}
		return 0
	}

	snippet, err := mcpconfig.Build(provider, opts)
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		return 1
	}

	if !*write {
		printSnippet(snippet)
		return 0
	}

	result, err := mcpconfig.Apply(provider, opts)
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		return 1
	}
	printWriteResult(result)
	if result.Action == mcpconfig.ActionManual {
		// Manual no es un fallo: es una decisión para no romper nada.
		return 0
	}
	return 0
}

func buildOptions(command, root, name, path string, noEnv bool) (mcpconfig.Options, error) {
	if command == "" {
		resolved, err := mcpconfig.ResolveCommand()
		if err != nil {
			return mcpconfig.Options{}, err
		}
		command = resolved
	}

	opts := mcpconfig.Options{Command: command, Name: name, Path: path}

	if noEnv {
		return opts, nil
	}

	// Las variables de entorno se emiten solo cuando hacen falta. Si la raíz es
	// la de por defecto, la app y el MCP coinciden solos y no hay nada que fijar;
	// añadirlas "por si acaso" solo crea una forma de que se desincronicen.
	env := map[string]string{}
	if root != "" {
		abs, err := filepath.Abs(root)
		if err != nil {
			return opts, fmt.Errorf("resolver la raíz %q: %w", root, err)
		}
		env["SAVEME_ROOT"] = abs
	} else if fromEnv := os.Getenv("SAVEME_ROOT"); fromEnv != "" {
		env["SAVEME_ROOT"] = fromEnv
	}
	if cfgPath := os.Getenv("SAVEME_CONFIG"); cfgPath != "" {
		env["SAVEME_CONFIG"] = cfgPath
	}
	if len(env) > 0 {
		opts.Env = env
	}
	return opts, nil
}

func printSnippet(s mcpconfig.Snippet) {
	fmt.Printf("\n\x1b[1m%s\x1b[0m\n", s.Provider.Name)
	if s.Path != "" {
		fmt.Printf("archivo: %s\n", s.Path)
	}
	if s.Provider.Note != "" {
		fmt.Printf("# %s\n", s.Provider.Note)
	}
	for _, w := range s.Warnings {
		fmt.Printf("\n\x1b[33maviso:\x1b[0m %s\n", w)
	}
	fmt.Printf("\n%s\n", strings.TrimRight(s.Body, "\n"))
	fmt.Printf("\n\x1b[2maplicar automáticamente: saveme mcp-config --provider %s --write\x1b[0m\n\n", s.Provider.Key)
}

func printWriteResult(r mcpconfig.WriteResult) {
	switch r.Action {
	case mcpconfig.ActionCreated:
		fmt.Printf("\x1b[32m✓\x1b[0m creado %s\n", r.Path)
	case mcpconfig.ActionMerged:
		fmt.Printf("\x1b[32m✓\x1b[0m añadido a %s (lo que había se conservó)\n", r.Path)
	case mcpconfig.ActionUpdated:
		fmt.Printf("\x1b[32m✓\x1b[0m actualizado en %s\n", r.Path)
	case mcpconfig.ActionPresent:
		fmt.Printf("\x1b[33m·\x1b[0m %s\n", r.Message)
	case mcpconfig.ActionRemoved:
		fmt.Printf("\x1b[32m✓\x1b[0m quitado de %s\n", r.Path)
		if r.Message != "" {
			fmt.Printf("  %s\n", r.Message)
		}
	case mcpconfig.ActionAbsent:
		fmt.Printf("\x1b[33m·\x1b[0m no había nada que quitar\n")
		if r.Path != "" {
			fmt.Printf("  archivo: %s\n", r.Path)
		}
		if r.Message != "" {
			fmt.Printf("  %s\n", r.Message)
		}
	case mcpconfig.ActionManual:
		fmt.Printf("\x1b[33m·\x1b[0m hay que aplicarlo a mano\n")
		if r.Path != "" {
			fmt.Printf("  archivo: %s\n", r.Path)
		}
		fmt.Printf("  %s\n", r.Message)
		if r.Command != "" {
			fmt.Printf("\n  %s\n", r.Command)
		}
	}
	if r.Backup != "" {
		fmt.Printf("\x1b[2mcopia de seguridad: %s\x1b[0m\n", r.Backup)
	}
	switch r.Action {
	case mcpconfig.ActionCreated, mcpconfig.ActionMerged, mcpconfig.ActionUpdated, mcpconfig.ActionRemoved:
		fmt.Println("\x1b[2mReinicia el cliente para que lo cargue.\x1b[0m")
	}
}

func listProviders(name string) int {
	fmt.Println("\nClientes MCP soportados:")
	fmt.Println()
	for _, p := range mcpconfig.Providers() {
		st := mcpconfig.StatusOf(p, name)
		mark := "\x1b[2m—\x1b[0m"
		switch {
		case !st.Exists:
			mark = "\x1b[2msin archivo\x1b[0m"
		case st.Configured:
			mark = "\x1b[32m✓ saveme configurado\x1b[0m"
		default:
			mark = "\x1b[33marchivo existe, sin saveme\x1b[0m"
		}
		path := st.Path
		if path == "" {
			path = "(se configura con un comando)"
		}
		fmt.Printf("  \x1b[1m%-16s\x1b[0m %s\n", p.Key, mark)
		fmt.Printf("  %-16s %s\n\n", "", path)
	}
	fmt.Println("Genera el bloque con:  saveme mcp-config --provider <clave>")
	fmt.Println("Aplícalo directo con:  saveme mcp-config --provider <clave> --write")
	fmt.Println("\nPara que funcione sin la app abierta no hay que hacer nada especial:")
	fmt.Println("el MCP es el mismo binario y habla directo con SQLite y los archivos.")
	return 0
}

// --- doctor ------------------------------------------------------------------

// runDoctor diagnostica la instalación.
//
// Es el comando que contesta "por qué no me funciona": casi siempre es que el
// MCP y la app resuelven raíces distintas, o que el binario no está en el PATH
// que ve el cliente.
func runDoctor(args []string) int {
	fs := flag.NewFlagSet("doctor", flag.ExitOnError)
	root := fs.String("root", "", "raíz a comprobar (por defecto, la efectiva)")
	_ = fs.Parse(args)

	problems := 0
	head := func(s string) { fmt.Printf("\n\x1b[1m%s\x1b[0m\n", s) }
	ok := func(format string, a ...any) { fmt.Printf("  \x1b[32m✓\x1b[0m "+format+"\n", a...) }
	warn := func(format string, a ...any) {
		fmt.Printf("  \x1b[33m!\x1b[0m "+format+"\n", a...)
	}
	bad := func(format string, a ...any) {
		fmt.Printf("  \x1b[31m✗\x1b[0m "+format+"\n", a...)
		problems++
	}

	fmt.Printf("\nSaveMe doctor — %s\n", version)

	// --- binario ---
	head("Binario")
	if exe, err := os.Executable(); err == nil {
		fmt.Printf("  ruta: %s\n", exe)
	}
	if mcpconfig.LooksInstalled() {
		ok("está en el PATH como `saveme`, así que los clientes MCP pueden lanzarlo por nombre")
	} else {
		warn("no está en el PATH como `saveme`; los clientes MCP necesitarán la ruta absoluta")
		fmt.Println("     instálalo con:  make install        (o copia el binario a ~/.local/bin)")
	}

	// La copia instalada es la que lanzan los clientes MCP, y el actualizador de la
	// app **no la toca**: reemplaza el binario de dentro del bundle. Si se quedan en
	// versiones distintas, la app y el MCP dejan de ser el mismo programa sin dar
	// ningún síntoma. Se compara la copia con **este** binario, así que ejecutado
	// desde la copia misma la comprobación sale bien por definición: lo que detecta
	// es el caso de correrlo desde el bundle de la app.
	if path, err := mcpconfig.InstallPath(); err == nil {
		if _, statErr := os.Stat(path); statErr == nil {
			switch installed, err := mcpconfig.VersionOf(path); {
			case err != nil:
				warn("no pude leer la versión de la copia instalada (%s)", path)
				fmt.Printf("     %v\n", err)
			case installed != version:
				warn("la copia instalada es la %s y este binario es la %s", installed, version)
				fmt.Println("     los clientes MCP siguen lanzando la vieja; actualízala con:")
				fmt.Println("       saveme mcp-config --install     (o desde la app: Ajustes → Agentes)")
			default:
				ok("la copia instalada es la misma versión (%s)", installed)
			}
		}
	}

	// --- configuración y raíz ---
	head("Workspace")
	cfg, err := config.Load()
	if err != nil {
		bad("no pude leer la configuración: %v", err)
	} else {
		fmt.Printf("  archivo de configuración: %s\n", cfg.Path)
		if cfg.RootFromEnv {
			warn("la raíz viene de SAVEME_ROOT=%s", cfg.RootDir)
			fmt.Println("     si configuras el MCP sin esa variable, escribirá en otro sitio")
		} else {
			ok("la raíz viene de la configuración (app y MCP coinciden solos)")
		}
	}

	effective := cfg.RootDir
	if *root != "" {
		if abs, err := filepath.Abs(*root); err == nil {
			effective = abs
		}
	}
	fmt.Printf("  raíz efectiva: %s\n", effective)

	if err := os.MkdirAll(effective, 0o755); err != nil {
		bad("no puedo crear la raíz: %v", err)
	} else if probe, err := os.CreateTemp(filepath.Join(effective, ".saveme"), ".probe-*"); err != nil {
		bad("la raíz no es escribible: %v", err)
	} else {
		name := probe.Name()
		probe.Close()
		os.Remove(name)
		ok("la raíz existe y es escribible")
	}

	dbPath := filepath.Join(effective, ".saveme", "saveme.db")
	if _, err := os.Stat(dbPath); err == nil {
		ok("índice: %s", dbPath)
	} else {
		warn("todavía no hay índice en %s (se crea al primer uso)", dbPath)
	}

	// --- daemon ---
	head("Aplicación")
	daemonPath := filepath.Join(effective, ".saveme", "daemon.json")
	if data, err := os.ReadFile(daemonPath); err == nil {
		var info struct {
			Port      int    `json:"port"`
			PID       int    `json:"pid"`
			Watch     bool   `json:"watching"`
			StartedAt string `json:"started_at"`
		}
		if json.Unmarshal(data, &info) == nil {
			conn, err := net.DialTimeout("tcp",
				fmt.Sprintf("127.0.0.1:%d", info.Port), 500*time.Millisecond)
			if err == nil {
				conn.Close()
				ok("el daemon está escuchando en el puerto %d (pid %d)", info.Port, info.PID)
				if !info.Watch {
					warn("arrancó con --no-watch: no verá los archivos que escriba un agente")
				}
			} else {
				warn("hay un daemon.json del puerto %d pero nadie responde (¿app cerrada?)", info.Port)
				fmt.Println("     no pasa nada: el MCP funciona igual, escribe directo al disco")
			}
		}
	} else {
		warn("la app no está corriendo")
		fmt.Println("     no pasa nada: el MCP funciona igual. Al abrir la app, reconciliará los archivos.")
	}

	// --- clientes MCP ---
	head("Clientes MCP")
	providers := mcpconfig.Providers()
	sort.Slice(providers, func(i, j int) bool { return providers[i].Key < providers[j].Key })
	anyConfigured := false
	for _, p := range providers {
		if p.Key == "generic" {
			continue
		}
		st := mcpconfig.StatusOf(p, "saveme")
		switch {
		case st.Configured:
			ok("%-16s configurado (%s)", p.Key, st.Path)
			anyConfigured = true
		case st.Exists:
			fmt.Printf("  \x1b[2m·\x1b[0m %-16s sin saveme (%s)\n", p.Key, st.Path)
		default:
			fmt.Printf("  \x1b[2m·\x1b[0m %-16s sin archivo de configuración\n", p.Key)
		}
	}
	if !anyConfigured {
		warn("ningún cliente tiene a SaveMe configurado todavía")
		fmt.Println("     genera el bloque con:  saveme mcp-config --provider opencode --write")
	}

	// --- veredicto ---
	fmt.Println()
	if problems == 0 {
		fmt.Println("\x1b[32mTodo en orden.\x1b[0m")
		fmt.Println("Pídele a tu agente: «guarda un resumen en SaveMe de lo último que hicimos».")
		return 0
	}
	fmt.Printf("\x1b[31m%d problema(s) que hay que resolver.\x1b[0m\n", problems)
	return 1
}
