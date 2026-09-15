import { useMemo } from 'react'
import { useT } from '@/i18n'
import { categoryLabel } from '@/lib/labels'

import { useCategories } from '@/api/queries'
import type { Category } from '@/api/types'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const VARIANT_BY_KEY: Record<string, BadgeProps['variant']> = {
  feature: 'default',
  fix: 'destructive',
  incident: 'destructive',
  chore: 'muted',
  refactor: 'info',
  docs: 'outline',
  infra: 'info',
  design: 'secondary',
  research: 'secondary',
  uncategorized: 'muted',
}

/**
 * Resolutor clave → categoría. La taxonomía la manda el core
 * (`GET /categories`); hasta que llega se muestra la clave cruda, que ya es
 * legible.
 */
export function useCategoryLookup(): (key: string) => Category | undefined {
  const { data } = useCategories()
  return useMemo(() => {
    const byKey = new Map<string, Category>()
    for (const category of data ?? []) byKey.set(category.key, category)
    return (key: string) => byKey.get(key)
  }, [data])
}

interface CategoryBadgeProps {
  category: string
  className?: string
  withDescription?: boolean
}

export function CategoryBadge({ category, className, withDescription = false }: CategoryBadgeProps) {
  const lookup = useCategoryLookup()
  const meta = lookup(category)
  const t = useT()
  const label = categoryLabel(t, category, meta?.label)
  const variant = VARIANT_BY_KEY[category] ?? 'muted'

  return (
    <Badge
      variant={variant}
      className={cn('uppercase', className)}
      title={withDescription ? meta?.description : undefined}
    >
      {label}
    </Badge>
  )
}
