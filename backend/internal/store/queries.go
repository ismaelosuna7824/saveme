package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"
	"unicode"

	"github.com/ismaelosuna/saveme/backend/internal/domain"
)

// scanner es lo que comparten *sql.Row y *sql.Rows.
type scanner interface{ Scan(dest ...any) error }

// --- proyectos ---------------------------------------------------------------

// UpsertProject registra o actualiza un proyecto. En un conflicto nunca pisa
// created_at: la fecha de alta de un proyecto es un hecho, no un dato derivado.
func (s *Store) UpsertProject(ctx context.Context, p domain.Project) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO projects(slug, name, path, created_at, updated_at)
		VALUES(?, ?, ?, ?, ?)
		ON CONFLICT(slug) DO UPDATE SET
			name = excluded.name,
			path = excluded.path,
			updated_at = excluded.updated_at`,
		p.Slug, p.Name, p.Path, ts(p.CreatedAt), ts(p.UpdatedAt))
	if err != nil {
		return fmt.Errorf("registrar el proyecto %s: %w", p.Slug, err)
	}
	return nil
}

// GetProject devuelve un proyecto con sus conteos por categoría.
func (s *Store) GetProject(ctx context.Context, slug string) (domain.Project, error) {
	var p domain.Project
	var created, updated string
	err := s.db.QueryRowContext(ctx,
		`SELECT slug, name, path, created_at, updated_at FROM projects WHERE slug = ?`, slug).
		Scan(&p.Slug, &p.Name, &p.Path, &created, &updated)
	if errors.Is(err, sql.ErrNoRows) {
		return p, ErrNotFound
	}
	if err != nil {
		return p, fmt.Errorf("leer el proyecto %s: %w", slug, err)
	}
	p.CreatedAt = parseTS(created)
	p.UpdatedAt = parseTS(updated)

	counts, last, err := s.categoryCounts(ctx, slug)
	if err != nil {
		return p, err
	}
	p.Counts = counts
	for _, n := range counts {
		p.Total += n
	}
	p.LastActivity = last
	return p, nil
}

// ListProjects devuelve todos los proyectos ordenados por actividad reciente.
//
// Se resuelve con dos consultas en vez de un JOIN con GROUP BY: con decenas de
// proyectos el JOIN sería perfectamente válido, pero así el conteo y la lista
// de proyectos se razonan por separado y el código queda más simple.
func (s *Store) ListProjects(ctx context.Context) ([]domain.Project, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT slug, name, path, created_at, updated_at FROM projects`)
	if err != nil {
		return nil, fmt.Errorf("listar proyectos: %w", err)
	}
	defer rows.Close()

	var out []domain.Project
	for rows.Next() {
		var p domain.Project
		var created, updated string
		if err := rows.Scan(&p.Slug, &p.Name, &p.Path, &created, &updated); err != nil {
			return nil, fmt.Errorf("leer proyecto: %w", err)
		}
		p.CreatedAt = parseTS(created)
		p.UpdatedAt = parseTS(updated)
		p.Counts = map[string]int{}
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	for i := range out {
		counts, last, err := s.categoryCounts(ctx, out[i].Slug)
		if err != nil {
			return nil, err
		}
		out[i].Counts = counts
		for _, n := range counts {
			out[i].Total += n
		}
		out[i].LastActivity = last
	}

	// Orden: primero lo que tuvo actividad más recientemente; los proyectos sin
	// resúmenes van al final, ordenados por nombre.
	for i := 0; i < len(out); i++ {
		for j := i + 1; j < len(out); j++ {
			if lessProject(out[j], out[i]) {
				out[i], out[j] = out[j], out[i]
			}
		}
	}
	return out, nil
}

func lessProject(a, b domain.Project) bool {
	if (a.LastActivity == nil) != (b.LastActivity == nil) {
		return a.LastActivity != nil
	}
	if a.LastActivity != nil && b.LastActivity != nil && !a.LastActivity.Equal(*b.LastActivity) {
		return a.LastActivity.After(*b.LastActivity)
	}
	return a.Slug < b.Slug
}

// categoryCounts devuelve cuántos resúmenes hay por categoría y la fecha de la
// última actividad del proyecto.
func (s *Store) categoryCounts(ctx context.Context, slug string) (map[string]int, *time.Time, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT category, COUNT(*), MAX(updated_at)
		FROM summaries WHERE project_slug = ?
		GROUP BY category`, slug)
	if err != nil {
		return nil, nil, fmt.Errorf("contar resúmenes de %s: %w", slug, err)
	}
	defer rows.Close()

	counts := make(map[string]int)
	var last *time.Time
	for rows.Next() {
		var category string
		var n int
		var maxUpdated sql.NullString
		if err := rows.Scan(&category, &n, &maxUpdated); err != nil {
			return nil, nil, err
		}
		counts[category] = n
		if maxUpdated.Valid {
			t := parseTS(maxUpdated.String)
			if !t.IsZero() && (last == nil || t.After(*last)) {
				last = &t
			}
		}
	}
	return counts, last, rows.Err()
}

// ProjectSlugs devuelve solo los slugs registrados.
func (s *Store) ProjectSlugs(ctx context.Context) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT slug FROM projects ORDER BY slug`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var slug string
		if err := rows.Scan(&slug); err != nil {
			return nil, err
		}
		out = append(out, slug)
	}
	return out, rows.Err()
}

// DeleteProject borra un proyecto del índice. Los resúmenes asociados caen por
// la clave foránea en cascada.
func (s *Store) DeleteProject(ctx context.Context, slug string) error {
	if _, err := s.db.ExecContext(ctx, `DELETE FROM projects WHERE slug = ?`, slug); err != nil {
		return fmt.Errorf("borrar el proyecto %s del índice: %w", slug, err)
	}
	return nil
}

// Stats resume el estado global para el dashboard.
type Stats struct {
	Projects         int            `json:"projects"`
	Summaries        int            `json:"summaries"`
	ByCategory       map[string]int `json:"by_category"`
	PendingProposals int            `json:"pending_proposals"`
	UsingFTS         bool           `json:"using_fts"`
}

// Stats calcula los totales globales.
func (s *Store) Stats(ctx context.Context) (Stats, error) {
	st := Stats{ByCategory: map[string]int{}, UsingFTS: s.fts}
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM projects`).Scan(&st.Projects); err != nil {
		return st, err
	}
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM summaries`).Scan(&st.Summaries); err != nil {
		return st, err
	}
	if err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM proposals WHERE status = ?`, domain.ProposalPending).
		Scan(&st.PendingProposals); err != nil {
		return st, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT category, COUNT(*) FROM summaries GROUP BY category`)
	if err != nil {
		return st, err
	}
	defer rows.Close()
	for rows.Next() {
		var category string
		var n int
		if err := rows.Scan(&category, &n); err != nil {
			return st, err
		}
		st.ByCategory[category] = n
	}
	return st, rows.Err()
}

// --- resúmenes ---------------------------------------------------------------

// ErrNotFound indica que la fila pedida no existe.
var ErrNotFound = errors.New("no encontrado")

// summaryCols son las columnas de un resumen, cualificadas con el alias `s`:
// toda consulta que las use debe leer `FROM summaries s`. Sin el alias, la
// búsqueda FTS (que cruza con `summaries_fts`, que también tiene `id`, `title`
// y `summary_line`) fallaba con «ambiguous column name» y caía siempre a LIKE
// sin que nadie lo notara: perdía el orden por relevancia y los fragmentos.
const summaryCols = `s.id, s.project_slug, s.category, s.title, s.summary_line, s.rel_path,
	s.content_hash, s.status, s.author, COALESCE(s.agent, ''), COALESCE(s.commit_sha, ''),
	s.tags_json, s.files_json, s.related_json, s.supersedes_json, s.word_count, s.size_bytes,
	s.created_at, s.updated_at`

// scanSummary lee una fila de summaryCols. `extra` recibe las columnas que la
// consulta pida detrás de ellas (los fragmentos de la búsqueda, por ejemplo).
func (s *Store) scanSummary(sc scanner, extra ...any) (domain.SummaryMeta, error) {
	var m domain.SummaryMeta
	var tagsJSON, filesJSON, relatedJSON, supersedesJSON, createdStr, updatedStr string
	dest := []any{
		&m.ID, &m.ProjectSlug, &m.Category, &m.Title, &m.SummaryLine, &m.RelPath,
		&m.ContentHash, &m.Status, &m.Author, &m.Agent, &m.CommitSHA,
		&tagsJSON, &filesJSON, &relatedJSON, &supersedesJSON, &m.WordCount, &m.SizeBytes,
		&createdStr, &updatedStr,
	}
	if err := sc.Scan(append(dest, extra...)...); err != nil {
		return m, err
	}
	m.Tags = decodeStrings(tagsJSON)
	m.FilesTouched = decodeStrings(filesJSON)
	m.Related = decodeStrings(relatedJSON)
	m.Supersedes = decodeStrings(supersedesJSON)
	m.CreatedAt = parseTS(createdStr)
	m.UpdatedAt = parseTS(updatedStr)
	m.AbsPath = s.absPath(m.RelPath)
	return m, nil
}

// UpsertSummary indexa un resumen y su cuerpo. Es idempotente: la clave es el
// id, y el mismo id con contenido nuevo simplemente actualiza.
func (s *Store) UpsertSummary(ctx context.Context, m domain.SummaryMeta, body string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO summaries(
			id, project_slug, category, title, summary_line, rel_path, content_hash,
			status, author, agent, commit_sha, tags_json, files_json, related_json,
			supersedes_json, word_count, size_bytes, created_at, updated_at)
		VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
		ON CONFLICT(id) DO UPDATE SET
			project_slug = excluded.project_slug,
			category     = excluded.category,
			title        = excluded.title,
			summary_line = excluded.summary_line,
			rel_path     = excluded.rel_path,
			content_hash = excluded.content_hash,
			status       = excluded.status,
			author       = excluded.author,
			agent        = excluded.agent,
			commit_sha   = excluded.commit_sha,
			tags_json    = excluded.tags_json,
			files_json   = excluded.files_json,
			related_json = excluded.related_json,
			supersedes_json = excluded.supersedes_json,
			word_count   = excluded.word_count,
			size_bytes   = excluded.size_bytes,
			updated_at   = excluded.updated_at`,
		m.ID, m.ProjectSlug, m.Category, m.Title, m.SummaryLine, m.RelPath, m.ContentHash,
		m.Status, m.Author, nullify(m.Agent), nullify(m.CommitSHA),
		encodeStrings(m.Tags), encodeStrings(m.FilesTouched), encodeStrings(m.Related),
		encodeStrings(m.Supersedes),
		m.WordCount, m.SizeBytes, ts(m.CreatedAt), ts(m.UpdatedAt),
	); err != nil {
		return fmt.Errorf("indexar el resumen %s: %w", m.ID, err)
	}

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO summary_bodies(summary_id, body) VALUES(?, ?)
		ON CONFLICT(summary_id) DO UPDATE SET body = excluded.body`,
		m.ID, body); err != nil {
		return fmt.Errorf("indexar el cuerpo de %s: %w", m.ID, err)
	}

	if _, err := tx.ExecContext(ctx, `DELETE FROM summary_tags WHERE summary_id = ?`, m.ID); err != nil {
		return err
	}
	for _, tag := range m.Tags {
		tag = strings.ToLower(strings.TrimSpace(tag))
		if tag == "" {
			continue
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT OR IGNORE INTO summary_tags(summary_id, tag) VALUES(?, ?)`, m.ID, tag); err != nil {
			return fmt.Errorf("indexar la etiqueta %q: %w", tag, err)
		}
	}

	if s.fts {
		if _, err := tx.ExecContext(ctx, `DELETE FROM summaries_fts WHERE id = ?`, m.ID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO summaries_fts(id, title, summary_line, body, tags) VALUES(?,?,?,?,?)`,
			m.ID, m.Title, m.SummaryLine, body, strings.Join(m.Tags, " ")); err != nil {
			return fmt.Errorf("indexar %s para búsqueda: %w", m.ID, err)
		}
	}

	return tx.Commit()
}

// GetSummary lee la metadata de un resumen por id.
func (s *Store) GetSummary(ctx context.Context, id string) (domain.SummaryMeta, error) {
	row := s.db.QueryRowContext(ctx, `SELECT `+summaryCols+` FROM summaries s WHERE s.id = ?`, id)
	m, err := s.scanSummary(row)
	if errors.Is(err, sql.ErrNoRows) {
		return m, ErrNotFound
	}
	if err != nil {
		return m, fmt.Errorf("leer el resumen %s: %w", id, err)
	}
	return m, nil
}

// GetSummaryByRelPath busca por ruta relativa. Lo usa el reconciliador, que
// razona en rutas y no en ids.
func (s *Store) GetSummaryByRelPath(ctx context.Context, rel string) (domain.SummaryMeta, error) {
	row := s.db.QueryRowContext(ctx, `SELECT `+summaryCols+` FROM summaries s WHERE s.rel_path = ?`, rel)
	m, err := s.scanSummary(row)
	if errors.Is(err, sql.ErrNoRows) {
		return m, ErrNotFound
	}
	if err != nil {
		return m, fmt.Errorf("leer el resumen en %s: %w", rel, err)
	}
	return m, nil
}

// Backlinks devuelve los resúmenes que enlazan a `id` en su `related`, los más
// recientes primero. También cuenta la ruta relativa, porque quien edita el
// frontmatter a mano escribe rutas y no ids.
//
// Se busca dentro del JSON con `json_each` en vez de mantener una tabla de
// enlaces aparte: `related_json` ya es la copia indexada del frontmatter, y una
// segunda tabla sería otra caché que mantener sincronizada con el disco. Con
// unos pocos miles de resúmenes el recorrido completo no se nota.
func (s *Store) Backlinks(ctx context.Context, id, relPath string) ([]domain.SummaryMeta, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+summaryCols+` FROM summaries s
		WHERE s.id <> ? AND EXISTS (
			SELECT 1 FROM json_each(s.related_json) WHERE value IN (?, ?))
		ORDER BY s.updated_at DESC`, id, id, relPath)
	if err != nil {
		return nil, fmt.Errorf("buscar quién enlaza a %s: %w", id, err)
	}
	defer rows.Close()

	out := []domain.SummaryMeta{}
	for rows.Next() {
		m, err := s.scanSummary(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// Superseders devuelve los resúmenes que sustituyen a `id` (por id o por ruta,
// como `Backlinks`), los más recientes primero.
func (s *Store) Superseders(ctx context.Context, id, relPath string) ([]domain.SummaryMeta, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+summaryCols+` FROM summaries s
		WHERE s.id <> ? AND EXISTS (
			SELECT 1 FROM json_each(s.supersedes_json) WHERE value IN (?, ?))
		ORDER BY s.created_at DESC`, id, id, relPath)
	if err != nil {
		return nil, fmt.Errorf("buscar quién sustituye a %s: %w", id, err)
	}
	defer rows.Close()

	out := []domain.SummaryMeta{}
	for rows.Next() {
		m, err := s.scanSummary(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// SupersededIndex devuelve, para cada id o ruta que algún resumen sustituye, el
// id del sustituto más reciente.
//
// Es una consulta para todo el listado y no una por fila: marcar quinientos
// resultados de una búsqueda costaría quinientos recorridos del JSON.
func (s *Store) SupersededIndex(ctx context.Context) (map[string]string, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT j.value, s.id FROM summaries s, json_each(s.supersedes_json) j
		ORDER BY s.created_at ASC`)
	if err != nil {
		return nil, fmt.Errorf("leer qué resúmenes están sustituidos: %w", err)
	}
	defer rows.Close()

	out := map[string]string{}
	for rows.Next() {
		var ref, by string
		if err := rows.Scan(&ref, &by); err != nil {
			return nil, err
		}
		// En orden de creación ascendente: el último que se escribe es el más
		// reciente, que es el que vale.
		out[ref] = by
	}
	return out, rows.Err()
}

// GetSummaryBody lee el cuerpo indexado. Es un atajo para búsqueda y
// previsualización; la lectura autoritativa siempre va al archivo.
func (s *Store) GetSummaryBody(ctx context.Context, id string) (string, error) {
	var body string
	err := s.db.QueryRowContext(ctx,
		`SELECT body FROM summary_bodies WHERE summary_id = ?`, id).Scan(&body)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("leer el cuerpo de %s: %w", id, err)
	}
	return body, nil
}

// DeleteSummary quita un resumen del índice. Es lo que se llama cuando el
// archivo desaparece del disco, no cuando el usuario borra desde la app.
func (s *Store) DeleteSummary(ctx context.Context, id string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `DELETE FROM summaries WHERE id = ?`, id); err != nil {
		return err
	}
	if s.fts {
		if _, err := tx.ExecContext(ctx, `DELETE FROM summaries_fts WHERE id = ?`, id); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// SummaryFilter describe una consulta de listado o búsqueda.
type SummaryFilter struct {
	Project  string
	Category string
	Status   string
	Tag      string
	// File filtra por archivo tocado. Es lo que responde «¿qué se hizo aquí?»
	// antes de tocar un archivo.
	File  string
	Query string
	// From y To acotan por fecha de creación, por días enteros: From cuenta desde
	// su medianoche y To incluye su día completo (hasta la medianoche siguiente,
	// sin incluirla). El día es el de la zona de la propia fecha —la API las lee
	// en hora local—, porque «lo que hice el lunes» es el lunes de quien lo
	// pregunta, no el de UTC. Cero significa sin límite.
	From   time.Time
	To     time.Time
	Sort   string // recent (default) | oldest | title
	Limit  int
	Offset int
}

// Normalize aplica los valores por defecto y acota el limit.
func (f *SummaryFilter) Normalize() {
	if f.Limit <= 0 {
		f.Limit = 50
	}
	if f.Limit > 500 {
		f.Limit = 500
	}
	if f.Offset < 0 {
		f.Offset = 0
	}
	// Sort vacío significa "el criterio natural del caso de uso": fecha
	// descendente al listar, relevancia al buscar.
	//
	// "created" se acepta como sinónimo de "recent": el matiz entre ordenar por
	// fecha de creación y de modificación no le importa a nadie en una lista, y
	// rechazarlo solo produciría un error confuso.
	switch f.Sort {
	case "recent", "created", "oldest", "title":
	default:
		f.Sort = ""
	}
}

// orderBy traduce el criterio de orden a SQL. Es un switch cerrado sobre
// valores conocidos: nunca se interpola entrada del usuario en el SQL.
func (f SummaryFilter) orderBy() string {
	switch f.Sort {
	case "oldest":
		return "s.created_at ASC"
	case "title":
		return "s.title COLLATE NOCASE ASC"
	case "created":
		return "s.created_at DESC"
	default:
		return "s.updated_at DESC"
	}
}

// searchOrderBy decide el orden de los resultados de búsqueda.
//
// Cuando el usuario no pidió un orden explícito se ordena por relevancia, no
// por fecha: si buscas "editor", la nota que se titula "Editor markdown" debe
// salir antes que una que solo menciona la palabra en una etiqueta.
//
// Los pesos de bm25() son, en orden de columnas de summaries_fts:
// id (ignorada), título x10, línea de resumen x5, cuerpo x1, etiquetas x2.
// bm25 devuelve valores negativos donde más negativo es mejor, así que ASC
// pone primero la mejor coincidencia.
func (f SummaryFilter) searchOrderBy(fts bool) string {
	if f.Sort != "" {
		return f.orderBy()
	}
	if fts {
		return "bm25(summaries_fts, 0.0, 10.0, 5.0, 1.0, 2.0) ASC"
	}
	return "s.updated_at DESC"
}

// where construye la cláusula de filtros y sus argumentos.
func (f SummaryFilter) where() (string, []any) {
	var conds []string
	var args []any

	if f.Project != "" {
		conds = append(conds, "s.project_slug = ?")
		args = append(args, f.Project)
	}
	if f.Category != "" {
		conds = append(conds, "s.category = ?")
		args = append(args, f.Category)
	}
	if f.Status != "" {
		conds = append(conds, "s.status = ?")
		args = append(args, f.Status)
	}
	if f.Tag != "" {
		conds = append(conds,
			"EXISTS (SELECT 1 FROM summary_tags t WHERE t.summary_id = s.id AND t.tag = ?)")
		args = append(args, strings.ToLower(strings.TrimSpace(f.Tag)))
	}
	if f.File != "" {
		// `files_json` guarda las rutas como cadenas JSON entrecomilladas, así que
		// se busca **con las comillas incluidas**: sin ellas, «a.go» casaría también
		// con «otro/a.go.bak», que es otra cosa.
		conds = append(conds, `files_json LIKE ? ESCAPE '\'`)
		args = append(args, "%\""+escapeLike(strings.TrimSpace(f.File))+"\"%")
	}
	if !f.From.IsZero() {
		conds = append(conds, "s.created_at >= ?")
		args = append(args, dayBound(startOfDay(f.From)))
	}
	if !f.To.IsZero() {
		conds = append(conds, "s.created_at < ?")
		args = append(args, dayBound(startOfDay(f.To).AddDate(0, 0, 1)))
	}
	if len(conds) == 0 {
		return "", nil
	}
	return " WHERE " + strings.Join(conds, " AND "), args
}

// startOfDay lleva una fecha a la medianoche de su día, en su propia zona.
func startOfDay(t time.Time) time.Time {
	y, m, d := t.Date()
	return time.Date(y, m, d, 0, 0, 0, 0, t.Location())
}

// dayBound escribe un límite de día para compararlo con `created_at`.
//
// Va en UTC y **sin la zeta ni fracción de segundo**: las fechas guardadas son
// RFC3339Nano, que omite la fracción cuando es cero, y entre «…00Z» y
// «…00.5Z» el orden de texto no es el cronológico ('.' < 'Z'). Cortando en el
// segundo, el límite es prefijo de cualquier instante de ese mismo segundo y
// queda por debajo de todos ellos, que es justo lo que piden `>=` (desde) y
// `<` (hasta la medianoche siguiente, excluida).
func dayBound(t time.Time) string {
	return t.UTC().Format("2006-01-02T15:04:05")
}

// ListSummaries devuelve una página de resúmenes y el total que matchea el
// filtro (sin paginar).
func (s *Store) ListSummaries(ctx context.Context, f SummaryFilter) ([]domain.SummaryMeta, int, error) {
	f.Normalize()
	where, args := f.where()

	var total int
	if err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM summaries s`+where, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("contar resúmenes: %w", err)
	}

	q := `SELECT ` + summaryCols + ` FROM summaries s` + where +
		` ORDER BY ` + f.orderBy() + ` LIMIT ? OFFSET ?`
	rows, err := s.db.QueryContext(ctx, q, append(append([]any{}, args...), f.Limit, f.Offset)...)
	if err != nil {
		return nil, 0, fmt.Errorf("listar resúmenes: %w", err)
	}
	defer rows.Close()

	items, err := s.collectSummaries(rows)
	if err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

func (s *Store) collectSummaries(rows *sql.Rows) ([]domain.SummaryMeta, error) {
	var out []domain.SummaryMeta
	for rows.Next() {
		m, err := s.scanSummary(rows)
		if err != nil {
			return nil, fmt.Errorf("leer resumen: %w", err)
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// Search busca por texto libre en título, resumen, cuerpo y etiquetas.
//
// Usa FTS5 cuando está disponible y cae a LIKE cuando no. Si la consulta FTS
// resulta inválida (por ejemplo por caracteres que el parser no acepta) se
// degrada a LIKE en vez de devolver un error: buscar nunca debería fallar.
func (s *Store) Search(ctx context.Context, f SummaryFilter) ([]domain.SummaryMeta, int, error) {
	f.Normalize()
	q := strings.TrimSpace(f.Query)
	if q == "" {
		return s.ListSummaries(ctx, f)
	}

	if s.fts {
		items, total, err := s.searchFTS(ctx, f, q)
		if err == nil {
			return items, total, nil
		}
		// Degradación silenciosa y deliberada, con el motivo en el mensaje de
		// error que se descarta aquí pero queda disponible en los tests.
		_ = err
	}
	return s.searchLike(ctx, f, q)
}

func (s *Store) searchFTS(ctx context.Context, f SummaryFilter, q string) ([]domain.SummaryMeta, int, error) {
	match := ftsQuery(q)
	if match == "" {
		return s.searchLike(ctx, f, q)
	}
	where, args := f.where()
	const ftsJoin = ` FROM summaries_fts f JOIN summaries s ON s.id = f.id`
	args = append([]any{match}, args...)

	var total int
	if err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*)`+ftsJoin+` WHERE summaries_fts MATCH ?`+andAlso(where), args...).
		Scan(&total); err != nil {
		return nil, 0, err
	}

	// Dos fragmentos: el de la línea de resumen y el del cuerpo. snippet() con
	// columna automática (-1) elegía a menudo el título o las etiquetas, que la
	// fila ya enseña; pickSnippet se queda con el primero que de verdad marca
	// una coincidencia. Los marcadores van como parámetros para que salgan de
	// las mismas constantes que lee la interfaz.
	const snippetCols = `, snippet(summaries_fts, 2, ?, ?, ?, 32), snippet(summaries_fts, 3, ?, ?, ?, 16)`
	snippetArgs := []any{
		domain.SnippetOpen, domain.SnippetClose, snippetEllipsis,
		domain.SnippetOpen, domain.SnippetClose, snippetEllipsis,
	}
	sqlq := `SELECT ` + summaryCols + snippetCols + ftsJoin +
		` WHERE summaries_fts MATCH ?` + andAlso(where) +
		` ORDER BY ` + f.searchOrderBy(true) + ` LIMIT ? OFFSET ?`
	allArgs := append(append(snippetArgs, args...), f.Limit, f.Offset)
	rows, err := s.db.QueryContext(ctx, sqlq, allArgs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var items []domain.SummaryMeta
	for rows.Next() {
		var lineSnippet, bodySnippet string
		m, err := s.scanSummary(rows, &lineSnippet, &bodySnippet)
		if err != nil {
			return nil, 0, fmt.Errorf("leer resultado de búsqueda: %w", err)
		}
		m.Snippet = pickSnippet(lineSnippet, bodySnippet)
		items = append(items, m)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

// searchLike es la búsqueda degradada (SQLite sin FTS5, o una consulta que FTS
// no acepta). Casa la consulta entera como subcadena, sin distinguir mayúsculas
// ASCII, y calcula el fragmento en Go con likeSnippet: así la interfaz recibe la
// misma forma de resultado con o sin FTS.
func (s *Store) searchLike(ctx context.Context, f SummaryFilter, q string) ([]domain.SummaryMeta, int, error) {
	where, args := f.where()
	like := "%" + strings.ToLower(q) + "%"

	cond := `(LOWER(s.title) LIKE ? OR LOWER(s.summary_line) LIKE ? OR
	          LOWER(COALESCE(b.body, '')) LIKE ? OR LOWER(s.tags_json) LIKE ?)`
	whereLike := cond
	if where != "" {
		whereLike = where + " AND " + cond
	} else {
		whereLike = " WHERE " + cond
	}
	likeArgs := []any{like, like, like, like}
	allArgs := append(append([]any{}, args...), likeArgs...)

	var total int
	if err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM summaries s
		 LEFT JOIN summary_bodies b ON b.summary_id = s.id`+whereLike, allArgs...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("contar resultados de búsqueda: %w", err)
	}

	// El cuerpo se lee solo para recortar el fragmento. Son como mucho `Limit`
	// cuerpos, y solo en el camino degradado.
	sqlq := `SELECT ` + summaryCols + `, COALESCE(b.body, '') FROM summaries s
	         LEFT JOIN summary_bodies b ON b.summary_id = s.id` + whereLike +
		` ORDER BY ` + f.searchOrderBy(false) + ` LIMIT ? OFFSET ?`
	rows, err := s.db.QueryContext(ctx, sqlq, append(append([]any{}, allArgs...), f.Limit, f.Offset)...)
	if err != nil {
		return nil, 0, fmt.Errorf("buscar resúmenes: %w", err)
	}
	defer rows.Close()

	var items []domain.SummaryMeta
	for rows.Next() {
		var body string
		m, err := s.scanSummary(rows, &body)
		if err != nil {
			return nil, 0, fmt.Errorf("leer resultado de búsqueda: %w", err)
		}
		m.Snippet = likeSnippet(m.SummaryLine, body, q)
		items = append(items, m)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

// snippetEllipsis marca el texto recortado a los lados de un fragmento.
const snippetEllipsis = "…"

// likeSnippetContext es cuántos caracteres de contexto deja likeSnippet a cada
// lado de la coincidencia: más o menos lo que ocupan los 16 tokens que pide
// snippet() en la búsqueda FTS.
const likeSnippetContext = 50

// pickSnippet elige entre el fragmento de la línea de resumen y el del cuerpo.
//
// snippet() devuelve texto aunque la columna no case (su principio, sin
// marcas), así que solo vale el que trae una marca. Primero la línea de
// resumen: es corta, la fila ya la enseñaría, y resaltada se lee mejor que un
// trozo de cuerpo. Si solo casaron el título o las etiquetas, no hay fragmento
// y la fila enseña su línea de resumen de siempre.
func pickSnippet(line, body string) string {
	for _, candidate := range []string{line, body} {
		if strings.Contains(candidate, domain.SnippetOpen) {
			return cleanSnippet(candidate)
		}
	}
	return ""
}

// cleanSnippet deja un fragmento de cuerpo legible en una línea: junta los
// espacios y saltos de línea, quita los títulos de sección que no traen la
// coincidencia («## Contexto» pegado a la frase siguiente se leía como parte de
// ella) y los tokens que son solo sintaxis de markdown («```», «-», «>», «|»…),
// que en un trozo suelto no dicen nada.
func cleanSnippet(text string) string {
	var out []string
	for _, line := range strings.Split(text, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "#") && !strings.Contains(trimmed, domain.SnippetOpen) {
			continue
		}
		for _, w := range strings.Fields(trimmed) {
			if strings.Trim(w, "#`*-_>|=~") != "" {
				out = append(out, w)
			}
		}
	}
	return strings.Join(out, " ")
}

// likeSnippet imita snippet() para la búsqueda sin FTS: la primera aparición de
// la consulta entera (la misma regla que el LIKE) en la línea de resumen o, si
// no está, en el cuerpo, con la coincidencia entre marcadores y contexto a los
// lados. Sigue el mismo orden que el camino FTS —marcar, limpiar, recortar— para
// que cleanSnippet vea la marca y no tire un título que trae la coincidencia.
// Vacío si solo casaron el título o las etiquetas.
func likeSnippet(line, body, q string) string {
	for _, text := range []string{line, body} {
		if marked := markFirst(text, q); marked != "" {
			return trimAroundMark(cleanSnippet(marked))
		}
	}
	return ""
}

// markFirst devuelve text con la primera aparición de q, sin distinguir
// mayúsculas, entre marcadores; vacío si no aparece. Trabaja en runas:
// unicode.ToLower convierte cada runa en exactamente una, así que los índices
// sobre el texto en minúsculas valen para el original.
func markFirst(text, q string) string {
	needle := []rune(strings.ToLower(strings.TrimSpace(q)))
	runes := []rune(text)
	if len(needle) == 0 || len(needle) > len(runes) {
		return ""
	}
	lower := make([]rune, len(runes))
	for i, r := range runes {
		lower[i] = unicode.ToLower(r)
	}
	for at := 0; at+len(needle) <= len(lower); at++ {
		if slices.Equal(lower[at:at+len(needle)], needle) {
			end := at + len(needle)
			return string(runes[:at]) + domain.SnippetOpen + string(runes[at:end]) +
				domain.SnippetClose + string(runes[end:])
		}
	}
	return ""
}

// trimAroundMark recorta un texto ya marcado a likeSnippetContext caracteres a
// cada lado de la coincidencia, ensanchando hasta el espacio más cercano para no
// partir palabras, y pone «…» donde corta.
func trimAroundMark(text string) string {
	runes := []rune(text)
	open := slices.Index(runes, []rune(domain.SnippetOpen)[0])
	closing := slices.Index(runes, []rune(domain.SnippetClose)[0])
	if open < 0 || closing < open {
		return text
	}
	from := max(0, open-likeSnippetContext)
	for from > 0 && !unicode.IsSpace(runes[from-1]) {
		from--
	}
	to := min(len(runes), closing+1+likeSnippetContext)
	for to < len(runes) && !unicode.IsSpace(runes[to]) {
		to++
	}

	out := string(runes[from:to])
	if from > 0 {
		out = snippetEllipsis + out
	}
	if to < len(runes) {
		out += snippetEllipsis
	}
	return out
}

// andAlso convierte " WHERE x" en " AND x" para encadenarlo tras MATCH.
func andAlso(where string) string {
	if where == "" {
		return ""
	}
	return " AND " + strings.TrimPrefix(where, " WHERE ")
}

// ftsQuery convierte texto libre en una consulta FTS5 segura.
//
// Cada término se entrecomilla (escapando las comillas internas duplicándolas)
// y se le añade "*" para búsqueda por prefijo, de modo que escribir "edit"
// encuentre "editor". Los términos se unen con AND. Entrecomillar es lo que
// impide que un usuario rompa la consulta con un guion, unas comillas o un
// asterisco: dentro de comillas, FTS5 los trata como texto literal.
func ftsQuery(q string) string {
	terms := strings.Fields(q)
	out := make([]string, 0, len(terms))
	for _, t := range terms {
		t = strings.TrimSpace(strings.ReplaceAll(t, `"`, `""`))
		if t == "" {
			continue
		}
		out = append(out, `"`+t+`"*`)
	}
	return strings.Join(out, " AND ")
}

// AllTags devuelve las etiquetas en uso con su frecuencia, para autocompletar.
//
// Con `project` cuenta solo las de ese proyecto: es lo que ofrece el filtro por
// etiqueta del buscador de un proyecto, donde una etiqueta de otro proyecto
// solo serviría para dar cero resultados. Vacío, todas.
func (s *Store) AllTags(ctx context.Context, project string) (map[string]int, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT t.tag, COUNT(*) FROM summary_tags t
		 JOIN summaries s ON s.id = t.summary_id
		 WHERE ? = '' OR s.project_slug = ?
		 GROUP BY t.tag ORDER BY COUNT(*) DESC, t.tag`, project, project)
	if err != nil {
		return nil, fmt.Errorf("leer etiquetas: %w", err)
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var tag string
		var n int
		if err := rows.Scan(&tag, &n); err != nil {
			return nil, err
		}
		out[tag] = n
	}
	return out, rows.Err()
}

// --- estado de archivos ------------------------------------------------------

// FileState es la huella observada de un archivo en el último indexado.
type FileState struct {
	RelPath     string
	MtimeNs     int64
	SizeBytes   int64
	ContentHash string
	IndexedAt   time.Time
}

// GetFileState lee la huella de un archivo. El segundo valor indica si existía.
func (s *Store) GetFileState(ctx context.Context, rel string) (FileState, bool, error) {
	var f FileState
	var indexedAt string
	err := s.db.QueryRowContext(ctx,
		`SELECT rel_path, mtime_ns, size_bytes, content_hash, indexed_at
		 FROM file_state WHERE rel_path = ?`, rel).
		Scan(&f.RelPath, &f.MtimeNs, &f.SizeBytes, &f.ContentHash, &indexedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return FileState{}, false, nil
	}
	if err != nil {
		return f, false, fmt.Errorf("leer el estado de %s: %w", rel, err)
	}
	f.IndexedAt = parseTS(indexedAt)
	return f, true, nil
}

// SetFileState guarda la huella observada de un archivo.
func (s *Store) SetFileState(ctx context.Context, f FileState) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO file_state(rel_path, mtime_ns, size_bytes, content_hash, indexed_at)
		VALUES(?,?,?,?,?)
		ON CONFLICT(rel_path) DO UPDATE SET
			mtime_ns = excluded.mtime_ns,
			size_bytes = excluded.size_bytes,
			content_hash = excluded.content_hash,
			indexed_at = excluded.indexed_at`,
		f.RelPath, f.MtimeNs, f.SizeBytes, f.ContentHash, ts(f.IndexedAt))
	if err != nil {
		return fmt.Errorf("guardar el estado de %s: %w", f.RelPath, err)
	}
	return nil
}

// ListFileStates devuelve todas las huellas conocidas, indexadas por ruta.
func (s *Store) ListFileStates(ctx context.Context) (map[string]FileState, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT rel_path, mtime_ns, size_bytes, content_hash, indexed_at FROM file_state`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]FileState{}
	for rows.Next() {
		var f FileState
		var indexedAt string
		if err := rows.Scan(&f.RelPath, &f.MtimeNs, &f.SizeBytes, &f.ContentHash, &indexedAt); err != nil {
			return nil, err
		}
		f.IndexedAt = parseTS(indexedAt)
		out[f.RelPath] = f
	}
	return out, rows.Err()
}

// DeleteFileState olvida la huella de un archivo que ya no existe.
func (s *Store) DeleteFileState(ctx context.Context, rel string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM file_state WHERE rel_path = ?`, rel)
	return err
}

// ClearIndex vacía todo el índice derivado. No toca los archivos ni las
// propuestas pendientes: solo lo que se puede reconstruir.
func (s *Store) ClearIndex(ctx context.Context) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, stmt := range []string{
		`DELETE FROM summary_tags`,
		`DELETE FROM summary_bodies`,
		`DELETE FROM summaries`,
		`DELETE FROM file_state`,
		`DELETE FROM projects`,
	} {
		if _, err := tx.ExecContext(ctx, stmt); err != nil {
			return fmt.Errorf("limpiar el índice (%s): %w", stmt, err)
		}
	}
	if s.fts {
		if _, err := tx.ExecContext(ctx, `DELETE FROM summaries_fts`); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// RebuildSearch repuebla la tabla de búsqueda completa.
func (s *Store) RebuildSearch(ctx context.Context) error { return s.rebuildFTS() }

// --- helpers -----------------------------------------------------------------

func nullify(s string) any {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}

func encodeStrings(v []string) string {
	if len(v) == 0 {
		return "[]"
	}
	b, err := json.Marshal(v)
	if err != nil {
		return "[]"
	}
	return string(b)
}

func decodeStrings(raw string) []string {
	if raw == "" {
		return []string{}
	}
	var out []string
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return []string{}
	}
	if out == nil {
		return []string{}
	}
	return out
}
