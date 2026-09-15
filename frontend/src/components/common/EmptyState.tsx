import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  hint?: ReactNode
  action?: ReactNode
  className?: string
}

export function EmptyState({ icon, title, hint, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 border border-dashed border-border px-4 py-8 text-center',
        className,
      )}
    >
      {icon ? <div className="text-muted-foreground">{icon}</div> : null}
      <div className="text-xs text-foreground">{title}</div>
      {hint ? <div className="max-w-md text-2xs text-muted-foreground">{hint}</div> : null}
      {action}
    </div>
  )
}
