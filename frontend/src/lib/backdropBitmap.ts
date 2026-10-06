/**
 * Decodificar la imagen de fondo una sola vez, a un tamaño razonable.
 *
 * Pintar una foto de cámara a resolución completa con un difuminado en vivo
 * cuesta decenas de milisegundos por fotograma. Se decodifica una vez, se reduce
 * a 1920 px por el lado largo y se comparte: el fondo de la app y las dos vistas
 * previas de Ajustes usan el mismo bitmap.
 *
 * Se pide con `fetch` y se decodifica desde un blob en vez de con un `<img>`: el
 * core sirve desde otro origen (`127.0.0.1:<puerto>`) y un `<img>` de otro origen
 * deja el canvas «sucio», con lo que los efectos que leen píxeles fallarían.
 */

export const BACKDROP_MAX_EDGE = 1920
/** Bitmaps sin usar que se conservan, para volver a una imagen sin decodificar. */
const KEEP_UNUSED = 2

export interface Size {
  width: number
  height: number
}

export interface Rect extends Size {
  x: number
  y: number
}

/** El tamaño que cabe en `maxEdge` por el lado largo, sin agrandar nunca. */
export function fitWithin(natural: Size, maxEdge: number): Size {
  const scale = Math.min(1, maxEdge / Math.max(natural.width, natural.height, 1))
  return {
    width: Math.max(1, Math.round(natural.width * scale)),
    height: Math.max(1, Math.round(natural.height * scale)),
  }
}

/**
 * El rectángulo que cubre `target` como `object-fit: cover`, centrado.
 *
 * `bleed` lo agranda por cada lado: al difuminar, los bordes de la imagen se
 * vuelven transparentes, y dibujarla un poco más grande evita ese halo.
 */
export function coverRect(source: Size, target: Size, bleed: number): Rect {
  const width = target.width + bleed * 2
  const height = target.height + bleed * 2
  const scale = Math.max(width / source.width, height / source.height)
  const drawn = { width: source.width * scale, height: source.height * scale }
  return {
    x: (target.width - drawn.width) / 2,
    y: (target.height - drawn.height) / 2,
    width: drawn.width,
    height: drawn.height,
  }
}

async function decode(src: string): Promise<ImageBitmap> {
  const response = await fetch(src)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const full = await createImageBitmap(await response.blob())
  const size = fitWithin(full, BACKDROP_MAX_EDGE)
  if (full.width <= size.width && full.height <= size.height) return full

  // Se reduce dibujándola en un canvas: las opciones de redimensionado de
  // `createImageBitmap` no existen en todos los webviews.
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const context = canvas.getContext('2d')
  if (context === null) return full
  context.imageSmoothingQuality = 'high'
  context.drawImage(full, 0, 0, size.width, size.height)
  full.close()
  const scaled = await createImageBitmap(canvas)
  canvas.width = 0
  canvas.height = 0
  return scaled
}

interface Entry {
  bitmap: Promise<ImageBitmap>
  users: number
}

const entries = new Map<string, Entry>()

function evict(): void {
  const unused = [...entries].filter(([, entry]) => entry.users === 0)
  for (const [src, entry] of unused.slice(0, Math.max(0, unused.length - KEEP_UNUSED))) {
    entries.delete(src)
    void entry.bitmap.then((bitmap) => bitmap.close()).catch(() => {})
  }
}

/**
 * Pide el bitmap de una imagen. Quien lo pide tiene que llamar a `release`
 * cuando deje de usarlo; el último en soltarlo lo deja en una caché corta.
 */
export function acquireBackdrop(src: string): { bitmap: Promise<ImageBitmap>; release: () => void } {
  let entry = entries.get(src)
  if (entry) {
    // Se reinserta para que el Map conserve el orden de uso.
    entries.delete(src)
  } else {
    const fresh: Entry = { bitmap: decode(src), users: 0 }
    fresh.bitmap.catch(() => {
      if (entries.get(src) === fresh) entries.delete(src)
    })
    entry = fresh
  }
  entries.set(src, entry)
  entry.users++
  const held = entry
  let released = false
  return {
    bitmap: held.bitmap,
    release: () => {
      if (released) return
      released = true
      held.users--
      evict()
    },
  }
}
