# SaveMe — cómo registrar un resumen humano

SaveMe guarda un diario técnico de este proyecto. Después de cada feature, fix,
chore o decisión, escribe un resumen **para una persona** —no un changelog, no un
diff— que documente qué cambió, por qué, cómo funciona y qué habría que saber
dentro de seis meses.

Carpeta raíz del workspace: `{{root}}`

## Flujo obligatorio: proponer y después confirmar

**Nunca escribas un archivo a mano en el workspace de SaveMe.** Usa las tools.

1. **`saveme_summary_propose`** con el proyecto, el título, el cuerpo y tu
   directorio de trabajo en `cwd`. No escribe nada: devuelve una propuesta con
   la categoría sugerida, la ruta final y un `token`.

2. **Pregunta al usuario.** Muéstrale la ruta propuesta y las alternativas, y
   espera su respuesta. Esto no es opcional: SaveMe no escribe sin una decisión
   explícita de una persona.

3. **`saveme_summary_confirm`** con el `token` y la decisión.
   Es el único camino por el que se escribe un archivo.

Si el usuario quiere otra carpeta, pásala en `override` y usa
`decision: "modified"`. Si no quiere guardarlo, llama a
`saveme_summary_cancel`.

## Si ya existe un resumen de eso, actualízalo

Un diario que solo sabe añadir se degrada: iterando sobre la misma funcionalidad
acabas con diez entradas casi iguales y ninguna que cuente la historia completa.

Antes de proponer, busca con `saveme_summary_search`. Si encuentras uno que
trata de lo mismo y el usuario quiere continuarlo:

1. Léelo entero con `saveme_summary_read`. Vas a **reescribirlo**, así que
   necesitas saber qué había: lo que no repitas, se pierde.
2. Propón igual que siempre, pero con el campo `target` puesto al id de ese
   resumen. La propuesta apunta a su archivo.
3. El usuario decide, y al confirmar **se reescribe en su sitio**: no se duplica ni
   se mueve, y conserva su id y su fecha de creación.

Dos cosas que conviene saber:

- El cuerpo que mandes **sustituye** al anterior, no se añade.
- Si alguien editó el archivo entre la propuesta y la confirmación, SaveMe **no pisa
  nada**: la confirmación falla y te pide releerlo. No es un error tuyo, es la
  garantía de que no se pierde el trabajo de nadie.

## Sin credenciales

Un resumen sale de la app: se comparte, se exporta, se pega en Slack. No copies
claves, tokens, contraseñas ni URLs con usuario y contraseña, aunque los acabes de
ver en el `.env` o en un log: escribe `<REDACTED>` en su lugar. Si la respuesta de
`saveme_summary_propose` trae `secret_warnings`, quítalas y vuelve a proponer antes
de preguntarle nada al usuario; si de verdad no son secretos (un valor de ejemplo),
díselo al preguntarle.

## Si continúa o explica otro resumen, enlázalo

Cuando lo que escribes no es lo mismo que un resumen existente pero sí lo continúa,
depende de él o lo explica, pasa su id (o su ruta relativa) en `related`, hasta 10.
No se reescribe nada: en la app se muestran como enlaces en los dos sentidos. Si
alguno no existe, la propuesta falla y te dice cuál; búscalo con
`saveme_summary_search`. Al actualizar con `target`, omitir `related` conserva los
que ya tenía y pasarlo los reemplaza.

## Si deja sin vigencia otro resumen, dilo

Cuando lo que escribes **revierte una decisión, abandona un enfoque o reemplaza un
diseño** que ya está en el diario, pasa el id (o la ruta) de ese resumen en
`supersedes`. No se reescribe ni se borra —sigue siendo historia—, pero queda marcado:
`saveme_context`, `saveme_summary_search` y `saveme_summary_list` lo devuelven con
`superseded_by`, y la app lo enseña como sustituido. Si solo lo continúas o lo amplías,
eso es `related`, no `supersedes`.

Y al revés: si una herramienta te devuelve un resumen con `superseded_by`, **no lo
tomes como vigente**. Lee el que lo sustituye antes de seguir lo que dice.

{{writing}}
## Elegir la categoría

| key | cuándo |
| --- | --- |
| `feature` | funcionalidad nueva visible para quien usa el producto |
| `fix` | se corrigió un comportamiento incorrecto |
| `perf` | rendimiento: algo va más rápido o gasta menos (cuenta las cifras de antes y después) |
| `security` | seguridad: una vulnerabilidad, permisos, validación de entradas, secretos |
| `chore` | dependencias, tooling, versiones, limpieza |
| `refactor` | se reestructuró el código sin cambiar su comportamiento |
| `docs` | documentación, guías, comentarios |
| `infra` | CI/CD, build, despliegue, observabilidad |
| `design` | decisión de arquitectura o diseño |
| `research` | spike, exploración, comparación de opciones |
| `incident` | post-mortem de algo que se rompió |

Si dudas, **no pases `category`**: SaveMe la infiere a partir del título
y el cuerpo, te dice en qué se basó y con qué confianza, y se lo propone al
usuario junto a tres alternativas. El usuario siempre tiene la última palabra.

## Proyectos

El `project` es el nombre de la carpeta de primer nivel dentro del
workspace, en minúsculas y con guiones: `saveme-app`, `api-pagos`.
Si el proyecto no existe, SaveMe lo crea con una carpeta por categoría cuando
el usuario confirma.

Antes de proponer, puedes usar `saveme_project_list` para ver los
proyectos existentes y no inventar uno nuevo por un error de tipeo.

**Pasa siempre `cwd`.** Un proyecto se vincula al repo git desde el que se guarda
su primer resumen, y a partir de ahí el proyecto sale del repo: puedes omitir
`project`. El repo se reconoce por su remote y su primer commit, no por su ruta,
así que da igual que lo muevan, lo clonen en otra carpeta o trabajes en un
worktree. Si la respuesta avisa de que el repo está vinculado a otro proyecto,
pregúntale al usuario antes de seguir.

## Otras tools

- `saveme_context` — lo que se hizo en unos archivos. Llámala **antes** de
  tocarlos, con `cwd`: cada resumen trae `changed_since`, cuántos commits tocaron
  sus archivos después de escribirse. Con `stale: true`, lo que cuenta puede estar
  desactualizado: compruébalo con el código antes de seguirlo.
- `saveme_summary_search` — busca en el historial. Úsala antes de
  proponer: si ya hay un resumen de esto, quizá corresponda ampliarlo.
- `saveme_summary_list` — lista resúmenes de un proyecto o categoría.
- `saveme_summary_read` — lee un resumen completo por id.
- `saveme_pending` — propuestas esperando decisión del usuario.
- `saveme_project_create` — crea un proyecto sin proponer nada.
- `saveme_summary_cancel` — descarta una propuesta.

## Antes de proponer, revisa el historial

Llama a `saveme_summary_search` con el tema del cambio. Si ya existe un
resumen reciente de lo mismo, menciónalo y pregunta si esto es una continuación o
algo distinto, en vez de crear dos entradas casi idénticas.
