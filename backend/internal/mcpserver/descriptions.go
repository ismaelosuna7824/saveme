package mcpserver

import "fmt"

// proposeDescription es el texto que lee el modelo para decidir cómo usar la
// tool. Es la superficie de prompt más importante del proyecto: explica el
// contrato de dos fases y, sobre todo, deja claro que proponer NO escribe.
const proposeDescription = `Prepara el guardado de un resumen humano de un cambio reciente (feature, fix, perf,
security, chore, refactor, docs, infra, design, research o incident).

IMPORTANTE: esta tool NO escribe nada. Ni un archivo, ni una carpeta. Devuelve una
propuesta —la categoría sugerida, la ruta final y las alternativas— junto con un token
de un solo uso.

QUÉ HACER DESPUÉS, EN ESTE ORDEN:
1. Muéstrale la propuesta al usuario y PREGÚNTALE si le parece bien esa ubicación.
2. Espera su respuesta. No la inventes ni la supongas.
3. Llama a saveme_summary_confirm con el token y la decisión.

El usuario tiene la última palabra sobre dónde vive su historial: si quiere otra carpeta,
pásala en el override de saveme_summary_confirm. Si no quiere guardarlo, usa
saveme_summary_cancel.

CÓMO ESCRIBIR EL CUERPO: es DOCUMENTACIÓN en markdown para alguien que lo leerá en seis
meses sin haber visto esta conversación ni el diff. Tiene que poder entender qué se hizo,
POR QUÉ (lo que siempre se olvida), cómo funciona y cómo retomarlo. Si el usuario dijo qué
quiere guardar, eso es el centro del resumen. Estructura habitual: Contexto, Qué se hizo,
Por qué (con las alternativas descartadas), Cómo funciona, Cómo usarlo y verificarlo, Qué
falta y riesgos, Referencias; omite las que no aporten. Usa nombres reales (rutas,
comandos, endpoints) explicados la primera vez.

DIAGRAMAS: SaveMe pinta los bloques mermaid. Cuando haya un flujo, varias piezas que se
hablan o un ciclo de estados, añade un diagrama sencillo: flowchart para procesos y
decisiones, sequenceDiagram para quién llama a quién, stateDiagram-v2 para estados,
erDiagram para modelos de datos. Uno por idea, unos 15 nodos como mucho, con una frase
que diga qué enseña. Nada de diagramas para cambios triviales.

El detalle va con la importancia del cambio: una errata cabe en un párrafo; un feature,
una decisión de diseño o un incidente merecen un documento completo. Escribe en el idioma
del usuario. La guía completa, con ejemplos, está en el recurso saveme://guide.

SOBRE LA CATEGORÍA: si no estás seguro, OMÍTELA. SaveMe la infiere del título y del
cuerpo, te dice en qué se basó y con qué confianza, y se la propone al usuario con tres
alternativas concretas. Poner una categoría a la fuerza solo empeora la sugerencia.

Antes de proponer, considera llamar a saveme_summary_search para ver si ya hay un resumen
de esto.

SI YA HAY UN RESUMEN DE ESTO, ACTUALÍZALO EN VEZ DE CREAR OTRO
Un diario que solo sabe añadir se degrada: iterando una semana sobre la misma
funcionalidad acabas con diez entradas casi iguales y ninguna que cuente la historia
completa. Si encuentras un resumen que trata de lo mismo y el usuario quiere continuarlo:

1. Léelo entero con saveme_summary_read: vas a reescribirlo, así que necesitas saber qué
   había. Lo que no repitas, se pierde.
2. Propón con el campo target puesto a su id. La propuesta apunta a ese archivo.
3. El usuario decide igual que siempre, y al confirmar **se reescribe en su sitio**: no se
   duplica ni se mueve.

Dos cosas que conviene saber antes de proponer una actualización:

- El cuerpo que mandes **sustituye** al anterior, no se añade. Si el usuario quiere
  conservar lo que había, inclúyelo tú en el texto nuevo.
- Si alguien editó el archivo entre la propuesta y la confirmación, SaveMe **no pisa
  nada**: la confirmación falla y te dice que lo releas. No es un error tuyo, es la
  garantía de que no se pierde trabajo de nadie.`

// confirmDescription explica que esta tool es el único escritor y que exige una
// decisión real del usuario.
const confirmDescription = `Escribe en disco el resumen de una propuesta, en la ubicación aprobada.

Esta es la ÚNICA tool que escribe archivos. Necesita un token vivo, de un solo uso, con
15 minutos de vida, que solo se obtiene llamando antes a saveme_summary_propose.

REGLA QUE NO SE PUEDE SALTAR: solo puedes pasar decision="accepted" si de verdad le
preguntaste al usuario y te dijo que sí. No lo asumas por el contexto ni porque el cambio
parezca obvio.

- decision="accepted": el usuario aprobó la ubicación propuesta. Guarda tal cual.
- decision="modified": el usuario quiere otra ubicación. Manda override.rel_path (la ruta
  exacta, por ejemplo "api-pagos/docs/2026-02-14-mi-nota.md") o override.category.
- Si no quiere guardarlo, NO uses esta tool: usa saveme_summary_cancel.

Si el cliente MCP soporta elicitation (el parámetro elicit es true por defecto), SaveMe le
preguntará al usuario directamente con la ruta propuesta y las alternativas, y la
respuesta del usuario manda sobre la tuya. Si el usuario cancela el diálogo sin elegir, no
se escribe nada y debes volver a preguntarle en el chat.

La operación es idempotente: si vuelves a confirmar el mismo token, recibes el resumen que
ya se escribió con already_there=true, sin duplicar el archivo.`

// instructions es el texto que el servidor MCP entrega al cliente durante el
// handshake. Es lo primero que lee el modelo, así que aquí va el resumen del
// contrato completo.
func instructions(root string) string {
	return fmt.Sprintf(`SaveMe es el diario técnico del proyecto: guarda resúmenes humanos de lo que se
implementó, se arregló o se decidió, organizados en markdown por proyecto y categoría.

Carpeta raíz del workspace: %s

EL FLUJO SIEMPRE ES DE DOS PASOS
  saveme_summary_propose  ->  no escribe nada, devuelve una propuesta y un token
  [le preguntas al usuario y esperas su respuesta]
  saveme_summary_confirm  ->  escribe el archivo

Nunca escribas un .md a mano dentro del workspace de SaveMe: usa las tools. La
confirmación es obligatoria porque el usuario decide dónde vive su historial, y esa
decisión queda auditada.

CUÁNDO USARLO
Después de terminar un cambio real: un feature, un fix, un chore, un refactor, una
decisión de arquitectura, un incidente. No lo uses para cambios triviales de una línea ni
para exploraciones que no llegaron a nada.

QUÉ ES UN BUEN RESUMEN
Documentación en markdown, en el idioma del usuario, para alguien que lo leerá en seis
meses sin haber visto esta conversación: contexto, qué se hizo, por qué (lo que se pierde
primero), cómo funciona, cómo verificarlo y qué falta. Si el usuario dijo qué quiere
guardar, eso manda. Cuando haya un flujo, componentes que se hablan o estados, añade un
diagrama mermaid sencillo (flowchart, sequenceDiagram, stateDiagram-v2, erDiagram). El
detalle va con la importancia del cambio. Nada de changelogs, diffs ni listas de archivos.

ANTES DE ESCRIBIR TU PRIMER RESUMEN, lee la guía completa —estructura, cuánto detalle y
cómo hacer los diagramas, con ejemplos— en el recurso saveme://guide o con el prompt
"saveme/human-summary".
`, root)
}

// promptBody es la versión conversacional de la guía, para cuando el usuario
// invoca el prompt explícitamente.
func promptBody(root string) string {
	return fmt.Sprintf(`Vas a registrar un resumen humano en SaveMe (workspace: %s).

Sigue este procedimiento:

1. Identifica qué hay que dejar documentado. Si el usuario dijo qué quiere guardar, eso es
   el centro. Si no está claro, pregúntale.
2. Busca en el historial con saveme_summary_search para no duplicar algo que ya está.
3. Redacta el resumen siguiendo la guía de escritura de abajo.
4. Llama a saveme_summary_propose sin pasar categoría, salvo que estés seguro de cuál es.
5. Muéstrale al usuario la ruta propuesta, la razón de la categoría y las alternativas, y
   pregúntale si le parece bien.
6. Cuando responda, confirma con saveme_summary_confirm (o cancela con
   saveme_summary_cancel si no quiere guardarlo).

No escribas ningún archivo a mano: saveme_summary_confirm es el único camino.

`, root) + writingGuide
}
