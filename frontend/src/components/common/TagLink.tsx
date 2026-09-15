import { useNavigate } from '@tanstack/react-router'

import { useT } from '@/i18n'
import { cn } from '@/lib/utils'

interface TagLinkProps {
  tag: string
  className?: string
}

/**
 * Etiqueta pulsable: lleva a todo lo que la lleva puesta.
 *
 * Es un `<button>` y no un `<Link>` porque vive **dentro** de otro enlace —la fila
 * entera de un resumen lleva al resumen— y meter un enlace dentro de otro es HTML
 * inválido. El `stopPropagation` es lo que hace que el clic filtre en vez de abrir
 * el resumen, que es lo que pasaría sin él.
 */
export function TagLink({ tag, className }: TagLinkProps) {
  const t = useT()
  const navigate = useNavigate()

  return (
    <button
      type="button"
      title={t('common.tags.filterBy', { tag })}
      aria-label={t('common.tags.filterBy', { tag })}
      className={cn(
        'shrink-0 rounded-sm border border-border px-1 text-2xs text-muted-foreground',
        'transition-colors hover:border-primary/45 hover:text-primary',
        className,
      )}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        void navigate({ to: '/t/$tag', params: { tag } })
      }}
    >
      #{tag}
    </button>
  )
}
