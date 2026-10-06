import { useEffect, useRef, useState } from 'react'

import type { BackgroundEffect } from '@/api/types'
import { effectTakesBlur } from '@/lib/background'
import { acquireBackdrop, coverRect } from '@/lib/backdropBitmap'
import { paintBackdrop } from '@/lib/backdropEffects'
import { parseHexColor } from '@/lib/translucency'
import { cn } from '@/lib/utils'

/** Con difuminado se pinta a media resolución: no se nota y cuesta la cuarta parte. */
const BLURRED_SCALE = 0.5
/** Espera tras un cambio de tamaño antes de repintar, para no hacerlo a cada píxel. */
const RESIZE_SETTLE_MS = 120

/**
 * Si el tema es oscuro, según el color del texto: texto claro, fondo oscuro.
 *
 * Se mira el texto y no el fondo porque la opacidad de la ventana reescribe
 * `--color-background` con alpha, y el texto no lo toca nadie.
 */
function themeIsDark(): boolean {
  const rgb = parseHexColor(
    getComputedStyle(document.documentElement).getPropertyValue('--color-foreground'),
  )
  if (rgb === null) return true
  const [r, g, b] = rgb
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.5
}

/**
 * La imagen de fondo pintada en un canvas, con un velo del color del tema encima.
 *
 * El canvas es siempre opaco; lo que decide cuánto se ve es el velo, con opacidad
 * `1 - visibility`. Así la imagen se funde hacia el color del tema y no hacia la
 * transparencia, y el texto de encima conserva su contraste.
 */
export function BackdropLayer({
  src,
  visibility,
  blur,
  effect,
  className = 'absolute inset-0',
  onLoad,
  onError,
}: {
  src: string
  visibility: number
  blur: number
  effect: BackgroundEffect
  className?: string
  onLoad?: () => void
  onError?: () => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  // Si el navegador no sabe difuminar dentro del canvas, se difumina por CSS.
  const [cssBlur, setCssBlur] = useState(false)
  const callbacks = useRef({ onLoad, onError })
  callbacks.current = { onLoad, onError }
  const look = useRef({ blur, effect })
  const redraw = useRef<(() => void) | undefined>(undefined)

  useEffect(() => {
    const element = host.current
    const surface = canvas.current
    if (!element || !surface) return
    const { bitmap, release } = acquireBackdrop(src)
    let image: ImageBitmap | undefined
    let frame = 0
    let settle: number | undefined
    let announced = false
    let cancelled = false

    const draw = () => {
      frame = 0
      if (!image) return
      const width = element.clientWidth
      const height = element.clientHeight
      if (width === 0 || height === 0) return
      const { blur, effect } = look.current
      const softened = blur > 0 && effectTakesBlur(effect)
      const scale = softened ? BLURRED_SCALE : Math.min(window.devicePixelRatio || 1, 2)
      const target = { width: Math.ceil(width * scale), height: Math.ceil(height * scale) }
      if (surface.width !== target.width) surface.width = target.width
      if (surface.height !== target.height) surface.height = target.height
      const context = surface.getContext('2d')
      if (!context) return
      const filtered = softened && typeof context.filter === 'string'
      const radius = blur * scale
      const paint = {
        image,
        rect: coverRect(image, target, softened ? radius * 2 : 0),
        target,
        scale,
        filter: filtered ? `blur(${radius}px)` : undefined,
        dark: themeIsDark(),
      }
      context.clearRect(0, 0, target.width, target.height)
      try {
        paintBackdrop(context, effect, paint)
      } catch {
        // Un efecto que falla no puede dejar el fondo vacío: se pinta la imagen tal cual.
        context.clearRect(0, 0, target.width, target.height)
        paintBackdrop(context, 'none', paint)
      }
      setCssBlur(softened && !filtered)
      if (!announced) {
        announced = true
        callbacks.current.onLoad?.()
      }
    }
    const schedule = () => {
      if (!announced) {
        if (!frame) frame = requestAnimationFrame(draw)
        return
      }
      window.clearTimeout(settle)
      settle = window.setTimeout(draw, RESIZE_SETTLE_MS)
    }

    bitmap.then(
      (decoded) => {
        if (cancelled) return
        image = decoded
        schedule()
      },
      () => {
        if (!cancelled) callbacks.current.onError?.()
      },
    )
    const resize = new ResizeObserver(schedule)
    resize.observe(element)
    // El tema cambia `data-theme`, y la opacidad de la ventana el `style` de <html>.
    const theme = new MutationObserver(schedule)
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] })
    redraw.current = schedule
    return () => {
      redraw.current = undefined
      cancelled = true
      cancelAnimationFrame(frame)
      window.clearTimeout(settle)
      resize.disconnect()
      theme.disconnect()
      release()
    }
  }, [src])

  useEffect(() => {
    if (look.current.blur === blur && look.current.effect === effect) return
    look.current = { blur, effect }
    redraw.current?.()
  }, [blur, effect])

  return (
    <div
      ref={host}
      aria-hidden
      className={cn('pointer-events-none overflow-hidden', className)}
      style={{ contain: 'strict', transform: 'translateZ(0)' }}
    >
      <canvas
        ref={canvas}
        className="absolute"
        style={
          cssBlur
            ? {
                top: -blur * 2,
                left: -blur * 2,
                width: `calc(100% + ${blur * 4}px)`,
                height: `calc(100% + ${blur * 4}px)`,
                filter: `blur(${blur}px)`,
              }
            : { inset: 0, width: '100%', height: '100%' }
        }
      />
      <div
        className="absolute inset-0 transition-opacity duration-300"
        style={{ background: 'var(--color-background)', opacity: 1 - visibility }}
      />
    </div>
  )
}

export type ImageLoad = 'loading' | 'loaded' | 'failed'

/** Estado de carga de una imagen, que se reinicia al cambiar de imagen. */
export function useImageLoad(src: string | undefined) {
  const [settled, setSettled] = useState<{ src: string; load: ImageLoad }>()
  return {
    load: settled && settled.src === src ? settled.load : ('loading' as ImageLoad),
    onLoad: () => {
      if (src) setSettled({ src, load: 'loaded' })
    },
    onError: () => {
      if (src) setSettled({ src, load: 'failed' })
    },
  }
}
