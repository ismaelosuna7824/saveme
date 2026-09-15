import type { EditorView } from '@codemirror/view'

/**
 * Marca o desmarca una casilla de tarea reescribiendo sus tres caracteres.
 *
 * Vive aparte porque lo usan los dos editores —el de resúmenes y el de notas— y
 * porque es lógica pura sobre un `EditorView`: se puede razonar sin montar nada.
 *
 * Solo se tocan los tres caracteres del marcador. El resto de la línea no se
 * toca, así que el texto de la tarea y el historial de deshacer quedan intactos.
 */
export function toggleTaskAtLine(
  view: EditorView | null,
  line: number,
  checked: boolean,
): void {
  if (view === null) return
  const total = view.state.doc.lines
  if (!Number.isInteger(line) || line < 1 || line > total) return

  const target = view.state.doc.line(line)
  const match = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]/.exec(target.text)
  if (match === null) return

  const markerFrom = target.from + match[1].length
  view.dispatch({
    changes: { from: markerFrom, to: markerFrom + 3, insert: checked ? '[x]' : '[ ]' },
    scrollIntoView: false,
  })
}
