import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { summaryQuery } from '@/api/queries'
import { isDocumentPath } from '@/lib/background'
import { useShownPathname } from '@/lib/hooks'

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
 * resumen abierto. Para el resumen se lee la caché que ya llenó la ruta, con la
 * consulta desactivada: así no se pide dos veces.
 *
 * Se mira la ruta **pintada**, no la de destino: mientras el `loader` del
 * resumen trae sus datos, la de destino todavía no sabe de qué proyecto es, y el
 * fondo saltaría al global y volvería al del proyecto.
 */
export function useBackdropContext(): BackdropContext {
  const pathname = useShownPathname()
  const projectMatch = /^\/p\/([^/]+)/.exec(pathname)
  const summaryMatch = /^\/s\/([^/]+)/.exec(pathname)
  const summaryId = summaryMatch ? decodeURIComponent(summaryMatch[1]) : ''

  const summary = useQuery({ ...summaryQuery(summaryId), enabled: false })

  // `undefined`: un resumen que aún no está en caché (su `loader` tardó más de
  // la cuenta). Hasta saber de qué proyecto es, se sigue con el fondo de antes.
  const known = projectMatch
    ? decodeURIComponent(projectMatch[1])
    : summaryMatch
      ? summary.data === undefined
        ? undefined
        : summary.data.meta.project_slug || null
      : null
  const [lastProject, setLastProject] = useState<string | null>(known ?? null)
  if (known !== undefined && known !== lastProject) setLastProject(known)

  return { project: known === undefined ? lastProject : known, hasDocument: isDocumentPath(pathname) }
}
