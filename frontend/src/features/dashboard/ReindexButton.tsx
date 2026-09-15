import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

import { errorMessage } from '@/api/client'
import { useReindex } from '@/api/queries'
import { Button, type ButtonProps } from '@/components/ui/button'
import { useT } from '@/i18n'

/**
 * Reconstruye el índice desde el disco (`POST /reindex`).
 *
 * Es seguro: el `.md` en disco es la fuente de verdad y el índice SQLite es
 * derivado, así que reindexar nunca pierde contenido.
 */
export function ReindexButton({
  variant = 'outline',
  size = 'sm',
  withLabel = true,
}: {
  variant?: ButtonProps['variant']
  size?: ButtonProps['size']
  withLabel?: boolean
}) {
  const t = useT()
  const reindex = useReindex()

  const run = () => {
    reindex.mutate(undefined, {
      onSuccess: (result) => {
        toast.success(t('dashboard.reindex.done', { count: result.indexed }), {
          description: t('dashboard.reindex.detail', {
            added: result.added,
            updated: result.updated,
            removed: result.removed,
            duration: result.duration_ms,
          }),
        })
      },
      onError: (error) => {
        toast.error(t('dashboard.reindex.failed'), { description: errorMessage(error) })
      },
    })
  }

  return (
    <Button
      variant={variant}
      size={size}
      onClick={run}
      disabled={reindex.isPending}
      title={t('dashboard.reindex.title')}
    >
      <RefreshCw className={reindex.isPending ? 'size-3 animate-spin' : 'size-3'} />
      {withLabel
        ? reindex.isPending
          ? t('dashboard.reindex.running')
          : t('common.actions.reindex')
        : null}
    </Button>
  )
}
