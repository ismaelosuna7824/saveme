-- Resúmenes relacionados que trae una propuesta.
--
-- El agente puede decir que lo que escribe continúa, depende o explica otro
-- resumen. Esos enlaces se resuelven a ids al proponer y se guardan aquí, igual
-- que `tags_json` y `files_json`, porque al confirmar se escribe exactamente lo
-- que se le mostró al usuario y no lo que el agente recuerde un turno después.
--
-- Una lista vacía significa "la propuesta no dice nada": al actualizar un
-- resumen se conservan los relacionados que ya tenía.
ALTER TABLE proposals ADD COLUMN related_json TEXT NOT NULL DEFAULT '[]';
