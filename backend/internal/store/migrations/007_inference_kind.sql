-- Cómo se infirió la categoría de una propuesta, en claves y no en texto.
--
-- `inference_reason` es una frase en español pensada para el agente; la interfaz
-- en inglés la enseñaba tal cual. Con `inference_kind` (explicit, none, signals,
-- tie) y `inference_runner_up` la interfaz monta la explicación en su idioma.
ALTER TABLE proposals ADD COLUMN inference_kind TEXT NOT NULL DEFAULT '';
ALTER TABLE proposals ADD COLUMN inference_runner_up TEXT NOT NULL DEFAULT '';

-- Las propuestas que ya existen se reconocen por la frase exacta que generaba el
-- core. Las etiquetas de categoría son la clave con mayúscula inicial («Fix y
-- Infra tienen la misma evidencia…»), así que el empate recupera su rival.
UPDATE proposals SET inference_kind = 'explicit' WHERE inference_reason = 'Lo pediste explícitamente.';
UPDATE proposals SET inference_kind = 'none' WHERE inference_reason LIKE 'No encontré señales claras%';
UPDATE proposals SET inference_kind = 'signals' WHERE inference_reason LIKE 'El título y el cuerpo mencionan %';
UPDATE proposals SET inference_kind = 'tie' WHERE inference_reason LIKE '% tienen la misma evidencia %';
UPDATE proposals
   SET inference_runner_up = lower(substr(inference_reason,
         instr(inference_reason, ' y ') + 3,
         instr(inference_reason, ' tienen ') - instr(inference_reason, ' y ') - 3))
 WHERE inference_kind = 'tie'
   AND instr(inference_reason, ' y ') > 0
   AND instr(inference_reason, ' y ') < instr(inference_reason, ' tienen ')
   AND lower(substr(inference_reason,
         instr(inference_reason, ' y ') + 3,
         instr(inference_reason, ' tienen ') - instr(inference_reason, ' y ') - 3))
       IN ('feature', 'fix', 'perf', 'security', 'chore', 'refactor', 'docs', 'infra',
           'design', 'research', 'incident');
