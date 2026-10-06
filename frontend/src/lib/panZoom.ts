/**
 * Geometría del visor de diagramas: zoom y desplazamiento.
 *
 * Es pura a propósito —números entran, números salen— para poder comprobarla
 * sin navegador. La vista se describe con la escala del contenido y la posición
 * de su esquina superior izquierda dentro del visor, en píxeles de pantalla.
 */

export interface View {
  scale: number
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

/** Por debajo, un diagrama grande es un borrón; por encima, solo se ve un trazo. */
export const MIN_SCALE = 0.05
export const MAX_SCALE = 8

/**
 * Encajar no amplía más de esto: un diagrama de tres cajas a pantalla completa
 * se ve absurdo. Quien quiera más, hace zoom.
 */
const MAX_FIT_SCALE = 2

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

/**
 * Cambia la escala por `factor` dejando quieto el punto `(px, py)` del visor.
 *
 * Es lo que hace que el zoom vaya «hacia el cursor»: lo que había bajo el puntero
 * sigue bajo el puntero. Si la escala ya está en el tope, la vista no se mueve.
 */
export function zoomAt(view: View, factor: number, px: number, py: number): View {
  const scale = clampScale(view.scale * factor)
  const k = scale / view.scale
  return {
    scale,
    x: px - (px - view.x) * k,
    y: py - (py - view.y) * k,
  }
}

/** Escala y centra el contenido para que quepa entero, con un margen. */
export function fitView(content: Size, viewport: Size, padding = 24): View {
  const availableWidth = Math.max(1, viewport.width - padding * 2)
  const availableHeight = Math.max(1, viewport.height - padding * 2)
  const scale = clampScale(
    Math.min(availableWidth / content.width, availableHeight / content.height, MAX_FIT_SCALE),
  )
  return centeredView(content, viewport, scale)
}

/** El contenido a la escala dada, centrado en el visor. */
export function centeredView(content: Size, viewport: Size, scale: number): View {
  const clamped = clampScale(scale)
  return {
    scale: clamped,
    x: (viewport.width - content.width * clamped) / 2,
    y: (viewport.height - content.height * clamped) / 2,
  }
}
