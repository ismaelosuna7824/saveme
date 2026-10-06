import {
  type KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { Minus, Plus, Scan } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useT } from '@/i18n'
import {
  closeDiagramViewer,
  openDiagram,
  subscribeDiagramViewer,
  type OpenDiagram,
} from '@/lib/diagramViewer'
import { useDocumentTheme } from '@/lib/hooks'
import { renderDiagram } from '@/lib/mermaid'
import { centeredView, fitView, zoomAt, type Size, type View } from '@/lib/panZoom'

/** Lo que avanza un clic en los botones de zoom o una pulsación de `+`/`-`. */
const ZOOM_STEP = 1.25
/** Lo que se desplaza una flecha del teclado; con Mayúsculas, el cuádruple. */
const PAN_STEP = 80

/**
 * Pinch de Safari/WebKit. No es estándar y no viene en `lib.dom`: WKWebView —el
 * motor de la app en macOS— no traduce el pellizco del trackpad a `wheel` con
 * `ctrlKey` como Chromium, sino a estos eventos propios.
 */
interface GestureEvent extends UIEvent {
  scale: number
  clientX: number
  clientY: number
}

/**
 * Visor de diagramas a pantalla completa. Se monta una vez en la raíz y se abre
 * desde `openDiagramViewer`, tanto desde la preview como desde el modo en vivo.
 */
export function DiagramViewerHost() {
  const diagram = useSyncExternalStore(subscribeDiagramViewer, openDiagram, () => null)

  return (
    <Dialog
      open={diagram !== null}
      onOpenChange={(open) => {
        if (!open) closeDiagramViewer()
      }}
    >
      {diagram !== null ? <DiagramViewer key={diagram.code} diagram={diagram} /> : null}
    </Dialog>
  )
}

/**
 * El SVG se escala cambiando su **tamaño**, no con `transform: scale()`. Con un
 * transform, WebKit rasteriza la capa a la escala de partida y amplía el mapa de
 * bits: el texto se ve borroso justo cuando se hace zoom para leerlo. Cambiando
 * ancho y alto el SVG se vuelve a dibujar nítido a cada escala. La posición sí
 * va con `translate`, que no reescala nada.
 */
function DiagramViewer({ diagram }: { diagram: OpenDiagram }) {
  const t = useT()
  const theme = useDocumentTheme()
  const [svg, setSvg] = useState(diagram.svg)
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null)
  const [viewportSize, setViewportSize] = useState<Size | null>(null)
  const [content, setContent] = useState<HTMLDivElement | null>(null)
  const [contentSize, setContentSize] = useState<Size | null>(null)
  // `null` hasta el primer encaje: así no se ve un fotograma a escala 1 pegado
  // a la esquina antes de que el diagrama se centre.
  const [view, setView] = useState<View | null>(null)
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ pointer: number; x: number; y: number } | null>(null)

  // Se dibuja una copia propia al abrir, aunque ya venga un SVG. Mermaid pone el
  // id del render en los selectores de su `<style>` y en las flechas
  // (`url(#id_…-pointEnd)`): con el mismo SVG dos veces en el documento, las
  // flechas del visor apuntarían a las del bloque y se perderían si este
  // desaparece. Mientras tanto se enseña el recibido, que es idéntico.
  // Con otro tema también hay que redibujar, porque los colores van incrustados.
  // La vista se conserva: el tamaño del diagrama no cambia con los colores.
  useEffect(() => {
    let cancelled = false
    void renderDiagram(diagram.code).then((result) => {
      if (!cancelled && result.svg !== undefined) setSvg(result.svg)
    })
    return () => {
      cancelled = true
    }
  }, [theme, diagram.code])

  useEffect(() => {
    if (viewport === null) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) return
      setViewportSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(viewport)
    return () => {
      observer.disconnect()
    }
  }, [viewport])

  // Tamaño propio del diagrama. Mermaid lo deja en el `viewBox`; el SVG trae
  // además un `max-width` en línea que lo encogería, y lo anula el CSS.
  useLayoutEffect(() => {
    const element = content?.querySelector('svg')
    if (element === null || element === undefined) return
    const box = element.viewBox.baseVal
    if (box !== null && box.width > 0 && box.height > 0) {
      setContentSize({ width: box.width, height: box.height })
      return
    }
    const rect = element.getBoundingClientRect()
    setContentSize({ width: Math.max(1, rect.width), height: Math.max(1, rect.height) })
  }, [content, svg])

  useEffect(() => {
    if (view !== null || contentSize === null || viewportSize === null) return
    if (viewportSize.width === 0 || viewportSize.height === 0) return
    setView(fitView(contentSize, viewportSize))
  }, [view, contentSize, viewportSize])

  // La rueda se escucha a mano porque React registra `wheel` como pasivo y
  // entonces no se puede cancelar: el pellizco haría zoom de toda la ventana.
  useEffect(() => {
    if (viewport === null) return

    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1
      // Pellizco del trackpad (Chromium lo manda con `ctrlKey`) o Ctrl/Cmd +
      // rueda: zoom hacia el puntero. El resto es desplazarse, como en un lienzo.
      if (event.ctrlKey || event.metaKey) {
        const rect = viewport.getBoundingClientRect()
        // Una rueda de ratón da saltos de 100 y un pellizco de 1 a 10: se acota
        // para que un clic de rueda sea un paso (~×1.3) y no multiplique por tres.
        const delta = Math.max(-25, Math.min(25, event.deltaY * unit))
        const factor = Math.exp(-delta * 0.01)
        const px = event.clientX - rect.left
        const py = event.clientY - rect.top
        setView((current) => (current === null ? null : zoomAt(current, factor, px, py)))
        return
      }
      const dx = event.deltaX * unit
      const dy = event.deltaY * unit
      setView((current) => (current === null ? null : { ...current, x: current.x - dx, y: current.y - dy }))
    }

    let gestureScale = 1
    const onGestureStart = (event: Event) => {
      event.preventDefault()
      gestureScale = 1
    }
    const onGestureChange = (event: Event) => {
      event.preventDefault()
      const gesture = event as GestureEvent
      const factor = gesture.scale / gestureScale
      gestureScale = gesture.scale
      const rect = viewport.getBoundingClientRect()
      const px = gesture.clientX - rect.left
      const py = gesture.clientY - rect.top
      setView((current) => (current === null ? null : zoomAt(current, factor, px, py)))
    }

    viewport.addEventListener('wheel', onWheel, { passive: false })
    viewport.addEventListener('gesturestart', onGestureStart)
    viewport.addEventListener('gesturechange', onGestureChange)
    return () => {
      viewport.removeEventListener('wheel', onWheel)
      viewport.removeEventListener('gesturestart', onGestureStart)
      viewport.removeEventListener('gesturechange', onGestureChange)
    }
  }, [viewport])

  /** Zoom hacia el centro del visor: botones y teclado, que no tienen puntero. */
  const zoomCentered = (factor: number) => {
    if (viewportSize === null) return
    setView((current) =>
      current === null
        ? null
        : zoomAt(current, factor, viewportSize.width / 2, viewportSize.height / 2),
    )
  }

  const fit = () => {
    if (contentSize !== null && viewportSize !== null) setView(fitView(contentSize, viewportSize))
  }

  const actualSize = () => {
    if (contentSize !== null && viewportSize !== null) {
      setView(centeredView(contentSize, viewportSize, 1))
    }
  }

  const onKeyDown = (event: KeyboardEvent) => {
    // Cmd/Ctrl + tecla son atajos de la ventana: no se secuestran.
    if (event.metaKey || event.ctrlKey || event.altKey) return
    const pan = event.shiftKey ? PAN_STEP * 4 : PAN_STEP
    const move = (dx: number, dy: number) => {
      setView((current) => (current === null ? null : { ...current, x: current.x + dx, y: current.y + dy }))
    }
    switch (event.key) {
      case '+':
      case '=':
        zoomCentered(ZOOM_STEP)
        break
      case '-':
      case '_':
        zoomCentered(1 / ZOOM_STEP)
        break
      case '0':
        fit()
        break
      case '1':
        actualSize()
        break
      case 'ArrowLeft':
        move(pan, 0)
        break
      case 'ArrowRight':
        move(-pan, 0)
        break
      case 'ArrowUp':
        move(0, pan)
        break
      case 'ArrowDown':
        move(0, -pan)
        break
      default:
        return
    }
    event.preventDefault()
  }

  const scale = view?.scale ?? 1

  return (
    <DialogContent
      className="flex h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-none flex-col"
      aria-describedby={undefined}
      onKeyDown={onKeyDown}
    >
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-1.5 pr-9">
        <DialogTitle className="mr-2 shrink-0 text-2xs uppercase tracking-[0.14em] text-primary">
          mermaid
        </DialogTitle>
        <span className="mr-auto truncate text-2xs text-muted-foreground">
          {t('editor.mermaid.viewerHint')}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          title={t('editor.mermaid.zoomOut')}
          aria-label={t('editor.mermaid.zoomOut')}
          onClick={() => zoomCentered(1 / ZOOM_STEP)}
        >
          <Minus />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="w-14 tabular-nums"
          title={t('editor.mermaid.actualSize')}
          aria-label={t('editor.mermaid.actualSize')}
          onClick={actualSize}
        >
          {Math.round(scale * 100)}%
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          title={t('editor.mermaid.zoomIn')}
          aria-label={t('editor.mermaid.zoomIn')}
          onClick={() => zoomCentered(ZOOM_STEP)}
        >
          <Plus />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          title={t('editor.mermaid.fit')}
          aria-label={t('editor.mermaid.fit')}
          onClick={fit}
        >
          <Scan />
        </Button>
      </div>

      <div
        ref={setViewport}
        className="mermaid-viewer__viewport"
        data-dragging={dragging ? '' : undefined}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.currentTarget.setPointerCapture(event.pointerId)
          drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY }
          setDragging(true)
        }}
        onPointerMove={(event) => {
          const start = drag.current
          if (start === null || start.pointer !== event.pointerId) return
          const dx = event.clientX - start.x
          const dy = event.clientY - start.y
          drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY }
          setView((current) => (current === null ? null : { ...current, x: current.x + dx, y: current.y + dy }))
        }}
        onPointerUp={(event) => {
          if (drag.current?.pointer !== event.pointerId) return
          drag.current = null
          setDragging(false)
        }}
        onPointerCancel={() => {
          drag.current = null
          setDragging(false)
        }}
        onDoubleClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          const factor = event.shiftKey ? 1 / 2 : 2
          const px = event.clientX - rect.left
          const py = event.clientY - rect.top
          setView((current) => (current === null ? null : zoomAt(current, factor, px, py)))
        }}
      >
        <div
          ref={setContent}
          className="mermaid-viewer__content"
          style={
            view === null || contentSize === null
              ? { visibility: 'hidden' }
              : {
                  width: contentSize.width * view.scale,
                  height: contentSize.height * view.scale,
                  transform: `translate(${view.x}px, ${view.y}px)`,
                }
          }
          // Mismo SVG que el bloque: generado por Mermaid con `securityLevel:
          // 'strict'`, etiquetas saneadas.
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
    </DialogContent>
  )
}
