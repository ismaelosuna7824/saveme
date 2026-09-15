import { useT } from '@/i18n'

import { useSummaries, useTags } from '@/api/queries'
import { SectionHeader } from '@/components/common/SectionHeader'
import { SummaryList } from '@/features/projects/SummaryList'

interface TagPageProps {
  tag: string
}

/**
 * Todo lo que lleva una etiqueta, de cualquier proyecto.
 *
 * Es global a propósito: una etiqueta cruza proyectos —`#oauth` puede estar en
 * tres— y ese es justo el valor que tiene. La categoría, en cambio, vive dentro
 * de un proyecto, y por eso su pantalla es `/<proyecto>/<categoría>`.
 */
export function TagPage({ tag }: TagPageProps) {
  const t = useT()
  const tags = useTags()
  const summaries = useSummaries({ tag, limit: 200, sort: 'created' })

  // El contador sale del índice de etiquetas y no del total de esta lista: el
  // listado va limitado a 200, así que en un workspace grande el total de la
  // respuesta podría no ser el de la etiqueta.
  const total = tags.data?.[tag]

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 space-y-1 px-3 py-2">
        <SectionHeader
          title={`#${tag}`}
          hint={
            total === undefined
              ? t('common.state.loading')
              : t('projects.summaryCount', { count: total })
          }
        />
        <p className="text-2xs text-muted-foreground">{t('projects.tag.explain')}</p>
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
          emptyTitle={t('projects.tag.empty.title', { tag })}
          emptyHint={t('projects.tag.empty.hint')}
        />
      </div>
    </div>
  )
}
