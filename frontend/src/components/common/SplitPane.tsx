import { useRef, useState, type ReactNode } from 'react'

import { useT } from '@/i18n'

const MIN_RATIO = 0.2
const MAX_RATIO = 0.8

export type SplitPaneVisibility = 'left' | 'right' | 'both'

interface SplitPaneProps {
  left: ReactNode
  right: ReactNode
  /**
   * Qué panel ocupa el espacio. El panel izquierdo **nunca se desmonta** (el
   * editor de CodeMirror vive ahí): cuando no se ve se colapsa a ancho 0 en vez
   * de desaparecer, para no perder scroll, selección ni estado interno.
   */
  visible: SplitPaneVisibility
}

/**
 * Dos paneles redimensionables.
 *
 * Se implementa con CSS y eventos de puntero en vez de tirar de una librería:
 * `@radix-ui/react-resizable` no existe y para partir una ventana en dos no
 * hace falta un árbol de paneles. El divisor se arrastra y, con doble clic,
 * vuelve al 50 %.
 */
export function SplitPane({ left, right, visible }: SplitPaneProps) {
  const t = useT()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const draggingRef = useRef(false)
  const [ratio, setRatio] = useState(0.5)

  const leftBasis = visible === 'both' ? `${ratio * 100}%` : visible === 'left' ? '100%' : '0%'

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return
    const container = containerRef.current
    if (container === null) return
    const rect = container.getBoundingClientRect()
    if (rect.width <= 0) return
    const next = (event.clientX - rect.left) / rect.width
    setRatio(Math.min(MAX_RATIO, Math.max(MIN_RATIO, next)))
  }

  return (
    <div ref={containerRef} className="flex min-h-0 flex-1">
      <div
        className="min-h-0 min-w-0 overflow-hidden"
        style={{ flexBasis: leftBasis, flexGrow: 0, flexShrink: 0 }}
        aria-hidden={visible === 'right'}
      >
        {left}
      </div>

      {visible === 'both' ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t('common.splitPane.resize')}
          title={t('common.splitPane.hint')}
          className="w-px shrink-0 cursor-col-resize bg-border transition-colors hover:bg-primary focus-visible:bg-primary"
          tabIndex={0}
          onPointerDown={(event) => {
            draggingRef.current = true
            event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onPointerMove={onPointerMove}
          onPointerUp={(event) => {
            draggingRef.current = false
            event.currentTarget.releasePointerCapture(event.pointerId)
          }}
          onDoubleClick={() => setRatio(0.5)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') setRatio((value) => Math.max(MIN_RATIO, value - 0.03))
            if (event.key === 'ArrowRight') setRatio((value) => Math.min(MAX_RATIO, value + 0.03))
          }}
        />
      ) : null}

      {visible !== 'left' ? (
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{right}</div>
      ) : null}
    </div>
  )
}
