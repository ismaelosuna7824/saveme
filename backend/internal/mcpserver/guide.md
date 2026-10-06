# SaveMe — cómo registrar un resumen humano

SaveMe guarda un diario técnico de este proyecto. Después de cada feature, fix,
chore o decisión, escribe un resumen **para una persona** —no un changelog, no un
diff— que documente qué cambió, por qué, cómo funciona y qué habría que saber
dentro de seis meses.

Carpeta raíz del workspace: `{{root}}`

## Flujo obligatorio: proponer y después confirmar

**Nunca escribas un archivo a mano en el workspace de SaveMe.** Usa las tools.

1. **`saveme_summary_propose`** con el proyecto, el título y el cuerpo.
   No escribe nada: devuelve una propuesta con la categoría sugerida, la ruta
   final y un `token`.

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

## Otras tools

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
