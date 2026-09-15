#!/usr/bin/env bun
/**
 * Verificación del diff de líneas.
 *
 * Un diff mal calculado no revienta: enseña algo parecido a lo que cambió, y eso
 * es peor que no enseñar nada, porque el usuario aprueba una propuesta creyendo
 * que ha visto el cambio. Por eso aquí no se comprueban casos sueltos nada más:
 * se comprueba la **propiedad** que tiene que cumplir un diff para ser útil.
 *
 * Uso:  bun run verify:diff
 */
import { diffCounts, diffLines } from '../src/lib/diff.ts'

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

/** Reconstruye el texto de antes: las líneas que siguen y las que se fueron. */
function reconstruirAntes(lines) {
  return lines.filter((l) => l.kind !== 'added').map((l) => l.text).join('\n')
}

/** Reconstruye el texto de después: las líneas que siguen y las que llegan. */
function reconstruirDespues(lines) {
  return lines.filter((l) => l.kind !== 'removed').map((l) => l.text).join('\n')
}

/**
 * Comprueba las tres invariantes que definen un diff correcto:
 * reconstruye los dos textos, no deja líneas sin numerar donde toca, y numera en
 * orden creciente.
 */
function invariantes(etiqueta, antes, despues) {
  const lines = diffLines(antes, despues)
  const sinSalto = (t) => (t.endsWith('\n') ? t.slice(0, -1) : t)

  check(`${etiqueta}: reconstruye el texto de antes`, reconstruirAntes(lines) === sinSalto(antes))
  check(`${etiqueta}: reconstruye el texto de después`, reconstruirDespues(lines) === sinSalto(despues))

  const antesOk = lines
    .filter((l) => l.kind !== 'added')
    .every((l, i) => l.before === i + 1)
  const despuesOk = lines
    .filter((l) => l.kind !== 'removed')
    .every((l, i) => l.after === i + 1)
  check(`${etiqueta}: los números de línea de antes son 1..n`, antesOk)
  check(`${etiqueta}: los números de línea de después son 1..n`, despuesOk)

  return lines
}

// --- 1. Las invariantes, sobre casos que se rompen fácil ---------------------

section('1. El diff reconstruye los dos textos')
{
  invariantes('idénticos', 'uno\ndos\ntres\n', 'uno\ndos\ntres\n')
  invariantes('una añadida al final', 'uno\ndos\n', 'uno\ndos\ntres\n')
  invariantes('una quitada del principio', 'uno\ndos\ntres\n', 'dos\ntres\n')
  invariantes('un reemplazo en medio', 'a\nb\nc\nd\ne\n', 'a\nb\nX\nd\ne\n')
  invariantes('antes vacío', '', 'a\nb\n')
  invariantes('después vacío', 'a\nb\n', '')
  invariantes('los dos vacíos', '', '')
  invariantes('todo distinto', 'a\nb\n', 'x\ny\n')
  invariantes('sin salto final', 'a\nb', 'a\nc')
  invariantes('líneas repetidas', 'a\na\na\n', 'a\na\n')
  invariantes('reordenado', 'a\nb\nc\n', 'c\nb\na\n')
  invariantes('crece por delante y por detrás', 'b\n', 'a\nb\nc\n')
}

// --- 2. Lo que se enseña -----------------------------------------------------

section('2. Lo que se enseña es lo que cambió')
{
  const lines = diffLines('uno\ndos\ntres\n', 'uno\nDOS\ntres\n')
  const cambiadas = lines.filter((l) => l.kind !== 'same')

  check('una línea cambiada sale como una quitada y una añadida', cambiadas.length === 2)
  check('la que se va es la vieja',
    cambiadas.some((l) => l.kind === 'removed' && l.text === 'dos'))
  check('la que llega es la nueva',
    cambiadas.some((l) => l.kind === 'added' && l.text === 'DOS'))
  check('el contexto no se marca como cambio',
    lines.filter((l) => l.kind === 'same').length === 2)
  check('la línea quitada no tiene número de después', cambiadas[0].before !== null && cambiadas[0].after === null)

  const { added, removed } = diffCounts(lines)
  check('el recuento cuadra', added === 1 && removed === 1)

  const iguales = diffLines('a\nb\n', 'a\nb\n')
  check('sin cambios, el recuento es cero', diffCounts(iguales).added === 0 && diffCounts(iguales).removed === 0)
  check('y todo son líneas «same»', iguales.every((l) => l.kind === 'same'))
}

// --- 3. El salto de línea final no inventa una línea -------------------------

section('3. El salto final no cuenta como línea')
{
  check('un fichero con salto final y otro sin él no difieren',
    diffLines('a\nb\n', 'a\nb').every((l) => l.kind === 'same'))
  check('añadir una línea en blanco al final SÍ se ve',
    diffCounts(diffLines('a\nb\n', 'a\nb\n\n')).added === 1)
  check('un fichero vacío no tiene líneas', diffLines('', '').length === 0)
}

// --- 4. El recorte de prefijo y sufijo ---------------------------------------

section('4. Un cambio pequeño en un fichero grande no explota')
{
  // 4000 líneas iguales y una distinta en medio: sin recortar el prefijo y el
  // sufijo, esto serían 16 millones de celdas y el navegador se notaría.
  const antes = Array.from({ length: 4000 }, (_, i) => `línea ${i}`).join('\n') + '\n'
  const despues = antes.replace('línea 2000', 'línea 2000 cambiada')

  const t0 = performance.now()
  const lines = diffLines(antes, despues)
  const ms = performance.now() - t0

  check('el resultado sigue siendo correcto', reconstruirDespues(lines) === despues.slice(0, -1))
  check('y solo señala el cambio real',
    diffCounts(lines).added === 1 && diffCounts(lines).removed === 1)
  check(`tarda menos de 100 ms (tardó ${ms.toFixed(1)} ms)`, ms < 100)
}

// --- 5. Ruido determinista, por si el caso raro es el que falla ---------------

section('5. Cien casos generados')
{
  // Generador con semilla fija: si algún día falla, falla siempre en el mismo
  // sitio y se puede reproducir.
  let semilla = 12345
  const azar = () => {
    semilla = (semilla * 1103515245 + 12345) & 0x7fffffff
    return semilla / 0x7fffffff
  }
  const alfabeto = ['a', 'b', 'c', 'd', 'e']

  let malos = 0
  for (let caso = 0; caso < 100; caso += 1) {
    const n = 1 + Math.floor(azar() * 12)
    const m = 1 + Math.floor(azar() * 12)
    const antes = Array.from({ length: n }, () => alfabeto[Math.floor(azar() * alfabeto.length)]).join('\n') + '\n'
    const despues = Array.from({ length: m }, () => alfabeto[Math.floor(azar() * alfabeto.length)]).join('\n') + '\n'
    const lines = diffLines(antes, despues)
    if (reconstruirAntes(lines) !== antes.slice(0, -1)) malos += 1
    else if (reconstruirDespues(lines) !== despues.slice(0, -1)) malos += 1
  }
  check('los 100 reconstruyen sus dos textos', malos === 0)
}

console.log('')
if (failures > 0) {
  console.log(`\x1b[31m${failures} problema(s) en el diff\x1b[0m`)
  process.exit(1)
}
console.log('\x1b[32mDiff verificado.\x1b[0m')
