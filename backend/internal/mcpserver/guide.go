package mcpserver

import (
	_ "embed"
	"strings"
)

// La guía vive en markdown y no en una cadena de Go: es un documento largo, con
// bloques de código y diagramas de ejemplo, y escrito dentro de una cadena cruda
// cada comilla invertida obligaba a cortarla. Así se lee y se revisa como lo que
// es.
//
// `writing.md` es la parte de cómo se escribe un resumen. Va aparte porque la
// usan dos textos —la guía completa y el prompt— y tiene que decir lo mismo en
// los dos.

//go:embed guide.md
var guideTemplate string

//go:embed writing.md
var writingGuide string

// Guide devuelve la guía completa para agentes, con la raíz del workspace puesta.
//
// La sirven el recurso MCP `saveme://guide`, el endpoint `GET /api/agents/guide` y el
// subcomando `saveme guide`, que existe para poder hacer
// `saveme guide >> CLAUDE.md` y dejar al agente instruido sin copiar y pegar.
//
// Se sustituye con `strings.ReplaceAll` y no con `fmt.Sprintf`: la guía es texto
// libre y un `%` en un ejemplo rompería el formato sin que nada fallara.
func Guide(root string) string {
	return strings.NewReplacer("{{root}}", root, "{{writing}}", writingGuide).Replace(guideTemplate)
}
