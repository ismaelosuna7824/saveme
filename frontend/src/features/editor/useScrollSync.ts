import { useEffect, type RefObject } from 'react'
import type { EditorView } from '@codemirror/view'

/** Ventana en la que se ignoran los scrolls provocados por nosotros mismos. */
const GUARD_MS = 140
/** Umbral a partir del cual merece la pena mover la otra mitad. */
const MIN_DELTA_PX = 20

export interface UseScrollSyncArgs {
  /** Vista de CodeMirror. `null` mientras el editor no está montado. */
  view: EditorView | null
  /** Contenedor con scroll de la preview. */
  previewRef: RefObject<HTMLElement | null>
  /** Solo tiene sentido en modo dividido. */
  enabled: boolean
}

/**
 * Sincronización de scroll entre fuente y preview.
 *
 * Es sincronización **por posición**, no proporcional: ReactMarkdown conserva
 * las posiciones del markdown original, así que cada bloque de la preview lleva
 * `data-line` con su línea de origen. Al hacer scroll en la fuente se busca el
 * último bloque cuya línea sea <= la línea visible arriba y se lleva la preview
 * ahí (marcándolo como activo). En sentido contrario se hace el mapeo inverso.
 *
 * Solo si no hay ningún bloque con `data-line` (por ejemplo, si una versión
 * futura de react-markdown dejara de exponer posiciones) se cae a un reparto
 * proporcional, que alinea los dos scrolls pero no respeta los bloques.
 */
export function useScrollSync({ view, previewRef, enabled }: UseScrollSyncArgs): void {
  useEffect(() => {
    if (!enabled || view === null) return

    const scroller = view.scrollDOM
    let frame = 0
    let guardUntil = 0
    let activeBlock: HTMLElement | null = null

    const collectBlocks = (): HTMLElement[] => {
      const container = previewRef.current
      if (container === null) return []
      return Array.from(container.querySelectorAll<HTMLElement>('[data-line]'))
    }

    const setActive = (element: HTMLElement | null) => {
      if (activeBlock === element) return
      activeBlock?.classList.remove('is-sync-active')
      element?.classList.add('is-sync-active')
      activeBlock = element
    }

    const blockForLine = (blocks: HTMLElement[], line: number): HTMLElement | null => {
      let best: HTMLElement | null = null
      let bestLine = Number.NEGATIVE_INFINITY
      for (const block of blocks) {
        const value = Number(block.dataset['line'])
        if (!Number.isFinite(value)) continue
        if (value <= line && value > bestLine) {
          best = block
          bestLine = value
        }
      }
      return best ?? blocks[0] ?? null
    }

    const scrollPreviewTo = (element: HTMLElement) => {
      const container = previewRef.current
      if (container === null) return
      const desired =
        container.scrollTop +
        (element.getBoundingClientRect().top - container.getBoundingClientRect().top)
      if (Math.abs(desired - container.scrollTop) > MIN_DELTA_PX) {
        guardUntil = Date.now() + GUARD_MS
        container.scrollTop = desired
      }
      setActive(element)
    }

    const proportional = () => {
      const container = previewRef.current
      if (container === null) return
      const sourceMax = scroller.scrollHeight - scroller.clientHeight
      const previewMax = container.scrollHeight - container.clientHeight
      if (sourceMax <= 0 || previewMax <= 0) return
      guardUntil = Date.now() + GUARD_MS
      container.scrollTop = (scroller.scrollTop / sourceMax) * previewMax
    }

    const syncPreviewFromSource = () => {
      const blocks = collectBlocks()
      if (blocks.length === 0) {
        proportional()
        return
      }
      const info = view.lineBlockAtHeight(scroller.scrollTop)
      const line = view.state.doc.lineAt(info.from).number
      const target = blockForLine(blocks, line)
      if (target !== null) scrollPreviewTo(target)
    }

    const syncSourceFromPreview = () => {
      const container = previewRef.current
      const blocks = collectBlocks()
      if (container === null || blocks.length === 0) return

      const containerTop = container.getBoundingClientRect().top
      let candidate = blocks[0]
      for (const block of blocks) {
        if (block.getBoundingClientRect().top - containerTop <= 4) candidate = block
        else break
      }

      const line = Number(candidate.dataset['line'])
      if (!Number.isFinite(line) || line < 1) return
      const lineNumber = Math.min(Math.max(1, Math.trunc(line)), view.state.doc.lines)
      const info = view.lineBlockAt(view.state.doc.line(lineNumber).from)
      if (Math.abs(info.top - scroller.scrollTop) > MIN_DELTA_PX) {
        guardUntil = Date.now() + GUARD_MS
        scroller.scrollTop = info.top
      }
      setActive(candidate)
    }

    // Un solo listener en captura: los eventos `scroll` de un elemento no
    // burbujean, pero sí pasan por la fase de captura. Así no dependemos de que
    // el nodo de la preview siga siendo el mismo cuando cambia el modo.
    const onScroll = (event: Event) => {
      if (Date.now() < guardUntil) return
      const target = event.target
      if (target === scroller) {
        cancelAnimationFrame(frame)
        frame = requestAnimationFrame(syncPreviewFromSource)
      } else if (target === previewRef.current) {
        cancelAnimationFrame(frame)
        frame = requestAnimationFrame(syncSourceFromPreview)
      }
    }

    document.addEventListener('scroll', onScroll, { capture: true, passive: true })

    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('scroll', onScroll, { capture: true })
      activeBlock?.classList.remove('is-sync-active')
    }
  }, [enabled, view, previewRef])
}
