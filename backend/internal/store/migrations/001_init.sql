-- 001_init.sql — esquema inicial del índice de SaveMe.
--
-- El índice es derivado y reconstruible: todo lo que hay aquí se puede volver a
-- generar recorriendo los .md del workspace. Nunca se guarda aquí nada que no
-- exista también en disco, salvo las propuestas pendientes (que son estado
-- transitorio del protocolo de confirmación).

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  slug       TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  path       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS summaries (
  id            TEXT PRIMARY KEY,
  project_slug  TEXT NOT NULL REFERENCES projects(slug) ON DELETE CASCADE,
  category      TEXT NOT NULL,
  title         TEXT NOT NULL,
  summary_line  TEXT NOT NULL DEFAULT '',
  rel_path      TEXT NOT NULL UNIQUE,
  content_hash  TEXT NOT NULL,
  status        TEXT NOT NULL,
  author        TEXT NOT NULL,
  agent         TEXT,
  commit_sha    TEXT,
  tags_json     TEXT NOT NULL DEFAULT '[]',
  files_json    TEXT NOT NULL DEFAULT '[]',
  related_json  TEXT NOT NULL DEFAULT '[]',
  word_count    INTEGER NOT NULL DEFAULT 0,
  size_bytes    INTEGER NOT NULL DEFAULT 0,
  mtime_ns      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_summaries_project  ON summaries(project_slug, category);
CREATE INDEX IF NOT EXISTS idx_summaries_updated  ON summaries(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_summaries_category ON summaries(category);

-- El cuerpo se guarda en el índice además de en el archivo.
--
-- Es una duplicación deliberada: permite buscar por contenido sin abrir cada
-- archivo y hace que la búsqueda funcione igual cuando la build de SQLite no
-- trae FTS5. La fuente de verdad sigue siendo el archivo; el reconciliador
-- reescribe esta fila cuando detecta que el mtime cambió.
CREATE TABLE IF NOT EXISTS summary_bodies (
  summary_id TEXT PRIMARY KEY REFERENCES summaries(id) ON DELETE CASCADE,
  body       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS summary_tags (
  summary_id TEXT NOT NULL REFERENCES summaries(id) ON DELETE CASCADE,
  tag        TEXT NOT NULL,
  PRIMARY KEY (summary_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_summary_tags_tag ON summary_tags(tag);

-- Propuestas: escrituras que todavía NO ocurrieron.
--
-- Esta tabla es el mecanismo que hace imposible escribir un resumen sin
-- confirmación. El token es de un solo uso y expira.
CREATE TABLE IF NOT EXISTS proposals (
  token             TEXT PRIMARY KEY,
  project_slug      TEXT NOT NULL,
  category          TEXT NOT NULL,
  title             TEXT NOT NULL,
  rel_path          TEXT NOT NULL,
  body              TEXT NOT NULL,
  summary_line      TEXT NOT NULL DEFAULT '',
  payload_hash      TEXT NOT NULL,
  inference_reason  TEXT NOT NULL DEFAULT '',
  confidence        REAL NOT NULL DEFAULT 0,
  evidence_json     TEXT NOT NULL DEFAULT '[]',
  alternatives_json TEXT NOT NULL DEFAULT '[]',
  created_at        TEXT NOT NULL,
  expires_at        TEXT NOT NULL,
  status            TEXT NOT NULL,
  decision          TEXT,
  resolved_via      TEXT,
  resolved_at       TEXT,
  override_rel_path TEXT,
  summary_id        TEXT,
  agent             TEXT,
  tags_json         TEXT NOT NULL DEFAULT '[]',
  files_json        TEXT NOT NULL DEFAULT '[]',
  commit_sha        TEXT
);

CREATE INDEX IF NOT EXISTS idx_proposals_status  ON proposals(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_proposals_project ON proposals(project_slug);

-- Bitácora de eventos para SSE y para auditoría de quién resolvió cada
-- propuesta y por qué vía.
CREATE TABLE IF NOT EXISTS events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ts           TEXT NOT NULL,
  type         TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}'
);

-- Estado observado de cada archivo. Es lo que permite que el reconciliador
-- detecte cambios sin leer el contenido de todo el workspace.
CREATE TABLE IF NOT EXISTS file_state (
  rel_path     TEXT PRIMARY KEY,
  mtime_ns     INTEGER NOT NULL,
  size_bytes   INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  indexed_at   TEXT NOT NULL
);
