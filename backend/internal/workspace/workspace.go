// Package workspace es la única capa que toca los archivos del usuario.
//
// Todo lo que escriba SaveMe pasa por aquí, y aquí se garantizan tres cosas:
// las rutas nunca escapan de la raíz, las escrituras son atómicas, y los
// archivos que SaveMe no gestiona jamás se sobrescriben.
package workspace

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/ismaelosuna/saveme/backend/internal/domain"
)

// StateDirName es el directorio oculto con el índice y los metadatos. La
// definición vive en domain para que la validación de slugs pueda rechazarlo
// sin crear un ciclo de imports.
const StateDirName = domain.StateDirName

// rootMarker es el archivo que marca un directorio como raíz de SaveMe.
type rootMarker struct {
	App           string    `json:"app"`
	SchemaVersion int       `json:"schema_version"`
	CreatedAt     time.Time `json:"created_at"`
}

// FileEntry describe un markdown encontrado en el workspace.
type FileEntry struct {
	RelPath     string
	AbsPath     string
	ProjectSlug string
	Category    domain.Category
	ModTime     time.Time
	Size        int64
}

// Workspace representa la raíz de resúmenes del usuario.
type Workspace struct {
	root string
	// realRoot es `root` con los enlaces resueltos.
	//
	// Hace falta porque en macOS la propia raíz puede estar detrás de uno —`/tmp`
	// es un enlace a `/private/tmp`, y los temporales de las pruebas viven bajo
	// `/var`, que también lo es—. Comparar una ruta resuelta contra una sin
	// resolver daría falsos positivos en todas partes.
	realRoot string
}

// New abre (o inicializa) un workspace en root.
//
// Inicializar es idempotente: crea el directorio, el subdirectorio de estado y
// el marcador. Si el directorio existe con contenido ajeno, no lo toca: SaveMe
// convive con archivos que no son suyos.
// HasMarker dice si una carpeta parece un workspace de SaveMe **sin abrirla ni
// crearla**.
//
// Se apoya en el marcador que deja `New` (`.saveme/root.json`). Es lo que permite
// distinguir «aquí había un SaveMe» de «aquí no hay nada», que es justo lo que
// hace falta para reconocer un workspace que se ha movido de sitio.
func HasMarker(dir string) bool {
	if strings.TrimSpace(dir) == "" {
		return false
	}
	info, err := os.Stat(filepath.Join(dir, StateDirName, "root.json"))
	return err == nil && info.Mode().IsRegular()
}

// MarkerExistsIn es como `HasMarker` pero sin exigir que exista la carpeta: útil
// para descartar rutas antes de comprobarlas.
func MarkerExistsIn(dir string) bool {
	if _, err := os.Stat(dir); err != nil {
		return false
	}
	return HasMarker(dir)
}

func New(root string) (*Workspace, error) {
	if strings.TrimSpace(root) == "" {
		return nil, errors.New("la raíz del workspace no puede estar vacía")
	}
	abs, err := filepath.Abs(root)
	if err != nil {
		return nil, fmt.Errorf("resolver la raíz %s: %w", root, err)
	}
	w := &Workspace{root: abs}

	if err := os.MkdirAll(w.stateDir(), 0o755); err != nil {
		return nil, fmt.Errorf("crear %s: %w", w.stateDir(), err)
	}

	// Se resuelve después de crear el directorio, así que existe. Si aun así
	// fallara, se usa la ruta sin resolver: es preferible que la comprobación de
	// enlaces sea conservadora a que el workspace no se pueda abrir.
	if resolved, err := filepath.EvalSymlinks(abs); err == nil {
		w.realRoot = resolved
	} else {
		w.realRoot = abs
	}

	markerPath := filepath.Join(w.stateDir(), "root.json")
	if _, err := os.Stat(markerPath); errors.Is(err, fs.ErrNotExist) {
		marker := rootMarker{App: "saveme", SchemaVersion: domain.SchemaVersion, CreatedAt: time.Now().UTC()}
		data, _ := json.MarshalIndent(marker, "", "  ")
		if err := os.WriteFile(markerPath, append(data, '\n'), 0o644); err != nil {
			return nil, fmt.Errorf("escribir marcador de raíz: %w", err)
		}
	}
	return w, nil
}

// Root devuelve la raíz absoluta del workspace.
func (w *Workspace) Root() string { return w.root }

// StateDir es donde viven saveme.db, daemon.json y root.json.
func (w *Workspace) StateDir() string { return w.stateDir() }

func (w *Workspace) stateDir() string { return filepath.Join(w.root, StateDirName) }

// DBPath es la ruta del índice SQLite.
func (w *Workspace) DBPath() string { return filepath.Join(w.stateDir(), "saveme.db") }

// ProjectDir devuelve el directorio absoluto de un proyecto.
func (w *Workspace) ProjectDir(slug string) string { return filepath.Join(w.root, slug) }

// EnsureProject crea el directorio del proyecto y las nueve carpetas de
// categoría. Se crean todas aunque estén vacías para que quien escribe (humano
// o agente) nunca tenga que decidir entre crear una carpeta o guardar el
// archivo.
func (w *Workspace) EnsureProject(slug string) error {
	if err := domain.ValidateSlug(slug); err != nil {
		return err
	}
	dir := w.ProjectDir(slug)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("crear proyecto %s: %w", slug, err)
	}
	for _, c := range domain.Categories() {
		if err := os.MkdirAll(filepath.Join(dir, c.Folder), 0o755); err != nil {
			return fmt.Errorf("crear carpeta %s de %s: %w", c.Folder, slug, err)
		}
	}
	return nil
}

// ProjectExists indica si el directorio del proyecto ya está en disco.
func (w *Workspace) ProjectExists(slug string) bool {
	st, err := os.Stat(w.ProjectDir(slug))
	return err == nil && st.IsDir()
}

// SafeRel valida y normaliza una ruta relativa.
//
// Es la defensa contra un agente (o un bug de la UI) que mande
// "../../etc/passwd" o una ruta absoluta. Todo path que venga de fuera pasa
// por aquí antes de tocar el disco.
func (w *Workspace) SafeRel(rel string) (string, error) {
	rel = strings.TrimSpace(rel)
	if rel == "" {
		return "", errors.New("la ruta relativa está vacía")
	}
	if filepath.IsAbs(rel) {
		return "", fmt.Errorf("la ruta %q es absoluta: debe ser relativa a la raíz del workspace", rel)
	}
	// Windows acepta separadores invertidos; normalizarlos evita que un
	// "..\\..\\algo" pase el chequeo en una plataforma y no en otra.
	rel = strings.ReplaceAll(rel, "\\", "/")
	clean := filepath.Clean(rel)
	if clean == "." || clean == string(filepath.Separator) {
		return "", fmt.Errorf("la ruta %q no apunta a ningún archivo", rel)
	}
	for _, part := range strings.Split(filepath.ToSlash(clean), "/") {
		if part == ".." {
			return "", fmt.Errorf("la ruta %q intenta salir de la raíz del workspace", rel)
		}
	}
	if strings.HasPrefix(filepath.ToSlash(clean), StateDirName+"/") || filepath.ToSlash(clean) == StateDirName {
		return "", fmt.Errorf("la ruta %q apunta al directorio interno de estado", rel)
	}
	return filepath.ToSlash(clean), nil
}

// Abs convierte una ruta relativa ya validada en absoluta y comprueba que
// quede dentro de la raíz. Es una segunda barrera por si SafeRel se saltara.
func (w *Workspace) Abs(rel string) (string, error) {
	clean, err := w.SafeRel(rel)
	if err != nil {
		return "", err
	}
	abs := filepath.Join(w.root, filepath.FromSlash(clean))
	prefix := w.root + string(filepath.Separator)
	if abs != w.root && !strings.HasPrefix(abs, prefix) {
		return "", fmt.Errorf("la ruta %q resuelve fuera de la raíz del workspace", rel)
	}
	if err := w.assertNoSymlinkEscape(abs, rel); err != nil {
		return "", err
	}
	return abs, nil
}

// assertNoSymlinkEscape comprueba que la ruta no salga de la raíz **a través de un
// enlace simbólico**.
//
// Las dos comprobaciones de arriba son léxicas: miran la cadena. Un enlace dentro
// del workspace que apunte fuera —`proyecto/features -> /etc`— las pasa todas,
// porque la cadena sigue estando dentro. Esto es lo que lo detecta, resolviendo
// el ancestro existente más profundo y comparándolo con la raíz ya resuelta.
//
// Se resuelve el ancestro y no la ruta entera porque el destino casi nunca existe
// todavía al escribir (se crea con un temporal y un `rename`), así que no hay nada
// que resolver en el último tramo. Y se resuelve **solo el ancestro existente**
// para no pagar un `EvalSymlinks` completo por cada archivo de un reindexado.
func (w *Workspace) assertNoSymlinkEscape(abs, rel string) error {
	existing := abs
	for {
		if _, err := os.Lstat(existing); err == nil {
			break
		} else if !errors.Is(err, fs.ErrNotExist) {
			// Un error que no es «no existe» (permisos, por ejemplo) no se
			// interpreta: lo tratará quien fuera a usar la ruta.
			return nil
		}
		parent := filepath.Dir(existing)
		if parent == existing {
			return nil
		}
		existing = parent
	}

	resolved, err := filepath.EvalSymlinks(existing)
	if err != nil {
		// Un enlace roto no se puede resolver, y dejarlo pasar sería justo el
		// agujero que esto cierra.
		return fmt.Errorf("la ruta %q no se puede resolver: %w", rel, err)
	}

	prefix := w.realRoot + string(filepath.Separator)
	if resolved != w.realRoot && !strings.HasPrefix(resolved, prefix) {
		return fmt.Errorf(
			"la ruta %q sale de la raíz del workspace a través de un enlace simbólico", rel)
	}
	return nil
}

// ReadFile lee un markdown del workspace por su ruta relativa.
func (w *Workspace) ReadFile(rel string) ([]byte, error) {
	abs, err := w.Abs(rel)
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(abs)
	if err != nil {
		return nil, err
	}
	return data, nil
}

// WriteAtomic escribe un archivo de forma atómica: escribe un temporal en el
// mismo directorio y lo renombra encima. Un lector concurrente (el editor, el
// watcher, git) ve o la versión vieja completa o la nueva completa, nunca una
// mezcla.
//
// Nunca sobrescribe un archivo que ya exista salvo que overwrite sea true.
func (w *Workspace) WriteAtomic(rel string, data []byte, overwrite bool) error {
	abs, err := w.Abs(rel)
	if err != nil {
		return err
	}
	if !overwrite {
		if _, err := os.Stat(abs); err == nil {
			return &ExistsError{RelPath: rel}
		}
	}
	dir := filepath.Dir(abs)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("crear directorio %s: %w", dir, err)
	}

	tmp, err := os.CreateTemp(dir, ".saveme-tmp-*")
	if err != nil {
		return fmt.Errorf("crear temporal en %s: %w", dir, err)
	}
	tmpName := tmp.Name()
	// Si algo falla antes del rename, el temporal no debe quedar tirado.
	defer func() {
		if _, err := os.Stat(tmpName); err == nil {
			os.Remove(tmpName)
		}
	}()

	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return fmt.Errorf("escribir %s: %w", rel, err)
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return fmt.Errorf("sincronizar %s: %w", rel, err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("cerrar temporal de %s: %w", rel, err)
	}
	if err := os.Rename(tmpName, abs); err != nil {
		return fmt.Errorf("reemplazar %s: %w", rel, err)
	}
	return nil
}

// mustRel devuelve la ruta de `path` relativa a `root`, en forma de barra.
//
// Es para las rutas que compone el propio workspace —la papelera— y que por
// construcción están dentro de la raíz. Si el cálculo fallara, devolver una
// cadena vacía es preferible a devolver una ruta absoluta que luego se use como
// si fuera relativa.
func mustRel(root, path string) string {
	rel, err := filepath.Rel(root, path)
	if err != nil {
		return ""
	}
	return rel
}

// ExistsError indica que el destino ya estaba ocupado.
type ExistsError struct{ RelPath string }

func (e *ExistsError) Error() string { return "ya existe un archivo en " + e.RelPath }

// Delete mueve un archivo a la papelera del workspace (carpeta
// .saveme/trash/) conservando la ruta original para poder restaurarlo.
// Un borrado duro elimina el archivo y poda los directorios que queden vacíos.
func (w *Workspace) Delete(rel string, hard bool) (string, error) {
	abs, err := w.Abs(rel)
	if err != nil {
		return "", err
	}
	if _, err := os.Stat(abs); err != nil {
		return "", err
	}
	if hard {
		if err := os.Remove(abs); err != nil {
			return "", err
		}
		w.pruneEmptyDirs(filepath.Dir(abs))
		return "", nil
	}

	stamp := time.Now().UTC().Format("20060102-150405")
	// La papelera vive dentro del directorio de estado, y SafeRel rechaza
	// justamente esa ruta para que nada de fuera escriba ahí. Así que aquí se
	// compone a mano, sin pasar por Abs: `rel` ya quedó validado arriba, así que
	// unirlo a una ruta fija bajo el estado no puede escapar de la raíz.
	//
	// El sello tiene resolución de un segundo, así que dos borrados del MISMO
	// archivo en el mismo segundo apuntarían a la misma ruta y el `rename`
	// reemplazaría al primero sin decir nada: se perdería una copia. Si el destino
	// ya está ocupado, se añade un sufijo.
	trashAbs := filepath.Join(w.stateDir(), "trash", stamp, filepath.FromSlash(rel))
	for attempt := 2; ; attempt++ {
		if _, err := os.Stat(trashAbs); errors.Is(err, fs.ErrNotExist) {
			break
		} else if err != nil {
			return "", err
		}
		trashAbs = filepath.Join(
			w.stateDir(), "trash", stamp,
			fmt.Sprintf("%s.%d", filepath.FromSlash(rel), attempt),
		)
	}
	trashRel := filepath.ToSlash(mustRel(w.root, trashAbs))
	if err := os.MkdirAll(filepath.Dir(trashAbs), 0o755); err != nil {
		return "", fmt.Errorf("crear papelera: %w", err)
	}
	if err := os.Rename(abs, trashAbs); err != nil {
		return "", fmt.Errorf("mover a la papelera: %w", err)
	}
	w.pruneEmptyDirs(filepath.Dir(abs))
	return trashRel, nil
}

// pruneEmptyDirs borra directorios vacíos hacia arriba, deteniéndose en la raíz
// y sin tocar las carpetas de categoría de un proyecto (que deben existir
// aunque estén vacías).
func (w *Workspace) pruneEmptyDirs(dir string) {
	keep := map[string]bool{}
	for _, c := range domain.Categories() {
		keep[c.Folder] = true
	}
	for dir != w.root && strings.HasPrefix(dir, w.root) {
		base := filepath.Base(dir)
		if keep[base] || base == StateDirName {
			return
		}
		entries, err := os.ReadDir(dir)
		if err != nil || len(entries) > 0 {
			return
		}
		if err := os.Remove(dir); err != nil {
			return
		}
		dir = filepath.Dir(dir)
	}
}

// SummaryFilename construye el nombre de archivo canónico:
// YYYY-MM-DD-slug-del-titulo.md
func SummaryFilename(createdAt time.Time, title string) string {
	slug := domain.SlugTruncated(title)
	if slug == "" {
		slug = "resumen"
	}
	return fmt.Sprintf("%s-%s.md", createdAt.UTC().Format("2006-01-02"), slug)
}

// UniqueRelPath busca un nombre libre dentro de dirRel, añadiendo -2, -3, …
// antes de la extensión si el archivo ya existe. Devuelve la ruta relativa
// completa.
func (w *Workspace) UniqueRelPath(dirRel, filename string) (string, error) {
	base := strings.TrimSuffix(filename, filepath.Ext(filename))
	ext := filepath.Ext(filename)
	if ext == "" {
		ext = ".md"
	}
	candidate := filepath.ToSlash(filepath.Join(dirRel, filename))
	for i := 2; i <= 999; i++ {
		abs, err := w.Abs(candidate)
		if err != nil {
			return "", err
		}
		if _, err := os.Stat(abs); errors.Is(err, fs.ErrNotExist) {
			return candidate, nil
		}
		candidate = filepath.ToSlash(filepath.Join(dirRel, fmt.Sprintf("%s-%d%s", base, i, ext)))
	}
	return "", fmt.Errorf("no encontré un nombre libre para %s en %s", filename, dirRel)
}

// ListProjects devuelve los slugs de los directorios de primer nivel que
// parecen proyectos (excluye los que empiezan con punto).
func (w *Workspace) ListProjects() ([]string, error) {
	entries, err := os.ReadDir(w.root)
	if err != nil {
		return nil, err
	}
	var slugs []string
	for _, e := range entries {
		if !e.IsDir() || strings.HasPrefix(e.Name(), ".") {
			continue
		}
		slugs = append(slugs, e.Name())
	}
	sort.Strings(slugs)
	return slugs, nil
}

// Walk recorre el workspace y devuelve todos los markdown indexables.
//
// Un archivo directamente en la raíz no pertenece a ningún proyecto y se
// ignora; todo lo demás se atribuye al primer segmento de la ruta como
// proyecto y, si el segundo segmento coincide con una carpeta de categoría, a
// esa categoría. Lo que no coincide cae en "uncategorized" en vez de
// descartarse, para que el usuario pueda leer y buscar cualquier nota que haya
// dejado en el workspace.
func (w *Workspace) Walk() ([]FileEntry, error) {
	var out []FileEntry
	err := filepath.WalkDir(w.root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			// Un subdirectorio ilegible no debe abortar el recorrido completo.
			if d != nil && d.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		name := d.Name()
		if d.IsDir() {
			if path != w.root && strings.HasPrefix(name, ".") {
				return fs.SkipDir
			}
			// La carpeta de notas es de la interfaz, no de los resúmenes: si no se
			// salta, cada nota aparecería como un proyecto con categoría
			// desconocida y ensuciaría el historial entero.
			//
			// Se compara el **padre** y no `path == w.root`, que nunca se cumple:
			// para la raíz misma, `name` es el nombre de la carpeta raíz, no el de
			// sus hijos.
			if filepath.Dir(path) == w.root && name == NotesDirName {
				return fs.SkipDir
			}
			return nil
		}
		if strings.HasPrefix(name, ".") || !strings.EqualFold(filepath.Ext(name), ".md") {
			return nil
		}

		rel, err := filepath.Rel(w.root, path)
		if err != nil {
			return nil
		}
		rel = filepath.ToSlash(rel)
		parts := strings.Split(rel, "/")
		if len(parts) < 2 {
			// Archivo suelto en la raíz: no es de ningún proyecto.
			return nil
		}

		category := domain.CategoryByFolder(parts[1])
		info, statErr := d.Info()
		entry := FileEntry{
			RelPath:     rel,
			AbsPath:     path,
			ProjectSlug: parts[0],
			Category:    category,
		}
		if statErr == nil {
			entry.ModTime = info.ModTime()
			entry.Size = info.Size()
		}
		out = append(out, entry)
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Slice(out, func(i, j int) bool { return out[i].RelPath < out[j].RelPath })
	return out, nil
}
