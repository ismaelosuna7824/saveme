package workspace

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

// Historial de versiones de un resumen.
//
// Cada vez que SaveMe va a reescribir un resumen que ya existe —el agente lo
// actualiza, el usuario lo edita o restaura una versión— guarda antes una copia
// de lo que había en `.saveme/history/<id>/<sello>.<motivo>.md`. La papelera
// protege del borrado; esto protege de la reescritura, que pierde lo mismo: una
// actualización del agente que se deja una sección fuera la borra igual que un
// `rm`, y sin esta copia no hay de dónde recuperarla.
//
// Como la papelera, vive en disco y no en el índice: listarlo es leer una
// carpeta, y borrar el índice no se lleva el historial por delante.

// VersionReason es por qué se guardó una versión: qué la reemplazó.
type VersionReason string

const (
	// VersionAgent: la reemplazó una actualización del agente (propuesta con target).
	VersionAgent VersionReason = "agent"
	// VersionEdit: la reemplazó una edición desde la app.
	VersionEdit VersionReason = "edit"
	// VersionRestore: la reemplazó la restauración de otra versión.
	VersionRestore VersionReason = "restore"
)

// VersionEntry es una versión guardada de un resumen.
type VersionEntry struct {
	// Version identifica la versión dentro de su resumen: `<sello>.<motivo>`.
	// Es lo que se manda para leerla o restaurarla.
	Version string `json:"version"`
	// ReplacedAt es cuándo dejó de ser el contenido del archivo.
	ReplacedAt time.Time `json:"replaced_at"`
	// Reason es qué la reemplazó.
	Reason VersionReason `json:"reason"`
	Size   int64         `json:"size"`
}

// versionStampLayout lleva milisegundos: dos guardados del mismo resumen en el
// mismo segundo son normales (el agente actualiza y el usuario corrige una
// errata) y cada uno merece su versión.
const versionStampLayout = "20060102-150405.000"

var (
	versionPattern = regexp.MustCompile(`^(\d{8}-\d{6}\.\d{3})\.(agent|edit|restore)$`)
	safeIDPattern  = regexp.MustCompile(`^[A-Za-z0-9_-]{1,100}$`)
)

// ErrInvalidVersion: el nombre de versión no tiene la forma que produce SaveVersion.
var ErrInvalidVersion = errors.New("formato de versión inválido")

func (w *Workspace) historyRoot() string {
	return filepath.Join(w.stateDir(), "history")
}

// historyDir es la carpeta de versiones de un resumen.
//
// El id sale del frontmatter, y el frontmatter lo puede escribir cualquiera: un
// id con `/` o `..` no puede convertirse en una ruta. Los ids de SaveMe (`sm_…`,
// `un_…`) se usan tal cual, que es lo que permite reconocer la carpeta a ojo;
// cualquier otra cosa se resume con SHA-256, que siempre es un nombre válido y
// sigue siendo el mismo para el mismo id.
func (w *Workspace) historyDir(id string) (string, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return "", errors.New("hace falta el id del resumen")
	}
	key := id
	if !safeIDPattern.MatchString(id) {
		sum := sha256.Sum256([]byte(id))
		key = "x_" + hex.EncodeToString(sum[:16])
	}
	return filepath.Join(w.historyRoot(), key), nil
}

// SaveVersion guarda `data` como la versión de `id` que acaba de reemplazarse.
//
// Se escribe con un temporal y un `rename`, como el resto de archivos: una
// versión a medias sería peor que ninguna, porque restaurarla rompería el
// resumen. Si ya hay una versión con el mismo sello, se avanza un milisegundo:
// pisarla sería perder justo lo que esto existe para conservar.
func (w *Workspace) SaveVersion(id string, data []byte, reason VersionReason, at time.Time) (VersionEntry, error) {
	switch reason {
	case VersionAgent, VersionEdit, VersionRestore:
	default:
		return VersionEntry{}, fmt.Errorf("motivo de versión desconocido %q", reason)
	}
	dir, err := w.historyDir(id)
	if err != nil {
		return VersionEntry{}, err
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return VersionEntry{}, fmt.Errorf("crear el historial: %w", err)
	}

	at = at.UTC().Truncate(time.Millisecond)
	var version, final string
	for {
		version = at.Format(versionStampLayout) + "." + string(reason)
		final = filepath.Join(dir, version+".md")
		if _, err := os.Stat(final); errors.Is(err, fs.ErrNotExist) {
			break
		} else if err != nil {
			return VersionEntry{}, err
		}
		at = at.Add(time.Millisecond)
	}

	tmp, err := os.CreateTemp(dir, ".saveme-tmp-*")
	if err != nil {
		return VersionEntry{}, fmt.Errorf("crear temporal del historial: %w", err)
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return VersionEntry{}, fmt.Errorf("escribir la versión: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return VersionEntry{}, fmt.Errorf("sincronizar la versión: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return VersionEntry{}, fmt.Errorf("cerrar la versión: %w", err)
	}
	if err := os.Rename(tmpName, final); err != nil {
		return VersionEntry{}, fmt.Errorf("guardar la versión: %w", err)
	}
	return VersionEntry{Version: version, ReplacedAt: at, Reason: reason, Size: int64(len(data))}, nil
}

// Versions lista las versiones guardadas de un resumen, de la más reciente a la
// más antigua. Un resumen sin historial devuelve una lista vacía, no un error.
func (w *Workspace) Versions(id string) ([]VersionEntry, error) {
	dir, err := w.historyDir(id)
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(dir)
	if errors.Is(err, fs.ErrNotExist) {
		return []VersionEntry{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("leer el historial: %w", err)
	}

	out := make([]VersionEntry, 0, len(entries))
	for _, e := range entries {
		if !e.Type().IsRegular() {
			continue
		}
		entry, ok := parseVersion(strings.TrimSuffix(e.Name(), ".md"))
		if !ok || !strings.HasSuffix(e.Name(), ".md") {
			// Temporales a medio escribir u otra cosa que no es una versión.
			continue
		}
		if info, err := e.Info(); err == nil {
			entry.Size = info.Size()
		}
		out = append(out, entry)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Version > out[j].Version })
	return out, nil
}

// ReadVersion devuelve el contenido de una versión.
//
// `version` llega de fuera, así que tiene que tener exactamente la forma que
// produce `SaveVersion`: ni barras, ni `..`, ni nada que no sea un sello y un
// motivo. Con eso no hay forma de componer una ruta que salga de la carpeta.
func (w *Workspace) ReadVersion(id, version string) (VersionEntry, []byte, error) {
	entry, ok := parseVersion(version)
	if !ok {
		return VersionEntry{}, nil, fmt.Errorf("%w: %q", ErrInvalidVersion, version)
	}
	dir, err := w.historyDir(id)
	if err != nil {
		return VersionEntry{}, nil, err
	}
	data, err := os.ReadFile(filepath.Join(dir, version+".md"))
	if err != nil {
		return VersionEntry{}, nil, err
	}
	entry.Size = int64(len(data))
	return entry, data, nil
}

// LatestVersion devuelve la versión más reciente, si hay alguna.
func (w *Workspace) LatestVersion(id string) (VersionEntry, bool, error) {
	versions, err := w.Versions(id)
	if err != nil || len(versions) == 0 {
		return VersionEntry{}, false, err
	}
	return versions[0], true, nil
}

// DeleteHistory borra todas las versiones de un resumen. Es para cuando el
// resumen se borra de verdad: quedarse con sus versiones sería conservar justo lo
// que el usuario pidió destruir.
func (w *Workspace) DeleteHistory(id string) error {
	dir, err := w.historyDir(id)
	if err != nil {
		return err
	}
	if err := os.RemoveAll(dir); err != nil {
		return fmt.Errorf("borrar el historial: %w", err)
	}
	return nil
}

func parseVersion(version string) (VersionEntry, bool) {
	m := versionPattern.FindStringSubmatch(version)
	if m == nil {
		return VersionEntry{}, false
	}
	at, err := time.ParseInLocation(versionStampLayout, m[1], time.UTC)
	if err != nil {
		return VersionEntry{}, false
	}
	return VersionEntry{Version: version, ReplacedAt: at, Reason: VersionReason(m[2])}, true
}
