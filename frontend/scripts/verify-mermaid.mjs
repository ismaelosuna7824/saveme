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
 *  3. **Que las clases del componente estén en el CSS.** Un renombrado deja el
 *     diagrama sin caja y sin estilos, y tampoco falla nada.
 *
 * Uso:  bun run verify:mermaid
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { isDiagramLanguage, mermaidThemeVariables } from '../src/lib/mermaid.ts'

const ROOT = new URL('..', import.meta.url).pathname
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

section('3. Las clases del componente están en el CSS')
const component = readFileSync(join(SRC, 'components/common/MermaidBlock.tsx'), 'utf8')
const classes = [...new Set(component.match(/mermaid-block[\w-]*/g) ?? [])]
check('el componente usa clases mermaid-block', classes.length > 0)
for (const name of classes) {
  check(`.${name} está definida en styles.css`, CSS.includes(`.${name}`))
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

console.log('')
if (failures > 0) {
  console.log(`\x1b[31m${failures} problema(s) en los diagramas\x1b[0m`)
  process.exit(1)
}
console.log('\x1b[32mMermaid verificado.\x1b[0m')
