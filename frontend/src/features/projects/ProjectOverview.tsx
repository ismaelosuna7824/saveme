import { useState } from 'react'

import { useT } from '@/i18n'

import { useSummaries } from '@/api/queries'
import { SectionHeader } from '@/components/common/SectionHeader'
import { useDebouncedValue } from '@/lib/hooks'
import { SearchBox } from '@/features/projects/SearchBox'
import { SummaryList } from '@/features/projects/SummaryList'

/** Resumen general del proyecto: buscador + últimos resúmenes tocados. */
export function ProjectOverview({ slug }: { slug: string }) {
  const t = useT()
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebouncedValue(query, 300).trim()
  const searching = debouncedQuery.length > 0

  const summaries = useSummaries({
    project: slug,
    q: searching ? debouncedQuery : undefined,
    limit: 40,
  })

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 px-3 py-2">
        <SearchBox
          value={query}
          onChange={setQuery}
          resultCount={summaries.data?.total}
          placeholder={
            searching
              ? t('projects.search.searching', { query: debouncedQuery })
              : t('projects.search.placeholder')
          }
        />
      </div>

      <div className="shrink-0 px-3 pb-2">
        <SectionHeader
          title={searching ? t('projects.search.results') : t('projects.recentActivity')}
          hint={
            summaries.data
              ? t('projects.resultsShown', {
                  shown: summaries.data.items.length,
                  total: summaries.data.total,
                })
              : t('common.state.loading')
          }
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <SummaryList
          result={summaries.data}
          isLoading={summaries.isLoading}
          error={summaries.error}
          onRetry={() => {
            void summaries.refetch()
          }}
          showCategory
          emptyTitle={
            searching
              ? t('projects.search.empty.title', { query: debouncedQuery })
              : t('projects.empty.title')
          }
          emptyHint={t('projects.empty.hint')}
        />
      </div>
    </div>
  )
}
