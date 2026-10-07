import { Link } from '@tanstack/react-router'
import { CornerDownRight, CornerUpLeft } from 'lucide-react'
import type { ReactNode } from 'react'

import { useSummaryLinks } from '@/api/queries'
import type { SummaryMeta } from '@/api/types'
import { useT } from '@/i18n'

interface SummaryLinksRowProps {
  id: string
}

/**
 * Fila de la barra del editor con los resúmenes enlazados: los que este nombra
 * en su `related` y los que lo nombran a él.
 *
 * Los datos los precarga el loader de `/s/$id`, así que la fila aparece con el
 * editor y no después. Si no hay enlaces en ningún sentido no se pinta nada: una
 * fila vacía solo restaría alto al documento.
 */
export function SummaryLinksRow({ id }: SummaryLinksRowProps) {
  const t = useT()
  const links = useSummaryLinks(id).data
  const related = links?.related ?? []
  const backlinks = links?.backlinks ?? []
  if (related.length === 0 && backlinks.length === 0) return null

  return (
    <nav
      aria-label={t('editor.links.label')}
      className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 pb-1.5 text-2xs text-muted-foreground"
    >
      {related.length > 0 ? (
        <LinkGroup icon={<CornerDownRight className="size-3 shrink-0" />} label={t('editor.links.related')}>
          {related.map((meta) => (
            <SummaryLink key={meta.id} meta={meta} />
          ))}
        </LinkGroup>
      ) : null}
      {backlinks.length > 0 ? (
        <LinkGroup icon={<CornerUpLeft className="size-3 shrink-0" />} label={t('editor.links.backlinks')}>
          {backlinks.map((meta) => (
            <SummaryLink key={meta.id} meta={meta} />
          ))}
        </LinkGroup>
      ) : null}
    </nav>
  )
}

function LinkGroup({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
      {icon}
      <span>{label}:</span>
      {children}
    </span>
  )
}

/**
 * Enlace a otro resumen por su título. `Link` y no un botón: con el `preload`
 * por intención del router, pasar el ratón por encima ya carga el destino.
 */
function SummaryLink({ meta }: { meta: SummaryMeta }) {
  return (
    <Link
      to="/s/$id"
      params={{ id: meta.id }}
      title={meta.rel_path}
      className="max-w-64 truncate text-secondary underline-offset-2 transition-colors hover:text-primary hover:underline"
    >
      {meta.title}
    </Link>
  )
}
