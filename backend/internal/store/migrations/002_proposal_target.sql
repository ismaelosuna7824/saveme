-- Propuestas que actualizan un resumen existente en vez de crear uno nuevo.
--
-- Hasta ahora una propuesta solo podía crear: el agente escribía un resumen y, si
-- volvía sobre lo mismo, generaba otro archivo casi igual. Para poder continuar
-- uno existente hacen falta dos datos: **cuál** (`target_id`) y **cómo estaba
-- cuando se propuso** (`base_hash`).
--
-- El hash es lo que hace segura la actualización: si el archivo cambió entre la
-- propuesta y la confirmación —porque el usuario lo editó, o porque otro agente
-- escribió— el `Save` lo detecta y no pisa nada. Sin él, la actualización sería
-- una escritura a ciegas sobre trabajo ajeno.
ALTER TABLE proposals ADD COLUMN target_id TEXT NOT NULL DEFAULT '';
ALTER TABLE proposals ADD COLUMN base_hash TEXT NOT NULL DEFAULT '';
