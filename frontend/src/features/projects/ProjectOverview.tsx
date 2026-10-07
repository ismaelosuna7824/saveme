import { useState } from 'react'

import { useT } from '@/i18n'

import { useSummaries } from '@/api/queries'
import { SectionHeader } from '@/components/common/SectionHeader'
import { useDebouncedValue } from '@/lib/hooks'
import { SearchBox } from '@/features/projects/SearchBox'
import { SearchFilters } from '@/features/projects/SearchFilters'
import { SummaryList } from '@/features/projects/SummaryList'
import {
  hasOverviewFilters,
  projectOverviewFilter,
  type OverviewFilters,
} from '@/features/projects/summaryFilters'

/** Resumen general del proyecto: buscador con filtros + últimos resúmenes tocados. */
export function ProjectOverview({ slug }: { slug: string }) {
  const t = useT()
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebouncedValue(query, 300).trim()
  // Los filtros no pasan por el debounce: son un clic, no una ráfaga de teclas.
  const [filters, setFilters] = useState<OverviewFilters>({})

  const filter = projectOverviewFilter(
    slug,
    debouncedQuery.length > 0 ? debouncedQuery : undefined,
    filters,
  )
  const summaries = useSummaries(filter, { keepPrevious: true })
  const stale = summaries.isPlaceholderData

  // La búsqueda (texto y filtros) de la lista que se ve. Mientras llega la
  // siguiente, la lista sigue siendo la anterior, y su título y su «nada
  // coincide» también: si no, dirían una búsqueda que todavía no ha contestado.
  const requestedKey = JSON.stringify(filter)
  const [shown, setShown] = useState({ key: requestedKey, query: debouncedQuery, filters })
  if (!stale && summaries.data && shown.key !== requestedKey) {
    setShown({ key: requestedKey, query: debouncedQuery, filters })
  }
  const searching = shown.query.length > 0
  const filtering = hasOverviewFilters(shown.filters)
  // Se está escribiendo (el debounce aún no soltó el texto) o la búsqueda
  // está en camino.
  const busy = query.trim() !== debouncedQuery || stale

  let emptyTitle = t('projects.empty.title')
  if (searching && filtering) {
    emptyTitle = t('projects.search.empty.titleFiltered', { query: shown.query })
  } else if (searching) {
    emptyTitle = t('projects.search.empty.title', { query: shown.query })
  } else if (filtering) {
    emptyTitle = t('projects.search.empty.filtered')
  }

  return (
    <div className="flex h-full flex-col">
      <div className="backdrop-surface shrink-0 px-3 py-2">
        <SearchBox
          value={query}
          onChange={setQuery}
          busy={busy}
          resultCount={summaries.data?.total}
        />
        <SearchFilters project={slug} value={filters} onChange={setFilters} />
      </div>

      <div className="backdrop-surface shrink-0 px-3 pb-2">
        <SectionHeader
          title={
            searching || filtering ? t('projects.search.results') : t('projects.recentActivity')
          }
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
          emptyTitle={emptyTitle}
          emptyHint={
            filtering ? t('projects.search.empty.filteredHint') : t('projects.empty.hint')
          }
        />
      </div>
    </div>
  )
}
