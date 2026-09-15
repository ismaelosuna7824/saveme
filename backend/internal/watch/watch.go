// Package watch mantiene el índice al día cuando los archivos cambian por fuera
// de la app.
//
// El caso de uso que justifica este paquete: el usuario tiene el editor abierto
// y un agente escribe (o reescribe) un resumen desde la sesión de otro proceso.
// Sin watcher habría que reiniciar la app o pulsar "reindexar" para verlo.
package watch

import (
	"context"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/fsnotify/fsnotify"

	"github.com/ismaelosuna/saveme/backend/internal/domain"
	"github.com/ismaelosuna/saveme/backend/internal/service"
)

// debounce es cuánto se espera tras el último cambio antes de reindexar.
//
// Un solo guardado de editor puede producir varios eventos (crear temporal,
// escribir, renombrar). Agrupar por quietud evita reindexar cuatro veces el
// mismo archivo.
const debounce = 300 * time.Millisecond

// pollInterval es cada cuánto se revisan los cambios pendientes.
const pollInterval = 150 * time.Millisecond

// Watcher vigila el workspace y reindexa lo que cambie.
type Watcher struct {
	svc *service.Service
	log *slog.Logger
}

// New construye el watcher.
func New(svc *service.Service, log *slog.Logger) *Watcher {
	if log == nil {
		log = slog.Default()
	}
	return &Watcher{svc: svc, log: log}
}

// Run vigila hasta que se cancele el contexto.
//
// fsnotify no es recursivo en macOS ni en Linux, así que hay que registrar cada
// directorio a mano y registrar los nuevos a medida que aparecen.
func (w *Watcher) Run(ctx context.Context) error {
	fsw, err := fsnotify.NewWatcher()
	if err != nil {
		return err
	}
	defer fsw.Close()

	root := w.svc.Workspace().Root()
	if err := w.addRecursive(fsw, root); err != nil {
		return err
	}

	// Los archivos modificados se acumulan aquí y se procesan cuando dejan de
	// llegar eventos para ellos.
	pending := map[string]time.Time{}

	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return nil

		case err, ok := <-fsw.Errors:
			if !ok {
				return nil
			}
			w.log.Warn("error del watcher", "err", err)

		case ev, ok := <-fsw.Events:
			if !ok {
				return nil
			}
			w.handleEvent(fsw, ev, pending)

		case <-ticker.C:
			w.flush(ctx, pending)
		}
	}
}

func (w *Watcher) handleEvent(fsw *fsnotify.Watcher, ev fsnotify.Event, pending map[string]time.Time) {
	rel, ok := w.rel(ev.Name)
	if !ok {
		return
	}
	// Ignorar el directorio de estado: escribir el índice no es un cambio de
	// contenido, y vigilarlo provocaría un bucle.
	if rel == domain.StateDirName || strings.HasPrefix(rel, domain.StateDirName+"/") {
		return
	}

	// Un directorio nuevo (por ejemplo la carpeta de un proyecto recién creado)
	// necesita su propio watch.
	if ev.Op&(fsnotify.Create|fsnotify.Rename) != 0 {
		if info, err := os.Stat(ev.Name); err == nil && info.IsDir() {
			if err := w.addRecursive(fsw, ev.Name); err != nil {
				w.log.Warn("no pude vigilar el directorio nuevo", "dir", ev.Name, "err", err)
			}
			return
		}
	}

	if !strings.EqualFold(filepath.Ext(rel), ".md") {
		return
	}
	pending[rel] = time.Now()
}

// flush reindexa los archivos que llevan suficiente tiempo sin cambios.
func (w *Watcher) flush(ctx context.Context, pending map[string]time.Time) {
	now := time.Now()
	for rel, at := range pending {
		if now.Sub(at) < debounce {
			continue
		}
		delete(pending, rel)
		if err := w.svc.ReindexFile(ctx, rel); err != nil {
			// Un archivo ilegible o a medio escribir no debe tumbar el watcher.
			w.log.Warn("no pude reindexar un archivo", "rel_path", rel, "err", err)
		}
	}
}

// addRecursive registra el directorio y todos sus descendientes.
func (w *Watcher) addRecursive(fsw *fsnotify.Watcher, dir string) error {
	root := w.svc.Workspace().Root()
	return filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			if d != nil && d.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		if !d.IsDir() {
			return nil
		}
		// No vigilar el estado interno ni directorios ocultos.
		if path != root && strings.HasPrefix(d.Name(), ".") {
			return fs.SkipDir
		}
		if err := fsw.Add(path); err != nil {
			w.log.Warn("no pude vigilar un directorio", "dir", path, "err", err)
		}
		return nil
	})
}

// rel convierte una ruta absoluta en relativa a la raíz. Devuelve false si está
// fuera del workspace.
func (w *Watcher) rel(abs string) (string, bool) {
	root := w.svc.Workspace().Root()
	r, err := filepath.Rel(root, abs)
	if err != nil || strings.HasPrefix(r, "..") {
		return "", false
	}
	return filepath.ToSlash(r), true
}
