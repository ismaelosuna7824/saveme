import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

interface SectionHeaderProps {
  title: ReactNode
  hint?: ReactNode
  actions?: ReactNode
  className?: string
}

/** Cabecera de sección con la regla de caja a la derecha. */
export function SectionHeader({ title, hint, actions, className }: SectionHeaderProps) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <div className="term-rule min-w-0 shrink">
        <span className="text-primary">▚</span>
        <span className="truncate">{title}</span>
      </div>
      {hint ? <span className="shrink-0 text-2xs text-muted-foreground">{hint}</span> : null}
      {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </div>
  )
}
