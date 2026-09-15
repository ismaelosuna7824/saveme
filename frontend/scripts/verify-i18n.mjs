#!/usr/bin/env bun
/**
 * Verificación de las traducciones.
 *
 * Se comprueba en dos niveles, porque cada uno cubre un fallo distinto:
 *
 *  1. **Estático** — recorre los dos diccionarios. El compilador ya garantiza que
 *     el inglés tenga la misma FORMA que el español; lo que no puede ver es el
 *     contenido: un texto vacío, un `{placeholder}` que se pierde al traducir, un
 *     plural al que le falta una rama. Eso se mira aquí.
 *
 *  2. **Runtime** — monta el proveedor de verdad con `react-dom/server` y
 *     comprueba que devuelve el idioma pedido, que interpola, que resuelve las dos
 *     formas de escribir un plural y que los errores del core se traducen por
 *     código. Un diccionario perfecto no sirve de nada si el proveedor no lo lee.
 *
 * Uso:  bun run verify:i18n
 */
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { I18nProvider, translateError, useT, resolveLocale } from '../src/i18n/index.tsx'
import { en } from '../src/i18n/locales/en/index.ts'
import { es } from '../src/i18n/locales/es/index.ts'

let failures = 0

function fail(message) {
  console.log(`  \x1b[31m✗\x1b[0m ${message}`)
  failures++
}

function check(label, condition) {
  if (condition) console.log(`  \x1b[32m✓\x1b[0m ${label}`)
  else fail(label)
}

function section(title) {
  console.log(`\n\x1b[1m${title}\x1b[0m`)
}

/** Aplana un bundle en un mapa ruta -> texto. */
function flatten(node, prefix = '', out = new Map()) {
  for (const [key, value] of Object.entries(node)) {
    const path = prefix === '' ? key : `${prefix}.${key}`
    if (typeof value === 'string') out.set(path, value)
    else if (value !== null && typeof value === 'object') flatten(value, path, out)
  }
  return out
}

const flatEs = flatten(es)
const flatEn = flatten(en)

// ---------------------------------------------------------------- estático ---

section('1. Paridad de claves')
console.log(`  claves: es=${flatEs.size} en=${flatEn.size}`)
const onlyEs = [...flatEs.keys()].filter((key) => !flatEn.has(key))
const onlyEn = [...flatEn.keys()].filter((key) => !flatEs.has(key))
if (onlyEs.length > 0) fail(`solo en español: ${onlyEs.slice(0, 5).join(', ')}`)
if (onlyEn.length > 0) fail(`solo en inglés: ${onlyEn.slice(0, 5).join(', ')}`)
if (onlyEs.length === 0 && onlyEn.length === 0) {
  console.log('  \x1b[32m✓\x1b[0m los dos idiomas tienen exactamente las mismas claves')
}

section('2. Textos vacíos o sin traducir')
let emptyCount = 0
for (const [path, value] of flatEs) {
  if (value.trim() === '') {
    fail(`es "${path}" está vacío`)
    emptyCount++
  }
}
for (const [path, value] of flatEn) {
  if (value.trim() === '') {
    fail(`en "${path}" está vacío`)
    emptyCount++
  }
  // Un valor igual a su ruta significa que nadie lo tradujo y quedó la clave.
  if (value === path) fail(`en "${path}" tiene la clave como texto`)
}
if (emptyCount === 0) console.log('  \x1b[32m✓\x1b[0m ningún texto está vacío en ninguno de los dos idiomas')

section('3. Placeholders')
const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')
let placeholderProblems = 0
for (const [path, valueEs] of flatEs) {
  const valueEn = flatEn.get(path)
  if (valueEn === undefined) continue
  if (placeholders(valueEs) !== placeholders(valueEn)) {
    fail(`"${path}" usa {${placeholders(valueEs)}} en español y {${placeholders(valueEn)}} en inglés`)
    placeholderProblems++
  }
}
if (placeholderProblems === 0) {
  console.log('  \x1b[32m✓\x1b[0m todas las traducciones conservan los mismos placeholders')
}

section('4. Plurales')
// Un plural se escribe como `clave_one`/`clave_other` o como `clave: {one, other}`.
// En los dos casos, tener solo una rama deja un idioma sin forma para el otro número.
const pluralBases = new Set()
for (const path of flatEs.keys()) {
  const sibling = /^(.*)_(one|other)$/.exec(path)
  if (sibling) pluralBases.add(sibling[1])
  const nested = /^(.*)\.(one|other)$/.exec(path)
  if (nested) pluralBases.add(nested[1])
}
let pluralProblems = 0
for (const base of pluralBases) {
  for (const form of ['one', 'other']) {
    if (!flatEs.has(`${base}_${form}`) && !flatEs.has(`${base}.${form}`)) {
      fail(`el plural "${base}" no tiene forma para ${form}`)
      pluralProblems++
    }
  }
}
if (pluralBases.size === 0) fail('no encontré ningún plural (¿seguro que no hay ninguno?)')
else if (pluralProblems === 0) {
  console.log(`  \x1b[32m✓\x1b[0m ${pluralBases.size} plurales con sus dos formas`)
}

// ----------------------------------------------------------------- runtime ---

// El proveedor real, montado con `react-dom/server`. Sin navegador: basta con
// que el contexto de React entregue el idioma correcto.
function Probe() {
  const t = useT()
  return h(
    'ul',
    null,
    h('li', { id: 'plain' }, t('shell.nav.inbox')),
    h('li', { id: 'interp' }, t('common.state.savingAt', { when: 'X' })),
    h('li', { id: 'nested1' }, t('common.time.months', { count: 1 })),
    h('li', { id: 'nested3' }, t('common.time.months', { count: 3 })),
    h('li', { id: 'sibling1' }, t('editor.toolbar.files', { count: 1 })),
    h('li', { id: 'sibling3' }, t('editor.toolbar.files', { count: 3 })),
  )
}

function render(locale) {
  const html = renderToStaticMarkup(h(I18nProvider, { locale }, h(Probe, null)))
  const grab = (id) => {
    const match = new RegExp(`id="${id}"[^>]*>([^<]*)<`).exec(html)
    return match ? match[1] : '(no encontrado)'
  }
  return {
    plain: grab('plain'),
    interp: grab('interp'),
    nested1: grab('nested1'),
    nested3: grab('nested3'),
    sibling1: grab('sibling1'),
    sibling3: grab('sibling3'),
  }
}

const inEs = render('es')
const inEn = render('en')

section('5. El proveedor devuelve el idioma pedido')
check('es devuelve el texto español', inEs.plain === 'inbox')
check('en devuelve el texto inglés', inEn.plain === 'Inbox')
check('resolveLocale("en") es "en"', resolveLocale('en') === 'en')
check('resolveLocale("") cae al idioma del sistema', ['es', 'en'].includes(resolveLocale('')))

section('6. Interpolación y plurales en runtime')
check('interpola {when} en español', inEs.interp === 'guardado X')
check('interpola {when} en inglés', inEn.interp === 'saved X')
check('plural anidado (es): singular', inEs.nested1 === 'hace 1 mes')
check('plural anidado (es): plural', inEs.nested3 === 'hace 3 meses')
check('plural anidado (en): singular', inEn.nested1 === '1 month ago')
check('plural anidado (en): plural', inEn.nested3 === '3 months ago')
check('plural de hermanos (es): singular', inEs.sibling1 === '1 archivo')
check('plural de hermanos (es): plural', inEs.sibling3 === '3 archivos')
check('plural de hermanos (en): singular', inEn.sibling1 === '1 file')
check('plural de hermanos (en): plural', inEn.sibling3 === '3 files')

// `translateError` sigue el idioma activo, que es estado de módulo. Se fija
// renderizando con el proveedor, igual que hace la app al cambiar de idioma.
//
// `client.ts` lee `window` al cargarse —dentro de Tauri ahí está el puerto del
// core—, así que fuera del navegador hay que darle uno antes de importarlo.
globalThis.window ??= {}
const { ApiError, errorMessage } = await import('../src/api/client.ts')
const asLocale = (locale, fn) => {
  render(locale)
  return fn()
}

section('7. Errores traducidos por código')
check(
  'los códigos con mensaje fijo se traducen (es)',
  asLocale('es', () => translateError('invalid_root', 'FALLBACK')) ===
    'La carpeta raíz no puede estar vacía.',
)
check(
  'los códigos con mensaje fijo se traducen (en)',
  asLocale('en', () => translateError('invalid_root', 'FALLBACK')) ===
    "The root folder can't be empty.",
)
check(
  'un código con detalle dinámico conserva el texto del servidor',
  asLocale('en', () => translateError('invalid', 'el título no puede estar vacío')) ===
    'el título no puede estar vacío',
)
check(
  'un código desconocido conserva el texto del servidor',
  asLocale('en', () => translateError('list_failed', 'listar: boom')) === 'listar: boom',
)
const network = asLocale('en', () =>
  translateError('network_error', 'FALLBACK', { base: 'http://x', detail: 'boom' }),
)
check('network_error interpola sin dejar placeholders', !network.includes('{') && network.includes('http://x'))
check(
  'errorMessage traduce un error con código fijo (en)',
  /root folder/i.test(
    asLocale('en', () => errorMessage(new ApiError(400, 'invalid_root', 'da igual'))),
  ),
)
check(
  'errorMessage traduce un error con código fijo (es)',
  /carpeta raíz/.test(
    asLocale('es', () => errorMessage(new ApiError(400, 'invalid_root', 'da igual'))),
  ),
)
check(
  'errorMessage no re-traduce lo que ya se tradujo al construirlo',
  asLocale('en', () => errorMessage(new ApiError(0, 'network_error', 'no pude hablar'))) ===
    'no pude hablar',
)

section('8. Cobertura por namespace')
const byNamespace = new Map()
for (const path of flatEs.keys()) {
  const ns = path.split('.')[0]
  byNamespace.set(ns, (byNamespace.get(ns) ?? 0) + 1)
}
for (const [ns, count] of [...byNamespace].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${ns.padEnd(12)} ${String(count).padStart(4)} claves`)
}

console.log('')
if (failures > 0) {
  console.log(`\x1b[31m${failures} problema(s) en las traducciones\x1b[0m`)
  process.exit(1)
}
console.log(`\x1b[32mTraducciones verificadas: ${flatEs.size} claves por idioma.\x1b[0m`)
