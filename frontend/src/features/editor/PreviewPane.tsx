import type { RefObject } from 'react'

import { Markdown } from '@/components/common/Markdown'

interface PreviewPaneProps {
  previewRef: RefObject<HTMLDivElement | null>
  /** Cuerpo del documento, sin frontmatter. */
  content: string
  /** Líneas que ocupa el frontmatter, para que `data-line` sea absoluto. */
  lineOffset: number
  /** Marcar una casilla de tarea reescribe el markdown. */
  onToggleTask?: (line: number, checked: boolean) => void
}

/**
 * Panel de preview.
 *
 * Es el contenedor sobre el que actúa la sincronización de scroll: los bloques
 * que renderiza `Markdown` llevan `data-line`, y aquí se busca el que
 * corresponde a la línea visible del editor.
 */
export function PreviewPane({ previewRef, content, lineOffset, onToggleTask }: PreviewPaneProps) {
  return (
    <div
      ref={previewRef}
      className="h-full overflow-y-auto bg-panel px-4 py-3"
      data-testid="editor-preview"
    >
      <Markdown content={content} lineOffset={lineOffset} onToggleTask={onToggleTask} />
    </div>
  )
}
