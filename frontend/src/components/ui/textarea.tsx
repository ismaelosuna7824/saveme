import type * as React from 'react'

import { cn } from '@/lib/utils'

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'flex min-h-16 w-full rounded-sm border border-input bg-sunken px-2 py-1.5 text-xs text-foreground',
        'placeholder:text-muted-foreground/70',
        'focus-visible:outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
