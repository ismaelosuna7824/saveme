import { AlertTriangle, RotateCw } from 'lucide-react'
import { useT } from '@/i18n'

import { errorMessage } from '@/api/client'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface ErrorPanelProps {
  error: unknown
  onRetry?: () => void
  title?: string
  className?: string
}

/** Panel de error. Siempre dice qué falló y, si se puede, ofrece reintentar. */
export function ErrorPanel({ error, onRetry, title, className }: ErrorPanelProps) {
  const t = useT()
  return (
    <div className={cn('border border-destructive/40 bg-destructive/5 px-3 py-2', className)}>
      <div className="flex items-center gap-2 text-2xs uppercase tracking-[0.12em] text-destructive">
        <AlertTriangle className="size-3" />
        {title ?? t('common.state.error')}
      </div>
      <p className="mt-1 whitespace-pre-wrap break-words text-xs text-foreground">
        {errorMessage(error)}
      </p>
      {onRetry ? (
        <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
          <RotateCw className="size-3" />
          {t('common.actions.retry')}
        </Button>
      ) : null}
    </div>
  )
}
