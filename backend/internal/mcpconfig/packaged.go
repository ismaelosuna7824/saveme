package mcpconfig

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

// --- apps instaladas ---------------------------------------------------------

// appListed dice si alguno de los nombres instalados es el de la app: igual, o
// el nombre seguido de un espacio, porque los instaladores añaden coletillas
// («Cursor (User)», «Microsoft Visual Studio Code (User)»). No vale cualquier
// prefijo: «Orca» no debe encontrar «Orcaslicer».
func appListed(installed, wanted []string) bool {
	for _, name := range installed {
		for _, w := range wanted {
			if strings.EqualFold(name, w) ||
				(len(name) > len(w) && strings.EqualFold(name[:len(w)], w) && name[len(w)] == ' ') {
				return true
			}
		}
	}
	return false
}

// cachedAppNames guarda la lista unos segundos. El informe pregunta por cada
// cliente y leer el registro entero una vez por cliente sería tirar el tiempo;
// pero tampoco se guarda para siempre, porque quien instala una app con SaveMe
// abierto y pulsa «actualizar» espera verla.
func cachedAppNames() []string {
	appNames.Lock()
	defer appNames.Unlock()
	if appNames.at.IsZero() || time.Since(appNames.at) > 5*time.Second {
		appNames.names = installedAppNames()
		appNames.at = time.Now()
	}
	return appNames.names
}

var appNames struct {
	sync.Mutex
	names []string
	at    time.Time
}

// --- apps empaquetadas de Windows (MSIX / Microsoft Store) ------------------
//
// Una app empaquetada no escribe donde cree que escribe. Cuando Claude Desktop
// instalado desde la Store (o con winget, que usa el mismo paquete) crea
// `%APPDATA%\Claude\claude_desktop_config.json`, Windows lo guarda en realidad en
// `%LOCALAPPDATA%\Packages\Claude_<id>\LocalCache\Roaming\Claude\…`, y al abrirlo
// mira primero ahí y solo después en el `%APPDATA%` real. Escribir en la ruta de
// siempre es escribir donde la app no lee: SaveMe decía «configurado» y Claude no
// veía nada.
//
// Las reglas son de Microsoft («Understanding how packaged desktop apps run on
// Windows», AppData en Windows 10 1903 y posteriores):
//
//   - lo que la app crea bajo AppData va a su carpeta privada del paquete;
//   - al abrir un archivo, gana la copia privada; si no existe, la real;
//   - lo que ya existía en el AppData real se modifica en su sitio.
//
// Esto no depende de en qué disco esté instalada la app: los paquetes pueden
// vivir en cualquier volumen, pero sus datos van siempre a la carpeta del
// usuario. Lo mismo vale para los instaladores normales: la configuración está en
// el perfil (`%APPDATA%`, `%USERPROFILE%`), no junto al ejecutable.

// packagedRoots son las carpetas que Windows virtualiza para una app empaquetada
// y su nombre dentro de `LocalCache`.
type packagedRoots struct {
	roaming  string // %APPDATA%
	local    string // %LOCALAPPDATA%
	packages string // %LOCALAPPDATA%\Packages
}

// windowsRoots devuelve las carpetas del usuario actual, o false fuera de
// Windows o si faltan las variables.
func windowsRoots() (packagedRoots, bool) {
	if runtime.GOOS != "windows" {
		return packagedRoots{}, false
	}
	roaming := os.Getenv("APPDATA")
	local := os.Getenv("LOCALAPPDATA")
	if roaming == "" || local == "" {
		return packagedRoots{}, false
	}
	return packagedRoots{roaming: roaming, local: local, packages: filepath.Join(local, "Packages")}, true
}

// split dice bajo qué carpeta virtualizada cae path («Roaming» o «Local») y qué
// queda por debajo. Lo que ya está dentro de `Packages` no se toca.
func (r packagedRoots) split(path string) (kind, rel string, ok bool) {
	if within(r.packages, path) {
		return "", "", false
	}
	if rel, ok := relWithin(r.roaming, path); ok {
		return "Roaming", rel, true
	}
	if rel, ok := relWithin(r.local, path); ok {
		return "Local", rel, true
	}
	return "", "", false
}

// candidates devuelve, para cada paquete instalado, dónde estaría rel dentro de
// su carpeta privada.
func (r packagedRoots) candidates(kind, rel string) []string {
	entries, err := os.ReadDir(r.packages)
	if err != nil {
		return nil
	}
	out := make([]string, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() {
			out = append(out, filepath.Join(r.packages, e.Name(), "LocalCache", kind, rel))
		}
	}
	return out
}

// resolveFile busca el archivo en los sitios donde Windows puede haberlo puesto
// y devuelve el que lee de verdad el cliente: la copia privada de un paquete si
// existe, porque la app la abre antes que la normal, y si no, la ruta de siempre.
// Si no existe en ninguna parte, la de siempre también vale: sin copia privada,
// la app empaquetada abre la normal, así que escribir ahí funciona se haya
// instalado como se haya instalado.
//
// Buscar en estos sitios y no en todo el disco es lo que evita equivocarse: una
// copia vieja en el AppData normal (la que escribían versiones anteriores de
// SaveMe) también existe, y no es la que lee Claude. Con varios paquetes (una
// beta y la estable, por ejemplo) gana el que se modificó más tarde.
func (r packagedRoots) resolveFile(path string) string {
	kind, rel, ok := r.split(path)
	if !ok {
		return path
	}
	if found := newest(r.candidates(kind, rel), false); found != "" {
		return found
	}
	return path
}

// resolveDir hace lo mismo con una carpeta, para detectar si el cliente está
// instalado: vale la real o la privada de cualquier paquete.
func (r packagedRoots) resolveDir(path string) string {
	kind, rel, ok := r.split(path)
	if !ok || exists(path, true) {
		return path
	}
	if dir := newest(r.candidates(kind, rel), true); dir != "" {
		return dir
	}
	return path
}

// packagedPaths aplica la resolución a las rutas de todos los clientes. Fuera de
// Windows, y para rutas que no estén bajo AppData, no cambia nada.
func packagedPaths(providers []Provider) []Provider {
	for i := range providers {
		p := &providers[i]
		if p.Path != nil {
			p.Path = packagedFile(p.Path)
		}
		for j, dir := range p.DetectDirs {
			p.DetectDirs[j] = packagedDir(dir)
		}
	}
	return providers
}

func packagedFile(resolve func() string) func() string {
	return func() string {
		path := resolve()
		if roots, ok := windowsRoots(); ok && path != "" {
			return roots.resolveFile(path)
		}
		return path
	}
}

func packagedDir(resolve func() string) func() string {
	return func() string {
		path := resolve()
		if roots, ok := windowsRoots(); ok && path != "" {
			return roots.resolveDir(path)
		}
		return path
	}
}

// relWithin devuelve path relativo a base si está dentro de ella. En Windows
// filepath.Rel compara sin distinguir mayúsculas, como el sistema de archivos.
func relWithin(base, path string) (string, bool) {
	rel, err := filepath.Rel(base, path)
	if err != nil || rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", false
	}
	return rel, true
}

func within(base, path string) bool {
	_, ok := relWithin(base, path)
	return ok
}

func exists(path string, wantDir bool) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir() == wantDir
}

// newest devuelve el candidato existente modificado más tarde, o "".
func newest(paths []string, wantDir bool) string {
	best := ""
	var bestTime time.Time
	for _, p := range paths {
		info, err := os.Stat(p)
		if err != nil || info.IsDir() != wantDir {
			continue
		}
		if best == "" || info.ModTime().After(bestTime) {
			best, bestTime = p, info.ModTime()
		}
	}
	return best
}
