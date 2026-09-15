package service

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"path"
	"strings"
	"time"

	"github.com/ismaelosuna/saveme/backend/internal/domain"
	"github.com/ismaelosuna/saveme/backend/internal/markdown"
	"github.com/ismaelosuna/saveme/backend/internal/store"
)

// UpdateMeta cambia la categoría y el título de un resumen ya escrito.
//
// Existe porque hasta ahora solo se podía cambiar el **contenido**: si un agente
// archivaba algo bajo `feature` y era un `fix`, o el título salía malo, no había
// forma de arreglarlo desde la app — había que mover el archivo a mano y
// reindexar. El MCP sí puede redirigir una propuesta antes de confirmarla, pero
// después ya no. Esto cierra esa asimetría.
//
// La categoría manda la **carpeta**: mover el archivo es lo que la cambia, porque
// es de donde la deduce el reconciliador. El frontmatter se reescribe para que
// siga diciendo la verdad, no para decidir.
//
// Sobre el orden de las operaciones: se escribe el archivo nuevo **antes** de
// borrar el viejo, y nunca se pisa uno existente. Si algo falla a mitad, lo peor
// que pasa es que queden dos copias —molesto y visible— en vez de ninguna, que
// sería una pérdida silenciosa.
func (s *Service) UpdateMeta(ctx context.Context, id, category, title string) (*domain.SummaryMeta, error) {
	meta, err := s.st.GetSummary(ctx, id)
	if errors.Is(err, fs.ErrNotExist) || errors.Is(err, store.ErrNotFound) {
		return nil, fmt.Errorf("%w: el resumen %q no existe", ErrNotFound, id)
	}
	if err != nil {
		return nil, err
	}

	categoria := strings.TrimSpace(category)
	if categoria == "" {
		categoria = meta.Category
	}
	cat, ok := domain.CategoryByKey(categoria)
	if !ok {
		return nil, fmt.Errorf("%w: la categoría %q no existe", ErrInvalid, category)
	}

	titulo := strings.TrimSpace(title)
	if titulo == "" {
		titulo = meta.Title
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := s.ws.ReadFile(meta.RelPath)
	if err != nil {
		return nil, err
	}
	doc := markdown.Parse(data)
	fm := domain.Frontmatter{}
	if doc.Frontmatter != nil {
		fm = *doc.Frontmatter
	}
	fm.ID = meta.ID
	fm.Project = meta.ProjectSlug
	fm.Category = cat.Key
	fm.Title = titulo
	fm.UpdatedAt = time.Now().UTC()
	if fm.CreatedAt.IsZero() {
		fm.CreatedAt = meta.CreatedAt
	}
	if fm.Author == "" {
		fm.Author = meta.Author
	}
	if fm.Status == "" {
		fm.Status = "active"
	}

	contenido, err := markdown.Render(fm, doc.Body)
	if err != nil {
		return nil, err
	}

	// El nombre del archivo **no cambia**: solo cambia de carpeta. Renombrarlo al
	// retitular sería una sorpresa —enlaces, historiales de git y búsquedas
	// apuntan a esa ruta— y el título se lee del frontmatter, no del nombre.
	destino := path.Join(meta.ProjectSlug, cat.Folder, path.Base(meta.RelPath))
	// SafeRel normaliza y comprueba que la ruta no se escapa del workspace.
	if _, err := s.ws.SafeRel(destino); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalid, err)
	}

	if destino == meta.RelPath {
		// Solo cambió el título: se reescribe encima.
		if err := s.ws.WriteAtomic(destino, contenido, true); err != nil {
			return nil, err
		}
	} else {
		// `WriteAtomic` con overwrite=false se niega si ya hay algo ahí, que es lo
		// que queremos: mover encima de otro resumen sería perderlo.
		if err := s.ws.WriteAtomic(destino, contenido, false); err != nil {
			return nil, err
		}
		if _, err := s.ws.Delete(meta.RelPath, true); err != nil {
			// El nuevo ya está escrito, así que no se pierde nada: se avisa y se
			// deja el índice coherente con el archivo que sí existe.
			s.reindexFileLocked(ctx, destino)
			return nil, fmt.Errorf("el resumen se copió a %s pero no pude borrar el original %s: %w",
				destino, meta.RelPath, err)
		}
		s.st.DeleteSummary(ctx, meta.ID)
	}

	nuevo, err := s.indexFile(ctx, destino, contenido, meta.ID, meta.ProjectSlug, cat.Key, titulo, fm, doc.Body)
	if err != nil {
		return nil, err
	}
	return &nuevo, nil
}
