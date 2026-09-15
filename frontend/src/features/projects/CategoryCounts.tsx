import { useT } from '@/i18n'
import { categoryLabel } from '@/lib/labels'

import type { Project } from '@/api/types'
import { asCounts } from '@/api/normalize'
import { useCategoryLookup } from '@/components/common/CategoryBadge'

/**
 * Clave del core → clave de traducción.
 *
 * El core manda la categoría como clave (`feature`, `fix`…) y su `label` viene
 * del servidor; el texto que se muestra sale de `projects.category.*`. Este mapa
 * es el único sitio donde vive esa correspondencia. Idealmente
 * `components/common/CategoryBadge.tsx` y `StatusBadge.tsx` leerían de las
 * mismas claves (`projects.category.*`, `projects.status.*`) y el etiquetado no
 * quedaría repartido en dos sitios.
 */
/**
 * Etiqueta de una categoría.
 *
 * Traduce las claves conocidas y, para una categoría que el core añada y aquí
 * todavía no exista, cae al `label` que manda el servidor.
 */
/**
 * El mapeo vive en `@/lib/labels` para que los badges de `components/common` y
 * estas pantallas no mantengan dos listas que se desincronizan. Se reexporta
 * porque ya había consumidores importándolo de aquí.
 */
// `export ... from` no crea un enlace local, así que hay que importarlo además de
// reexportarlo: dentro de este módulo se usa, y fuera ya lo usaban otros.
export { categoryLabel }

/** Distribución por categoría de un proyecto, en una línea compacta. */
export function CategoryCounts({ project, max = 4 }: { project: Project; max?: number }) {
  const t = useT()
  const lookup = useCategoryLookup()

  const entries = Object.entries(asCounts(project.counts))
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])

  if (entries.length === 0) {
    return <span className="text-2xs text-muted-foreground">{t('projects.counts.none')}</span>
  }

  return (
    <span className="flex flex-wrap items-center gap-1">
      {entries.slice(0, max).map(([category, count]) => {
        const label = categoryLabel(t, category, lookup(category)?.label)
        return (
          <span
            key={category}
            className="border border-border bg-sunken px-1 text-2xs text-muted-foreground"
            title={t('projects.counts.entry', { count, category: label })}
          >
            {label} <span className="text-primary">{count}</span>
          </span>
        )
      })}
      {entries.length > max ? (
        <span className="text-2xs text-muted-foreground">
          {t('projects.counts.more', { count: entries.length - max })}
        </span>
      ) : null}
    </span>
  )
}
