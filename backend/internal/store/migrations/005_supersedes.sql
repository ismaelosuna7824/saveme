-- Resúmenes que uno nuevo sustituye.
--
-- Una decisión de diseño se revierte, un enfoque se abandona: el resumen viejo
-- sigue siendo historia, pero ya no es la verdad vigente. `supersedes` es la
-- copia indexada del campo del frontmatter (ids o rutas relativas, como
-- `related`), y en la propuesta guarda lo que se le enseñó al usuario para
-- escribir exactamente eso al confirmar.
--
-- Quién sustituye a quién se calcula al leer recorriendo este JSON, igual que
-- los enlaces inversos: una tabla aparte sería otra caché que mantener al día
-- con el disco.
ALTER TABLE summaries ADD COLUMN supersedes_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE proposals ADD COLUMN supersedes_json TEXT NOT NULL DEFAULT '[]';
