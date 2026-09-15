import { useT } from '@/i18n'

import { useCategories, useSummaries } from '@/api/queries'
import { SectionHeader } from '@/components/common/SectionHeader'
import { categoryLabel } from '@/features/projects/CategoryCounts'
import { categoryDescription } from '@/lib/labels'
import { SummaryList } from '@/features/projects/SummaryList'

interface CategoryPageProps {
  slug: string
  category: string
}

/**
 * Resúmenes de una categoría, del más nuevo al más viejo.
 *
 * Se pide `sort=created`: el contrato (§6) lista el parámetro `sort` sin
 * enumerar valores, así que `created` es una suposición razonable, no un valor
 * confirmado por el core.
 */
export function CategoryPage({ slug, category }: CategoryPageProps) {
  const t = useT()
  const categories = useCategories()
  const meta = categories.data?.find((candidate) => candidate.key === category)
  const label = categoryLabel(t, category, meta?.label)
  // La descripción se traduce por clave; el texto del core es el respaldo.
  const description = categoryDescription(t, category, meta?.description)

  const summaries = useSummaries({
    project: slug,
    category,
    limit: 200,
    sort: 'created',
  })

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 space-y-1 px-3 py-2">
        <SectionHeader
          title={label}
          hint={
            summaries.data
              ? t('projects.summaryCount', { count: summaries.data.total })
              : t('common.state.loading')
          }
        />
        {description ? (
          <p className="text-2xs text-muted-foreground">{description}</p>
        ) : null}
        <p className="text-2xs text-muted-foreground">
          {t('projects.category.folderLabel')}{' '}
          <code className="text-secondary">{meta?.folder ?? category}/</code> ·{' '}
          {t('projects.category.sortNewest')}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <SummaryList
          result={summaries.data}
          isLoading={summaries.isLoading}
          error={summaries.error}
          onRetry={() => {
            void summaries.refetch()
          }}
          emptyTitle={t('projects.category.empty.title', { category: label })}
          emptyHint={t('projects.category.empty.hint')}
        />
      </div>
    </div>
  )
}
