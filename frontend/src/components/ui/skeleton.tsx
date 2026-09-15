import type * as React from 'react'

import { cn } from '@/lib/utils'

function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('animate-pulse rounded-sm border border-border/60 bg-muted/60', className)}
      {...props}
    />
  )
}

export { Skeleton }
