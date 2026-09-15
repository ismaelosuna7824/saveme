import * as TabsPrimitive from '@radix-ui/react-tabs'
import type * as React from 'react'

import { cn } from '@/lib/utils'

const Tabs = TabsPrimitive.Root

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        'inline-flex flex-wrap items-center gap-px border-b border-border pb-px',
        className,
      )}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 border-transparent px-2 py-1 text-2xs uppercase tracking-[0.08em] text-muted-foreground transition-colors',
        'hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        'data-[state=active]:border-primary data-[state=active]:text-primary',
        className,
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn('focus-visible:outline-none', className)}
      {...props}
    />
  )
}

export { Tabs, TabsContent, TabsList, TabsTrigger }
