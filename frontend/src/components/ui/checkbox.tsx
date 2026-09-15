import { Check } from 'lucide-react'
import type * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * Checkbox nativo estilizado.
 *
 * El proyecto no trae el componente shadcn y no hay Radix de checkbox instalado:
 * un `input[type=checkbox]` real conserva teclado, foco y semántica sin añadir
 * dependencias. La marca la dibuja un icono hermano con `peer-checked`.
 */
function Checkbox({ className, ...props }: React.ComponentProps<'input'>) {
  return (
    <span className="relative inline-flex size-3.5 shrink-0 items-center justify-center">
      <input
        type="checkbox"
        className={cn(
          'peer size-3.5 cursor-pointer appearance-none rounded-xs border border-border-strong bg-sunken transition-colors',
          'checked:border-primary checked:bg-primary',
          'hover:border-primary',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
          'disabled:cursor-not-allowed disabled:opacity-40',
          className,
        )}
        {...props}
      />
      <Check
        aria-hidden
        strokeWidth={3}
        className="pointer-events-none absolute size-2.5 text-primary-foreground opacity-0 transition-opacity peer-checked:opacity-100"
      />
    </span>
  )
}

export { Checkbox }
