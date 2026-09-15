#!/usr/bin/env bun
/**
 * Guardia contra utilidades de Tailwind «tragadas» por el CSS propio.
 *
 * `src/styles.css` empieza con `@import 'tailwindcss'`, así que **todas** las
 * utilidades de Tailwind quedan antes que las clases propias del archivo. Como
 * `.term-panel` y `.fixed` tienen la misma especificidad (una clase cada una),
 * gana la que va después: la propia. El resultado fue que un diálogo con
 * `class="term-panel fixed …"` acababa siendo `position: relative`, y con
 * `left: 50%` / `top: 50%` encima eso no centra nada: el diálogo se iba al final
 * del documento y se salía de la ventana.
 *
 * Así se veían la paleta de comandos (anclada al fondo y cortada) y Ajustes (sin
 * contenido a la vista). No era un fallo de un componente: era el orden del CSS,
 * y volvería a pasar con cualquier clase propia que declare una propiedad que el
 * elemento también pide por utilidad.
 *
 * Uso:  bun run verify:css
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const STYLES = join(ROOT, 'src/styles.css')
const SRC = join(ROOT, 'src')

/**
 * Propiedades propias que pueden quedar anuladas por una utilidad de Tailwind.
 *
 * Solo están las que producen fallos que no se ven venir: `position` saca el
 * elemento de la pantalla y `display` lo deja visible cuando debería ocultarse.
 * Las colisiones de color o de tamaño se ven al primer vistazo y no compensan el
 * ruido de una lista más larga.
 */
const GUARDED = {
  position: new Set(['static', 'fixed', 'absolute', 'relative', 'sticky']),
  display: new Set([
    'block',
    'inline-block',
    'inline',
    'flex',
    'inline-flex',
    'table',
    'grid',
    'contents',
    'hidden',
    'flow-root',
  ]),
}

let failures = 0

function fail(message) {
  console.log(`  \x1b[31m✗\x1b[0m ${message}`)
  failures++
}

/**
 * Propiedades de cada clase propia, sumando todas sus reglas.
 *
 * Se acumulan en vez de quedarse con la última: `.scanlines` declara
 * `position: fixed` en su regla normal y `display: none` en la del tema plano, y
 * las dos cuentan. Las reglas con pseudoelemento (`.term-frame::before`) quedan
 * fuera: se aplican a otra caja y no compiten con las utilidades.
 */
function ownClasses(css) {
  const classes = new Map()
  const rule = /\.([a-zA-Z][\w-]*)\s*\{([^}]*)\}/g
  for (const match of css.matchAll(rule)) {
    const [, name, body] = match
    const declarations = classes.get(name) ?? new Map()
    for (const chunk of body.split(';')) {
      const colon = chunk.indexOf(':')
      if (colon === -1) continue
      const property = chunk.slice(0, colon).trim()
      const value = chunk.slice(colon + 1).trim()
      if (property !== '' && value !== '') declarations.set(property, value)
    }
    classes.set(name, declarations)
  }
  return classes
}

/** `fixed`, `sm:absolute`, `hover:flex`… cuentan; `[position:fixed]` no. */
function utilityIn(tokens, utilities) {
  return tokens.find((token) => {
    const base = token.split(':').at(-1)
    return token !== '' && !token.includes('[') && utilities.has(base)
  })
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

const classes = ownClasses(readFileSync(STYLES, 'utf8'))

console.log(`\n\x1b[1mClases propias que declaran position o display\x1b[0m`)
const risky = [...classes].flatMap(([name, declarations]) =>
  Object.keys(GUARDED)
    .filter((property) => declarations.has(property))
    .map((property) => [name, `${property}: ${declarations.get(property)}`]),
)
if (risky.length === 0) {
  console.log('  \x1b[32m✓\x1b[0m ninguna: el CSS propio no pisa posición ni display')
} else {
  for (const [name, declaration] of risky) console.log(`  .${name} → ${declaration}`)
}

console.log(`\n\x1b[1mCombinaciones peligrosas en el JSX\x1b[0m`)
const riskyNames = new Set(risky.map(([name]) => name))
let collisions = 0
for (const file of walk(SRC)) {
  const source = readFileSync(file, 'utf8')
  // Los literales de cadena y plantilla son donde viven los `className`. Se
  // incluye el contenido de los `cn(...)` porque suelen ser un solo literal.
  const literals = source.match(/'[^'\n]*'|"[^"\n]*"|`[^`]*`/g) ?? []
  for (const literal of literals) {
    const tokens = literal.slice(1, -1).split(/\s+/).filter(Boolean)
    const own = tokens.filter((token) => riskyNames.has(token))
    if (own.length === 0) continue
    for (const name of own) {
      const declarations = classes.get(name)
      for (const [property, utilities] of Object.entries(GUARDED)) {
        if (!declarations.has(property)) continue
        const utility = utilityIn(tokens, utilities)
        if (!utility) continue
        fail(
          `${relative(ROOT, file)}: ".${name}" (${property}: ${declarations.get(property)}) ` +
            `junto a "${utility}" — la clase propia va después en styles.css y gana, ` +
            `así que "${utility}" no se aplica`,
        )
        collisions++
      }
    }
  }
}
if (collisions === 0) {
  console.log('  \x1b[32m✓\x1b[0m ninguna se combina con una utilidad que anularía')
}

console.log('')
if (failures > 0) {
  console.log(`\x1b[31m${failures} problema(s) de orden CSS\x1b[0m`)
  process.exit(1)
}
console.log('\x1b[32mOrden CSS verificado.\x1b[0m')
