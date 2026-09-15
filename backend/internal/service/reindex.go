package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/ismaelosuna/saveme/backend/internal/domain"
	"github.com/ismaelosuna/saveme/backend/internal/markdown"
	"github.com/ismaelosuna/saveme/backend/internal/store"
	"github.com/ismaelosuna/saveme/backend/internal/workspace"
)

// ReindexResult resume una reconciliación.
type ReindexResult struct {
	// Indexed es el total de archivos procesados (added + updated).
	Indexed   int `json:"indexed"`
	Added     int `json:"added"`
	Updated   int `json:"updated"`
	Removed   int `json:"removed"`
	Unchanged int `json:"unchanged"`
	Projects  int `json:"projects_discovered"`
	// Notes es cuántas notas se indexaron. Van aparte de `Indexed` porque no son
	// resúmenes: mezclarlas en el mismo contador haría que el número que ve el
	// usuario no significara nada.
	Notes      int      `json:"notes_indexed"`
	DurationMs int64    `json:"duration_ms"`
	Errors     []string `json:"errors,omitempty"`
}

// Reindex reconcilia el índice con lo que hay en disco.
//
// Es la operación que hace que el índice sea de verdad descartable, y también
// el mecanismo por el que la app ve los resúmenes que un agente escribió con la
// app cerrada: no hace falta que el MCP notifique nada, basta con que el
// archivo esté ahí.
//
// La reconciliación es incremental: solo se leen los archivos cuyo mtime o
// tamaño cambiaron respecto a la última huella guardada. Un workspace con miles
// de notas se reindexa en milisegundos si nada cambió.
func (s *Service) Reindex(ctx context.Context) (*ReindexResult, error) {
	start := time.Now()
	res := &ReindexResult{}

	entries, err := s.ws.Walk()
	if err != nil {
		return nil, fmt.Errorf("recorrer el workspace: %w", err)
	}
	states, err := s.st.ListFileStates(ctx)
	if err != nil {
		return nil, err
	}

	if err := s.registerDiscoveredProjects(ctx, entries, res); err != nil {
		return nil, err
	}

	seen := make(map[string]bool, len(entries))
	for _, entry := range entries {
		seen[entry.RelPath] = true

		prev, known := states[entry.RelPath]
		if known && prev.MtimeNs == entry.ModTime.UnixNano() && prev.SizeBytes == entry.Size {
			res.Unchanged++
			continue
		}

		if err := s.indexDiscoveredFile(ctx, entry); err != nil {
			res.Errors = append(res.Errors, fmt.Sprintf("%s: %v", entry.RelPath, err))
			continue
		}
		res.Indexed++
		if known {
			res.Updated++
		} else {
			res.Added++
		}
	}

	// Archivos que estaban indexados y ya no existen en disco.
	for rel := range states {
		if seen[rel] {
			continue
		}
		if err := s.forgetFile(ctx, rel); err != nil {
			res.Errors = append(res.Errors, fmt.Sprintf("%s: %v", rel, err))
			continue
		}
		res.Removed++
	}

	// Las notas se reconcilian aquí también: `saveme reindex` reconstruye **todo**
	// lo que se puede reconstruir, y si dejara las notas fuera, borrar la base
	// perdería la búsqueda de notas para siempre.
	notes, err := s.reindexNotesLocked(ctx)
	if err != nil {
		res.Errors = append(res.Errors, fmt.Sprintf("notas: %v", err))
	}
	res.Notes = notes

	res.DurationMs = time.Since(start).Milliseconds()
	_, _ = s.st.AppendEvent(ctx, store.EventIndexRebuilt, map[string]any{
		"indexed": res.Indexed, "added": res.Added, "updated": res.Updated,
		"removed": res.Removed, "unchanged": res.Unchanged, "notes": res.Notes,
	})
	return res, nil
}

// registerDiscoveredProjects da de alta en el índice los proyectos que existen
// en disco pero no estaban registrados.
//
// Deliberadamente NO crea las carpetas de categoría: si el usuario tiene una
// carpeta con sus propias notas, SaveMe no le impone una estructura. Solo los
// proyectos creados desde SaveMe nacen con las nueve categorías.
func (s *Service) registerDiscoveredProjects(ctx context.Context, entries []workspace.FileEntry, res *ReindexResult) error {
	known := map[string]bool{}
	slugs, err := s.st.ProjectSlugs(ctx)
	if err != nil {
		return err
	}
	for _, slug := range slugs {
		known[slug] = true
	}

	done := map[string]bool{}
	for _, entry := range entries {
		if done[entry.ProjectSlug] || known[entry.ProjectSlug] {
			continue
		}
		done[entry.ProjectSlug] = true

		now := time.Now().UTC()
		p := domain.Project{
			Slug:      entry.ProjectSlug,
			Name:      entry.ProjectSlug,
			Path:      s.ws.ProjectDir(entry.ProjectSlug),
			CreatedAt: now,
			UpdatedAt: now,
		}
		if err := s.st.UpsertProject(ctx, p); err != nil {
			return err
		}
		res.Projects++
	}
	return nil
}

// indexDiscoveredFile indexa un archivo encontrado en el disco.
func (s *Service) indexDiscoveredFile(ctx context.Context, entry workspace.FileEntry) error {
	data, err := os.ReadFile(entry.AbsPath)
	if err != nil {
		return err
	}
	doc := markdown.Parse(data)
	contentHash := hashBytes(data)
	now := time.Now().UTC()

	// Resolver el id: el del frontmatter manda; si no hay, se conserva el que ya
	// tuviéramos para esa ruta; si tampoco, se deriva de la ruta para que sea
	// estable entre reindexados.
	id := ""
	if doc.Frontmatter != nil {
		id = strings.TrimSpace(doc.Frontmatter.ID)
	}
	if id == "" {
		if existing, err := s.st.GetSummaryByRelPath(ctx, entry.RelPath); err == nil {
			id = existing.ID
		}
	}
	if id == "" {
		id = derivedID(entry.RelPath)
	}

	// La carpeta manda sobre el frontmatter: si el usuario movió el archivo a
	// otra categoría, la intención está en el movimiento. El frontmatter solo
	// decide cuando la carpeta no es una categoría conocida.
	categoryKey := entry.Category.Key
	if categoryKey == domain.CategoryUncategorized && doc.Frontmatter != nil {
		if c, ok := domain.CategoryByKey(doc.Frontmatter.Category); ok {
			categoryKey = c.Key
		}
	}

	status := domain.StatusUnmanaged
	title := markdown.DeriveTitle(doc.Body, filepath.Base(entry.RelPath))
	summaryLine := markdown.DeriveSummaryLine(doc.Body)
	author := "human"
	agent := ""
	commit := ""
	var tags, filesTouched, related []string
	createdAt := entry.ModTime.UTC()

	if fm := doc.Frontmatter; fm != nil && strings.TrimSpace(fm.ID) != "" {
		status = fm.Status
		if status == "" {
			status = domain.StatusConfirmed
		}
		if strings.TrimSpace(fm.Title) != "" {
			title = fm.Title
		}
		if strings.TrimSpace(fm.Summary) != "" {
			summaryLine = fm.Summary
		}
		if fm.Author != "" {
			author = fm.Author
		}
		agent = fm.Agent
		commit = fm.Commit
		tags = store.TagList(fm.Tags)
		filesTouched = fm.FilesTouched
		related = fm.Related
		if !fm.CreatedAt.IsZero() {
			createdAt = fm.CreatedAt
		}
	}

	// El proyecto tiene que existir en el índice antes de la clave foránea.
	if _, err := s.st.GetProject(ctx, entry.ProjectSlug); errors.Is(err, store.ErrNotFound) {
		if err := s.st.UpsertProject(ctx, domain.Project{
			Slug: entry.ProjectSlug, Name: entry.ProjectSlug,
			Path: s.ws.ProjectDir(entry.ProjectSlug), CreatedAt: now, UpdatedAt: now,
		}); err != nil {
			return err
		}
	}

	meta := domain.SummaryMeta{
		ID:           id,
		ProjectSlug:  entry.ProjectSlug,
		Category:     categoryKey,
		Title:        title,
		SummaryLine:  summaryLine,
		RelPath:      entry.RelPath,
		Status:       status,
		Author:       author,
		Agent:        agent,
		CommitSHA:    commit,
		Tags:         tags,
		FilesTouched: filesTouched,
		Related:      related,
		WordCount:    domain.WordCount(doc.Body),
		SizeBytes:    entry.Size,
		CreatedAt:    createdAt,
		UpdatedAt:    now,
		ContentHash:  contentHash,
	}
	if err := s.st.UpsertSummary(ctx, meta, doc.Body); err != nil {
		return err
	}
	return s.st.SetFileState(ctx, store.FileState{
		RelPath:     entry.RelPath,
		MtimeNs:     entry.ModTime.UnixNano(),
		SizeBytes:   entry.Size,
		ContentHash: contentHash,
		IndexedAt:   now,
	})
}

// forgetFile quita del índice un archivo que ya no está en disco.
func (s *Service) forgetFile(ctx context.Context, rel string) error {
	if meta, err := s.st.GetSummaryByRelPath(ctx, rel); err == nil {
		if err := s.st.DeleteSummary(ctx, meta.ID); err != nil {
			return err
		}
		_, _ = s.st.AppendEvent(ctx, store.EventSummaryDeleted, map[string]any{
			"id": meta.ID, "rel_path": rel, "reason": "archivo ausente",
		})
	} else if !errors.Is(err, store.ErrNotFound) {
		return err
	}
	return s.st.DeleteFileState(ctx, rel)
}

// ReindexFile reindexa un solo archivo. Lo usa el watcher, que ya sabe qué
// cambió y no necesita recorrer todo el workspace.
func (s *Service) ReindexFile(ctx context.Context, rel string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.reindexFileLocked(ctx, rel)
}

// reindexFileLocked es el cuerpo de `ReindexFile` para quien **ya tiene el
// mutex**.
//
// Existe por un motivo concreto: `sync.Mutex` no es reentrante, así que un método
// que bloquea y luego llama a otro que también bloquea se queda colgado para
// siempre. Pasó con `Restore`, que toma el lock para mover el archivo y después
// quería reindexarlo: la petición no volvía nunca y el mutex quedaba tomado, con
// lo que la app entera dejaba de responder. La regla es que los métodos públicos
// bloquean y los `…Locked` no.
func (s *Service) reindexFileLocked(ctx context.Context, rel string) error {
	// La carpeta de notas no es historial. El watcher avisa de **cualquier** .md
	// que cambie, incluidos los de `notes/`, así que sin esta bifurcación cada
	// nota editada —desde la interfaz o desde vim— acababa indexada como un
	// resumen. Excluirla en `Walk` no bastaba: el watcher no pasa por ahí.
	//
	// Y no se descarta sin más: se reindexa en **su** índice, que es lo que hace
	// que editar una nota por fuera se refleje en la búsqueda.
	if isNotePath(rel) {
		return s.reindexNoteFileLocked(ctx, rel)
	}

	abs, err := s.ws.Abs(rel)
	if err != nil {
		return err
	}
	info, err := os.Stat(abs)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return s.forgetFile(ctx, rel)
		}
		return err
	}
	parts := strings.Split(filepath.ToSlash(rel), "/")
	if len(parts) < 2 {
		return nil
	}

	// Si la huella coincide, no hay nada que hacer. Importa porque SaveMe
	// escribe los archivos con rename atómico y el watcher ve su propio
	// guardado: sin este corte se emitiría un evento duplicado por cada
	// escritura de la propia app.
	if prev, known, err := s.st.GetFileState(ctx, filepath.ToSlash(rel)); err == nil && known {
		if prev.MtimeNs == info.ModTime().UnixNano() && prev.SizeBytes == info.Size() {
			return nil
		}
	}

	entry := workspace.FileEntry{
		RelPath:     filepath.ToSlash(rel),
		AbsPath:     abs,
		ProjectSlug: parts[0],
		Category:    domain.CategoryByFolder(parts[1]),
		ModTime:     info.ModTime(),
		Size:        info.Size(),
	}
	if err := s.indexDiscoveredFile(ctx, entry); err != nil {
		return err
	}
	if meta, err := s.st.GetSummaryByRelPath(ctx, entry.RelPath); err == nil {
		_, _ = s.st.AppendEvent(ctx, store.EventSummaryUpdated, map[string]any{
			"id": meta.ID, "project_slug": meta.ProjectSlug,
			"category": meta.Category, "rel_path": meta.RelPath, "external": true,
		})
	}
	return nil
}

// ResetIndex borra el índice y lo reconstruye desde cero. Es la salida de
// emergencia si el índice queda inconsistente.
func (s *Service) ResetIndex(ctx context.Context) (*ReindexResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if err := s.st.ClearIndex(ctx); err != nil {
		return nil, err
	}
	res, err := s.Reindex(ctx)
	if err != nil {
		return nil, err
	}
	if err := s.st.RebuildSearch(ctx); err != nil {
		return nil, err
	}
	return res, nil
}

// derivedID genera un id estable para un archivo que no tiene frontmatter de
// SaveMe. Derivarlo de la ruta (y no del contenido) hace que reindexar no
// cambie el id, así que la UI no pierde el archivo seleccionado.
func derivedID(rel string) string {
	sum := sha256.Sum256([]byte("saveme:unmanaged:" + rel))
	return "un_" + hex.EncodeToString(sum[:])[:24]
}

// isNotePath dice si una ruta del workspace está dentro de la carpeta de notas.
func isNotePath(rel string) bool {
	clean := strings.TrimPrefix(filepath.ToSlash(rel), "./")
	return clean == workspace.NotesDirName || strings.HasPrefix(clean, workspace.NotesDirName+"/")
}

// reindexNoteFileLocked actualiza el índice de notas para un archivo suelto.
//
// Si el archivo ya no está, se olvida: el watcher también avisa de los borrados, y
// una nota fantasma en la búsqueda es peor que no encontrarla.
func (s *Service) reindexNoteFileLocked(ctx context.Context, rel string) error {
	noteRel := strings.TrimPrefix(filepath.ToSlash(rel), workspace.NotesDirName+"/")
	if _, err := s.ws.NoteRead(noteRel); err != nil {
		if errors.Is(err, fs.ErrNotExist) || errors.Is(err, os.ErrNotExist) {
			_, forgetErr := s.st.ForgetNotePrefix(ctx, filepath.ToSlash(rel))
			return forgetErr
		}
		return err
	}
	_, err := s.indexNoteLocked(ctx, noteRel)
	return err
}
