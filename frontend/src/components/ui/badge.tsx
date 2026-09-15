import { cva, type VariantProps } from 'class-variance-authority'
import type * as React from 'react'

import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-2xs font-medium leading-4 transition-colors',
  {
    variants: {
      variant: {
        default: 'border-primary/35 bg-primary/10 text-primary',
        secondary: 'border-secondary/35 bg-secondary/10 text-secondary',
        outline: 'border-border bg-transparent text-muted-foreground',
        muted: 'border-border bg-muted text-muted-foreground',
        destructive: 'border-destructive/40 bg-destructive/10 text-destructive',
        info: 'border-info/35 bg-info/10 text-info',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

export interface BadgeProps
  extends React.ComponentProps<'span'>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
