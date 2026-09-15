package workspace

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// NotesDirName es la carpeta, dentro de la raíz, donde viven las notas.
//
// Es una carpeta reservada: el indexado de resúmenes la ignora a propósito (ver
// `Walk`), porque si no cada nota acabaría apareciendo como un proyecto con
// categoría desconocida. Está a la vista y no dentro de `.saveme/` para que las
// notas sean archivos normales: las abres con cualquier editor, las sincronizas o
// las metes en git sin tener que buscar una carpeta oculta.
const NotesDirName = "notes"

// NoteEntry es un archivo o una carpeta del árbol de notas.
type NoteEntry struct {
	// RelPath es la ruta **relativa a la carpeta de notas**, sin el prefijo:
	// `ideas/2026-02-14-algo.md`. Es lo que se manda en las peticiones.
	RelPath string `json:"rel_path"`
	Name    string `json:"name"`
	IsDir   bool   `json:"is_dir"`
	Size    int64  `json:"size"`
	// ModTime va en RFC3339 UTC; el cero significa que no se pudo leer.
	ModTime time.Time `json:"modified_at"`
}

func (w *Workspace) notesDir() string {
	return filepath.Join(w.root, NotesDirName)
}

// noteWorkspaceRel convierte una ruta relativa a las notas en una ruta relativa al
// workspace, validándola.
//
// Es la única puerta por la que entra una ruta de nota, así que la validación se
// delega entera en `SafeRel`: rechaza absolutas, `..`, y la carpeta de estado; y
// `Abs` —que se llama más abajo— añade la comprobación de enlaces simbólicos.
func (w *Workspace) noteWorkspaceRel(rel string) (string, error) {
	clean := strings.TrimSpace(rel)
	if clean == "" {
		return "", errors.New("la ruta de la nota está vacía")
	}
	if filepath.IsAbs(clean) {
		return "", fmt.Errorf("la ruta %q es absoluta: debe ser relativa a la carpeta de notas", rel)
	}
	// Se normalizan los separadores antes de unir: en Windows llegan con `\`.
	clean = filepath.ToSlash(clean)
	for _, part := range strings.Split(clean, "/") {
		if strings.HasPrefix(part, ".") && part != "." && part != ".." {
			// Una carpeta oculta dentro de las notas no se ve en el árbol, así que
			// dejar crear algo ahí sería escribir en un sitio invisible.
			return "", fmt.Errorf("la ruta %q apunta a una carpeta oculta", rel)
		}
	}
	if clean != NotesDirName && !strings.HasPrefix(clean, NotesDirName+"/") {
		clean = NotesDirName + "/" + clean
	}

	full, err := w.SafeRel(clean)
	if err != nil {
		return "", err
	}
	// **La comprobación va después de normalizar, y ese es el detalle que importa.**
	// `SafeRel` limpia la ruta, así que `notes/../fuera.md` se convierte en
	// `fuera.md` —sin ningún `..` ya— y lo aceptaría encantado: la nota acabaría
	// escrita fuera de su carpeta. Mirar el prefijo antes de limpiar no sirve;
	// hay que mirarlo sobre el resultado.
	if full != NotesDirName && !strings.HasPrefix(full, NotesDirName+"/") {
		return "", fmt.Errorf("la ruta %q sale de la carpeta de notas", rel)
	}
	return full, nil
}

// noteRelFromWorkspace es la vuelta: quita el prefijo para devolver al cliente la
// ruta que él entiende.
func noteRelFromWorkspace(rel string) string {
	return strings.TrimPrefix(filepath.ToSlash(rel), NotesDirName+"/")
}

// NotesTree devuelve todo el árbol de notas en plano.
//
// Plano y no anidado porque el árbol lo compone la interfaz: enviar una jerarquía
// obligaría a mantener dos representaciones del mismo dato y a decidir qué hacer
// con las carpetas vacías, que es justo lo que un árbol de verdad necesita
// conservar.
func (w *Workspace) NotesTree() ([]NoteEntry, error) {
	root := w.notesDir()
	out := make([]NoteEntry, 0)

	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			if errors.Is(err, fs.ErrNotExist) {
				return nil
			}
			if d != nil && d.IsDir() {
				// Una carpeta ilegible no puede tumbar el resto del árbol.
				return fs.SkipDir
			}
			return nil
		}
		if path == root {
			return nil
		}

		// Nada oculto: ni `.DS_Store` en macOS ni archivos temporales de un
		// editor a medio guardar.
		if strings.HasPrefix(d.Name(), ".") {
			if d.IsDir() {
				return fs.SkipDir
			}
			return nil
		}

		rel, relErr := filepath.Rel(w.root, path)
		if relErr != nil {
			return nil
		}
		entry := NoteEntry{
			RelPath: noteRelFromWorkspace(filepath.ToSlash(rel)),
			Name:    d.Name(),
			IsDir:   d.IsDir(),
		}
		if info, statErr := d.Info(); statErr == nil {
			entry.ModTime = info.ModTime().UTC()
			if !d.IsDir() {
				entry.Size = info.Size()
			}
		}
		out = append(out, entry)
		return nil
	})
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return nil, fmt.Errorf("leer las notas: %w", err)
	}

	sort.SliceStable(out, func(i, j int) bool { return out[i].RelPath < out[j].RelPath })
	return out, nil
}

// NoteRead devuelve el contenido de una nota.
func (w *Workspace) NoteRead(rel string) (string, error) {
	full, err := w.noteWorkspaceRel(rel)
	if err != nil {
		return "", err
	}
	data, err := w.ReadFile(full)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// NoteWrite guarda una nota. Crea las carpetas que hagan falta.
func (w *Workspace) NoteWrite(rel, content string) error {
	full, err := w.noteWorkspaceRel(rel)
	if err != nil {
		return err
	}
	return w.WriteAtomic(full, []byte(content), true)
}

// NoteCreate deja una nota nueva vacía.
//
// No la deja en blanco del todo: un archivo de cero bytes se ve igual que uno roto,
// así que empieza con un encabezado. El usuario escribe debajo y ya tiene título.
func (w *Workspace) NoteCreate(rel, title string) error {
	full, err := w.noteWorkspaceRel(rel)
	if err != nil {
		return err
	}
	body := "# " + strings.TrimSpace(title) + "\n\n"
	return w.WriteAtomic(full, []byte(body), false)
}

// NoteMkdir crea una carpeta, incluidas las intermedias.
func (w *Workspace) NoteMkdir(rel string) error {
	full, err := w.noteWorkspaceRel(rel)
	if err != nil {
		return err
	}
	abs, err := w.Abs(full)
	if err != nil {
		return err
	}
	if _, statErr := os.Stat(abs); statErr == nil {
		return &ExistsError{RelPath: rel}
	}
	return os.MkdirAll(abs, 0o755)
}

// NoteMove mueve o renombra un archivo o una carpeta **con todo su contenido**.
//
// Un `rename` del sistema es lo que hace el trabajo, así que es atómico y no hay
// copia intermedia que pueda quedar a medias. Lo que sí hay que comprobar es todo
// lo que puede salir mal:
//
//   - que el destino no exista, para no pisar nada;
//   - que no se mueva una carpeta **dentro de sí misma** (`notas/a` → `notas/a/b`),
//     que dejaría el árbol en un estado imposible y no siempre falla sola;
//   - que ninguno de los dos lados se salga de la carpeta de notas.
func (w *Workspace) NoteMove(from, to string) error {
	fromFull, err := w.noteWorkspaceRel(from)
	if err != nil {
		return err
	}
	toFull, err := w.noteWorkspaceRel(to)
	if err != nil {
		return err
	}
	if fromFull == toFull {
		// Renombrar algo al mismo sitio no es un error: es que no había nada que
		// hacer. Se acepta para que un arrastre que acaba donde empezó no falle.
		return nil
	}

	fromAbs, err := w.Abs(fromFull)
	if err != nil {
		return err
	}
	toAbs, err := w.Abs(toFull)
	if err != nil {
		return err
	}

	info, err := os.Stat(fromAbs)
	if err != nil {
		return fmt.Errorf("no encuentro %q: %w", from, err)
	}
	if info.IsDir() {
		// `toAbs` dentro de `fromAbs` sería mover una carpeta dentro de sí misma.
		prefix := fromAbs + string(filepath.Separator)
		if toAbs == fromAbs || strings.HasPrefix(toAbs, prefix) {
			return &IntoItselfError{RelPath: from}
		}
	}

	if _, err := os.Stat(toAbs); err == nil {
		return &ExistsError{RelPath: to}
	} else if !errors.Is(err, fs.ErrNotExist) {
		return err
	}

	if err := os.MkdirAll(filepath.Dir(toAbs), 0o755); err != nil {
		return fmt.Errorf("preparar el destino: %w", err)
	}
	if err := os.Rename(fromAbs, toAbs); err != nil {
		return fmt.Errorf("mover: %w", err)
	}

	// Al mover una carpeta, la de origen puede quedarse vacía.
	w.pruneEmptyNoteDirs(filepath.Dir(fromAbs))
	return nil
}

// IntoItselfError indica que se quiso meter una carpeta dentro de sí misma.
//
// Es un error tipado y no un texto suelto para que la capa HTTP lo pueda mapear a
// un 400: es una petición imposible, no un fallo del servidor. Sin esto acababa
// siendo un 500, que le dice al cliente «algo se rompió» cuando lo que pasa es que
// pidió algo que no tiene sentido.
type IntoItselfError struct{ RelPath string }

func (e *IntoItselfError) Error() string {
	return "no puedo mover " + e.RelPath + " dentro de sí misma"
}

// NoteDelete archiva una nota o una carpeta entera, con su contenido.
func (w *Workspace) NoteDelete(rel string) (string, error) {
	full, err := w.noteWorkspaceRel(rel)
	if err != nil {
		return "", err
	}
	// `Delete` archiva: mueve a la papelera conservando la ruta. Borrar una nota
	// es tan fácil de hacer sin querer como borrar un resumen, así que va por el
	// mismo camino y se puede recuperar.
	return w.Delete(full, false)
}

// pruneEmptyNoteDirs borra las carpetas que quedan vacías tras mover algo, sin
// tocar la raíz de las notas ni sus carpetas de primer nivel: una carpeta vacía
// que el usuario creó a propósito debe seguir ahí.
func (w *Workspace) pruneEmptyNoteDirs(dir string) {
	root := w.notesDir()
	for dir != root && strings.HasPrefix(dir, root) {
		entries, err := os.ReadDir(dir)
		if err != nil || len(entries) > 0 {
			return
		}
		if filepath.Dir(dir) == root {
			// Primer nivel: se respeta aunque esté vacío.
			return
		}
		if err := os.Remove(dir); err != nil {
			return
		}
		dir = filepath.Dir(dir)
	}
}
