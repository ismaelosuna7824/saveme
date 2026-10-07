import { EditorState, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'

import { splitFrontmatter } from '@/features/editor/frontmatter'

/**
 * El frontmatter, oculto y protegido en modo live.
 *
 * El editor trabaja con el archivo entero —frontmatter incluido— porque guarda lo
 * que tiene: sin el bloque YAML, el primer autoguardado lo borraba del disco. En
 * modo live ese bloque no es contenido humano, así que se esconde, el cursor lo
 * salta y ninguna edición lo toca (seleccionar todo y escribir reemplaza solo el
 * cuerpo). Quien quiera editarlo tiene el modo fuente, donde se ve tal cual.
 *
 * Los cambios que sí deben tocarlo —el título de la barra, adoptar el archivo del
 * disco— se despachan con `filter: false`, que es justo para lo que existe.
 */

/** El YAML de SaveMe son unas pocas líneas: no hace falta mirar más lejos. */
const MAX_SCAN = 16_384

interface FrontmatterRange {
  /** Fin de la línea de cierre `---`; `null` si el documento no tiene frontmatter. */
  to: number | null
  decorations: DecorationSet
}

function compute(state: EditorState): FrontmatterRange {
  const head = state.doc.sliceString(0, Math.min(state.doc.length, MAX_SCAN))
  const split = splitFrontmatter(head)
  if (split === null) return { to: null, decorations: Decoration.none }
  // `end` cae después del salto de la línea de cierre: se oculta hasta el final de
  // esa línea y no más, para que la primera línea del cuerpo siga siendo editable.
  const to = state.doc.lineAt(Math.max(0, split.end - 1)).to
  return { to, decorations: Decoration.set([Decoration.replace({ block: true }).range(0, to)]) }
}

const frontmatterField = StateField.define<FrontmatterRange>({
  create: compute,
  update: (value, tr) => (tr.docChanged ? compute(tr.state) : value),
  provide: (field) => [
    EditorView.decorations.from(field, (value) => value.decorations),
    EditorView.atomicRanges.of((view) => view.state.field(field).decorations),
  ],
})

export function hiddenFrontmatter(): Extension {
  return [
    frontmatterField,
    EditorState.changeFilter.of((tr) => {
      const to = tr.startState.field(frontmatterField).to
      return to === null ? true : [0, to]
    }),
  ]
}
