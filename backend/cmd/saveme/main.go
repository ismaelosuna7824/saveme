// Comando saveme: el core de SaveMe.
//
// Un solo binario, tres formas de usarlo:
//
//	saveme serve   el daemon que consume la interfaz (HTTP + SSE)
//	saveme mcp     el servidor MCP por stdio, para que lo lance un agente
//	saveme guide   imprime las instrucciones para pegar en el CLAUDE.md del repo
//	saveme changelog  saca las notas de versión de un proyecto desde el diario
//
// La decisión de fondo: el MCP no habla con el daemon, habla con la misma base
// de datos y el mismo workspace. Por eso un agente puede registrar un resumen
// con la aplicación cerrada, y la app lo ve al abrir porque el reconciliador
// compara el disco con su índice.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/ismaelosuna/saveme/backend/internal/api"
	"github.com/ismaelosuna/saveme/backend/internal/config"
	"github.com/ismaelosuna/saveme/backend/internal/mcpconfig"
	"github.com/ismaelosuna/saveme/backend/internal/mcpserver"
	"github.com/ismaelosuna/saveme/backend/internal/service"
	"github.com/ismaelosuna/saveme/backend/internal/store"
	"github.com/ismaelosuna/saveme/backend/internal/watch"
	"github.com/ismaelosuna/saveme/backend/internal/workspace"
)

// version se sobreescribe en tiempo de compilación con
// -ldflags "-X main.version=1.2.3".
var version = "0.1.0-dev"

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	switch os.Args[1] {
	case "serve":
		os.Exit(runServe(os.Args[2:]))
	case "mcp":
		os.Exit(runMCP(os.Args[2:]))
	case "add":
		os.Exit(runAdd(os.Args[2:]))
	case "changelog":
		os.Exit(runChangelog(os.Args[2:]))
	case "reindex":
		os.Exit(runReindex(os.Args[2:]))
	case "guide":
		os.Exit(runGuide(os.Args[2:]))
	case "mcp-config":
		os.Exit(runMCPConfig(os.Args[2:]))
	case "doctor":
		os.Exit(runDoctor(os.Args[2:]))
	case "version", "--version", "-v":
		fmt.Println("saveme " + version)
	case "help", "--help", "-h":
		usage()
	default:
		fmt.Fprintf(os.Stderr, "subcomando desconocido: %q\n\n", os.Args[1])
		usage()
		os.Exit(2)
	}
}

func usage() {
	fmt.Fprint(os.Stderr, `saveme — diario técnico de proyecto, en markdown

Uso:
  saveme serve    [--port N] [--root PATH] [--no-watch]   daemon para la interfaz
                  [--parent-stdin]  salir cuando el proceso padre cierre stdin
  saveme mcp      [--http ADDR] [--root PATH]             servidor MCP (stdio por defecto)
  saveme add --project X --title "…"           apunta un resumen desde la terminal
  saveme changelog --project X [--since AAAA-MM-DD] [--until AAAA-MM-DD] [--json]
                                               saca las notas de versión del diario
  saveme reindex  [--root PATH] [--hard]                  reconstruye el índice
  saveme guide    [--root PATH]                           instrucciones para agentes
  saveme mcp-config [--provider X] [--write|--remove]     configura o quita el MCP de un cliente
  saveme doctor                                           diagnostica la instalación
  saveme version

Variables de entorno:
  SAVEME_ROOT    raíz del workspace (gana sobre la configuración)
  SAVEME_CONFIG  archivo de configuración
  SAVEME_PORT    puerto preferido del daemon
`)
}

// --- serve -------------------------------------------------------------------

func runServe(args []string) int {
	fs := flag.NewFlagSet("serve", flag.ExitOnError)
	port := fs.Int("port", 0, "puerto preferido (0 = el de la configuración)")
	root := fs.String("root", "", "raíz del workspace (gana sobre la configuración)")
	noWatch := fs.Bool("no-watch", false, "no vigilar cambios en el filesystem")
	parentStdin := fs.Bool("parent-stdin", false,
		"salir cuando se cierre la entrada estándar (lo usa la app para no dejar procesos huérfanos)")
	verbose := fs.Bool("verbose", false, "log detallado")
	_ = fs.Parse(args)

	log := newLogger(*verbose)

	rt, err := open(*root, log)
	if err != nil {
		log.Error("no pude abrir el workspace", "err", err)
		return 1
	}
	defer rt.Close()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// Puente con el proceso que nos lanzó.
	//
	// Si la app muere de golpe —un crash, un `kill`, un cierre forzado— su
	// manejador de salida nunca corre y este daemon se quedaría vivo para
	// siempre, ocupando un puerto y una conexión a SQLite. Leer la entrada
	// estándar resuelve las dos cosas sin sondear procesos ni usar APIs por
	// plataforma: cuando el padre desaparece, el sistema operativo cierra su
	// extremo de la tubería, esta lectura devuelve EOF y nos apagamos en orden.
	if *parentStdin {
		go func() {
			_, _ = io.Copy(io.Discard, os.Stdin)
			log.Info("el proceso que me lanzó cerró la entrada estándar; apagando")
			stop()
		}()
	}

	if expired, err := rt.svc.ExpireProposals(ctx); err != nil {
		log.Warn("no pude expirar propuestas vencidas", "err", err)
	} else if expired > 0 {
		log.Info("propuestas vencidas marcadas", "n", expired)
	}

	// La copia instalada del MCP —la que lanzan los agentes— no la toca el
	// actualizador, que solo reemplaza el binario de dentro de la app. Se pone al
	// día aquí, al arrancar, para que nadie tenga que acordarse: si se quedara
	// atrás, los agentes usarían herramientas viejas contra una app nueva y no
	// habría ningún síntoma. Solo se toca si ya había copia.
	if res, err := mcpconfig.SyncInstalled(version); err != nil {
		log.Warn("no pude poner al día la copia instalada del MCP; se queda como estaba",
			"path", res.Path, "err", err)
	} else if res.Replaced {
		log.Info("copia instalada del MCP puesta al día",
			"path", res.Path, "antes", res.Before, "ahora", version)
	}

	preferred := rt.cfg.Port
	if *port > 0 {
		preferred = *port
	}
	ln, actualPort, err := listenLocal(preferred)
	if err != nil {
		log.Error("no pude abrir el puerto", "preferred", preferred, "err", err)
		return 1
	}

	srv := api.New(rt.svc, rt.cfg, version, actualPort, log)
	srv.StartEventPump(ctx)

	httpSrv := &http.Server{
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		// Sin WriteTimeout: la conexión SSE es de larga duración.
	}

	if err := writeDaemonFile(rt.ws, actualPort, *noWatch); err != nil {
		log.Warn("no pude escribir el archivo del daemon", "err", err)
	}
	defer removeDaemonFile(rt.ws)

	// La línea que un shell (o Tauri) puede parsear para saber dónde escuchar.
	//
	// Se imprime en cuanto el servidor va a atender, ANTES de reconciliar. Antes
	// se hacía al revés y eso rompía el arranque en workspaces grandes: la
	// reconciliación inicial lee y hashea todos los markdown, así que podía tardar
	// más de lo que el shell está dispuesto a esperar; el shell se rendía, adivinaba
	// el puerto y la ventana se quedaba en la pantalla de arranque apuntando a donde
	// no había nada.
	fmt.Printf("SAVEME_READY http://127.0.0.1:%d\n", actualPort)
	os.Stdout.Sync()
	log.Info("saveme escuchando",
		"url", fmt.Sprintf("http://127.0.0.1:%d", actualPort),
		"root", rt.ws.Root(), "version", version, "fts", rt.st.UsesFTS())

	errc := make(chan error, 1)
	go func() {
		if err := httpSrv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errc <- err
		}
	}()

	// Reconciliación inicial y vigilancia del disco, ya en segundo plano.
	//
	// El watcher arranca DESPUÉS de la reconciliación, no en paralelo: así no hay
	// dos recorridos indexando lo mismo a la vez, y el índice queda completo antes
	// de empezar a escuchar cambios. La interfaz no se queda esperando: la lista
	// aparece vacía un instante y se llena cuando llega el evento `index.rebuilt`.
	go func() {
		if res, err := rt.svc.Reindex(ctx); err != nil {
			log.Warn("la reindexación inicial falló", "err", err)
		} else {
			log.Info("workspace reconciliado",
				"added", res.Added, "updated", res.Updated, "removed", res.Removed,
				"unchanged", res.Unchanged, "ms", res.DurationMs)
		}

		if *noWatch {
			return
		}
		w := watch.New(rt.svc, log)
		if err := w.Run(ctx); err != nil && !errors.Is(err, context.Canceled) {
			log.Warn("el watcher se detuvo", "err", err)
		}
	}()

	select {
	case <-ctx.Done():
		log.Info("apagando")
	case err := <-errc:
		log.Error("el servidor HTTP falló", "err", err)
		return 1
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = httpSrv.Shutdown(shutdownCtx)
	return 0
}

// --- mcp ---------------------------------------------------------------------

func runMCP(args []string) int {
	fs := flag.NewFlagSet("mcp", flag.ExitOnError)
	httpAddr := fs.String("http", "", "servir por Streamable HTTP en esta dirección, por ejemplo 127.0.0.1:7412 (por defecto: stdio)")
	root := fs.String("root", "", "raíz del workspace (gana sobre la configuración)")
	verbose := fs.Bool("verbose", false, "log detallado")
	_ = fs.Parse(args)

	// El log SIEMPRE va a stderr. En modo stdio, stdout es el canal JSON-RPC:
	// una sola línea de log ahí corrompería el protocolo.
	log := newLogger(*verbose)

	rt, err := open(*root, log)
	if err != nil {
		log.Error("no pude abrir el workspace", "err", err)
		return 1
	}
	defer rt.Close()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if _, err := rt.svc.Reindex(ctx); err != nil {
		log.Warn("la reindexación inicial falló", "err", err)
	}
	if expired, err := rt.svc.ExpireProposals(ctx); err == nil && expired > 0 {
		log.Info("propuestas vencidas marcadas", "n", expired)
	}

	srv := mcpserver.New(rt.svc, version)

	if *httpAddr == "" {
		log.Info("saveme mcp por stdio", "root", rt.ws.Root())
		if err := srv.RunStdio(ctx); err != nil && !errors.Is(err, context.Canceled) {
			log.Error("el servidor MCP terminó con error", "err", err)
			return 1
		}
		return 0
	}

	mux := http.NewServeMux()
	mux.Handle("/mcp", srv.HTTPHandler())
	mux.Handle("/mcp/", srv.HTTPHandler())

	httpSrv := &http.Server{
		Addr:              *httpAddr,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = httpSrv.Shutdown(shutdownCtx)
	}()

	log.Info("saveme mcp por HTTP", "addr", *httpAddr, "root", rt.ws.Root())
	if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Error("el servidor MCP falló", "err", err)
		return 1
	}
	return 0
}

// --- reindex -----------------------------------------------------------------

func runReindex(args []string) int {
	fs := flag.NewFlagSet("reindex", flag.ExitOnError)
	root := fs.String("root", "", "raíz del workspace")
	hard := fs.Bool("hard", false, "borrar el índice y reconstruirlo desde cero")
	_ = fs.Parse(args)

	log := newLogger(false)
	rt, err := open(*root, log)
	if err != nil {
		log.Error("no pude abrir el workspace", "err", err)
		return 1
	}
	defer rt.Close()

	ctx := context.Background()
	var res *service.ReindexResult
	if *hard {
		res, err = rt.svc.ResetIndex(ctx)
	} else {
		res, err = rt.svc.Reindex(ctx)
	}
	if err != nil {
		log.Error("la reindexación falló", "err", err)
		return 1
	}

	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	_ = enc.Encode(res)
	for _, e := range res.Errors {
		fmt.Fprintln(os.Stderr, "aviso:", e)
	}
	if len(res.Errors) > 0 {
		// Se informa pero no se falla: un archivo ilegible no invalida el resto.
		fmt.Fprintf(os.Stderr, "%d archivo(s) no se pudieron indexar\n", len(res.Errors))
	}
	return 0
}

// --- guide -------------------------------------------------------------------

func runGuide(args []string) int {
	fs := flag.NewFlagSet("guide", flag.ExitOnError)
	root := fs.String("root", "", "raíz del workspace")
	_ = fs.Parse(args)

	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		return 1
	}
	if *root != "" {
		abs, err := filepath.Abs(*root)
		if err != nil {
			fmt.Fprintln(os.Stderr, "error:", err)
			return 1
		}
		cfg.RootDir = abs
	}
	fmt.Print(api.Guide(cfg.RootDir))
	return 0
}

// --- infraestructura compartida ----------------------------------------------

// runtime agrupa las piezas abiertas para poder cerrarlas en orden.
type runtime struct {
	cfg config.Config
	ws  *workspace.Workspace
	st  *store.Store
	svc *service.Service
}

func (r *runtime) Close() {
	if r.st != nil {
		_ = r.st.Close()
	}
}

// open carga la configuración, prepara la raíz y abre el índice.
//
// Que `serve` y `mcp` compartan esta función es lo que garantiza que ambos
// vean exactamente el mismo workspace y el mismo índice: no hay dos
// configuraciones que puedan divergir.
// shouldPersistRoot dice si este arranque puede escribir la configuración.
//
// Un `--root` es un override **de esta ejecución**: se usa para abrir el
// workspace, pero no se guarda. Y no es una precaución teórica: `Save()` escribe
// el archivo entero, así que persistir la lista de recientes arrastraba el
// `--root` a la configuración, y un `serve --root /tmp/x` de prueba dejaba la app
// abriendo una carpeta temporal para siempre. El diario del usuario desaparecía
// de su vista sin un solo aviso.
//
// `SAVEME_ROOT` ya se comportaba así; el flag ahora igual.
func shouldPersistRoot(rootFlag string, fromEnv bool) bool {
	return rootFlag == "" && !fromEnv
}

func open(rootFlag string, log *slog.Logger) (*runtime, error) {
	cfg, err := config.Load()
	if err != nil {
		return nil, err
	}
	if rootFlag != "" {
		abs, err := filepath.Abs(rootFlag)
		if err != nil {
			return nil, fmt.Errorf("resolver la raíz %q: %w", rootFlag, err)
		}
		cfg.RootDir = abs
	}
	// ¿La raíz ya era un workspace, o la estamos creando ahora mismo?
	//
	// Se mira **antes** de `EnsureRoot`, porque esa función crea la carpeta sin
	// preguntar. Si la raíz configurada no existía, lo más probable no es que el
	// usuario quiera empezar de cero: es que ha movido o renombrado su carpeta, y
	// enseñarle un workspace vacío sin decir nada es la forma más silenciosa de
	// perder datos que hay. Se apunta para que la interfaz pueda avisar y ofrecer
	// las carpetas recientes.
	rootExisted := dirExists(cfg.RootDir)
	cfg.RootWasCreated = !rootExisted

	if err := cfg.EnsureRoot(); err != nil {
		return nil, err
	}

	ws, err := workspace.New(cfg.RootDir)
	if err != nil {
		return nil, err
	}
	st, err := store.Open(ws.DBPath())
	if err != nil {
		return nil, err
	}
	svc := service.New(ws, st)

	// Las carpetas recientes que sí son un workspace de SaveMe y no son esta. Es
	// la lista que la interfaz ofrece como «¿no será esta?».
	if !cfg.RootFromEnv {
		suggestions := make([]string, 0, len(cfg.RecentRoots))
		for _, candidate := range cfg.RecentRoots {
			if candidate == cfg.RootDir || !workspace.HasMarker(candidate) {
				continue
			}
			suggestions = append(suggestions, candidate)
		}
		cfg.RootSuggestions = suggestions

		if shouldPersistRoot(rootFlag, cfg.RootFromEnv) {
			next := cfg.RememberRoot(cfg.RootDir)
			// Guardar la lista es barato y solo se hace cuando cambia, para no
			// reescribir el archivo en cada arranque.
			if len(next.RecentRoots) != len(cfg.RecentRoots) || (len(next.RecentRoots) > 0 && next.RecentRoots[0] != cfg.RootDir) {
				if err := next.Save(); err != nil {
					log.Warn("no pude recordar la raíz", "err", err)
				}
			}
			cfg = next
		}
	}
	log.Info("workspace abierto",
		"root", ws.Root(), "db", st.Path(), "fts", st.UsesFTS(),
		"creado_ahora", cfg.RootWasCreated)
	return &runtime{cfg: cfg, ws: ws, st: st, svc: svc}, nil
}

// listenLocal abre un puerto en loopback, probando desde el preferido hacia
// arriba. El daemon nunca escucha en 0.0.0.0: es un servicio de escritorio.
func listenLocal(preferred int) (net.Listener, int, error) {
	if preferred <= 0 {
		preferred = config.DefaultPort
	}
	var lastErr error
	for p := preferred; p < preferred+25; p++ {
		ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", p))
		if err == nil {
			return ln, p, nil
		}
		lastErr = err
	}
	// Último recurso: que el sistema elija. Es mejor arrancar en un puerto
	// inesperado (y decirlo en daemon.json) que no arrancar.
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, 0, fmt.Errorf("ningún puerto disponible desde %d: %w", preferred, lastErr)
	}
	return ln, ln.Addr().(*net.TCPAddr).Port, nil
}

// daemonInfo es lo que se publica en .saveme/daemon.json para que cualquier
// cliente local (la CLI, un script, la interfaz) encuentre el daemon sin
// adivinar el puerto.
type daemonInfo struct {
	Port      int       `json:"port"`
	PID       int       `json:"pid"`
	Version   string    `json:"version"`
	RootDir   string    `json:"root_dir"`
	StartedAt time.Time `json:"started_at"`
	Watch     bool      `json:"watching"`
}

func writeDaemonFile(ws *workspace.Workspace, port int, watchDisabled bool) error {
	info := daemonInfo{
		Port:      port,
		PID:       os.Getpid(),
		Version:   version,
		RootDir:   ws.Root(),
		StartedAt: time.Now().UTC(),
		Watch:     !watchDisabled,
	}
	data, err := json.MarshalIndent(info, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(ws.StateDir(), "daemon.json"), append(data, '\n'), 0o644)
}

func removeDaemonFile(ws *workspace.Workspace) {
	path := filepath.Join(ws.StateDir(), "daemon.json")
	// Solo se borra si es nuestro: si otro daemon lo sobreescribió, borrarlo
	// dejaría a ese otro sin archivo.
	data, err := os.ReadFile(path)
	if err != nil {
		return
	}
	var info daemonInfo
	if err := json.Unmarshal(data, &info); err != nil {
		return
	}
	if info.PID == os.Getpid() {
		_ = os.Remove(path)
	}
}

func newLogger(verbose bool) *slog.Logger {
	level := slog.LevelInfo
	if verbose {
		level = slog.LevelDebug
	}
	// stderr siempre: stdout está reservado para el protocolo en modo stdio y
	// para la línea SAVEME_READY en modo serve.
	handler := slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: level})
	return slog.New(handler)
}

// dirExists dice si una ruta existe y es un directorio.
func dirExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}
