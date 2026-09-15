#!/usr/bin/env bun
/**
 * Verificación del Live Preview sin navegador.
 *
 * El plugin decide qué ocultar, qué estilar y dónde poner widgets a partir del
 * árbol de sintaxis. Esa lógica es donde están los errores sutiles, y no se ve
 * compilando: si un nombre de nodo está mal escrito, el plugin simplemente no
 * hace nada y nadie se entera.
 *
 * Aquí se construye un estado de CodeMirror de verdad —el mismo parser que usa
 * el editor—, se calculan las decoraciones y se comprueban una por una. No
 * sustituye a mirar la pantalla, pero sí prueba que las decoraciones son las
 * correctas.
 *
 * Uso:  bun run scripts/verify-live-preview.mjs
 */
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'

import {
  computeDiagramDecorationsParaPruebas,
  computeDecorations,
  diagramFenceOf,
} from '../src/features/editor/livePreview/livePreview.ts'

const DOC = `# Encabezado uno

Texto con **negrita**, *cursiva*, ~~tachado~~ y \`codigo\`.

## Encabezado dos

- item normal
- [ ] tarea pendiente
- [x] tarea hecha
1. numerada

> una cita

[un enlace](https://ejemplo.com)
`

let failures = 0

function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  \x1b[32m✓\x1b[0m ${label}`)
  } else {
    console.log(`  \x1b[31m✗\x1b[0m ${label}${detail ? ` — ${detail}` : ''}`)
    failures++
  }
}

function stateFor(doc) {
  return EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage })],
  })
}

/** Recolecta las decoraciones como objetos simples para poder inspeccionarlas. */
function collect(state, activeLines) {
  const built = computeDecorations(state, activeLines, 0, state.doc.length)
  const out = []
  built.all.between(0, state.doc.length, (from, to, value) => {
    const widget = value.spec?.widget
    out.push({
      from,
      to,
      text: state.doc.sliceString(from, to),
      className: value.spec?.class ?? null,
      // Todas las marcas y decoraciones de línea de este plugin llevan clase;
      // las sustituciones no. Con eso se distinguen sin ambigüedad.
      isReplace: value.spec?.widget !== undefined || value.spec?.class === undefined,
      widget: widget ? widget.constructor.name : null,
      checked: widget && typeof widget.checked === 'boolean' ? widget.checked : null,
    })
  })
  return out
}

const state = stateFor(DOC)
const lineOf = (needle) => {
  const index = DOC.split('\n').findIndex((line) => line.includes(needle))
  if (index < 0) throw new Error(`no encontré la línea con ${needle}`)
  return index + 1
}

// ---------------------------------------------------------------------------
console.log('\n\x1b[1m1. Sin cursor (todo renderizado)\x1b[0m')
const rendered = collect(state, new Set())

const hidden = rendered.filter((d) => d.isReplace && d.widget === null)
const widgets = rendered.filter((d) => d.widget !== null)
const lines = rendered.filter((d) => d.className?.startsWith('cm-lp-h'))
const marks = rendered.filter((d) => d.className && d.className.startsWith('cm-lp-'))

check('oculta delimitadores (** ~~ ` # >)', hidden.length >= 8, `${hidden.length} sustituciones vacías`)
check('crea widgets para las dos casillas de tarea',
  widgets.filter((w) => w.widget === 'TaskCheckboxWidget').length === 2,
  JSON.stringify(widgets.map((w) => w.widget)))
check('una tarea marcada y otra no',
  widgets.some((w) => w.checked === true) && widgets.some((w) => w.checked === false))
check('sustituye la viñeta del item normal por un glifo',
  widgets.some((w) => w.widget === 'BulletWidget'))
check('marca las líneas de encabezado con su nivel',
  lines.some((d) => d.className === 'cm-lp-h1') && lines.some((d) => d.className === 'cm-lp-h2'),
  JSON.stringify(lines.map((d) => d.className)))
check('estiliza negrita, cursiva, tachado y código',
  ['cm-lp-strong', 'cm-lp-em', 'cm-lp-strike', 'cm-lp-code']
    .every((cls) => marks.some((d) => d.className === cls)),
  JSON.stringify([...new Set(marks.map((d) => d.className))]))
check('estiliza el texto del enlace',
  marks.some((d) => d.className === 'cm-lp-link' && d.text === 'un enlace'),
  JSON.stringify(marks.filter((d) => d.className === 'cm-lp-link').map((d) => d.text)))
check('marca las líneas de la cita',
  rendered.some((d) => d.className === 'cm-lp-quote'))

// ---------------------------------------------------------------------------
console.log('\n\x1b[1m2. Con el cursor en el encabezado h1\x1b[0m')
const onH1 = collect(state, new Set([lineOf('# Encabezado uno')]))

// Por posición, no por texto: el `## ` del h2 también empieza por `#`, así que
// buscar por texto no distingue de qué encabezado se trata. El `#` del h1 está
// en la posición 0 del documento.
check('el `#` del h1 NO se oculta (se puede editar la sintaxis)',
  !onH1.some((d) => d.isReplace && d.widget === null && d.from === 0),
  JSON.stringify(onH1.filter((d) => d.isReplace && d.widget === null && d.from === 0)))
check('el encabezado sigue agrandado',
  onH1.some((d) => d.className === 'cm-lp-h1'))
// El encabezado oculta el mark Y el espacio que le sigue, así que el texto
// sustituido es "## " y no "##".
check('fuera de esa línea sí se ocultan los demás delimitadores',
  onH1.some((d) => d.isReplace && d.widget === null && d.text.trim() === '##'),
  JSON.stringify(onH1.filter((d) => d.isReplace).map((d) => d.text).slice(0, 8)))

// ---------------------------------------------------------------------------
console.log('\n\x1b[1m3. Con el cursor en una tarea\x1b[0m')
const onTask = collect(state, new Set([lineOf('- [ ] tarea pendiente')]))

check('la casilla de esa línea se convierte en texto editable, no en widget',
  !onTask.some((w) => w.widget === 'TaskCheckboxWidget' && w.text === '[ ]'))
check('la otra tarea sigue siendo un widget clicable',
  onTask.some((w) => w.widget === 'TaskCheckboxWidget' && w.checked === true))
check('el marcador visible se estiliza como tal',
  onTask.some((d) => d.className === 'cm-lp-task-mark'))

// ---------------------------------------------------------------------------
console.log('\n\x1b[1m4. Propiedades que importan\x1b[0m')

const bold = rendered.find((d) => d.className === 'cm-lp-strong')
check('la negrita estiliza solo el contenido, sin los asteriscos',
  bold !== undefined && bold.text === 'negrita', bold ? JSON.stringify(bold.text) : 'no encontrada')

const taskWidget = widgets.find((w) => w.widget === 'TaskCheckboxWidget')
check('el widget de tarea cubre exactamente `[ ]` o `[x]`',
  taskWidget !== undefined && /^\[[ x]\]$/.test(taskWidget.text),
  taskWidget ? JSON.stringify(taskWidget.text) : 'no encontrado')

const built = computeDecorations(state, new Set(), 0, state.doc.length)
let atomicCount = 0
built.atomic.between(0, state.doc.length, () => {
  atomicCount++
})
check('solo los delimitadores ocultos y los widgets son atómicos (no las marcas)',
  atomicCount === hidden.length + widgets.length,
  `atomic=${atomicCount} hidden=${hidden.length} widgets=${widgets.length}`)

const markInAtomic = bold !== undefined && built.atomic.between(bold.from, bold.from, () => {}) === undefined
check('las marcas de estilo no son atómicas', markInAtomic, 'la negrita no debe ser atómica')

// ---------------------------------------------------------------------------
console.log('\n\x1b[1m5. Frontmatter (todos los archivos de SaveMe lo llevan)\x1b[0m')
// El cierre `---` del frontmatter se parsea como subrayado de un encabezado
// setext, así que hay que comprobar que el Live Preview no lo esconde ni agranda
// las líneas de metadatos. Sería un estropicio en todos los archivos.
const FRONTMATTER = `---
id: sm_abc
title: Un título con **negrita** dentro
category: feature
status: confirmed
---

Cuerpo del documento.
`
const fmState = stateFor(FRONTMATTER)
const fm = collect(fmState, new Set())
const fmLines = FRONTMATTER.split('\n')

check('no agranda ninguna línea del frontmatter',
  !fm.some((d) => d.className?.startsWith('cm-lp-h') && d.from < FRONTMATTER.indexOf('---\n\n')),
  JSON.stringify(fm.filter((d) => d.className?.startsWith('cm-lp-h'))))
check('no oculta los delimitadores del frontmatter',
  !fm.some((d) => d.isReplace && fmLines[fmState.doc.lineAt(d.from).number - 1]?.trim() === '---'),
  JSON.stringify(fm.filter((d) => d.isReplace).map((d) => d.text)))

// ---------------------------------------------------------------------------
console.log('\n\x1b[1m6. Documento vacío y casos límite\x1b[0m')
const empty = stateFor('')
check('un documento vacío no rompe nada',
  computeDecorations(empty, new Set(), 0, 0).all.size === 0)

const partial = stateFor('**negrita sin cerrar')
check('la negrita sin cerrar no rompe nada',
  computeDecorations(partial, new Set(), 0, partial.doc.length) !== null)

const fenced = stateFor('```go\nfunc main() { **no** }\n```\n')
const inCode = collect(fenced, new Set())
check('dentro de un bloque de código no se decora nada',
  !inCode.some((d) => d.className?.startsWith('cm-lp-')),
  JSON.stringify(inCode.map((d) => d.className)))

// ---------------------------------------------------------------------------
// Diagramas Mermaid.
//
// El widget de bloque no se puede montar sin DOM, pero lo que decide **cuándo**
// se monta sí se puede comprobar: eso es lo que se rompe en silencio si el
// parser cambia de nombres de nodo.
{
  const { syntaxTree } = await import('@codemirror/language')

  const fenceNodes = (state) => {
    const out = []
    syntaxTree(state).iterate({
      enter: (node) => {
        if (node.name === 'FencedCode') out.push(node.node)
      },
    })
    return out
  }

  const diagram = stateFor('```mermaid\ngraph TD\n  A --> B\n```\n')
  const [node] = fenceNodes(diagram)
  const fence = node ? diagramFenceOf(diagram, node) : null
  check('reconoce un cercado mermaid', fence !== null)
  check('y saca el cuerpo sin las tres comillas', fence?.code === 'graph TD\n  A --> B', fence?.code)
  check('y cubre el bloque entero', fence?.from === 0 && fence?.to === diagram.doc.length - 1,
    `${fence?.from}-${fence?.to} de ${diagram.doc.length}`)

  const alias = stateFor('~~~mmd\ngraph TD\n~~~\n')
  const [aliasNode] = fenceNodes(alias)
  check('reconoce el alias mmd y el cercado con tildes',
    aliasNode ? diagramFenceOf(alias, aliasNode) !== null : false)

  const otro = stateFor('```ts\nconst x = 1\n```\n')
  const [otroNode] = fenceNodes(otro)
  check('un bloque que no es diagrama se deja en paz',
    otroNode ? diagramFenceOf(otro, otroNode) === null : false)

  const vacio = stateFor('```mermaid\n```\n')
  const [vacioNode] = fenceNodes(vacio)
  check('un diagrama vacío no se sustituye',
    vacioNode ? diagramFenceOf(vacio, vacioNode) === null : false)

  // El caso que importa de verdad: con el cursor dentro, se ve el markdown.
  const dentro = stateFor('```mermaid\ngraph TD\n```\n')
  const conCursor = EditorState.create({
    doc: dentro.doc.toString(),
    selection: { anchor: 5 },
    extensions: [markdown({ base: markdownLanguage })],
  })
  const oculto = computeDiagramDecorationsParaPruebas(conCursor, new Set([2]))
  check('con el cursor dentro no se dibuja el diagrama', oculto.size === 0, `size=${oculto.size}`)

  const sinCursor = computeDiagramDecorationsParaPruebas(conCursor, new Set())
  check('con el cursor fuera se sustituye el bloque', sinCursor.size === 1, `size=${sinCursor.size}`)

  const dos = stateFor('```mermaid\ngraph TD\n```\n\ntexto\n\n```mermaid\ngraph LR\n```\n')
  check('dos diagramas dan dos sustituciones',
    computeDiagramDecorationsParaPruebas(dos, new Set()).size === 2)
}

// ---------------------------------------------------------------------------
console.log('')
if (failures > 0) {
  console.log(`\x1b[31m${failures} comprobación(es) fallaron\x1b[0m`)
  process.exit(1)
}
console.log('\x1b[32mLive Preview verificado.\x1b[0m')
