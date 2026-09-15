// Package store es el índice SQLite de SaveMe.
//
// Regla de oro: el índice es descartable. Nada de lo que hay aquí es la única
// copia de algo. Si la base se corrompe o se borra, `Reindex` reconstruye todo
// desde los markdown del workspace.
package store

import (
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	_ "modernc.org/sqlite" // driver "sqlite" en Go puro, sin CGO
)

//go:embed migrations/*.sql
var migrationFS embed.FS

// Store envuelve la conexión a SQLite.
type Store struct {
	db   *sql.DB
	path string
	// root es la raíz del workspace. El store nunca escribe archivos; la guarda
	// solo para poder rellenar AbsPath en las respuestas sin obligar a cada
	// llamador a recomponer rutas.
	root string
	// fts indica si la build de SQLite soporta FTS5. Cuando es false la
	// búsqueda cae a LIKE sobre summary_bodies. Se detecta en runtime porque
	// depende de cómo se compiló el driver, no de nuestro código.
	fts bool
}

// SetRoot indica la raíz del workspace para poder derivar rutas absolutas.
func (s *Store) SetRoot(root string) { s.root = root }

// absPath compone la ruta absoluta de un archivo a partir de su ruta relativa.
func (s *Store) absPath(rel string) string {
	if s.root == "" || rel == "" {
		return ""
	}
	return filepath.Join(s.root, filepath.FromSlash(rel))
}

// Open abre (y migra) el índice en path.
func Open(path string) (*Store, error) {
	// Los pragmas van en el DSN para que se apliquen a cada conexión nueva del
	// pool, no solo a la primera.
	dsn := "file:" + path +
		"?_pragma=busy_timeout(5000)" +
		"&_pragma=journal_mode(WAL)" +
		"&_pragma=synchronous(NORMAL)" +
		"&_pragma=foreign_keys(1)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("abrir el índice %s: %w", path, err)
	}

	// SQLite admite un solo escritor. Con una única conexión el driver nunca
	// puede quedar en interbloqueo consigo mismo; el volumen de datos de una
	// app personal hace que la serialización no se note.
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	db.SetConnMaxLifetime(0)

	if err := db.Ping(); err != nil {
		db.Close()
		return nil, fmt.Errorf("conectar con el índice %s: %w", path, err)
	}

	s := &Store{db: db, path: path}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, err
	}
	s.fts = s.detectFTS()
	if s.fts {
		if err := s.createFTS(); err != nil {
			// Si FTS5 está presente pero la tabla no se puede crear, seguimos
			// con LIKE: la búsqueda es una comodidad, no un requisito de
			// arranque.
			s.fts = false
		}
	}
	return s, nil
}

// Close cierra el índice.
func (s *Store) Close() error {
	if s.db == nil {
		return nil
	}
	// Un checkpoint antes de cerrar deja el WAL integrado en el archivo
	// principal, para que copiar saveme.db a mano sea suficiente.
	_, _ = s.db.Exec("PRAGMA wal_checkpoint(TRUNCATE)")
	return s.db.Close()
}

// Path devuelve la ruta del archivo del índice.
func (s *Store) Path() string { return s.path }

// UsesFTS indica si la búsqueda usa FTS5 (true) o LIKE (false).
func (s *Store) UsesFTS() bool { return s.fts }

// DB expone la conexión para pruebas y para el reconciliador.
func (s *Store) DB() *sql.DB { return s.db }

// --- migraciones -------------------------------------------------------------

// migrate aplica en orden las migraciones cuyo número sea mayor al registrado
// en meta.schema_version. Cada migración corre en su propia transacción: si una
// falla, las anteriores quedan aplicadas y la versión no avanza.
func (s *Store) migrate() error {
	current, err := s.schemaVersion()
	if err != nil {
		return err
	}

	names, err := fs.Glob(migrationFS, "migrations/*.sql")
	if err != nil {
		return fmt.Errorf("leer las migraciones embebidas: %w", err)
	}
	sort.Strings(names)

	for _, name := range names {
		version, err := parseMigrationVersion(name)
		if err != nil {
			return err
		}
		if version <= current {
			continue
		}
		body, err := migrationFS.ReadFile(name)
		if err != nil {
			return fmt.Errorf("leer la migración %s: %w", name, err)
		}
		if err := s.applyMigration(version, string(body)); err != nil {
			return fmt.Errorf("aplicar la migración %s: %w", name, err)
		}
	}
	return nil
}

func (s *Store) applyMigration(version int, body string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(body); err != nil {
		return err
	}
	if _, err := tx.Exec(
		`INSERT INTO meta(key, value) VALUES('schema_version', ?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
		strconv.Itoa(version),
	); err != nil {
		return err
	}
	return tx.Commit()
}

// schemaVersion devuelve la versión aplicada, o 0 si el índice es nuevo.
func (s *Store) schemaVersion() (int, error) {
	// En un archivo recién creado la tabla meta todavía no existe, así que la
	// primera consulta puede fallar legítimamente.
	var raw string
	err := s.db.QueryRow(`SELECT value FROM meta WHERE key = 'schema_version'`).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil
	}
	if err != nil {
		if isMissingTable(err) {
			return 0, nil
		}
		return 0, fmt.Errorf("leer schema_version: %w", err)
	}
	v, err := strconv.Atoi(raw)
	if err != nil {
		return 0, fmt.Errorf("schema_version corrupto (%q): %w", raw, err)
	}
	return v, nil
}

func isMissingTable(err error) bool {
	return err != nil && strings.Contains(strings.ToLower(err.Error()), "no such table")
}

// parseMigrationVersion extrae el número de "migrations/001_init.sql".
func parseMigrationVersion(name string) (int, error) {
	base := name[strings.LastIndex(name, "/")+1:]
	idx := strings.Index(base, "_")
	if idx <= 0 {
		return 0, fmt.Errorf("la migración %q no sigue el formato NNN_nombre.sql", name)
	}
	v, err := strconv.Atoi(base[:idx])
	if err != nil {
		return 0, fmt.Errorf("la migración %q no empieza con un número: %w", name, err)
	}
	return v, nil
}

// --- FTS5 --------------------------------------------------------------------

// detectFTS comprueba en runtime si la build de SQLite trae FTS5. Se hace
// creando la tabla dentro de una transacción que siempre se revierte, para no
// dejar basura si el intento falla.
func (s *Store) detectFTS() bool {
	tx, err := s.db.Begin()
	if err != nil {
		return false
	}
	defer tx.Rollback()
	_, err = tx.Exec(`CREATE VIRTUAL TABLE temp.__fts_probe USING fts5(x)`)
	return err == nil
}

// createFTS crea la tabla de búsqueda si no existe. Es idempotente.
func (s *Store) createFTS() error {
	_, err := s.db.Exec(`CREATE VIRTUAL TABLE IF NOT EXISTS summaries_fts USING fts5(
		id UNINDEXED,
		title,
		summary_line,
		body,
		tags,
		tokenize='unicode61 remove_diacritics 2'
	)`)
	if err != nil {
		return err
	}
	// Las notas tienen su propio índice de búsqueda, separado del de resúmenes:
	// son dos cosas distintas y una consulta de notas no debe devolver resúmenes.
	// Los pesos de bm25 van en orden de columna, y `rel_path` no puntúa.
	_, err = s.db.Exec(`CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
		rel_path UNINDEXED,
		title,
		body,
		tokenize='unicode61 remove_diacritics 2'
	)`)
	return err
}

// rebuildFTS vacía y repuebla el índice de búsqueda completo.
func (s *Store) rebuildFTS() error {
	if !s.fts {
		return nil
	}
	if _, err := s.db.Exec(`DELETE FROM summaries_fts`); err != nil {
		return err
	}
	_, err := s.db.Exec(`
		INSERT INTO summaries_fts(id, title, summary_line, body, tags)
		SELECT s.id, s.title, s.summary_line, COALESCE(b.body, ''), COALESCE(s.tags_json, '[]')
		FROM summaries s
		LEFT JOIN summary_bodies b ON b.summary_id = s.id`)
	return err
}

// --- utilidades de tiempo ----------------------------------------------------

// timeLayout es el formato en que se guardan todas las fechas. RFC3339 con
// nanosegundos y siempre en UTC: ordena lexicográficamente igual que
// cronológicamente y no depende de la zona horaria de la máquina.
const timeLayout = time.RFC3339Nano

func ts(t time.Time) string { return t.UTC().Format(timeLayout) }

func parseTS(s string) time.Time {
	if s == "" {
		return time.Time{}
	}
	t, err := time.Parse(timeLayout, s)
	if err != nil {
		// Tolerancia con formatos sin nanosegundos.
		if t2, err2 := time.Parse(time.RFC3339, s); err2 == nil {
			return t2.UTC()
		}
		return time.Time{}
	}
	return t.UTC()
}
