package api

import (
	"fmt"
	"net/http"
)

// handleGuide devuelve las instrucciones para que un agente use SaveMe bien.
//
// Es deliberadamente un endpoint y no solo documentación: la forma más fiable de
// que un agente escriba buenos resúmenes es darle el texto exacto que debe
// seguir, y que ese texto viva junto al código que lo hace cumplir.
func (s *Server) handleGuide(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
	fmt.Fprint(w, Guide(s.svc.Workspace().Root()))
}

// Guide devuelve el texto de la guía para agentes, con la raíz interpolada.
//
// Lo comparten el endpoint HTTP y el subcomando `saveme guide`, que existe para
// que el usuario pueda hacer `saveme guide >> CLAUDE.md` y dejar a su agente
// instruido sin copiar y pegar.
func Guide(root string) string {
	return fmt.Sprintf(guideTemplate, root)
}

const guideTemplate = `# SaveMe — cómo registrar un resumen humano

SaveMe guarda un diario técnico de este proyecto. Después de cada feature, fix,
chore o decisión, escribe un resumen **para una persona** —no un changelog, no un
diff— que explique qué cambió, por qué y qué habría que saber dentro de seis meses.

Carpeta raíz del workspace: ` + "`%s`" + `

## Flujo obligatorio: proponer y después confirmar

**Nunca escribas un archivo a mano en el workspace de SaveMe.** Usa las tools.

1. **` + "`saveme_summary_propose`" + `** con el proyecto, el título y el cuerpo.
   No escribe nada: devuelve una propuesta con la categoría sugerida, la ruta
   final y un ` + "`token`" + `.

2. **Pregunta al usuario.** Muéstrale la ruta propuesta y las alternativas, y
   espera su respuesta. Esto no es opcional: SaveMe no escribe sin una decisión
   explícita de una persona.

3. **` + "`saveme_summary_confirm`" + `** con el ` + "`token`" + ` y la decisión.
   Es el único camino por el que se escribe un archivo.

Si el usuario quiere otra carpeta, pásala en ` + "`override`" + ` y usa
` + "`decision: \"modified\"`" + `. Si no quiere guardarlo, llama a
` + "`saveme_summary_cancel`" + `.

## Si ya existe un resumen de eso, actualízalo

Un diario que solo sabe añadir se degrada: iterando sobre la misma funcionalidad
acabas con diez entradas casi iguales y ninguna que cuente la historia completa.

Antes de proponer, busca con ` + "`saveme_summary_search`" + `. Si encuentras uno que
trata de lo mismo y el usuario quiere continuarlo:

1. Léelo entero con ` + "`saveme_summary_read`" + `. Vas a **reescribirlo**, así que
   necesitas saber qué había: lo que no repitas, se pierde.
2. Propón igual que siempre, pero con el campo ` + "`target`" + ` puesto al id de ese
   resumen. La propuesta apunta a su archivo.
3. El usuario decide, y al confirmar **se reescribe en su sitio**: no se duplica ni
   se mueve, y conserva su id y su fecha de creación.

Dos cosas que conviene saber:

- El cuerpo que mandes **sustituye** al anterior, no se añade.
- Si alguien editó el archivo entre la propuesta y la confirmación, SaveMe **no pisa
  nada**: la confirmación falla y te pide releerlo. No es un error tuyo, es la
  garantía de que no se pierde el trabajo de nadie.

## Cómo se escribe un buen resumen

El cuerpo es markdown libre. La estructura que mejor funciona:

` + "```markdown" + `
## Qué se hizo

Dos o tres frases en pasado, en lenguaje llano. Sin nombres de funciones ni de
variables salvo que sean la clave del asunto.

## Por qué

El problema o la necesidad que lo motivó. Si hubo una alternativa descartada,
dila y explica por qué se descartó. Esto es lo que se olvida siempre y lo que
más se agradece después.

## Cómo funciona

Lo justo para que alguien pueda retomarlo: dónde vive el código, qué pieza es la
importante, qué invariantes hay que respetar.

## Qué falta / riesgos

Lo que quedó a medias, lo que se decidió no hacer, lo que podría romperse.

## Cómo verificarlo

Los comandos concretos que prueban que esto funciona.
` + "```" + `

Reglas de estilo:

- Escribe **en el idioma del usuario**. Si te habla en español, el resumen va en
  español.
- Frases cortas. Voz activa. Nada de "se procedió a realizar la implementación".
- Nada de relleno tipo "en este documento se describe". Empieza por el contenido.
- No pegues diffs ni listes cada archivo tocado: para eso está git. Usa
  ` + "`files_touched`" + ` para los archivos que de verdad importan.
- Si el cambio es trivial, un párrafo basta. Un resumen de tres líneas honesto
  vale más que una plantilla rellena.

## Elegir la categoría

| key | cuándo |
| --- | --- |
| ` + "`feature`" + ` | funcionalidad nueva visible para quien usa el producto |
| ` + "`fix`" + ` | se corrigió un comportamiento incorrecto |
| ` + "`chore`" + ` | dependencias, tooling, versiones, limpieza |
| ` + "`refactor`" + ` | se reestructuró el código sin cambiar su comportamiento |
| ` + "`docs`" + ` | documentación, guías, comentarios |
| ` + "`infra`" + ` | CI/CD, build, despliegue, observabilidad |
| ` + "`design`" + ` | decisión de arquitectura o diseño |
| ` + "`research`" + ` | spike, exploración, comparación de opciones |
| ` + "`incident`" + ` | post-mortem de algo que se rompió |

Si dudas, **no pases ` + "`category`" + `**: SaveMe la infiere a partir del título
y el cuerpo, te dice en qué se basó y con qué confianza, y se lo propone al
usuario junto a tres alternativas. El usuario siempre tiene la última palabra.

## Proyectos

El ` + "`project`" + ` es el nombre de la carpeta de primer nivel dentro del
workspace, en minúsculas y con guiones: ` + "`saveme-app`" + `, ` + "`api-pagos`" + `.
Si el proyecto no existe, SaveMe lo crea con sus nueve carpetas de categoría
cuando el usuario confirma.

Antes de proponer, puedes usar ` + "`saveme_project_list`" + ` para ver los
proyectos existentes y no inventar uno nuevo por un error de tipeo.

## Otras tools

- ` + "`saveme_summary_search`" + ` — busca en el historial. Úsala antes de
  proponer: si ya hay un resumen de esto, quizá corresponda ampliarlo.
- ` + "`saveme_summary_list`" + ` — lista resúmenes de un proyecto o categoría.
- ` + "`saveme_summary_read`" + ` — lee un resumen completo por id.
- ` + "`saveme_pending`" + ` — propuestas esperando decisión del usuario.
- ` + "`saveme_project_create`" + ` — crea un proyecto sin proponer nada.
- ` + "`saveme_summary_cancel`" + ` — descarta una propuesta.

## Antes de proponer, revisa el historial

Llama a ` + "`saveme_summary_search`" + ` con el tema del cambio. Si ya existe un
resumen reciente de lo mismo, menciónalo y pregunta si esto es una continuación o
algo distinto, en vez de crear dos entradas casi idénticas.
`
