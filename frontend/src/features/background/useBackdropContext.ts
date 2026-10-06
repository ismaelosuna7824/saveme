import { useQuery } from '@tanstack/react-query'
import { useRouterState } from '@tanstack/react-router'

import { api } from '@/api/client'
import { queryKeys } from '@/api/queries'
import type { SummaryDetail } from '@/api/types'
import { isDocumentPath } from '@/lib/background'

export interface BackdropContext {
  /** Proyecto de la pantalla actual, o `null` si no es de ningún proyecto. */
  project: string | null
  /** La pantalla enseña un documento (un resumen o una nota). */
  hasDocument: boolean
}

/**
 * De qué proyecto es la pantalla actual y si hay un documento delante.
 *
 * El proyecto sale de la ruta (`/p/<slug>/…`) o, en el editor (`/s/<id>`), del
 * resumen abierto. Para el resumen se lee la caché que ya llenó el editor, con
 * la consulta desactivada: así no se pide dos veces.
 */
export function useBackdropContext(): BackdropContext {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const projectMatch = /^\/p\/([^/]+)/.exec(pathname)
  const summaryMatch = /^\/s\/([^/]+)/.exec(pathname)
  const summaryId = summaryMatch ? decodeURIComponent(summaryMatch[1]) : ''

  const summary = useQuery({
    queryKey: queryKeys.summaries.detail(summaryId),
    queryFn: ({ signal }) => api.get<SummaryDetail>(`/summaries/${summaryId}`, signal),
    enabled: false,
  })

  const project = projectMatch
    ? decodeURIComponent(projectMatch[1])
    : summaryMatch
      ? (summary.data?.meta.project_slug || null)
      : null

  return { project, hasDocument: isDocumentPath(pathname) }
}
