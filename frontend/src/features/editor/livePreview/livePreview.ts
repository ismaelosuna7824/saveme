/**
 * Live Preview: el editor renderiza el markdown mientras escribes, como Obsidian.
 *
 * La idea, y la razón de que esto no rompa la promesa de "el markdown en disco es
 * la fuente de verdad", es que **el documento nunca se transforma**. Lo único que
 * pasa es que se ocultan los delimitadores (`**`, `#`, `[](url)`, `` ` ``) y se
 * sustituyen por widgets, siempre que el cursor no esté en esa línea. En la línea
 * del cursor se ve el markdown crudo, así que editar la sintaxis sigue siendo
 * posible; y en cualquier momento se puede pasar a `source` para verla entera.
 *
 * El árbol de sintaxis que se recorre es el que ya construye `@codemirror/lang-markdown`
 * para el resaltado, así que esto no añade ningún parser nuevo. Los nombres de
 * nodo (`StrongEmphasis`, `HeaderMark`, `TaskMarker`…) están verificados contra
 * el parser real, no supuestos.
 */
import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'
import { StateField, type EditorState, type Extension, type Range } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view'

import { isDiagramLanguage } from '@/lib/mermaid'

import { BulletWidget, MermaidWidget, TaskCheckboxWidget } from './widgets'
import './livePreview.css'

// --- decoraciones reutilizadas ----------------------------------------------

const strongMark = Decoration.mark({ class: 'cm-lp-strong' })
const emphasisMark = Decoration.mark({ class: 'cm-lp-em' })
const strikeMark = Decoration.mark({ class: 'cm-lp-strike' })
const codeMark = Decoration.mark({ class: 'cm-lp-code' })
const linkMark = Decoration.mark({ class: 'cm-lp-link' })
const taskMark = Decoration.mark({ class: 'cm-lp-task-mark' })

/** Una clase de línea por nivel de encabezado, para que el CSS fije el tamaño. */
const headingLines = [1, 2, 3, 4, 5, 6].map((level) =>
  Decoration.line({ class: `cm-lp-h${level}` }),
)

const quoteLine = Decoration.line({ class: 'cm-lp-quote' })

/** Sustitución invisible: hace desaparecer un delimitador. */
const hide = Decoration.replace({})

// --- utilidades --------------------------------------------------------------

/** Hijo directo con ese nombre, o `null`. */
function childNamed(node: SyntaxNode, name: string): SyntaxNode | null {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === name) return child
  }
  return null
}

/** Todos los hijos directos con ese nombre. */
function childrenNamed(node: SyntaxNode, name: string): SyntaxNode[] {
  const out: SyntaxNode[] = []
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === name) out.push(child)
  }
  return out
}

/** Cuántas listas con viñeta hay por encima: define el glifo de la viñeta. */
function bulletDepth(node: SyntaxNode): number {
  let depth = 0
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.name === 'BulletList') depth++
  }
  return depth
}

function bulletGlyph(depth: number): string {
  if (depth <= 1) return '•'
  if (depth === 2) return '◦'
  return '▪'
}

// --- construcción de decoraciones -------------------------------------------

interface Context {
  state: EditorState
  ranges: Range<Decoration>[]
  atomic: Range<Decoration>[]
  /** Líneas con el cursor: en ellas se muestra el markdown crudo. */
  activeLines: Set<number>
}

function isActive(ctx: Context, pos: number): boolean {
  return ctx.activeLines.has(ctx.state.doc.lineAt(pos).number)
}

function pushHide(ctx: Context, from: number, to: number): void {
  if (from >= to) return
  const range = hide.range(from, to)
  ctx.ranges.push(range)
  // Atómico: las flechas saltan el delimitador oculto en vez de meterse dentro.
  ctx.atomic.push(range)
}

function pushWidget(ctx: Context, from: number, to: number, widget: BulletWidget | TaskCheckboxWidget): void {
  if (from >= to) return
  const range = Decoration.replace({ widget }).range(from, to)
  ctx.ranges.push(range)
  ctx.atomic.push(range)
}

/** Un cercado que contiene un diagrama, con el rango que ocupa entero. */
export interface DiagramFence {
  code: string
  from: number
  to: number
}

/**
 * Reconoce un cercado de diagrama y devuelve su código.
 *
 * Los nombres de nodo están comprobados contra el parser real:
 * `FencedCode` → `CodeMark` (las tres comillas), `CodeInfo` (el lenguaje) y
 * `CodeText` (el cuerpo). Se lee el cuerpo del árbol en vez de recortar las
 * líneas a mano para que `~~~`, cercados indentados y fences anidados salgan
 * bien sin casos especiales.
 */
export function diagramFenceOf(state: EditorState, node: SyntaxNode): DiagramFence | null {
  if (node.name !== 'FencedCode') return null

  const info = childrenNamed(node, 'CodeInfo')[0]
  if (!info) return null
  if (!isDiagramLanguage(state.doc.sliceString(info.from, info.to))) return null

  const body = childrenNamed(node, 'CodeText')[0]
  if (!body) return null
  const code = state.doc.sliceString(body.from, body.to)
  // Un diagrama vacío no se sustituye: dejaría un hueco y ninguna pista de qué
  // falta. Es justo el estado en el que se escribe un diagrama nuevo.
  if (code.trim() === '') return null

  return { code, from: node.from, to: node.to }
}

/**
 * Estiliza el contenido de un nodo y oculta sus delimitadores.
 *
 * Sirve para `**negrita**`, `*cursiva*`, `~~tachado~~` y `` `código` ``: todos
 * tienen la misma forma (marcador, contenido, marcador), así que el contenido va
 * del final del primer marcador al inicio del último.
 */
function styleDelimited(
  ctx: Context,
  node: SyntaxNode,
  style: Decoration,
  markerName: string,
): void {
  const markers = childrenNamed(node, markerName)
  if (markers.length === 0) return

  const first = markers[0]
  const last = markers[markers.length - 1]
  if (first.to < last.from) ctx.ranges.push(style.range(first.to, last.from))

  // En la línea del cursor se dejan los marcadores visibles: es lo que permite
  // editar la sintaxis sin salir del modo en vivo.
  if (!isActive(ctx, node.from)) {
    pushHide(ctx, first.from, first.to)
    if (last.from !== first.from) pushHide(ctx, last.from, last.to)
  }
}

/**
 * `[texto](url)` → el texto con aspecto de enlace y el resto oculto.
 *
 * Cuidado con el número de `LinkMark`: el parser emite CUATRO —`[`, `]`, `(` y
 * `)`—, no dos. El texto del enlace va entre el primero y el segundo; tomar el
 * último como cierre haría que la marca cubriera `texto](url`, que es
 * exactamente el bug que se coló aquí y que la verificación headless detectó.
 */
function decorateLink(ctx: Context, node: SyntaxNode): void {
  const marks = childrenNamed(node, 'LinkMark')
  if (marks.length < 2) return

  const open = marks[0]
  const close = marks[1]
  if (open.to < close.from) ctx.ranges.push(linkMark.range(open.to, close.from))

  if (!isActive(ctx, node.from)) {
    pushHide(ctx, node.from, open.to)
    pushHide(ctx, close.from, node.to)
  }
}

function decorateHeading(ctx: Context, node: SyntaxNode, level: number): void {
  const line = ctx.state.doc.lineAt(node.from)
  ctx.ranges.push(headingLines[level - 1].range(line.from))

  const mark = childNamed(node, 'HeaderMark')
  if (mark && !isActive(ctx, node.from)) {
    // Se come también el espacio que sigue a los almohadillas, si lo hay.
    let end = mark.to
    if (ctx.state.doc.sliceString(end, end + 1) === ' ') end += 1
    pushHide(ctx, mark.from, end)
  }
}

function decorateBlockquote(ctx: Context, node: SyntaxNode): void {
  const first = ctx.state.doc.lineAt(node.from).number
  const last = ctx.state.doc.lineAt(Math.max(node.from, node.to - 1)).number
  for (let number = first; number <= last; number++) {
    ctx.ranges.push(quoteLine.range(ctx.state.doc.line(number).from))
  }
}

function decorateQuoteMark(ctx: Context, node: SyntaxNode): void {
  if (isActive(ctx, node.from)) return
  let end = node.to
  if (ctx.state.doc.sliceString(end, end + 1) === ' ') end += 1
  pushHide(ctx, node.from, end)
}

function decorateListItem(ctx: Context, node: SyntaxNode): void {
  const listMark = childNamed(node, 'ListMark')
  if (listMark === null) return

  // Una tarea no lleva viñeta: el checkbox ocupa su lugar.
  if (childNamed(node, 'Task') !== null) {
    if (!isActive(ctx, node.from)) {
      let end = listMark.to
      if (ctx.state.doc.sliceString(end, end + 1) === ' ') end += 1
      pushHide(ctx, listMark.from, end)
    }
    return
  }

  const text = ctx.state.doc.sliceString(listMark.from, listMark.to)
  // Solo las listas con viñeta se redibujan. En las numeradas el número es
  // información, así que se deja tal cual.
  if (text !== '-' && text !== '*' && text !== '+') return
  if (isActive(ctx, node.from)) return

  pushWidget(ctx, listMark.from, listMark.to, new BulletWidget(bulletGlyph(bulletDepth(node))))
}

function decorateTask(ctx: Context, node: SyntaxNode): void {
  const marker = childNamed(node, 'TaskMarker')
  if (marker === null) return

  const raw = ctx.state.doc.sliceString(marker.from, marker.to)
  const checked = raw.toLowerCase().includes('x')

  if (isActive(ctx, node.from)) {
    // Con el cursor encima se muestra `[ ]` para poder editarlo.
    ctx.ranges.push(taskMark.range(marker.from, marker.to))
    return
  }
  pushWidget(ctx, marker.from, marker.to, new TaskCheckboxWidget(checked, marker.from, marker.to))
}

/**
 * Calcula las decoraciones de un estado.
 *
 * Está separado del `EditorView` a propósito: así la lógica —que es donde están
 * los errores sutiles— se puede verificar sin navegador ni DOM.
 */
export function computeDecorations(
  state: EditorState,
  activeLines: ReadonlySet<number>,
  from: number,
  to: number,
): { all: DecorationSet; atomic: DecorationSet } {
  const ctx: Context = {
    state,
    ranges: [],
    atomic: [],
    activeLines: activeLines as Set<number>,
  }

  {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        const { name } = node
        if (name.startsWith('ATXHeading')) {
          decorateHeading(ctx, node.node, Number(name.slice(-1)))
          return
        }
        switch (name) {
          case 'StrongEmphasis':
            styleDelimited(ctx, node.node, strongMark, 'EmphasisMark')
            break
          case 'Emphasis':
            styleDelimited(ctx, node.node, emphasisMark, 'EmphasisMark')
            break
          case 'Strikethrough':
            styleDelimited(ctx, node.node, strikeMark, 'StrikethroughMark')
            break
          case 'InlineCode':
            styleDelimited(ctx, node.node, codeMark, 'CodeMark')
            break
          case 'Link':
            decorateLink(ctx, node.node)
            break
          case 'Blockquote':
            decorateBlockquote(ctx, node.node)
            break
          case 'QuoteMark':
            decorateQuoteMark(ctx, node.node)
            break
          case 'ListItem':
            decorateListItem(ctx, node.node)
            break
          case 'Task':
            decorateTask(ctx, node.node)
            break
          default:
            break
        }
      },
    })
  }

  return {
    // `true` ordena los rangos. Se deja que lo haga el propio CodeMirror en vez
    // de garantizar el orden a mano: con decoraciones de línea, marcas y
    // sustituciones entremezcladas, ordenarlas a mano es una fuente de bugs sutil.
    all: Decoration.set(ctx.ranges, true),
    atomic: Decoration.set(ctx.atomic, true),
  }
}

/** Líneas que contienen el cursor. Sin foco, ninguna: todo se ve renderizado. */
function activeLinesOf(view: EditorView): Set<number> {
  const active = new Set<number>()
  if (!view.hasFocus) return active
  for (const range of view.state.selection.ranges) {
    const first = view.state.doc.lineAt(range.from).number
    const last = view.state.doc.lineAt(range.to).number
    for (let number = first; number <= last; number++) active.add(number)
  }
  return active
}

function buildDecorations(view: EditorView): { all: DecorationSet; atomic: DecorationSet } {
  const active = activeLinesOf(view)

  // Caso normal: un solo rango visible. Se devuelve tal cual, sin recomponer.
  if (view.visibleRanges.length === 1) {
    const visible = view.visibleRanges[0]
    return computeDecorations(view.state, active, visible.from, visible.to)
  }

  // Con el código plegado hay varios rangos visibles y hay que unirlos.
  // Se calcula una sola vez por rango: recorrer y recolectar por separado para
  // `all` y para `atomic` duplicaría el trabajo en cada pulsación.
  const ranges: Range<Decoration>[] = []
  const atomicRanges: Range<Decoration>[] = []
  for (const visible of view.visibleRanges) {
    const built = computeDecorations(view.state, active, visible.from, visible.to)
    built.all.between(visible.from, visible.to, (from, to, value) => {
      ranges.push(value.range(from, to))
    })
    built.atomic.between(visible.from, visible.to, (from, to, value) => {
      atomicRanges.push(value.range(from, to))
    })
  }
  return { all: Decoration.set(ranges, true), atomic: Decoration.set(atomicRanges, true) }
}

const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    all: DecorationSet
    atomic: DecorationSet

    constructor(view: EditorView) {
      const built = buildDecorations(view)
      this.all = built.all
      this.atomic = built.atomic
    }

    update(update: ViewUpdate): void {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        update.focusChanged
      ) {
        const built = buildDecorations(update.view)
        this.all = built.all
        this.atomic = built.atomic
      }
    }
  },
  {
    decorations: (plugin) => plugin.all,
    provide: (plugin) =>
      EditorView.atomicRanges.of((view) => view.plugin(plugin)?.atomic ?? Decoration.none),
  },
)

/**
 * Decoraciones de los diagramas Mermaid.
 *
 * **Va en un `StateField` y no en el `ViewPlugin` de arriba, y no es una
 * preferencia.** CodeMirror lo prohíbe expresamente para plugins:
 *
 *     if (this.disallowBlockEffectsFor[index]) {
 *       if (deco.block) throw new RangeError("Block decorations may not be specified via plugins")
 *       if (to > doc.lineAt(from).to) throw new RangeError("Decorations that replace line breaks ...")
 *     }
 *
 * Un diagrama hay que sustituirlo entero —tres comillas de apertura, cuerpo y
 * cierre—, y eso cruza saltos de línea. Desde un `ViewPlugin` eso revienta en
 * tiempo de ejecución; desde un `StateField`, no.
 *
 * El plugin de arriba se queda como estaba: esto se suma. Los dos proveen
 * `EditorView.decorations` y CodeMirror los combina.
 */
function computeDiagramDecorations(state: EditorState, activeLines: ReadonlySet<number>): DecorationSet {
  const ranges: Range<Decoration>[] = []

  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== 'FencedCode') return
      const fence = diagramFenceOf(state, node.node)
      if (fence === null) return

      // Con el cursor dentro se ve el markdown, igual que con los delimitadores:
      // es lo que permite editar el diagrama sin salir del modo en vivo.
      const first = state.doc.lineAt(fence.from).number
      const last = state.doc.lineAt(fence.to).number
      for (let line = first; line <= last; line++) {
        if (activeLines.has(line)) return
      }

      ranges.push(
        Decoration.replace({ widget: new MermaidWidget(fence.code), block: true }).range(
          fence.from,
          fence.to,
        ),
      )
    },
  })

  return Decoration.set(ranges, true)
}

/**
 * El mismo cálculo, expuesto para la verificación headless.
 *
 * Montar el widget de bloque necesita un DOM, así que la prueba no puede mirar
 * el DOM: mira esta función, que es la que decide si hay diagrama o no. Es el
 * trozo donde un nombre de nodo mal escrito no daría ningún error.
 */
export const computeDiagramDecorationsParaPruebas = computeDiagramDecorations

const diagramField = StateField.define<DecorationSet>({
  create: (state) => computeDiagramDecorations(state, new Set()),

  update: (value, tr) => {
    // Solo se recalcula cuando algo puede cambiar el resultado: al escribir o al
    // mover el cursor. En cualquier otro caso basta con desplazar los rangos.
    if (tr.docChanged || tr.selection) {
      return computeDiagramDecorations(tr.state, activeDiagramLines(tr.state))
    }
    return value.map(tr.changes)
  },

  provide: (field) => [
    EditorView.decorations.from(field),
    // Atómico: las flechas saltan el diagrama en vez de meterse dentro.
    EditorView.atomicRanges.of((view) => (view.state.field(field, false) ?? Decoration.none)),
  ],
})

/** Líneas con el cursor, para el campo del diagrama. */
function activeDiagramLines(state: EditorState): ReadonlySet<number> {
  const active = new Set<number>()
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number
    const last = state.doc.lineAt(range.to).number
    for (let number = first; number <= last; number++) active.add(number)
  }
  return active
}

/**
 * Extensión de Live Preview.
 *
 * Se monta y se desmonta por compartment, así que alternar a `source` no recrea
 * el editor ni pierde el cursor ni el scroll: solo se quitan los adornos y el
 * markdown vuelve a estar a la vista.
 */
export function livePreview(): Extension {
  return [livePreviewPlugin, diagramField]
}
