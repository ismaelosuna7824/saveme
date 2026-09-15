// Package config resuelve dónde vive el estado de SaveMe.
//
// Hay dos ubicaciones distintas que no hay que confundir:
//
//   - La configuración (este paquete): preferencias del usuario, en el
//     directorio estándar de configuración del sistema.
//   - La raíz del workspace (workspace.Config.RootDir): los markdown del
//     usuario, en ~/Documents/SaveMe por defecto.
//
// Ambas se pueden redirigir por entorno para poder correr varias instancias
// (desarrollo, pruebas, CI) sin pisarse:
//
//	SAVEME_ROOT    -> raíz de los resúmenes
//	SAVEME_CONFIG  -> archivo de configuración
//	SAVEME_PORT    -> puerto del daemon
package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

// Version es la versión del formato de configuración. Si cambia, se migra.
const Version = 1

// DefaultPort es el puerto del daemon cuando el configurado está ocupado.
const DefaultPort = 7411

// EditorPrefs son las preferencias del editor markdown.
type EditorPrefs struct {
	FontSize    int    `json:"font_size"`
	Wrap        bool   `json:"wrap"`
	PreviewMode string `json:"preview_mode"` // source | split | preview
	AutosaveMs  int    `json:"autosave_ms"`
}

// Config es la configuración persistida. RootDir es el único campo que el
// usuario normalmente toca.
type Config struct {
	Version int    `json:"version"`
	RootDir string `json:"root_dir"`
	Port    int    `json:"port"`
	Theme   string `json:"theme"`
	// Language es el idioma de la interfaz. Vacío significa "el del sistema", que
	// es el valor por defecto: elegir por el usuario antes de que pueda leer la
	// pantalla sería una decisión que no le corresponde.
	Language string `json:"language"`
	// Opacity es la opacidad de la ventana, en porcentaje. 100 es opaca del todo.
	//
	// Por debajo del mínimo la interfaz se vuelve ilegible sobre cualquier cosa
	// que haya detrás y el usuario no tendría forma de arreglarlo desde dentro, así
	// que se acota. El valor por defecto deja la ventana como estaba.
	Opacity   int         `json:"opacity"`
	Editor    EditorPrefs `json:"editor"`
	Onboarded bool        `json:"onboarded"`

	// RecentRoots son las últimas carpetas de workspace que se abrieron, la más
	// reciente primero.
	//
	// Viven aquí y no dentro del workspace a propósito: **este archivo está fuera
	// de la carpeta que puede moverse**, así que sobrevive a que el usuario mueva
	// o renombre su workspace. Es lo que permite ofrecerle «¿no será esta?» en vez
	// de enseñarle un workspace vacío como si no tuviera nada.
	RecentRoots []string `json:"recent_roots,omitempty"`

	// Path es dónde se leyó/guardará este archivo. No se serializa.
	Path string `json:"-"`
	// RootFromEnv indica que RootDir vino de SAVEME_ROOT y por lo tanto no
	// debe persistirse como preferencia del usuario.
	RootFromEnv bool `json:"-"`
	// RootWasCreated indica que la raíz **no existía** y se ha creado vacía en
	// este arranque. Es la señal de que puede que el usuario haya movido su
	// workspace: la app tiene que decírselo en vez de dar por bueno el vacío.
	RootWasCreated bool `json:"-"`
	// RootSuggestions son carpetas recientes que sí existen y **tienen la marca de
	// SaveMe**, para poder ofrecerlas como destino.
	RootSuggestions []string `json:"-"`
}

// MaxRecentRoots es cuántas raíces se recuerdan. Una lista corta: es para
// reconocer la carpeta que acabas de mover, no un historial.
const MaxRecentRoots = 6

// RememberRoot apunta una raíz como la última usada, sin repetidos.
//
// Devuelve una copia con la lista actualizada; no guarda en disco, de eso se
// encarga quien llama cuando ya sabe que el arranque ha ido bien.
func (c Config) RememberRoot(root string) Config {
	// Se recorta **antes** de resolver la ruta: `filepath.Abs("   ")` no devuelve
	// vacío, resuelve los espacios como una ruta relativa contra el directorio
	// actual, y eso acababa apuntando en la lista una carpeta que no es un
	// workspace.
	trimmed := strings.TrimSpace(root)
	if trimmed == "" {
		return c
	}
	clean := absOrSelf(trimmed)
	if clean == "" {
		return c
	}
	next := []string{clean}
	for _, seen := range c.RecentRoots {
		if seen == clean || len(next) >= MaxRecentRoots {
			continue
		}
		next = append(next, seen)
	}
	c.RecentRoots = next
	return c
}

// Límites de la opacidad de la ventana, en porcentaje.
const (
	// DefaultOpacity es la ventana opaca: el aspecto de siempre.
	DefaultOpacity = 100
	// MinOpacity es el mínimo razonable. Por debajo, el texto deja de leerse sobre
	// lo que haya detrás y el usuario no tendría forma de subirlo desde dentro.
	MinOpacity = 20
	MaxOpacity = 100
)

// ClampOpacity deja un valor dentro de los límites.
func ClampOpacity(v int) int {
	if v < MinOpacity {
		return MinOpacity
	}
	if v > MaxOpacity {
		return MaxOpacity
	}
	return v
}

// DefaultRootDir es ~/Documents/SaveMe.
func DefaultRootDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return filepath.Join(os.TempDir(), "SaveMe")
	}
	return filepath.Join(home, "Documents", "SaveMe")
}

// DefaultConfigPath es el archivo de preferencias.
//
// Si SAVEME_CONFIG está definido se usa tal cual. Si no, y SAVEME_ROOT está
// definido (modo desarrollo), la configuración vive junto al workspace para que
// todo el estado de una instancia quede en un solo lugar. En producción se usa
// el directorio estándar del sistema.
func DefaultConfigPath() string {
	if p := os.Getenv("SAVEME_CONFIG"); p != "" {
		return expandHome(p)
	}
	if root := os.Getenv("SAVEME_ROOT"); root != "" {
		return filepath.Join(expandHome(root), ".saveme", "config.json")
	}
	dir, err := os.UserConfigDir()
	if err != nil {
		home, _ := os.UserHomeDir()
		dir = filepath.Join(home, ".config")
	}
	return filepath.Join(dir, "SaveMe", "config.json")
}

// Defaults devuelve una configuración válida sin tocar el disco.
func Defaults() Config {
	cfg := Config{
		Version: Version,
		RootDir: DefaultRootDir(),
		Port:    DefaultPort,
		Theme:   "phosphor",
		// Vacío = deducirlo del sistema.
		Language: "",
		Opacity:  DefaultOpacity,
		Editor: EditorPrefs{
			FontSize: 14,
			Wrap:     true,
			// `live` es el modo por defecto: el editor renderiza el markdown en
			// línea al estilo Obsidian. `source`, `split` y `preview` quedan
			// disponibles para cuando se quiera ver el markdown crudo.
			PreviewMode: "live",
			AutosaveMs:  1200,
		},
		Path: DefaultConfigPath(),
	}
	if root := os.Getenv("SAVEME_ROOT"); root != "" {
		cfg.RootDir = expandHome(root)
		cfg.RootFromEnv = true
	}
	if port := os.Getenv("SAVEME_PORT"); port != "" {
		var p int
		if _, err := fmt.Sscanf(port, "%d", &p); err == nil && p > 0 && p < 65536 {
			cfg.Port = p
		}
	}
	return cfg
}

// Load lee la configuración del disco. Un archivo ausente no es un error: se
// devuelven los valores por defecto, porque la primera ejecución de la app no
// debe fallar.
func Load() (Config, error) {
	cfg := Defaults()
	data, err := os.ReadFile(cfg.Path)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			cfg.RootDir = absOrSelf(cfg.RootDir)
			return cfg, nil
		}
		return cfg, fmt.Errorf("leer configuración %s: %w", cfg.Path, err)
	}

	// Se decodifica sobre los defaults para que un archivo viejo al que le
	// faltan campos no quede con ceros.
	if err := json.Unmarshal(data, &cfg); err != nil {
		return Defaults(), fmt.Errorf("parsear configuración %s: %w", cfg.Path, err)
	}

	// Los valores por defecto se recalculan por si el archivo no los traía.
	def := Defaults()
	if cfg.Version == 0 {
		cfg.Version = Version
	}
	if cfg.RootDir == "" {
		cfg.RootDir = def.RootDir
	}
	if cfg.Port == 0 {
		cfg.Port = def.Port
	}
	if cfg.Editor.FontSize <= 0 {
		cfg.Editor = def.Editor
	}
	if cfg.Editor.PreviewMode == "" {
		cfg.Editor.PreviewMode = def.Editor.PreviewMode
	}
	if cfg.Theme == "" {
		cfg.Theme = def.Theme
	}

	// El entorno gana sobre el archivo: así se puede apuntar una instancia de
	// desarrollo a otro workspace sin editar la configuración del usuario.
	if root := os.Getenv("SAVEME_ROOT"); root != "" {
		cfg.RootDir = expandHome(root)
		cfg.RootFromEnv = true
	}
	cfg.RootDir = absOrSelf(cfg.RootDir)
	cfg.Path = DefaultConfigPath()
	return cfg, nil
}

// Save escribe la configuración de forma atómica.
func (c Config) Save() error {
	if c.Path == "" {
		c.Path = DefaultConfigPath()
	}
	c.Version = Version
	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return fmt.Errorf("serializar configuración: %w", err)
	}
	data = append(data, '\n')

	if err := os.MkdirAll(filepath.Dir(c.Path), 0o755); err != nil {
		return fmt.Errorf("crear directorio de configuración: %w", err)
	}
	tmp, err := os.CreateTemp(filepath.Dir(c.Path), ".config-*.json")
	if err != nil {
		return fmt.Errorf("crear temporal de configuración: %w", err)
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)

	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return fmt.Errorf("escribir configuración: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return fmt.Errorf("sincronizar configuración: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("cerrar temporal de configuración: %w", err)
	}
	if err := os.Rename(tmpName, c.Path); err != nil {
		return fmt.Errorf("reemplazar configuración: %w", err)
	}
	return nil
}

// EnsureRoot crea la raíz del workspace si no existe y verifica que sea
// escribible. Falla temprano y con un mensaje claro en vez de dejar que el
// primer guardado reviente más tarde.
func (c Config) EnsureRoot() error {
	if strings.TrimSpace(c.RootDir) == "" {
		return errors.New("la raíz del workspace está vacía")
	}
	if err := os.MkdirAll(c.RootDir, 0o755); err != nil {
		return fmt.Errorf("crear la raíz %s: %w", c.RootDir, err)
	}
	probe := filepath.Join(c.RootDir, ".saveme")
	if err := os.MkdirAll(probe, 0o755); err != nil {
		return fmt.Errorf("crear %s: %w", probe, err)
	}
	f, err := os.CreateTemp(probe, ".write-probe-*")
	if err != nil {
		return fmt.Errorf("la raíz %s no es escribible: %w", c.RootDir, err)
	}
	name := f.Name()
	f.Close()
	os.Remove(name)
	return nil
}

// expandHome resuelve un "~" inicial al home del usuario.
func expandHome(p string) string {
	if p == "~" || strings.HasPrefix(p, "~/") {
		home, err := os.UserHomeDir()
		if err == nil {
			if p == "~" {
				return home
			}
			return filepath.Join(home, p[2:])
		}
	}
	return p
}

// absOrSelf convierte a absoluta; si falla, devuelve la ruta tal cual para no
// perder la intención del usuario.
func absOrSelf(p string) string {
	if abs, err := filepath.Abs(p); err == nil {
		return abs
	}
	return p
}
