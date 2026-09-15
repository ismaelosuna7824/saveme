package mcpserver

import "fmt"

// proposeDescription es el texto que lee el modelo para decidir cómo usar la
// tool. Es la superficie de prompt más importante del proyecto: explica el
// contrato de dos fases y, sobre todo, deja claro que proponer NO escribe.
const proposeDescription = `Prepara el guardado de un resumen humano de un cambio reciente (feature, fix, chore,
refactor, docs, infra, design, research o incident).

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

CÓMO ESCRIBIR EL CUERPO: es markdown para una persona que lo leerá en seis meses, no un
changelog ni un diff. Explica qué se hizo, POR QUÉ (esto es lo que siempre se olvida) y
qué habría que saber para retomarlo. Escribe en el idioma en el que te habla el usuario.
Si el cambio es trivial, un párrafo honesto vale más que una plantilla rellena.

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
Markdown legible, en el idioma del usuario, escrito para alguien que lo leerá en seis
meses. Qué se hizo, por qué, cómo funciona y qué falta. Lo más valioso es el "por qué":
es lo que se pierde primero y lo que más se agradece después. Nada de changelogs, diffs ni
listas de archivos.

Puedes pedir la guía completa con el prompt "saveme/human-summary" o leyendo el recurso
saveme://guide.
`, root)
}

// promptBody es la versión conversacional de la guía, para cuando el usuario
// invoca el prompt explícitamente.
func promptBody(root string) string {
	return fmt.Sprintf(`Vas a registrar un resumen humano en SaveMe (workspace: %s).

Sigue este procedimiento:

1. Identifica el cambio del que hay que dejar constancia. Si no está claro, pregúntale al
   usuario de qué cambio se trata.
2. Busca en el historial con saveme_summary_search para no duplicar algo que ya está.
3. Redacta el resumen en markdown, en el idioma del usuario, con esta estructura:
   "## Qué se hizo", "## Por qué", "## Cómo funciona", "## Qué falta / riesgos",
   "## Cómo verificarlo". Omite las secciones que no aporten; no rellenes por rellenar.
4. Llama a saveme_summary_propose sin pasar categoría, salvo que estés seguro de cuál es.
5. Muéstrale al usuario la ruta propuesta, la razón de la categoría y las alternativas, y
   pregúntale si le parece bien.
6. Cuando responda, confirma con saveme_summary_confirm (o cancela con
   saveme_summary_cancel si no quiere guardarlo).

No escribas ningún archivo a mano: saveme_summary_confirm es el único camino.`, root)
}
