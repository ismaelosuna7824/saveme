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

// TrashEntry es un archivo que está en la papelera.
type TrashEntry struct {
	// TrashRel es dónde está ahora, relativo a la raíz del workspace:
	// `.saveme/trash/<sello>/<ruta original>`. Es lo que se manda para restaurar.
	TrashRel string `json:"trash_rel"`
	// RelPath es dónde estaba antes de borrarlo, relativo a la raíz.
	RelPath string `json:"rel_path"`
	// Name es el nombre del archivo, para poder listarlo sin la ruta entera.
	Name string `json:"name"`
	// DeletedAt sale del sello de la carpeta. Si el sello no se puede leer, es
	// cero: se prefiere una fecha vacía a inventarse una.
	DeletedAt time.Time `json:"deleted_at"`
	Size      int64     `json:"size"`
}

// trashStampLayout es el formato del nombre de carpeta que usa `Delete`.
const trashStampLayout = "20060102-150405"

func (w *Workspace) trashDir() string {
	return filepath.Join(w.stateDir(), "trash")
}

// Trash lista lo que hay en la papelera, de lo más reciente a lo más antiguo.
//
// La papelera guarda la ruta original dentro de su estructura
// (`.saveme/trash/<sello>/<ruta>`), así que restaurar es reconstruirla. Listarla
// es recorrer ese árbol: no hay índice ni base de datos de por medio, y no hace
// falta que la haya, porque el disco ya cuenta todo lo necesario.
func (w *Workspace) Trash() ([]TrashEntry, error) {
	root := w.trashDir()
	entries := make([]TrashEntry, 0)

	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			// Una papelera a medio escribir no puede impedir ver el resto.
			if errors.Is(err, fs.ErrNotExist) {
				return nil
			}
			return err
		}
		if d.IsDir() {
			return nil
		}
		if !d.Type().IsRegular() {
			return nil
		}

		rel, err := filepath.Rel(w.root, path)
		if err != nil {
			return nil
		}
		rel = filepath.ToSlash(rel)

		// `.saveme/trash/<sello>/<ruta original>`
		parts := strings.Split(rel, "/")
		if len(parts) < 4 {
			return nil
		}
		stamp := parts[2]
		original := strings.Join(parts[3:], "/")

		entry := TrashEntry{
			TrashRel: rel,
			RelPath:  original,
			Name:     filepath.Base(original),
		}
		if when, err := time.ParseInLocation(trashStampLayout, stamp, time.UTC); err == nil {
			entry.DeletedAt = when
		}
		if info, err := d.Info(); err == nil {
			entry.Size = info.Size()
		}
		entries = append(entries, entry)
		return nil
	})
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return nil, fmt.Errorf("leer la papelera: %w", err)
	}

	// Lo más reciente primero: es lo que se acaba de borrar por accidente.
	sort.SliceStable(entries, func(i, j int) bool {
		if entries[i].DeletedAt.Equal(entries[j].DeletedAt) {
			return entries[i].TrashRel < entries[j].TrashRel
		}
		return entries[i].DeletedAt.After(entries[j].DeletedAt)
	})
	return entries, nil
}

// Restore devuelve un archivo de la papelera a donde estaba y devuelve su ruta.
//
// No pisa nada: si en el destino ya hay un archivo, se niega y lo dice. Restaurar
// por encima de algo más nuevo sería una forma silenciosa de perder trabajo, y
// el usuario siempre puede mover o borrar lo que estorba.
func (w *Workspace) Restore(trashRel string) (string, error) {
	original, err := w.validateTrashPath(trashRel)
	if err != nil {
		return "", err
	}

	targetAbs, err := w.Abs(original)
	if err != nil {
		return "", err
	}
	if _, err := os.Stat(targetAbs); err == nil {
		return "", &ExistsError{RelPath: original}
	} else if !errors.Is(err, fs.ErrNotExist) {
		return "", err
	}

	trashAbs := filepath.Join(w.root, filepath.FromSlash(trashRel))
	if err := os.MkdirAll(filepath.Dir(targetAbs), 0o755); err != nil {
		return "", fmt.Errorf("preparar el destino: %w", err)
	}
	if err := os.Rename(trashAbs, targetAbs); err != nil {
		return "", fmt.Errorf("restaurar: %w", err)
	}

	// El sello y los directorios intermedios se quedan vacíos al restaurar el
	// último archivo de un borrado.
	w.pruneEmptyTrashDirs(filepath.Dir(trashAbs))
	return original, nil
}

// EmptyTrash borra la papelera de verdad y devuelve cuántos archivos se llevó.
func (w *Workspace) EmptyTrash() (int, error) {
	entries, err := w.Trash()
	if err != nil {
		return 0, err
	}
	if err := os.RemoveAll(w.trashDir()); err != nil {
		return 0, fmt.Errorf("vaciar la papelera: %w", err)
	}
	return len(entries), nil
}

// validateTrashPath comprueba que la ruta que llega apunta a un archivo de la
// papelera y devuelve la ruta original que hay dentro.
//
// Hace falta una validación propia porque `SafeRel` rechaza a propósito todo lo
// que empiece por `.saveme`, que es justo donde vive la papelera. Esta función es
// la única puerta por la que se acepta una ruta de estado, así que se comprueba
// entera: prefijo, sin `..`, dentro de la papelera de verdad, y con un archivo
// detrás.
func (w *Workspace) validateTrashPath(trashRel string) (string, error) {
	clean := filepath.ToSlash(filepath.Clean(strings.TrimSpace(trashRel)))
	if clean == "" || clean == "." {
		return "", errors.New("la ruta de la papelera está vacía")
	}
	if filepath.IsAbs(clean) {
		return "", fmt.Errorf("la ruta %q es absoluta", trashRel)
	}

	prefix := StateDirName + "/trash/"
	if !strings.HasPrefix(clean, prefix) {
		return "", fmt.Errorf("la ruta %q no está en la papelera", trashRel)
	}
	// Barrera redundante a propósito: `filepath.Clean` ya colapsa los `..`, así
	// que a estas alturas no queda ninguno y esta comprobación no puede fallar
	// sola. Se deja porque es la que se lee y porque el día que alguien reordene
	// el `Clean` sigue estando.
	//
	// Lo que cierra el paso de verdad es que la ruta se componga **dentro** de la
	// papelera y que el archivo tenga que existir ahí (abajo): un intento de
	// escape no encuentra nada que restaurar. La prueba
	// `TestTrashRechazaRutasQueSeEscapan` verifica el comportamiento; no puede
	// aislar una sola línea porque las capas se solapan, y eso es el diseño.
	for _, part := range strings.Split(clean, "/") {
		if part == ".." {
			return "", fmt.Errorf("la ruta %q intenta salir de la papelera", trashRel)
		}
	}

	// `.saveme/trash/<sello>/<ruta original>`: sin las dos partes de después del
	// sello no hay nada que restaurar.
	rest := strings.TrimPrefix(clean, prefix)
	parts := strings.Split(rest, "/")
	if len(parts) < 2 {
		return "", fmt.Errorf("la ruta %q no apunta a ningún archivo", trashRel)
	}
	original := strings.Join(parts[1:], "/")
	if _, err := w.SafeRel(original); err != nil {
		return "", fmt.Errorf("la ruta original %q no es válida: %w", original, err)
	}

	// Última barrera: que el archivo exista de verdad en la papelera. Compuesto
	// así, un intento de escape no encuentra nada y no hay forma de restaurar
	// algo de fuera.
	//
	// Lo que esto **no** cubre son los symlinks —el mismo agujero que en
	// `SafeRel`—: `os.Stat` los sigue, así que un enlace dentro de la papelera
	// que apunte fuera pasa. El `Rename` mueve el enlace, no su destino, así que
	// el archivo restaurado sería un enlace a algo de fuera de la raíz.
	abs := filepath.Join(w.trashDir(), filepath.FromSlash(rest))
	if _, err := os.Stat(abs); err != nil {
		return "", fmt.Errorf("ese archivo ya no está en la papelera: %w", err)
	}
	return original, nil
}

// pruneEmptyTrashDirs borra las carpetas que quedan vacías tras un restore, sin
// tocar la raíz de la papelera.
func (w *Workspace) pruneEmptyTrashDirs(dir string) {
	root := w.trashDir()
	for dir != root && strings.HasPrefix(dir, root) {
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
