-- El repositorio de código desde el que se hizo una propuesta.
--
-- Se guarda su identidad —remote normalizado y commit raíz, lo que no cambia al
-- mover el repo— para vincularlo al proyecto al confirmar, y la ruta solo como
-- la última vista. Vacío cuando el agente no dijo dónde trabaja o no es un repo.
ALTER TABLE proposals ADD COLUMN repo_remote TEXT NOT NULL DEFAULT '';
ALTER TABLE proposals ADD COLUMN repo_root_commit TEXT NOT NULL DEFAULT '';
ALTER TABLE proposals ADD COLUMN repo_path TEXT NOT NULL DEFAULT '';
