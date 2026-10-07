import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Network } from 'lucide-react'

import { projectGraphQuery } from '@/api/queries'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorPanel } from '@/components/common/ErrorPanel'
import { SectionHeader } from '@/components/common/SectionHeader'
import { Skeleton } from '@/components/ui/skeleton'
import { decisionMapDiagram } from '@/features/projects/decisionMapDiagram'
import { useT } from '@/i18n'
import { useDocumentTheme } from '@/lib/hooks'
import { readCssVariable, renderDiagram } from '@/lib/mermaid'

/**
 * Mapa de decisiones de un proyecto: los resúmenes que se enlazan (`related`) o
 * se sustituyen (`supersedes`), del más antiguo al más nuevo.
 *
 * Contesta «¿cómo llegamos a esta decisión?» de un vistazo, que con la lista solo
 * se reconstruye abriendo resúmenes uno a uno. Se dibuja con Mermaid —ya está en
 * la app y sigue el tema— y cada nodo abre su resumen.
 *
 * El SVG se inyecta como en `MermaidBlock`: lo genera Mermaid con
 * `securityLevel: 'strict'` y los títulos van escapados en `mermaidLabel`.
 */
export function DecisionMap({ slug }: { slug: string }) {
  const t = useT()
  const navigate = useNavigate()
  const theme = useDocumentTheme()
  const graph = useQuery(projectGraphQuery(slug))
  const [svg, setSvg] = useState<string | null>(null)
  const [renderError, setRenderError] = useState<string | null>(null)

  const supersedesLabel = t('projects.graph.supersedes')
  const diagram = useMemo(
    () =>
      graph.data && graph.data.nodes.length > 0
        ? decisionMapDiagram(
            graph.data,
            { supersedes: supersedesLabel },
            // El color se lee del tema activo: Mermaid lo incrusta en el SVG.
            { warning: readCssVariable('--color-warning') || 'orange' },
          )
        : null,
    // `theme` cambia el color de aviso aunque el grafo sea el mismo.
    [graph.data, supersedesLabel, theme],
  )

  useEffect(() => {
    if (diagram === null) return
    let cancelled = false
    void renderDiagram(diagram.code).then((result) => {
      if (cancelled) return
      setSvg(result.svg ?? null)
      setRenderError(result.error ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [diagram])

  // Un solo manejador para todo el SVG: Mermaid da a cada nodo un id del estilo
  // `…flowchart-n3-…`, y de ahí sale el resumen.
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const node = (event.target as Element).closest('g.node')
    const match = node?.id.match(/flowchart-(n\d+)-/)
    const id = match ? diagram?.nodeIds.get(match[1]) : undefined
    if (id !== undefined) void navigate({ to: '/s/$id', params: { id } })
  }

  const data = graph.data

  return (
    <div className="h-full overflow-y-auto">
      <div className="space-y-3 p-3">
        <div className="backdrop-surface space-y-1 border border-border p-2">
          <SectionHeader
            title={t('projects.graph.title')}
            hint={
              data
                ? t('projects.graph.hint', { nodes: data.nodes.length, isolated: data.isolated })
                : t('common.state.loading')
            }
          />
          {data && data.omitted > 0 ? (
            <p className="text-2xs text-muted-foreground">{t('projects.graph.omitted', { count: data.omitted })}</p>
          ) : null}
        </div>

        {graph.isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : graph.error ? (
          <ErrorPanel error={graph.error} title={t('projects.graph.loadFailed')} onRetry={() => void graph.refetch()} />
        ) : data && data.nodes.length === 0 ? (
          <EmptyState
            icon={<Network className="size-4" />}
            title={t('projects.graph.empty')}
            hint={t('projects.graph.emptyHint')}
          />
        ) : renderError !== null ? (
          <p className="backdrop-surface border border-border p-2 text-2xs text-destructive">
            {t('projects.graph.renderFailed')}: {renderError}
          </p>
        ) : svg === null ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <div className="backdrop-surface space-y-2 border border-border p-2">
            <div
              onClick={onClick}
              className="decision-map overflow-x-auto"
              // SVG de Mermaid en modo `strict`, con los títulos escapados.
              dangerouslySetInnerHTML={{ __html: svg }}
            />
            <Legend />
          </div>
        )}
      </div>
    </div>
  )
}

function Legend() {
  const t = useT()
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-2 text-2xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="w-6 border-t border-muted-foreground" />
        {t('projects.graph.legendRelated')}
      </span>
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="w-6 border-t border-dashed border-muted-foreground" />
        {t('projects.graph.legendSupersedes')}
      </span>
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="size-3 border border-dashed border-border-strong opacity-50" />
        {t('projects.graph.legendSuperseded')}
      </span>
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="size-3 border-2 border-warning" />
        {t('projects.graph.legendStale')}
      </span>
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="size-3 border border-dotted border-border-strong" />
        {t('projects.graph.legendExternal')}
      </span>
      <span className="ml-auto">{t('projects.graph.clickHint')}</span>
    </div>
  )
}
