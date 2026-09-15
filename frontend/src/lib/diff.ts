/**
 * Diff de líneas para enseñar qué cambia una propuesta.
 *
 * Se calcula en la interfaz y no en el núcleo a propósito: es presentación, y el
 * núcleo no tiene por qué saber cómo se pinta un diff. Lo único que hace falta
 * del backend es el antes y el después, que es lo que sirve `/proposals/{t}/diff`.
 *
 * Sin dependencias: para dos versiones de un resumen —decenas o cientos de
 * líneas— la subsecuencia común más larga clásica sobra, y traer una biblioteca
 * para esto sería más código del que sustituye.
 */

export type DiffKind = 'same' | 'added' | 'removed'

export interface DiffLine {
  kind: DiffKind
  text: string
  /** Número de línea en el texto de antes; `null` si la línea es nueva. */
  before: number | null
  /** Número de línea en el texto de después; `null` si la línea se fue. */
  after: number | null
}

/**
 * Parte en líneas «como las cuenta un lector».
 *
 * Se quita **un** salto final antes de partir. Sin eso, un fichero acabado en
 * salto de línea —todos los que escribe SaveMe— tendría una línea vacía extra al
 * final, y el diff mostraría una línea fantasma en cada comparación. El salto
 * final no es contenido: es cómo termina el fichero, y además es igual en las dos
 * versiones porque las escribe el mismo escritor.
 */
function splitLines(text: string): string[] {
  const sinSaltoFinal = text.endsWith('\n') ? text.slice(0, -1) : text
  if (sinSaltoFinal === '') return []
  return sinSaltoFinal.split('\n')
}

/**
 * Diff línea a línea entre dos textos.
 *
 * Antes de calcular la subsecuencia común se recortan el prefijo y el sufijo
 * iguales. No es una optimización cosmética: una edición típica —cambiar un
 * párrafo en medio de un resumen largo— deja un hueco diminuto en medio de dos
 * mitades idénticas, y la tabla de la LCS se calcula solo sobre ese hueco. Sin el
 * recorte, un resumen de 2000 líneas costaría 4.000.000 de celdas para enseñar
 * tres líneas cambiadas.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = splitLines(before)
  const b = splitLines(after)

  // Prefijo común.
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1

  // Sufijo común, sin pisar el prefijo.
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1
    endB -= 1
  }

  const medioA = a.slice(start, endA)
  const medioB = b.slice(start, endB)

  const out: DiffLine[] = []
  for (let i = 0; i < start; i += 1) {
    out.push({ kind: 'same', text: a[i], before: i + 1, after: i + 1 })
  }

  // LCS del hueco, con la tabla entera: `lcs[i][j]` es la longitud de la
  // subsecuencia común de `medioA[i:]` y `medioB[j:]`.
  const n = medioA.length
  const m = medioB.length
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i][j] =
        medioA[i] === medioB[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (medioA[i] === medioB[j]) {
      out.push({ kind: 'same', text: medioA[i], before: start + i + 1, after: start + j + 1 })
      i += 1
      j += 1
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      // Se va una línea de los de antes. El empate se resuelve hacia «quitada»
      // para que un reemplazo se lea como una línea fuera y otra dentro, y no al
      // revés.
      out.push({ kind: 'removed', text: medioA[i], before: start + i + 1, after: null })
      i += 1
    } else {
      out.push({ kind: 'added', text: medioB[j], before: null, after: start + j + 1 })
      j += 1
    }
  }
  for (; i < n; i += 1) {
    out.push({ kind: 'removed', text: medioA[i], before: start + i + 1, after: null })
  }
  for (; j < m; j += 1) {
    out.push({ kind: 'added', text: medioB[j], before: null, after: start + j + 1 })
  }

  // Sufijo común.
  for (let k = 0; k < a.length - endA; k += 1) {
    out.push({
      kind: 'same',
      text: a[endA + k],
      before: endA + k + 1,
      after: endB + k + 1,
    })
  }

  return out
}

/** Cuántas líneas se añaden y cuántas se quitan: el resumen de un vistazo. */
export function diffCounts(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const line of lines) {
    if (line.kind === 'added') added += 1
    else if (line.kind === 'removed') removed += 1
  }
  return { added, removed }
}
