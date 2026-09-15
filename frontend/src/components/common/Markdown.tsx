import { memo, useCallback, useMemo, type MouseEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeSlug from 'rehype-slug'
import remarkGfm from 'remark-gfm'

import { buildMarkdownComponents } from '@/components/common/markdownComponents'
import { cn } from '@/lib/utils'

interface MarkdownProps {
  content: string
  /**
   * Desplazamiento que se suma a la línea de cada bloque. Se usa cuando se
   * renderiza solo el cuerpo de un archivo con frontmatter, para que las líneas
   * sigan siendo las del archivo completo.
   */
  lineOffset?: number
  className?: string
  /**
   * Se llama al marcar o desmarcar una casilla de tarea. Recibe la línea del
   * archivo (no la del cuerpo) donde está el `- [ ]`.
   */
  onToggleTask?: (line: number, checked: boolean) => void
}

/**
 * Renderiza markdown con GFM. Cada bloque lleva `data-line` con su línea de
 * origen, que es lo que usa la sincronización de scroll del editor.
 *
 * Las casillas de tarea se resuelven por delegación de eventos: en lugar de
 * cablear un callback por casilla —que exigiría conocer la posición de un nodo
 * que `remark-gfm` genera sin información de posición— se escucha el click en el
 * contenedor y se sube hasta el bloque `[data-line]` más cercano. Ese bloque es
 * el `<li>`, cuya línea sí es fiable porque viene del parser.
 */
export const Markdown = memo(function Markdown({
  content,
  lineOffset = 0,
  className,
  onToggleTask,
}: MarkdownProps) {
  const components = useMemo(() => buildMarkdownComponents(lineOffset), [lineOffset])

  const handleClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (onToggleTask === undefined) return
      const target = event.target
      if (!(target instanceof HTMLInputElement)) return
      if (!target.classList.contains('md-task')) return

      const block = target.closest<HTMLElement>('[data-line]')
      const line = Number(block?.dataset.line)
      if (!Number.isInteger(line) || line <= 0) return

      // El navegador ya invirtió `checked` antes de despachar el click, así que
      // lo que se lee aquí es el valor NUEVO. Se cancela el cambio del DOM para
      // que el estado lo mande siempre el markdown: si el guardado fallara, la
      // casilla no quedaría mintiendo.
      event.preventDefault()
      onToggleTask(line, target.checked)
    },
    [onToggleTask],
  )

  return (
    <div className={cn('md-preview', className)} onClick={handleClick}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSlug]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
})
