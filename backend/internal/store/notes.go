package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/ismaelosuna/saveme/backend/internal/domain"
)

// UpsertNote indexa una nota: su título para listar y su cuerpo para buscar.
//
// Es idempotente por `rel_path`, igual que `UpsertSummary` por id: volver a
// indexar la misma nota la actualiza en vez de duplicarla.
func (s *Store) UpsertNote(ctx context.Context, n domain.NoteMeta, body string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO notes(rel_path, title, body, size_bytes, modified_at)
		VALUES(?,?,?,?,?)
		ON CONFLICT(rel_path) DO UPDATE SET
			title = excluded.title,
			body = excluded.body,
			size_bytes = excluded.size_bytes,
			modified_at = excluded.modified_at`,
		n.RelPath, n.Title, body, n.SizeBytes, ts(n.ModifiedAt)); err != nil {
		return fmt.Errorf("indexar la nota %s: %w", n.RelPath, err)
	}

	if s.fts {
		// Se borra y se inserta en vez de actualizar: en FTS5 no hay `ON CONFLICT`
		// sobre una tabla virtual, y el borrado por clave es barato.
		if _, err := tx.ExecContext(ctx, `DELETE FROM notes_fts WHERE rel_path = ?`, n.RelPath); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO notes_fts(rel_path, title, body) VALUES(?,?,?)`,
			n.RelPath, n.Title, body); err != nil {
			return fmt.Errorf("indexar %s para búsqueda: %w", n.RelPath, err)
		}
	}
	return tx.Commit()
}

// ForgetNote saca una nota del índice.
func (s *Store) ForgetNote(ctx context.Context, relPath string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `DELETE FROM notes WHERE rel_path = ?`, relPath); err != nil {
		return err
	}
	if s.fts {
		if _, err := tx.ExecContext(ctx, `DELETE FROM notes_fts WHERE rel_path = ?`, relPath); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// MoveNotePrefix reescribe las rutas indexadas al mover una nota o una carpeta.
//
// Mover una carpeta cambia la ruta de todo lo que lleva dentro. Se resuelve con un
// `UPDATE` sobre el prefijo en vez de recorrer el disco: el contenido no cambió,
// solo su sitio, así que releer los archivos sería trabajo tirado.
//
// El `LIKE` va con el separador pegado a propósito: sin él, mover `notas/a`
// también arrastraría `notas/ab`, que no tiene nada que ver.
func (s *Store) MoveNotePrefix(ctx context.Context, from, to string) (int, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	// Las filas que se van a mover, para poder reindexar su FTS con la ruta nueva.
	rows, err := tx.QueryContext(ctx,
		`SELECT rel_path, title, body, size_bytes, modified_at FROM notes
		 WHERE rel_path = ? OR rel_path LIKE ? ESCAPE '\'`,
		from, escapeLike(from)+"/%")
	if err != nil {
		return 0, err
	}
	var moved []domain.NoteMeta
	var bodies []string
	for rows.Next() {
		var n domain.NoteMeta
		var body, modified string
		if err := rows.Scan(&n.RelPath, &n.Title, &body, &n.SizeBytes, &modified); err != nil {
			rows.Close()
			return 0, err
		}
		n.ModifiedAt = parseTS(modified)
		moved = append(moved, n)
		bodies = append(bodies, body)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}
	if len(moved) == 0 {
		return 0, nil
	}

	for i, n := range moved {
		newPath := to + strings.TrimPrefix(n.RelPath, from)
		if _, err := tx.ExecContext(ctx,
			`UPDATE notes SET rel_path = ? WHERE rel_path = ?`, newPath, n.RelPath); err != nil {
			return 0, fmt.Errorf("mover %s en el índice: %w", n.RelPath, err)
		}
		if s.fts {
			if _, err := tx.ExecContext(ctx, `DELETE FROM notes_fts WHERE rel_path = ?`, n.RelPath); err != nil {
				return 0, err
			}
			if _, err := tx.ExecContext(ctx,
				`INSERT INTO notes_fts(rel_path, title, body) VALUES(?,?,?)`,
				newPath, n.Title, bodies[i]); err != nil {
				return 0, err
			}
		}
	}
	return len(moved), tx.Commit()
}

// SearchNotes busca texto libre en el título y el cuerpo de las notas.
//
// Comparte el criterio de `SearchSummaries`: FTS5 con ranking si la build lo trae,
// y un `LIKE` si no. Que la búsqueda se degrade es mejor que no tenerla.
func (s *Store) SearchNotes(ctx context.Context, query string, limit int) ([]domain.NoteMeta, error) {
	q := strings.TrimSpace(query)
	if q == "" {
		return []domain.NoteMeta{}, nil
	}
	if limit <= 0 {
		limit = 50
	}

	var (
		rows *sql.Rows
		err  error
	)
	if s.fts {
		rows, err = s.db.QueryContext(ctx, `
			SELECT n.rel_path, n.title, n.size_bytes, n.modified_at
			FROM notes_fts f
			JOIN notes n ON n.rel_path = f.rel_path
			WHERE notes_fts MATCH ?
			ORDER BY bm25(notes_fts, 0.0, 10.0, 1.0) ASC
			LIMIT ?`, ftsQuery(q), limit)
	} else {
		like := "%" + escapeLike(strings.ToLower(q)) + "%"
		rows, err = s.db.QueryContext(ctx, `
			SELECT rel_path, title, size_bytes, modified_at
			FROM notes
			WHERE LOWER(title) LIKE ? ESCAPE '\' OR LOWER(body) LIKE ? ESCAPE '\'
			ORDER BY modified_at DESC
			LIMIT ?`, like, like, limit)
	}
	if err != nil {
		return nil, fmt.Errorf("buscar notas: %w", err)
	}
	defer rows.Close()

	out := make([]domain.NoteMeta, 0)
	for rows.Next() {
		var n domain.NoteMeta
		var modified string
		if err := rows.Scan(&n.RelPath, &n.Title, &n.SizeBytes, &modified); err != nil {
			return nil, err
		}
		n.ModifiedAt = parseTS(modified)
		out = append(out, n)
	}
	return out, rows.Err()
}

// ForgetNotePrefix saca del índice una nota o una carpeta entera.
//
// Mismo cuidado con el separador que en `MoveNotePrefix`: sin él, borrar `notas/a`
// se llevaría por delante `notas/ab`.
func (s *Store) ForgetNotePrefix(ctx context.Context, prefix string) (int, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	pattern := escapeLike(prefix) + "/%"
	if _, err := tx.ExecContext(ctx,
		`DELETE FROM notes WHERE rel_path = ? OR rel_path LIKE ? ESCAPE '\'`,
		prefix, pattern); err != nil {
		return 0, err
	}
	res, err := tx.ExecContext(ctx,
		`DELETE FROM notes_fts WHERE rel_path = ? OR rel_path LIKE ? ESCAPE '\'`,
		prefix, pattern)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return int(n), tx.Commit()
}

// NotePaths devuelve todas las rutas indexadas. Se usa para reconciliar: lo que
// está en el índice y ya no en disco se olvida.
func (s *Store) NotePaths(ctx context.Context) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT rel_path FROM notes`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []string
	for rows.Next() {
		var rel string
		if err := rows.Scan(&rel); err != nil {
			return nil, err
		}
		out = append(out, rel)
	}
	return out, rows.Err()
}

// GetNote lee una nota del índice. No toca el disco.
func (s *Store) GetNote(ctx context.Context, relPath string) (domain.NoteMeta, error) {
	var n domain.NoteMeta
	var modified string
	err := s.db.QueryRowContext(ctx,
		`SELECT rel_path, title, size_bytes, modified_at FROM notes WHERE rel_path = ?`,
		relPath).Scan(&n.RelPath, &n.Title, &n.SizeBytes, &modified)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.NoteMeta{}, ErrNotFound
	}
	if err != nil {
		return domain.NoteMeta{}, err
	}
	n.ModifiedAt = parseTS(modified)
	return n, nil
}

// CountNotes cuenta las notas indexadas. Para las estadísticas.
func (s *Store) CountNotes(ctx context.Context) (int, error) {
	var n int
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM notes`).Scan(&n)
	return n, err
}

// ClearNotes vacía el índice de notas. Lo usa el reindexado completo antes de
// repoblarlo.
func (s *Store) ClearNotes(ctx context.Context) error {
	if _, err := s.db.ExecContext(ctx, `DELETE FROM notes`); err != nil {
		return err
	}
	if s.fts {
		if _, err := s.db.ExecContext(ctx, `DELETE FROM notes_fts`); err != nil {
			return err
		}
	}
	return nil
}

// escapeLike deja un texto listo para usarse dentro de un `LIKE ... ESCAPE '\'`.
// Sin esto, una consulta con `%` o `_` haría comodines sin querer.
func escapeLike(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, "%", `\%`)
	return strings.ReplaceAll(s, "_", `\_`)
}
