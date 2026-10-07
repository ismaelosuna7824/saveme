import { useState } from 'react'

import { useT } from '@/i18n'

import { useSummaries } from '@/api/queries'
import { SectionHeader } from '@/components/common/SectionHeader'
import { useDebouncedValue } from '@/lib/hooks'
import { SearchBox } from '@/features/projects/SearchBox'
import { SummaryList } from '@/features/projects/SummaryList'
import { projectOverviewFilter } from '@/features/projects/summaryFilters'

/** Resumen general del proyecto: buscador + últimos resúmenes tocados. */
export function ProjectOverview({ slug }: { slug: string }) {
  const t = useT()
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebouncedValue(query, 300).trim()

  const summaries = useSummaries(
    projectOverviewFilter(slug, debouncedQuery.length > 0 ? debouncedQuery : undefined),
    { keepPrevious: true },
  )
  const stale = summaries.isPlaceholderData

  // La búsqueda de la lista que se ve. Mientras llega la siguiente, la lista
  // sigue siendo la anterior, y su título y su «nada coincide» también: si no,
  // dirían una búsqueda que todavía no ha contestado.
  const [shownQuery, setShownQuery] = useState(debouncedQuery)
  if (!stale && summaries.data && shownQuery !== debouncedQuery) setShownQuery(debouncedQuery)
  const searching = shownQuery.length > 0
  // Se está escribiendo (el debounce aún no soltó el texto) o la búsqueda
  // está en camino.
  const busy = query.trim() !== debouncedQuery || stale

  return (
    <div className="flex h-full flex-col">
      <div className="backdrop-surface shrink-0 px-3 py-2">
        <SearchBox
          value={query}
          onChange={setQuery}
          busy={busy}
          resultCount={summaries.data?.total}
        />
      </div>

      <div className="backdrop-surface shrink-0 px-3 pb-2">
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

      {/* Sin atenuar con `opacity` mientras llega la búsqueda: un ancestro con
          opacidad < 1 corta el `backdrop-filter` de las tarjetas de dentro, y el
          difuminado desaparecía y volvía a cada letra. «buscando…» ya lo avisa. */}
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
              ? t('projects.search.empty.title', { query: shownQuery })
              : t('projects.empty.title')
          }
          emptyHint={t('projects.empty.hint')}
        />
      </div>
    </div>
  )
}
