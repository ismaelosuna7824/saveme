import type * as React from 'react'

import { cn } from '@/lib/utils'

interface SwitchProps
  extends Omit<
    React.ComponentProps<'button'>,
    'onChange' | 'onClick' | 'role' | 'aria-checked' | 'type' | 'children'
  > {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}

/**
 * Interruptor de dos estados.
 *
 * No hay Radix de switch instalado, así que es un `<button role="switch">`
 * nativo: conserva teclado (Space/Enter), foco y el estado que anuncia un
 * lector de pantalla. El desplazamiento se apaga con `prefers-reduced-motion`.
 */
function Switch({ checked, onCheckedChange, className, disabled, ...props }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-4 w-7 shrink-0 items-center rounded-sm border transition-colors motion-reduce:transition-none',
        checked ? 'border-primary/45 bg-primary/20' : 'border-border-strong bg-sunken',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
        'disabled:cursor-not-allowed disabled:opacity-40',
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          'block size-3 transition-transform motion-reduce:transition-none',
          checked ? 'translate-x-3.5 bg-primary' : 'translate-x-0.5 bg-muted-foreground',
        )}
      />
    </button>
  )
}

export { Switch }
