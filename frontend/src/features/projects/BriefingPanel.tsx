import { Link } from '@tanstack/react-router'
import { Clock, FileCode2, Inbox } from 'lucide-react'

import type { Briefing } from '@/api/types'
import { CategoryBadge } from '@/components/common/CategoryBadge'
import { EmptyState } from '@/components/common/EmptyState'
import { SectionHeader } from '@/components/common/SectionHeader'
import { Badge } from '@/components/ui/badge'
import { formatDateTime, formatRelative } from '@/lib/format'
import { useT } from '@/i18n'

/**
 * «¿Dónde lo dejamos?»
 *
 * Es la pantalla que contesta la pregunta que uno se hace al volver a un proyecto
 * después de dos semanas: qué pasó al final, por dónde se anduvo y qué quedó
 * esperando. Los tres bloques van en ese orden porque es el orden en que se
 * necesitan: primero el hilo, luego el sitio, luego lo que reclama una decisión.
 *
 * Los resúmenes recientes se pintan como una **línea temporal** y no como la lista
 * del proyecto: aquí lo que importa es cuándo pasó cada cosa, y eso se lee mejor
 * con una guía vertical que con filas sueltas.
 */
export function BriefingPanel({ data }: { data: Briefing }) {
  const t = useT()

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <SectionHeader
          title={t('projects.briefing.lastTitle')}
          hint={t('projects.briefing.lastHint', {
            count: data.total,
            days: data.days,
            active: data.active_days,
          })}
        />

        {data.last.length === 0 ? (
          <EmptyState
            icon={<Clock className="size-4" />}
            title={t('projects.briefing.emptyTitle', { days: data.days })}
            hint={t('projects.briefing.emptyHint')}
          />
        ) : (
          <ol className="relative space-y-2 border-l border-border pl-3">
            {data.last.map((entrada) => (
              <li key={entrada.id} className="relative">
                {/* El punto sobre la guía: marca el día sin ocupar espacio. */}
                <span
                  aria-hidden
                  className="absolute top-1.5 -left-[17px] size-1.5 rounded-full bg-primary"
                />
                <Link
                  to="/s/$id"
                  params={{ id: entrada.id }}
                  className="block transition-colors hover:text-primary"
                >
                  <span className="flex flex-wrap items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                      {entrada.title}
                    </span>
                    <CategoryBadge category={entrada.category} />
                    <span
                      className="shrink-0 text-2xs text-muted-foreground"
                      title={formatDateTime(entrada.created_at)}
                    >
                      {formatRelative(entrada.created_at)}
                    </span>
                  </span>
                  {entrada.summary_line.length > 0 ? (
                    <span className="mt-0.5 line-clamp-2 block text-2xs text-muted-foreground">
                      {entrada.summary_line}
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ol>
        )}
      </section>

      {data.files.length > 0 ? (
        <section className="space-y-2">
          <SectionHeader
            title={t('projects.briefing.filesTitle')}
            hint={t('projects.briefing.filesHint', { days: data.days })}
          />
          <div className="flex flex-wrap gap-1.5">
            {data.files.map((archivo) => (
              <span
                key={archivo.path}
                // El título lleva la ruta entera: en pantalla se recorta y lo que
                // importa de un archivo suele ser el final del camino.
                title={`${archivo.path} · ${formatDateTime(archivo.last_at)}`}
                className="flex max-w-full items-center gap-1.5 border border-border bg-panel px-1.5 py-0.5 text-2xs"
              >
                <FileCode2 className="size-3 shrink-0 text-muted-foreground" />
                <code className="min-w-0 truncate text-foreground">{archivo.path}</code>
                <span className="shrink-0 text-muted-foreground">×{archivo.count}</span>
              </span>
            ))}
          </div>
        </section>
      ) : null}

      <section className="space-y-2">
        <SectionHeader
          title={t('projects.briefing.pendingTitle')}
          hint={t('projects.briefing.pendingHint')}
        />
        {data.pending.length === 0 ? (
          <p className="text-2xs text-muted-foreground">{t('projects.briefing.noPending')}</p>
        ) : (
          <ul className="space-y-1">
            {data.pending.map((propuesta) => (
              <li key={propuesta.token}>
                <Link
                  to="/"
                  className="flex flex-wrap items-baseline gap-2 border border-border bg-panel px-2 py-1 transition-colors hover:bg-accent/40"
                >
                  <Inbox className="size-3 shrink-0 self-center text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                    {propuesta.title}
                  </span>
                  <CategoryBadge category={propuesta.category} />
                  {/* Una propuesta vencida es una que nadie resolvió a tiempo: es
                      justo lo que hay que mirar al volver, así que se distingue. */}
                  {propuesta.status === 'expired' ? (
                    <Badge variant="destructive">{t('projects.briefing.expired')}</Badge>
                  ) : (
                    <Badge variant="outline">{propuesta.agent ?? 'agent'}</Badge>
                  )}
                  <span className="shrink-0 text-2xs text-muted-foreground">
                    {formatRelative(propuesta.created_at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
