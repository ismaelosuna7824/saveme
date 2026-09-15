/**
 * Opacidad de la ventana.
 *
 * La ventana de Tauri se crea translúcida, y **cuánto** se ve a través lo decide
 * la interfaz con este valor. El truco es no repartir la opacidad por media
 * hoja de estilos: se reescribe `--color-background` con su versión en `rgb(... /
 * alpha)`, y todo lo que ya la usaba —el fondo del marco, el del documento, el
 * velo de los diálogos— pasa a ser translúcido sin tocar nada más.
 *
 * Los paneles y el texto siguen opacos a propósito: translucir el contenido
 * además del fondo deja la interfaz ilegible sobre cualquier cosa con movimiento.
 */

/** Convierte `#rgb` o `#rrggbb` a componentes. Devuelve null si no lo entiende. */
export function parseHexColor(value: string): [number, number, number] | null {
  const hex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(value.trim())
  if (hex === null) return null
  let digits = hex[1]
  if (digits.length === 3) {
    digits = digits
      .split('')
      .map((d) => d + d)
      .join('')
  }
  return [0, 2, 4].map((i) => Number.parseInt(digits.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ]
}

/** El `rgb(r g b / a)` que sustituye a `--color-background`. */
export function translucentBackground(hex: string, percent: number): string | null {
  const rgb = parseHexColor(hex)
  if (rgb === null) return null
  const alpha = Math.min(1, Math.max(0, percent / 100))
  return `rgb(${rgb.join(' ')} / ${alpha})`
}

/**
 * Aplica la opacidad al documento.
 *
 * Con el 100 % **quita** la propiedad en línea en vez de ponerla opaca, para que
 * el fondo vuelva a ser exactamente el token del tema. Si no, quedaría un
 * `rgb(...)` calculado que ya no seguiría a un cambio de tema.
 */
export function applyWindowOpacity(percent: number): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.style.removeProperty('--color-background')

  if (percent >= 100) {
    root.removeAttribute('data-translucent')
    return
  }

  // Se lee **después** de quitar el valor en línea, así que esto es el color del
  // tema y no el translúcido de la vez anterior.
  const solid = getComputedStyle(root).getPropertyValue('--color-background')
  const value = translucentBackground(solid, percent)
  if (value === null) return

  root.setAttribute('data-translucent', 'true')
  root.style.setProperty('--color-background', value)
}
