import { useStats } from '@/api/queries'
import { CategoryBadge } from '@/components/common/CategoryBadge'
import { SectionHeader } from '@/components/common/SectionHeader'
import { Skeleton } from '@/components/ui/skeleton'
import { useT } from '@/i18n'

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="border border-border bg-sunken px-2 py-1.5">
      <div className="text-2xs uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
      <div className="text-base leading-tight text-primary">{value}</div>
    </div>
  )
}

/** Estado global del workspace: totales y reparto por categoría. */
export function StatsPanel() {
  const t = useT()
  const { data, isLoading, error } = useStats()
  const byCategory = Object.entries(data?.by_category ?? {})
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
  const max = byCategory.reduce((top, [, count]) => Math.max(top, count), 0)

  return (
    <div className="space-y-2">
      <SectionHeader title={t('dashboard.stats.title')} hint={t('dashboard.stats.hint')} />

      {isLoading ? (
        <div className="grid grid-cols-3 gap-2">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      ) : error ? (
        <p className="text-2xs text-destructive">
          {t('dashboard.stats.error', {
            message: error instanceof Error ? error.message : t('common.state.error'),
          })}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Metric label={t('dashboard.stats.projects')} value={data?.projects ?? 0} />
            <Metric label={t('dashboard.stats.summaries')} value={data?.summaries ?? 0} />
            <Metric label={t('dashboard.stats.pending')} value={data?.pending_proposals ?? 0} />
          </div>

          {byCategory.length > 0 ? (
            <ul className="space-y-1">
              {byCategory.map(([category, count]) => (
                <li key={category} className="flex items-center gap-2">
                  <CategoryBadge category={category} className="w-20 shrink-0 justify-center" />
                  <span
                    aria-hidden
                    className="h-2 bg-primary/35"
                    style={{ width: `${max > 0 ? Math.max(4, (count / max) * 100) : 0}%` }}
                  />
                  <span className="ml-auto text-2xs text-muted-foreground">{count}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-2xs text-muted-foreground">
              {t('dashboard.stats.empty')}
            </p>
          )}
        </>
      )}
    </div>
  )
}
