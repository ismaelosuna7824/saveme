import { useState } from 'react'

import { useActivity, useBriefing } from '@/api/queries'
import { ErrorPanel } from '@/components/common/ErrorPanel'
import { SectionHeader } from '@/components/common/SectionHeader'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ActivityHeatmap } from '@/features/projects/ActivityHeatmap'
import { BriefingPanel } from '@/features/projects/BriefingPanel'
import { useT } from '@/i18n'

/** Las ventanas que se ofrecen. El núcleo acota por su cuenta si le llegara otra. */
const VENTANAS = [
  { days: 90, key: 'projects.activity.window.quarter' },
  { days: 180, key: 'projects.activity.window.half' },
  { days: 365, key: 'projects.activity.window.year' },
] as const

/**
 * «Pulso» de un proyecto: dónde se dejó y cómo ha ido.
 *
 * Junta las dos formas de mirar el mismo diario —qué pasó al final y cómo se
 * reparte en el tiempo— porque separadas obligan a saltar entre pantallas para
 * responder una sola pregunta. Va fuera de las pestañas de categoría a propósito:
 * esas navegan por el **tema** de cada resumen, y esto mira por **fecha**, que es
 * otro eje.
 */
export function ProjectActivity({ slug }: { slug: string }) {
  const t = useT()
  const [dias, setDias] = useState<number>(365)
  const briefing = useBriefing(slug, dias)
  const activity = useActivity(slug, dias)

  return (
    <div className="h-full overflow-y-auto">
      <div className="space-y-5 p-3">
        <section className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <SectionHeader
              title={t('projects.activity.title')}
              hint={
                activity.data
                  ? t('projects.activity.hint', {
                      count: activity.data.total,
                      active: activity.data.active,
                      days: activity.data.days,
                    })
                  : t('common.state.loading')
              }
            />
            <div className="ml-auto flex items-center gap-1">
              {VENTANAS.map((ventana) => (
                <Button
                  key={ventana.days}
                  variant={ventana.days === dias ? 'outline' : 'ghost'}
                  size="sm"
                  onClick={() => setDias(ventana.days)}
                >
                  {t(ventana.key)}
                </Button>
              ))}
            </div>
          </div>

          {activity.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : activity.error ? (
            <ErrorPanel
              error={activity.error}
              title={t('projects.activity.loadFailed')}
              onRetry={() => void activity.refetch()}
            />
          ) : activity.data ? (
            <div className="border border-border bg-panel px-2 py-2">
              <ActivityHeatmap data={activity.data} />
            </div>
          ) : null}
        </section>

        {briefing.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : briefing.error ? (
          <ErrorPanel
            error={briefing.error}
            title={t('projects.briefing.loadFailed')}
            onRetry={() => void briefing.refetch()}
          />
        ) : briefing.data ? (
          <BriefingPanel data={briefing.data} />
        ) : null}
      </div>
    </div>
  )
}
