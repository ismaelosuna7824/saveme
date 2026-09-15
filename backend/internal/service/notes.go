package service

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/ismaelosuna/saveme/backend/internal/domain"
	"github.com/ismaelosuna/saveme/backend/internal/markdown"
	"github.com/ismaelosuna/saveme/backend/internal/workspace"
)

// Notas.
//
// Las notas **no pasan por el MCP**: son de la interfaz, para que una persona
// guarde lo que quiera sin que un agente las vea ni las escriba. Comparten el
// workspace con los resúmenes y por tanto la base de datos, que aquí es lo que
// era en los resúmenes: un índice. **El disco sigue siendo la verdad** —cada nota
// es un `.md` en `<raíz>/notes/`— y todo esto se puede reconstruir con un
// reindexado.

// NoteTree devuelve el árbol completo de notas, en plano.
func (s *Service) NoteTree(ctx context.Context) ([]workspace.NoteEntry, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return s.ws.NotesTree()
}

// NoteRead devuelve el contenido de una nota, leído del disco.
func (s *Service) NoteRead(ctx context.Context, rel string) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	return s.ws.NoteRead(rel)
}

// NoteSave guarda una nota y la reindexa.
//
// Escribe primero y indexa después, en ese orden a propósito: si el indexado
// fallara, el archivo ya está a salvo en disco y el índice se puede reconstruir.
// Al revés se perdería el trabajo.
func (s *Service) NoteSave(ctx context.Context, rel, content string) (domain.NoteMeta, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if err := s.ws.NoteWrite(rel, content); err != nil {
		return domain.NoteMeta{}, err
	}
	return s.indexNoteLocked(ctx, rel)
}

// NoteCreate deja una nota nueva con un encabezado y la indexa.
func (s *Service) NoteCreate(ctx context.Context, rel, title string) (domain.NoteMeta, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if err := s.ws.NoteCreate(rel, title); err != nil {
		return domain.NoteMeta{}, err
	}
	return s.indexNoteLocked(ctx, rel)
}

// NoteMkdir crea una carpeta vacía.
//
// Las carpetas no se indexan: no tienen contenido que buscar, y el árbol se lee
// del disco. Indexarlas obligaría a mantener sincronizadas dos representaciones
// del mismo árbol, que es donde aparecen las carpetas fantasma.
func (s *Service) NoteMkdir(ctx context.Context, rel string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if err := ctx.Err(); err != nil {
		return err
	}
	return s.ws.NoteMkdir(rel)
}

// NoteMove mueve o renombra una nota o una carpeta con todo su contenido.
//
// Devuelve cuántos documentos se movieron en el índice. El disco primero y el
// índice después, por el mismo motivo que en `NoteSave`.
func (s *Service) NoteMove(ctx context.Context, from, to string) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if err := s.ws.NoteMove(from, to); err != nil {
		return 0, err
	}
	return s.st.MoveNotePrefix(
		ctx,
		workspace.NotesDirName+"/"+strings.TrimPrefix(from, workspace.NotesDirName+"/"),
		workspace.NotesDirName+"/"+strings.TrimPrefix(to, workspace.NotesDirName+"/"),
	)
}

// NoteDelete archiva una nota o una carpeta entera y la saca del índice.
func (s *Service) NoteDelete(ctx context.Context, rel string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	trash, err := s.ws.NoteDelete(rel)
	if err != nil {
		return "", err
	}
	prefix := workspace.NotesDirName + "/" + strings.TrimPrefix(rel, workspace.NotesDirName+"/")
	if _, err := s.st.ForgetNotePrefix(ctx, prefix); err != nil {
		return trash, fmt.Errorf("el archivo se archivó, pero no pude sacarlo del índice: %w", err)
	}
	return trash, nil
}

// NoteSearch busca en el título y el cuerpo de las notas.
func (s *Service) NoteSearch(ctx context.Context, query string, limit int) ([]domain.NoteMeta, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return s.st.SearchNotes(ctx, query, limit)
}

// ReindexNotes reconcilia el índice con lo que hay en disco.
//
// Es lo que hace que la promesa «el disco manda» sea cierta también para las notas:
// se indexa lo que aparezca y se olvida lo que ya no esté. Se llama desde el
// reindexado general, así que `saveme reindex` reconstruye todo de una vez.
func (s *Service) ReindexNotes(ctx context.Context) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	return s.reindexNotesLocked(ctx)
}

func (s *Service) reindexNotesLocked(ctx context.Context) (int, error) {
	entries, err := s.ws.NotesTree()
	if err != nil {
		return 0, err
	}

	// Lo que sigue en disco.
	onDisk := make(map[string]bool, len(entries))
	indexed := 0
	for _, entry := range entries {
		if entry.IsDir {
			continue
		}
		if !strings.EqualFold(filepath.Ext(entry.Name), ".md") {
			// Solo se indexan markdown: una imagen en la carpeta de notas no se
			// busca, y su título no significaría nada.
			continue
		}
		onDisk[workspace.NotesDirName+"/"+entry.RelPath] = true
		if _, err := s.indexNoteLocked(ctx, entry.RelPath); err != nil {
			return indexed, err
		}
		indexed++
	}

	// Y lo que el índice recuerda pero ya no está.
	known, err := s.st.NotePaths(ctx)
	if err != nil {
		return indexed, err
	}
	for _, rel := range known {
		if onDisk[rel] {
			continue
		}
		if err := s.st.ForgetNote(ctx, rel); err != nil {
			return indexed, err
		}
	}
	return indexed, nil
}

// indexNoteLocked lee una nota del disco y la mete en el índice.
//
// El título sale del primer encabezado del markdown, y si no hay, del nombre del
// archivo: es lo que el usuario ve en el árbol, así que el índice tiene que decir
// lo mismo que la pantalla.
func (s *Service) indexNoteLocked(ctx context.Context, rel string) (domain.NoteMeta, error) {
	content, err := s.ws.NoteRead(rel)
	if err != nil {
		return domain.NoteMeta{}, err
	}
	full := workspace.NotesDirName + "/" + strings.TrimPrefix(rel, workspace.NotesDirName+"/")

	filename := filepath.Base(full)
	meta := domain.NoteMeta{
		RelPath:   full,
		Title:     markdown.DeriveTitle(content, filename),
		SizeBytes: int64(len(content)),
	}
	if info, statErr := os.Stat(filepath.Join(s.ws.Root(), filepath.FromSlash(full))); statErr == nil {
		meta.ModifiedAt = info.ModTime().UTC()
	}
	if err := s.st.UpsertNote(ctx, meta, content); err != nil {
		return domain.NoteMeta{}, err
	}
	return meta, nil
}
