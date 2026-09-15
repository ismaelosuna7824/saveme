import { useMemo } from 'react'
import { useRouterState } from '@tanstack/react-router'

import { useCategories, useProjects } from '@/api/queries'
import { useT } from '@/i18n'

export interface Crumb {
  label: string
  /** Ruta absoluta. La última miga no lleva destino. */
  href?: string
}

/**
 * Migas de pan derivadas de la URL. Los nombres de proyecto y las etiquetas de
 * categoría se resuelven contra las consultas ya cacheadas, así que no hay
 * peticiones extra.
 */
export function useBreadcrumbs(): Crumb[] {
  const t = useT()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const projects = useProjects().data
  const categories = useCategories().data

  return useMemo(() => {
    const segments = pathname.split('/').filter((segment) => segment.length > 0)
    // `saveme` es el nombre del producto: no se traduce.
    const crumbs: Crumb[] = [{ label: 'saveme', href: '/' }]

    if (segments[0] === 'p' && segments[1]) {
      const slug = decodeURIComponent(segments[1])
      const project = projects?.find((candidate) => candidate.slug === slug)
      crumbs.push({ label: project?.name ?? slug, href: `/p/${slug}` })

      if (segments[2]) {
        const key = decodeURIComponent(segments[2])
        const category = categories?.find((candidate) => candidate.key === key)
        crumbs.push({ label: category?.label ?? key, href: `/p/${slug}/${key}` })
      }
    } else if (segments[0] === 's' && segments[1]) {
      crumbs.push({
        label: t('shell.breadcrumbs.summary', {
          id: decodeURIComponent(segments[1]).slice(0, 10),
        }),
      })
    } else {
      crumbs.push({ label: t('shell.nav.inbox') })
    }

    // La última miga no navega a ningún sitio.
    const last = crumbs[crumbs.length - 1]
    delete last.href
    return crumbs
  }, [pathname, projects, categories, t])
}
