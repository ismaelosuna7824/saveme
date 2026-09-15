import type { VimModeName } from '@/features/editor/useMarkdownEditor'
import { cn } from '@/lib/utils'
import { useT } from '@/i18n'

/**
 * Los nombres de los modos no se traducen: son el vocabulario de vim, y quien lo
 * usa los busca así. Lo que sí se traduce es la ayuda que aparece al pasar por
 * encima, que es la que explica qué está pasando a quien no lo conoce.
 */
const ETIQUETA: Record<VimModeName, string> = {
  normal: 'NORMAL',
  insert: 'INSERT',
  visual: 'VISUAL',
  'visual-line': 'V-LINE',
  'visual-block': 'V-BLOCK',
}

/**
 * Indicador del modo modal.
 *
 * Es obligatorio, no un adorno: con vim encendido las letras dejan de escribir
 * texto, y sin decir en qué modo se está la única explicación posible para el
 * usuario es que el editor se ha roto.
 */
export function VimModeBadge({ mode, className }: { mode: VimModeName; className?: string }) {
  const t = useT()
  const insertando = mode === 'insert'
  const visual = mode.startsWith('visual')

  return (
    <span
      className={cn(
        'shrink-0 rounded-xs border px-1 py-px text-2xs uppercase tracking-wide',
        insertando && 'border-secondary/50 text-secondary',
        visual && 'border-primary/50 text-primary',
        !insertando && !visual && 'border-border-strong text-muted-foreground',
        className,
      )}
      title={t('editor.vim.badgeTitle')}
      aria-label={t('editor.vim.badgeTitle')}
    >
      {ETIQUETA[mode]}
    </span>
  )
}
