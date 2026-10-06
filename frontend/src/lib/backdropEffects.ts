/**
 * Los efectos de la imagen de fondo, pintados en un canvas 2D.
 *
 * Nada se anima: el canvas se repinta solo al cambiar de tamaño, de tema o de
 * aspecto. Las cuentas de cada efecto están en funciones puras (`inkOf`,
 * `asciiGlyph`, `ditherChannel`) para poder probarlas sin navegador.
 */
import type { BackgroundEffect } from '@/api/types'
import type { Rect, Size } from '@/lib/backdropBitmap'

const HALFTONE_CELL = 5
const HALFTONE_REACH = 0.62
const ASCII_CELL = { width: 6, height: 10 }
export const ASCII_RAMP = ' .:-=+*#%@'
const DITHER_CELL = 2
export const DITHER_LEVELS = 4
const BAYER_4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]
const SCANLINE_PERIOD = 3
const SCANLINE_SHADE = 'rgba(0, 0, 0, 0.35)'
const HAZE_CELL = 12
const HAZE_DETAIL = 0.45

export interface BackdropPaint {
  image: ImageBitmap
  /** Dónde va la imagen, ya ajustada como `cover`. */
  rect: Rect
  /** Tamaño del canvas en píxeles. */
  target: Size
  /** Píxeles de canvas por píxel CSS: escala las celdas de los efectos. */
  scale: number
  /** `blur(...)` para `context.filter`, si hay difuminado. */
  filter: string | undefined
  /** Tema oscuro: decide si la «tinta» es la luz o la sombra de la imagen. */
  dark: boolean
}

/**
 * Cuánta «tinta» lleva un píxel, de 0 a 1. Sobre fondo oscuro se dibuja la luz;
 * sobre claro, la sombra: así los efectos se leen igual en los dos.
 */
export function inkOf(r: number, g: number, b: number, dark: boolean): number {
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  return dark ? luminance : 1 - luminance
}

/** El carácter de la rampa que corresponde a una cantidad de tinta. */
export function asciiGlyph(ink: number): string {
  const last = ASCII_RAMP.length - 1
  return ASCII_RAMP[Math.min(last, Math.max(0, Math.floor(ink * (last + 1))))] ?? ' '
}

/**
 * Un canal tramado con la matriz de Bayer 4×4: se suma el umbral de la celda y
 * se redondea al nivel más cercano de los `DITHER_LEVELS` posibles.
 */
export function ditherChannel(value: number, x: number, y: number): number {
  const step = 255 / (DITHER_LEVELS - 1)
  const threshold = ((BAYER_4[(y % 4) * 4 + (x % 4)] ?? 0) + 0.5) / 16 - 0.5
  return Math.min(255, Math.max(0, Math.round((value + threshold * step) / step) * step))
}

export function paintBackdrop(
  context: CanvasRenderingContext2D,
  effect: BackgroundEffect,
  paint: BackdropPaint,
): void {
  switch (effect) {
    case 'none':
      drawBase(context, paint)
      return
    case 'scanlines':
      drawBase(context, paint)
      scanlines(context, paint)
      return
    case 'haze':
      haze(context, paint)
      return
    case 'halftone':
      halftone(context, paint)
      return
    case 'ascii':
      ascii(context, paint)
      return
    case 'dither':
      dither(context, paint)
      return
  }
}

function drawBase(context: CanvasRenderingContext2D, { image, rect, filter }: BackdropPaint): void {
  if (filter) context.filter = filter
  context.drawImage(image, rect.x, rect.y, rect.width, rect.height)
  if (filter) context.filter = 'none'
}

interface Shrunk {
  canvas: HTMLCanvasElement
  context: CanvasRenderingContext2D
  grid: Size
}

/** La imagen reducida a una cuadrícula de celdas: un píxel por celda. */
function shrink({ image, rect, target }: BackdropPaint, cell: Size, extra = 0): Shrunk | undefined {
  const grid = {
    width: Math.ceil(target.width / cell.width) + extra,
    height: Math.ceil(target.height / cell.height),
  }
  const canvas = document.createElement('canvas')
  canvas.width = grid.width
  canvas.height = grid.height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return undefined
  context.imageSmoothingQuality = 'high'
  context.drawImage(
    image,
    rect.x / cell.width,
    rect.y / cell.height,
    rect.width / cell.width,
    rect.height / cell.height,
  )
  return { canvas, context, grid }
}

function release({ canvas }: Shrunk): void {
  canvas.width = 0
  canvas.height = 0
}

function sample(paint: BackdropPaint, cell: Size, extra = 0) {
  const shrunk = shrink(paint, cell, extra)
  if (!shrunk) return undefined
  const { data } = shrunk.context.getImageData(0, 0, shrunk.grid.width, shrunk.grid.height)
  release(shrunk)
  return { grid: shrunk.grid, data }
}

function pixelInk(data: Uint8ClampedArray, index: number, dark: boolean): number {
  return inkOf(data[index] ?? 0, data[index + 1] ?? 0, data[index + 2] ?? 0, dark)
}

function colour(data: Uint8ClampedArray, index: number): string {
  return `rgb(${data[index]}, ${data[index + 1]}, ${data[index + 2]})`
}

function halftone(context: CanvasRenderingContext2D, paint: BackdropPaint): void {
  const size = HALFTONE_CELL * paint.scale
  const sampled = sample(paint, { width: size, height: size }, 1)
  if (!sampled) return
  const { grid, data } = sampled
  const reach = size * HALFTONE_REACH
  for (let y = 0; y < grid.height; y++) {
    const shift = y % 2 === 1 ? size / 2 : 0
    for (let x = 0; x < grid.width; x++) {
      const index = (y * grid.width + x) * 4
      const radius = reach * Math.sqrt(pixelInk(data, index, paint.dark))
      if (radius < 0.4) continue
      context.fillStyle = colour(data, index)
      context.beginPath()
      context.arc((x + 0.5) * size - shift, (y + 0.5) * size, radius, 0, Math.PI * 2)
      context.fill()
    }
  }
}

function ascii(context: CanvasRenderingContext2D, paint: BackdropPaint): void {
  const cell = {
    width: ASCII_CELL.width * paint.scale,
    height: ASCII_CELL.height * paint.scale,
  }
  const sampled = sample(paint, cell)
  if (!sampled) return
  const { grid, data } = sampled
  context.font = `${Math.round(cell.height * 0.95)}px ui-monospace, SFMono-Regular, Menlo, monospace`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const index = (y * grid.width + x) * 4
      const glyph = asciiGlyph(pixelInk(data, index, paint.dark))
      if (glyph === ' ') continue
      context.fillStyle = colour(data, index)
      context.fillText(glyph, (x + 0.5) * cell.width, (y + 0.5) * cell.height)
    }
  }
}

function dither(context: CanvasRenderingContext2D, paint: BackdropPaint): void {
  const size = DITHER_CELL * paint.scale
  const shrunk = shrink(paint, { width: size, height: size })
  if (!shrunk) return
  const { grid } = shrunk
  const pixels = shrunk.context.getImageData(0, 0, grid.width, grid.height)
  const { data } = pixels
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const index = (y * grid.width + x) * 4
      for (let channel = 0; channel < 3; channel++) {
        data[index + channel] = ditherChannel(data[index + channel] ?? 0, x, y)
      }
    }
  }
  shrunk.context.putImageData(pixels, 0, 0)
  context.imageSmoothingEnabled = false
  context.drawImage(shrunk.canvas, 0, 0, grid.width * size, grid.height * size)
  context.imageSmoothingEnabled = true
  release(shrunk)
}

function scanlines(context: CanvasRenderingContext2D, { target, scale }: BackdropPaint): void {
  const period = SCANLINE_PERIOD * scale
  const line = Math.max(1, Math.round(scale))
  context.fillStyle = SCANLINE_SHADE
  for (let y = 0; y < target.height; y += period) context.fillRect(0, y, target.width, line)
}

function haze(context: CanvasRenderingContext2D, paint: BackdropPaint): void {
  const size = HAZE_CELL * paint.scale
  const shrunk = shrink(paint, { width: size, height: size })
  if (!shrunk) return
  const { grid } = shrunk
  if (paint.filter) context.filter = paint.filter
  context.imageSmoothingQuality = 'high'
  context.drawImage(shrunk.canvas, 0, 0, grid.width * size, grid.height * size)
  context.globalAlpha = HAZE_DETAIL
  context.drawImage(paint.image, paint.rect.x, paint.rect.y, paint.rect.width, paint.rect.height)
  context.globalAlpha = 1
  if (paint.filter) context.filter = 'none'
  release(shrunk)
}
