/**
 * Marcadores de coincidencia del fragmento de búsqueda (`SummaryMeta.snippet`).
 *
 * El core los pone como caracteres de control (STX/ETX, `domain.SnippetOpen` y
 * `domain.SnippetClose`) y no como HTML: aquí se trocea el texto y cada trozo se
 * pinta como texto de React, así que nada del índice se interpreta como marcado.
 */
export const SNIPPET_OPEN = '\u0002'
export const SNIPPET_CLOSE = '\u0003'

export interface SnippetPart {
  text: string
  match: boolean
}

/**
 * Parte un fragmento en trozos normales y coincidencias. Un marcador suelto (un
 * fragmento recortado justo dentro de una coincidencia) no rompe nada: el resto
 * del trozo sigue en el estado en que estaba.
 */
export function splitSnippet(snippet: string): SnippetPart[] {
  const parts: SnippetPart[] = []
  let match = false
  let start = 0
  for (let i = 0; i <= snippet.length; i++) {
    const char = snippet[i]
    if (i < snippet.length && char !== SNIPPET_OPEN && char !== SNIPPET_CLOSE) continue
    if (i > start) parts.push({ text: snippet.slice(start, i), match })
    match = char === SNIPPET_OPEN
    start = i + 1
  }
  return parts
}
