import { useMemo } from 'react'
import { Tags } from 'lucide-react'

import { useTags } from '@/api/queries'
import { TagLink } from '@/components/common/TagLink'
import { useT } from '@/i18n'

/**
 * Todas las etiquetas del diario, con cuántas veces se ha usado cada una.
 *
 * Las etiquetas se pintan repartidas en cada resumen, pero no había ningún sitio
 * donde ver el conjunto: cuáles existen, cuáles se usan de verdad y cuáles se
 * quedaron en un intento. Y son la única forma de cortar el diario por un eje que
 * no sea el proyecto o la categoría.
 *
 * Se ordenan por uso y no alfabéticamente: lo que interesa de un vistazo es qué
 * temas dominan, y una lista alfabética esconde eso.
 */
export function TagsPanel() {
  const t = useT()
  const { data, isPending } = useTags()

  const etiquetas = useMemo(() => {
    const entradas = Object.entries(data ?? {})
    // Desempate alfabético para que dos etiquetas con la misma cuenta no bailen
    // de posición entre renders.
    entradas.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    return entradas
  }, [data])

  // Mientras carga no se pinta nada: un hueco con un esqueleto en un panel
  // pequeño se nota más que la aparición del propio panel.
  if (isPending) return null

  return (
    <section className="space-y-1 border border-border bg-panel px-2 py-2">
      <div className="flex items-center gap-2">
        <Tags className="size-3 shrink-0 text-accent" />
        <span className="text-2xs uppercase tracking-[0.14em] text-muted-foreground">
          {t('inbox.tags.title')}
        </span>
        {etiquetas.length > 0 ? (
          <span className="text-2xs text-muted-foreground">
            {t('inbox.tags.count', { count: etiquetas.length })}
          </span>
        ) : null}
      </div>

      {etiquetas.length === 0 ? (
        <p className="text-2xs text-muted-foreground">{t('inbox.tags.empty')}</p>
      ) : (
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          {etiquetas.map(([tag, count]) => (
            <span key={tag} className="inline-flex items-baseline gap-1">
              <TagLink tag={tag} />
              <span className="text-2xs text-muted-foreground">{count}</span>
            </span>
          ))}
        </div>
      )}
    </section>
  )
}
