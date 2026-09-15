#!/usr/bin/env bun
/**
 * Verificación de los temas.
 *
 * Un tema son tres piezas que se pueden desincronizar sin que nada avise:
 * una entrada en `THEME_OPTIONS`, un bloque `html[data-theme='…']` en
 * `styles.css` y sus textos en los diccionarios. Si falta el bloque, elegir ese
 * tema deja la interfaz con los colores del anterior y parece que el botón no
 * hizo nada; si falta la entrada, el tema existe pero nadie puede elegirlo.
 *
 * Además se mide el **contraste** de cada paleta. No puedo ver los temas, así
 * que en vez de opinar sobre si se ven bonitos compruebo lo que sí es objetivo:
 * que el texto se lea. Las relaciones son las de WCAG 2.1.
 *
 * Uso:  bun run verify:themes
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { DEFAULT_THEME, THEME_OPTIONS } from '../src/features/settings/themeOptions.ts'
import { parseHexColor, translucentBackground } from '../src/lib/translucency.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
// Los comentarios se quitan antes de parsear: algunos llevan `:` dentro y, sin
// esto, el `indexOf(':')` de `tokens()` los toma por declaraciones y se come el
// token que va justo debajo.
const CSS = readFileSync(join(ROOT, 'src/styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

let failures = 0

function fail(message) {
  console.log(`  \x1b[31m✗\x1b[0m ${message}`)
  failures++
}

function ok(message) {
  console.log(`  \x1b[32m✓\x1b[0m ${message}`)
}

function section(title) {
  console.log(`\n\x1b[1m${title}\x1b[0m`)
}

// --- Lectura del CSS --------------------------------------------------------

/** Convierte el cuerpo de un bloque de tokens en un mapa propiedad → valor. */
function tokens(body) {
  const out = new Map()
  for (const chunk of body.split(';')) {
    const colon = chunk.indexOf(':')
    if (colon === -1) continue
    const property = chunk.slice(0, colon).trim()
    const value = chunk.slice(colon + 1).trim()
    if (property.startsWith('--')) out.set(property, value)
  }
  return out
}

const baseMatch = /@theme\s*\{([^}]*)\}/.exec(CSS)
if (!baseMatch) {
  console.error('no encontré el bloque @theme en styles.css')
  process.exit(1)
}
const baseTokens = tokens(baseMatch[1])

const blocks = new Map()
for (const match of CSS.matchAll(/html\[data-theme='([^']+)'\]\s*\{([^}]*)\}/g)) {
  blocks.set(match[1], tokens(match[2]))
}

/**
 * Temas que heredan la paleta base a propósito.
 *
 * `plain` es «phosphor sin scanlines»: solo cambia el color de la scanline. No
 * es un olvido, es su definición, así que se le exime de declarar el juego
 * completo. Cualquier otro tema que se añada tiene que ser autosuficiente.
 */
const INHERITS_BASE = new Set(['plain'])

/** Tokens derivados en `:root`: no los declara cada tema, apuntan a otros. */
const DERIVED = new Set([
  '--color-card',
  '--color-card-foreground',
  '--color-popover',
  '--color-popover-foreground',
  '--color-input',
])

const required = [...baseTokens.keys()].filter(
  (name) => name.startsWith('--color-') && !DERIVED.has(name),
)

const offered = THEME_OPTIONS.map((option) => option.key)

// --- 1. Las tres piezas cuadran --------------------------------------------

section('1. Temas ofrecidos y temas definidos')
console.log(`  THEME_OPTIONS: ${offered.join(', ')}`)
console.log(`  bloques CSS:   ${[...blocks.keys()].join(', ') || '(ninguno)'} + ${DEFAULT_THEME} en @theme`)

for (const key of offered) {
  if (key === DEFAULT_THEME || blocks.has(key)) continue
  fail(`"${key}" está en THEME_OPTIONS pero no tiene bloque en styles.css`)
}
for (const key of blocks.keys()) {
  if (!offered.includes(key)) fail(`styles.css define "${key}" pero THEME_OPTIONS no lo ofrece`)
}
if (failures === 0) ok('cada tema ofrecido tiene sus colores, y no hay temas huérfanos')

section('2. Cada tema declara la paleta completa')
if (required.length === 0) fail('no encontré tokens --color-* en @theme')
for (const [key, tokensOfTheme] of blocks) {
  if (INHERITS_BASE.has(key)) {
    console.log(`  \x1b[2m.${key} hereda la base (solo cambia ${[...tokensOfTheme.keys()].join(', ')})\x1b[0m`)
    continue
  }
  const missing = required.filter((name) => !tokensOfTheme.has(name))
  if (missing.length > 0) {
    fail(`"${key}" no declara ${missing.length} token(s): ${missing.join(', ')}`)
  }
}
if (required.length > 0) {
  ok(`${required.length} tokens por tema, y ninguno se deja a medias`)
}

// --- 3. Contraste -----------------------------------------------------------

/** `#rgb`, `#rrggbb` o `rgb(r g b / a)`. Devuelve [r, g, b] o null. */
function parseColor(value) {
  const hex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(value.trim())
  if (hex) {
    let digits = hex[1]
    if (digits.length === 3) digits = [...digits].map((d) => d + d).join('')
    return [0, 2, 4].map((i) => Number.parseInt(digits.slice(i, i + 2), 16))
  }
  const rgb = /^rgb\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*[\d.]+\s*)?\)$/.exec(value.trim())
  if (rgb) return [1, 2, 3].map((i) => Number(rgb[i]))
  return null
}

function luminance([r, g, b]) {
  const channel = (value) => {
    const c = value / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrast(front, back) {
  const a = luminance(front)
  const b = luminance(back)
  const [light, dark] = a > b ? [a, b] : [b, a]
  return (light + 0.05) / (dark + 0.05)
}

function paletteOf(key) {
  const overrides = key === DEFAULT_THEME ? new Map() : (blocks.get(key) ?? new Map())
  return new Map([...baseTokens, ...overrides])
}

/**
 * Pares que tienen que leerse, con el mínimo de WCAG 2.1.
 *
 * 4.5 es el mínimo para texto normal (AA) y 3.0 para texto grande, iconos y
 * bordes de control. `strong` solo aparece en negritas y títulos, así que se
 * queda en 4.5 igualmente: en markdown una negrita puede ser texto normal.
 */
const PAIRS = [
  ['--color-foreground', '--color-background', 4.5, 'texto sobre el fondo'],
  ['--color-foreground', '--color-panel', 4.5, 'texto dentro de un panel'],
  ['--color-strong', '--color-background', 4.5, 'negritas y títulos'],
  ['--color-muted-foreground', '--color-background', 4.5, 'texto secundario'],
  ['--color-primary', '--color-background', 4.5, 'acento sobre el fondo'],
  ['--color-primary-foreground', '--color-primary', 4.5, 'texto encima del acento'],
  ['--color-secondary', '--color-background', 4.5, 'segundo tono sobre el fondo'],
  ['--color-destructive', '--color-background', 4.5, 'errores'],
]

/**
 * El código resaltado se pinta sobre `--color-sunken` (`.code-block`), así que
 * sus colores se miden contra ese fondo y no contra el general. Los comentarios
 * y los operadores van a 3:1 a propósito: son deliberadamente apagados en
 * cualquier tema, y exigirles 4.5 obligaría a que dejaran de parecer comentarios.
 */
const SYNTAX_PAIRS = [
  ['--color-syntax-string', 4.5, 'cadenas'],
  ['--color-syntax-number', 4.5, 'números'],
  ['--color-syntax-keyword', 4.5, 'palabras clave'],
  ['--color-syntax-function', 4.5, 'funciones'],
  ['--color-syntax-type', 4.5, 'tipos'],
  ['--color-syntax-property', 4.5, 'propiedades'],
  ['--color-syntax-comment', 3.0, 'comentarios'],
  ['--color-syntax-operator', 3.0, 'operadores'],
]

section('3. Contraste de cada paleta (WCAG 2.1)')
const header = ['tema'.padEnd(9), ...PAIRS.map(([, , , label]) => label.split(' ')[0].padStart(7))]
console.log(`  \x1b[2m${header.join(' ')}\x1b[0m`)

for (const key of offered) {
  const palette = paletteOf(key)
  const cells = []
  for (const [front, back, min, label] of PAIRS) {
    const frontColor = parseColor(palette.get(front) ?? '')
    const backColor = parseColor(palette.get(back) ?? '')
    if (!frontColor || !backColor) {
      fail(`"${key}": no pude leer ${front} o ${back}`)
      cells.push('  ?  '.padStart(7))
      continue
    }
    const ratio = contrast(frontColor, backColor)
    const pass = ratio >= min
    if (!pass) fail(`"${key}": ${label} da ${ratio.toFixed(2)}:1 y hace falta ${min}:1`)
    const text = ratio.toFixed(1)
    cells.push((pass ? `\x1b[32m${text}\x1b[0m` : `\x1b[31m${text}\x1b[0m`).padStart(16))
  }
  console.log(`  ${key.padEnd(9)} ${cells.join('')}`)
}
if (failures === 0) ok('todas las paletas superan el mínimo de contraste')

section('4. Contraste del código resaltado (sobre --color-sunken)')
console.log(`  \x1b[2m${['tema'.padEnd(9), ...SYNTAX_PAIRS.map(([, , label]) => label.slice(0, 6).padStart(9))].join('')}\x1b[0m`)
for (const key of offered) {
  const palette = paletteOf(key)
  const cells = []
  for (const [front, min, label] of SYNTAX_PAIRS) {
    const frontColor = parseColor(palette.get(front) ?? '')
    const backColor = parseColor(palette.get('--color-sunken') ?? '')
    if (!frontColor || !backColor) {
      fail(`"${key}": no pude leer ${front} o --color-sunken`)
      cells.push('   ?   '.padStart(9))
      continue
    }
    const ratio = contrast(frontColor, backColor)
    const pass = ratio >= min
    if (!pass) fail(`"${key}": ${label} sobre el código da ${ratio.toFixed(2)}:1 y hace falta ${min}:1`)
    const text = ratio.toFixed(1)
    cells.push((pass ? `\x1b[32m${text}\x1b[0m` : `\x1b[31m${text}\x1b[0m`).padStart(18))
  }
  console.log(`  ${key.padEnd(9)}${cells.join('')}`)
}
if (failures === 0) ok('el resaltado se lee en todos los temas')

section('5. Opacidad de la ventana')
const check = (label, condition) => {
  if (condition) console.log(`  \x1b[32m✓\x1b[0m ${label}`)
  else fail(label)
}
// La opacidad se aplica reescribiendo el color de fondo del tema con alpha, así
// que la conversión tiene que ser exacta: un error aquí tiñe la app entera.
check('lee un hex de seis dígitos', JSON.stringify(parseHexColor('#0b0e0f')) === '[11,14,15]')
check('lee un hex de tres dígitos y lo expande', JSON.stringify(parseHexColor('#abc')) === '[170,187,204]')
check('tolera espacios alrededor', JSON.stringify(parseHexColor('  #ffffff  ')) === '[255,255,255]')
check('rechaza lo que no es un hex', parseHexColor('rgb(1 2 3)') === null)
check('rechaza un hex a medias', parseHexColor('#12345') === null)

check('al 100% el alpha es 1', translucentBackground('#0b0e0f', 100) === 'rgb(11 14 15 / 1)')
check('al 50% el alpha es 0,5', translucentBackground('#0b0e0f', 50) === 'rgb(11 14 15 / 0.5)')
check('el color no cambia, solo el alpha', translucentBackground('#abcdef', 40)?.startsWith('rgb(171 205 239'))
check('un color ilegible no revienta', translucentBackground('no-es-un-color', 50) === null)

// Los tokens de los once temas tienen que ser hex: si alguno fuera `rgb(...)`,
// la conversión devolvería null y la opacidad no se aplicaría en ese tema.
const nonHex = []
for (const key of offered) {
  const palette = paletteOf(key)
  if (parseHexColor(palette.get('--color-background') ?? '') === null) nonHex.push(key)
}
if (nonHex.length > 0) fail(`temas cuyo fondo no es un hex: ${nonHex.join(', ')}`)
else ok('el fondo de todos los temas es convertible')

console.log('')
if (failures > 0) {
  console.log(`\x1b[31m${failures} problema(s) en los temas\x1b[0m`)
  process.exit(1)
}
console.log(`\x1b[32mTemas verificados: ${offered.length} temas, ${required.length} tokens cada uno.\x1b[0m`)
