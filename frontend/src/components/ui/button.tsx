import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import type * as React from 'react'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-sm font-medium transition-colors select-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/85',
        secondary: 'bg-accent text-accent-foreground hover:bg-accent/70',
        outline:
          'border border-border bg-transparent text-foreground hover:border-border-strong hover:bg-accent hover:text-accent-foreground',
        ghost: 'bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground',
        destructive:
          'border border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20',
        success: 'border border-secondary/40 bg-secondary/10 text-secondary hover:bg-secondary/20',
        link: 'text-primary underline decoration-dotted underline-offset-2 hover:decoration-solid',
      },
      size: {
        default: 'h-7 px-2.5 text-xs',
        sm: 'h-6 px-2 text-2xs',
        lg: 'h-9 px-4 text-sm',
        icon: 'h-7 w-7',
        'icon-sm': 'h-6 w-6',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export interface ButtonProps
  extends React.ComponentProps<'button'>,
    VariantProps<typeof buttonVariants> {
  /** Renderiza el hijo en lugar de un `<button>` (Radix Slot). */
  asChild?: boolean
}

function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Component = asChild ? Slot : 'button'
  return (
    <Component
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
}

export { Button, buttonVariants }
