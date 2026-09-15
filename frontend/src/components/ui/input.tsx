import type * as React from 'react'

import { cn } from '@/lib/utils'

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      className={cn(
        'flex h-7 w-full rounded-sm border border-input bg-sunken px-2 py-1 text-xs text-foreground transition-colors',
        'placeholder:text-muted-foreground/70',
        'focus-visible:outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'file:border-0 file:bg-transparent file:text-xs file:font-medium',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
