-- Índice de las notas.
--
-- Las notas viven en `<raíz>/notes/` como archivos .md y **el disco sigue siendo la
-- verdad**: esta tabla es la misma clase de caché que `summaries`, y se puede
-- reconstruir entera recorriendo la carpeta. Guarda el cuerpo para poder buscar sin
-- abrir archivos, que es para lo único que hace falta.
--
-- La clave es la ruta relativa **a la raíz** (`notes/ideas/algo.md`), no a la
-- carpeta de notas: así mover el workspace entero no cambia ni una fila, y el
-- prefijo deja claro de un vistazo que esto no es un resumen.
CREATE TABLE IF NOT EXISTS notes (
  rel_path    TEXT PRIMARY KEY,
  title       TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL DEFAULT '',
  size_bytes  INTEGER NOT NULL DEFAULT 0,
  modified_at TEXT NOT NULL
);

-- El árbol se pide ordenado por fecha casi siempre, y listar todo desde el disco
-- en cada petición no escala con una carpeta de miles de notas.
CREATE INDEX IF NOT EXISTS idx_notes_modified ON notes(modified_at DESC);
