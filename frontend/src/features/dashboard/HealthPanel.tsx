import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ChevronDown, ChevronRight, TriangleAlert } from 'lucide-react'

import { useJournalHealth } from '@/api/queries'
import type { ProjectHealth } from '@/api/types'
import { ProjectSprite } from '@/components/common/ProjectSprite'
import { SectionHeader } from '@/components/common/SectionHeader'
import { Skeleton } from '@/components/ui/skeleton'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'

function Metric({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: number
  hint: string
  tone: 'warn' | 'muted' | 'ok'
}) {
  return (
    <div className="border border-border bg-sunken px-2 py-1.5" title={hint}>
      {/* Sin mayúsculas ni espaciado: «desactualizados» no cabe en un tercio de la
          columna con el estilo de las métricas de arriba. */}
      <div className="truncate text-2xs leading-tight text-muted-foreground">{label}</div>
      <div
        className={cn(
          'text-base leading-tight',
          tone === 'warn' && value > 0 ? 'text-warning' : tone === 'muted' ? 'text-muted-foreground' : 'text-primary',
        )}
      >
        {value}
      </div>
    </div>
  )
}

/**
 * Salud del diario: lo que envejece sin avisar.
 *
 * Junta en un sitio lo que de otra forma solo se ve abriendo resumen por resumen:
 * los desactualizados (sus archivos siguieron cambiando), los que no dicen qué
 * archivos tocaron (no podrán avisar nunca) y los proyectos sin repo vinculado.
 * Cada proyecto con algo que mirar se despliega en la lista de lo que hay que
 * abrir: un número sin camino a lo que lo explica no ayuda a arreglarlo.
 */
export function HealthPanel() {
  const t = useT()
  const { data, isLoading, error } = useJournalHealth()

  const withIssues = (data?.projects ?? []).filter(
    (p) => p.stale.length > 0 || p.no_files.length > 0 || !p.repo_linked || (p.repo_linked && !p.repo_reachable),
  )

  return (
    <div className="space-y-2">
      <SectionHeader title={t('dashboard.health.title')} hint={t('dashboard.health.hint')} />

      {isLoading ? (
        <div className="grid grid-cols-3 gap-2">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      ) : error || !data ? (
        <p className="text-2xs text-destructive">{t('dashboard.health.error')}</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Metric
              label={t('dashboard.health.stale')}
              value={data.totals.stale}
              hint={t('dashboard.health.staleHint')}
              tone="warn"
            />
            <Metric
              label={t('dashboard.health.noFiles')}
              value={data.totals.no_files}
              hint={t('dashboard.health.noFilesHint')}
              tone="warn"
            />
            <Metric
              label={t('dashboard.health.noRepo')}
              value={data.totals.projects_without_repo}
              hint={t('dashboard.health.noRepoHint')}
              tone="warn"
            />
          </div>

          {!data.git_available ? (
            <p className="text-2xs text-muted-foreground">{t('dashboard.health.noGit')}</p>
          ) : null}

          {withIssues.length === 0 ? (
            <p className="text-2xs text-muted-foreground">{t('dashboard.health.allGood')}</p>
          ) : (
            <ul className="divide-y divide-border border border-border">
              {withIssues.map((project) => (
                <ProjectHealthRow key={project.slug} project={project} />
              ))}
            </ul>
          )}

          {data.totals.superseded > 0 ? (
            <p className="text-2xs text-muted-foreground" title={t('dashboard.health.supersededHint')}>
              {data.totals.superseded} {t('dashboard.health.superseded')}
            </p>
          ) : null}
        </>
      )}
    </div>
  )
}

function ProjectHealthRow({ project }: { project: ProjectHealth }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const expandable = project.stale.length > 0 || project.no_files.length > 0

  return (
    <li>
      <button
        type="button"
        disabled={!expandable}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={expandable ? open : undefined}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-2xs hover:bg-accent/40 disabled:hover:bg-transparent"
      >
        {expandable ? (
          open ? (
            <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
          )
        ) : (
          <span className="size-3 shrink-0" />
        )}
        <ProjectSprite slug={project.slug} className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-foreground">{project.name}</span>
        {project.stale.length > 0 ? (
          <span className="flex items-center gap-1 text-warning" title={t('dashboard.health.staleHint')}>
            <TriangleAlert className="size-3" />
            {project.stale.length}
          </span>
        ) : null}
        {project.no_files.length > 0 ? (
          <span className="text-muted-foreground" title={t('dashboard.health.noFilesHint')}>
            {project.no_files.length} {t('dashboard.health.noFiles')}
          </span>
        ) : null}
        {!project.repo_linked ? (
          <span className="text-muted-foreground" title={t('dashboard.health.noRepoHint')}>
            {t('dashboard.health.noRepo')}
          </span>
        ) : !project.repo_reachable ? (
          <span className="text-muted-foreground" title={t('dashboard.health.repoMovedHint')}>
            {t('dashboard.health.repoMoved')}
          </span>
        ) : null}
      </button>

      {open ? (
        <ul className="space-y-0.5 border-t border-border bg-sunken px-2 py-1.5 text-2xs">
          {project.stale.map((item) => (
            <li key={item.id} className="flex items-center gap-1.5">
              <TriangleAlert className="size-3 shrink-0 text-warning" />
              <Link to="/s/$id" params={{ id: item.id }} className="min-w-0 flex-1 truncate hover:text-primary">
                {item.title}
              </Link>
              <span className="shrink-0 text-muted-foreground">
                {t('dashboard.health.commits', { count: item.count ?? 0 })}
              </span>
            </li>
          ))}
          {project.no_files.map((item) => (
            <li key={item.id} className="flex items-center gap-1.5 text-muted-foreground">
              <span className="size-3 shrink-0" />
              <Link to="/s/$id" params={{ id: item.id }} className="min-w-0 flex-1 truncate hover:text-primary">
                {item.title}
              </Link>
              <span className="shrink-0">{t('dashboard.health.noFiles')}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  )
}
