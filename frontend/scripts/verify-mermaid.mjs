#!/usr/bin/env bun
/**
 * Verificación de los diagramas Mermaid.
 *
 * Renderizar de verdad necesita un navegador —Mermaid mide texto y calcula
 * geometría—, así que aquí se comprueba lo que sí es objetivo y que además es lo
 * que se rompe en silencio:
 *
 *  1. **Que siga siendo perezoso.** Mermaid pesa más que el resto del editor:
 *     si alguien lo importa arriba, entra en el bundle inicial y lo paga todo el
 *     mundo. Se comprueba que la única vía sea `import()` dinámico.
 *  2. **Que los tokens existan.** El mapa de colores pide variables por nombre;
 *     si una se renombra en `styles.css`, el diagrama se queda con los colores
 *     por defecto de Mermaid y nadie se entera hasta que se ve.
 *  3. **Que las clases de los componentes estén en el CSS.** Un renombrado deja
 *     el diagrama —o el visor— sin caja y sin estilos, y tampoco falla nada.
 *  4. **Que el zoom del visor vaya hacia el puntero** y respete los topes: si
 *     la cuenta se tuerce, el diagrama se escapa de la vista al ampliar.
 *
 * Uso:  bun run verify:mermaid
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { isDiagramLanguage, mermaidThemeVariables } from '../src/lib/mermaid.ts'
import { decisionMapDiagram, mermaidLabel } from '../src/features/projects/decisionMapDiagram.ts'
import { MAX_SCALE, MIN_SCALE, fitView, zoomAt } from '../src/lib/panZoom.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SRC = join(ROOT, 'src')
const CSS = readFileSync(join(ROOT, 'src/styles.css'), 'utf8')

let failures = 0

function check(label, condition) {
  if (condition) console.log(`  \x1b[32m✓\x1b[0m ${label}`)
  else {
    console.log(`  \x1b[31m✗\x1b[0m ${label}`)
    failures++
  }
}

function section(title) {
  console.log(`\n\x1b[1m${title}\x1b[0m`)
}

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...walk(path))
    else if (/\.tsx?$/.test(path)) out.push(path)
  }
  return out
}

// --- 1. Reconocer un diagrama ------------------------------------------------

section('1. Qué cuenta como diagrama')
check('`mermaid` es un diagrama', isDiagramLanguage('mermaid'))
check('`Mermaid` también (el fence llega como se escribió)', isDiagramLanguage('mermaid'.toUpperCase()))
check('`mmd` es el alias y también cuenta', isDiagramLanguage('mmd'))
check('`  mermaid  ` con espacios cuenta', isDiagramLanguage('  mermaid  '))
check('`mermaidx` NO es un diagrama', !isDiagramLanguage('mermaidx'))
check('`ts` NO es un diagrama', !isDiagramLanguage('ts'))
check('vacío NO es un diagrama', !isDiagramLanguage(''))

// --- 2. Los tokens que pide el mapa existen ----------------------------------

section('2. Los tokens del tema existen en styles.css')
const requested = []
const variables = mermaidThemeVariables((name) => {
  requested.push(name)
  return 'valor-de-prueba'
})

check('el mapa devuelve variables', Object.keys(variables).length > 0)

// `--font-mono` se pide por separado en `currentMermaidConfig`.
const allRequested = [...new Set([...requested, '--font-mono'])]
const missing = allRequested.filter((name) => !CSS.includes(`${name}:`))
if (missing.length > 0) {
  for (const name of missing) {
    console.log(`  \x1b[31m✗\x1b[0m el mapa pide ${name}, que ya no está en styles.css`)
    failures++
  }
} else {
  check(`los ${allRequested.length} tokens que pide el mapa existen`, true)
}

// --- 3. El componente y el CSS se conocen ------------------------------------

section('3. Las clases de los componentes están en el CSS')
for (const [file, prefix] of [
  ['components/common/MermaidBlock.tsx', 'mermaid-block'],
  ['components/common/DiagramViewer.tsx', 'mermaid-viewer'],
]) {
  const component = readFileSync(join(SRC, file), 'utf8')
  const classes = [...new Set(component.match(new RegExp(`${prefix}[\\w-]*`, 'g')) ?? [])]
  check(`${file} usa clases ${prefix}`, classes.length > 0)
  for (const name of classes) {
    check(`.${name} está definida en styles.css`, CSS.includes(`.${name}`))
  }
}

// --- 4. Sigue siendo perezoso ------------------------------------------------

section('4. Mermaid se carga solo cuando hace falta')
const sources = walk(SRC)
const staticImports = []
let dynamicImports = 0

for (const file of sources) {
  const source = readFileSync(file, 'utf8')
  // `import type` no genera código: se borra al compilar y no arrastra nada.
  for (const match of source.matchAll(/import\s+(type\s+)?[^;\n]*from\s+'mermaid'/g)) {
    if (match[1] === undefined) staticImports.push(relative(ROOT, file))
  }
  // `typeof import('mermaid')` es una consulta de tipo, no una carga: se borra al
  // compilar y no genera trozo. Solo cuentan las que se evalúan de verdad.
  dynamicImports += (source.match(/(?<!typeof )import\('mermaid'\)/g) ?? []).length
}

if (staticImports.length > 0) {
  for (const file of staticImports) {
    console.log(`  \x1b[31m✗\x1b[0m ${file} importa mermaid arriba: entra en el bundle inicial`)
    failures++
  }
} else {
  check('ningún archivo lo importa de forma estática', true)
}
check('hay exactamente una carga dinámica', dynamicImports === 1)

// El enrutado del markdown: un fence ```mermaid tiene que acabar en el bloque.
const components = readFileSync(join(SRC, 'components/common/markdownComponents.tsx'), 'utf8')
check('el renderizador de markdown enruta los diagramas', components.includes('isDiagramLanguage'))
check('y monta el bloque del diagrama', components.includes('<MermaidBlock'))

// --- 5. Zoom y desplazamiento del visor --------------------------------------

section('5. El visor hace zoom hacia el puntero')
const close = (a, b) => Math.abs(a - b) < 1e-9
// Punto del contenido bajo (px, py): lo que el zoom tiene que dejar quieto.
const under = (view, px, py) => [(px - view.x) / view.scale, (py - view.y) / view.scale]

const start = { scale: 1.5, x: -120, y: 40 }
const zoomed = zoomAt(start, 2, 300, 200)
const [beforeX, beforeY] = under(start, 300, 200)
const [afterX, afterY] = under(zoomed, 300, 200)
check('lo que había bajo el puntero sigue bajo el puntero', close(beforeX, afterX) && close(beforeY, afterY))
check('y la escala se multiplica por el factor', close(zoomed.scale, 3))

const atMax = zoomAt({ scale: MAX_SCALE, x: 10, y: 20 }, 2, 300, 200)
check('en el tope de zoom la escala no pasa del máximo', atMax.scale === MAX_SCALE)
check('y la vista no se desplaza', atMax.x === 10 && atMax.y === 20)
check('el zoom de alejar tampoco baja del mínimo', zoomAt({ scale: MIN_SCALE, x: 0, y: 0 }, 0.5, 0, 0).scale === MIN_SCALE)

const wide = fitView({ width: 4000, height: 1000 }, { width: 1048, height: 648 }, 24)
check('encajar un diagrama ancho lo ajusta al ancho', close(wide.scale, 1000 / 4000))
check('y lo centra', close(wide.x, 24) && close(wide.y, (648 - 1000 * wide.scale) / 2))
const tiny = fitView({ width: 50, height: 20 }, { width: 1048, height: 648 }, 24)
check('encajar uno diminuto no lo amplía sin límite', tiny.scale === 2)

// --- 6. El mapa de decisiones -------------------------------------------------

section('6. El mapa de decisiones genera un diagrama válido')
// Un título con comillas o con `<` cerraría la etiqueta o colaría HTML: el mapa
// entero saldría como error de sintaxis.
const raro = mermaidLabel('Usar "comillas" y <b>html</b>')
check('las comillas y los < > de un título se escapan', !/["<>]/.test(raro))
check('un título largo se recorta', mermaidLabel('x'.repeat(200)).length <= 48)

// El título no repite el id: así se ve si el id del frontmatter se cuela en el diagrama.
const node = (id, extra = {}) => ({
  id, title: `Decisión ${id.slice(3)}`, category: 'design', project_slug: 'alfa', created_at: '2026-10-01T10:00:00Z',
  superseded: false, stale: false, external: false, ...extra,
})
const mapa = decisionMapDiagram(
  {
    nodes: [node('sm_a', { superseded: true }), node('sm_b'), node('sm_c', { stale: true })],
    edges: [
      { from: 'sm_b', to: 'sm_a', kind: 'supersedes' },
      { from: 'sm_c', to: 'sm_b', kind: 'related' },
      { from: 'sm_c', to: 'sm_fuera', kind: 'related' },
    ],
    isolated: 0,
    omitted: 0,
  },
  { supersedes: 'sustituye' },
  { warning: '#ffb454' },
)
check('empieza como flowchart', mapa.code.startsWith('flowchart LR'))
check('los ids del frontmatter no entran en el diagrama', !mapa.code.includes('sm_'))
check('cada nodo vuelve a su resumen', mapa.nodeIds.get('n0') === 'sm_a' && mapa.nodeIds.get('n2') === 'sm_c')
check('«sustituye» es una arista discontinua con su etiqueta', mapa.code.includes('n1 -. sustituye .-> n0'))
check('«relacionado» es una arista continua', mapa.code.includes('n2 --> n1'))
check('un enlace a un nodo que no está no se dibuja', mapa.code.split('-->').length === 2)
check('lo sustituido y lo desactualizado llevan su clase', mapa.code.includes('class n0 superseded') && mapa.code.includes('class n2 stale'))

console.log('')
if (failures > 0) {
  console.log(`\x1b[31m${failures} problema(s) en los diagramas\x1b[0m`)
  process.exit(1)
}
console.log('\x1b[32mMermaid verificado.\x1b[0m')
