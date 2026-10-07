import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { CircleCheck, GitCommitHorizontal, History } from 'lucide-react'
import { toast } from 'sonner'

import { errorMessage } from '@/api/client'
import { projectTimelineQuery } from '@/api/queries'
import type { SummaryMeta, TimelineCommit } from '@/api/types'
import { CategoryBadge } from '@/components/common/CategoryBadge'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorPanel } from '@/components/common/ErrorPanel'
import { SectionHeader } from '@/components/common/SectionHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { activeLocaleTag, useT } from '@/i18n'
import { formatDateTime } from '@/lib/format'
import { openExternal } from '@/lib/openExternal'

type Filter = 'all' | 'summaries' | 'undocumented'

type Entry =
  | { kind: 'summary'; when: string; summary: SummaryMeta }
  | { kind: 'commit'; when: string; commit: TimelineCommit }

/**
 * Línea de tiempo de un proyecto: sus resúmenes y los commits del repo
 * vinculado, juntos y por meses.
 *
 * El pulso dice **cuánto** se trabajó; esto dice **qué** y en qué orden. Cruzar
 * los commits con los resúmenes deja ver lo que no quedó escrito: un commit que
 * ningún resumen apunta sale marcado «sin resumen», y el filtro los deja solos.
 * Lo sustituido sale tachado: sigue siendo historia, pero se ve dónde se cortó.
 */
export function ProjectTimelineView({ slug }: { slug: string }) {
  const t = useT()
  const timeline = useQuery(projectTimelineQuery(slug))
  const [filter, setFilter] = useState<Filter>('all')
  const data = timeline.data

  const titles = useMemo(() => new Map((data?.summaries ?? []).map((s) => [s.id, s.title])), [data])

  const months = useMemo(() => {
    if (!data) return []
    const entries: Entry[] = []
    if (filter !== 'undocumented') {
      for (const summary of data.summaries) entries.push({ kind: 'summary', when: summary.created_at, summary })
    }
    if (filter !== 'summaries') {
      for (const commit of data.commits) {
        if (filter === 'undocumented' && commit.documented_by) continue
        entries.push({ kind: 'commit', when: commit.when, commit })
      }
    }
    // Por instante y no por texto: los commits llegan con su huso (`-07:00`) y
    // los resúmenes en UTC, y comparar las cadenas los desordena.
    entries.sort((a, b) => Date.parse(b.when) - Date.parse(a.when))

    // Por mes en hora local, del más reciente al más antiguo.
    const groups: { key: string; label: string; entries: Entry[] }[] = []
    const formatter = new Intl.DateTimeFormat(activeLocaleTag(), { month: 'long', year: 'numeric' })
    for (const entry of entries) {
      const date = new Date(entry.when)
      const key = `${date.getFullYear()}-${date.getMonth()}`
      let group = groups[groups.length - 1]
      if (group?.key !== key) {
        group = { key, label: formatter.format(date), entries: [] }
        groups.push(group)
      }
      group.entries.push(entry)
    }
    return groups
  }, [data, filter])

  const undocumented = data?.commits.filter((c) => !c.documented_by).length ?? 0

  return (
    <div className="h-full overflow-y-auto">
      <div className="space-y-3 p-3">
        <div className="backdrop-surface space-y-2 border border-border p-2">
          <div className="flex flex-wrap items-center gap-2">
            <SectionHeader
              title={t('projects.timeline.title')}
              hint={
                data
                  ? t('projects.timeline.hint', { summaries: data.summaries.length, commits: data.commits.length })
                  : t('common.state.loading')
              }
            />
            <div className="ml-auto flex items-center gap-1">
              <Button size="sm" variant={filter === 'all' ? 'outline' : 'ghost'} onClick={() => setFilter('all')}>
                {t('projects.timeline.filterAll')}
              </Button>
              <Button
                size="sm"
                variant={filter === 'summaries' ? 'outline' : 'ghost'}
                onClick={() => setFilter('summaries')}
              >
                {t('projects.timeline.filterSummaries')}
              </Button>
              {data?.repo === 'linked' ? (
                <Button
                  size="sm"
                  variant={filter === 'undocumented' ? 'outline' : 'ghost'}
                  onClick={() => setFilter('undocumented')}
                >
                  {t('projects.timeline.filterUndocumented')}
                  <span className="text-muted-foreground">{undocumented}</span>
                </Button>
              ) : null}
            </div>
          </div>
          {data?.repo === 'no_repo' ? (
            <p className="text-2xs text-muted-foreground">{t('projects.timeline.noRepo')}</p>
          ) : data?.repo === 'repo_moved' ? (
            <p className="text-2xs text-muted-foreground">{t('projects.timeline.repoMoved')}</p>
          ) : null}
        </div>

        {timeline.isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : timeline.error ? (
          <ErrorPanel
            error={timeline.error}
            title={t('projects.timeline.loadFailed')}
            onRetry={() => void timeline.refetch()}
          />
        ) : months.length === 0 ? (
          <EmptyState icon={<History className="size-4" />} title={t('projects.timeline.empty')} />
        ) : (
          months.map((month) => (
            <section key={month.key} className="backdrop-surface border border-border p-2">
              <h3 className="mb-2 text-2xs uppercase tracking-[0.14em] text-muted-foreground">{month.label}</h3>
              <ol className="relative space-y-1.5 border-l border-border pl-4">
                {month.entries.map((entry) =>
                  entry.kind === 'summary' ? (
                    <SummaryEntry key={`s-${entry.summary.id}`} summary={entry.summary} />
                  ) : (
                    <CommitEntry
                      key={`c-${entry.commit.sha}`}
                      commit={entry.commit}
                      documentedTitle={entry.commit.documented_by ? titles.get(entry.commit.documented_by) : undefined}
                    />
                  ),
                )}
              </ol>
            </section>
          ))
        )}
      </div>
    </div>
  )
}

function SummaryEntry({ summary }: { summary: SummaryMeta }) {
  const t = useT()
  const superseded = Boolean(summary.superseded_by)
  return (
    <li className="relative">
      <span aria-hidden className="absolute top-2 -left-[21px] size-2 rounded-full border border-background bg-primary" />
      <Link
        to="/s/$id"
        params={{ id: summary.id }}
        className="block border border-border bg-panel px-2 py-1.5 transition-colors hover:bg-accent/40"
      >
        <span className="flex flex-wrap items-baseline gap-2">
          <span
            className={
              superseded
                ? 'min-w-0 flex-1 truncate text-xs text-muted-foreground line-through'
                : 'min-w-0 flex-1 truncate text-xs text-foreground'
            }
          >
            {summary.title}
          </span>
          {superseded ? <Badge variant="muted">{t('projects.timeline.supersededBy')}</Badge> : null}
          <CategoryBadge category={summary.category} />
          <span className="shrink-0 text-2xs text-muted-foreground">{formatDateTime(summary.created_at)}</span>
        </span>
        {summary.summary_line.length > 0 ? (
          <span className="mt-0.5 line-clamp-2 block text-2xs text-muted-foreground">{summary.summary_line}</span>
        ) : null}
      </Link>
    </li>
  )
}

function CommitEntry({ commit, documentedTitle }: { commit: TimelineCommit; documentedTitle?: string }) {
  const t = useT()
  const documented = commit.documented_by !== undefined && commit.documented_by !== ''
  const url = commit.url
  return (
    <li className="relative flex items-center gap-2 py-0.5 text-2xs">
      <span
        aria-hidden
        className={
          documented
            ? 'absolute -left-[19px] size-1.5 rounded-full bg-muted-foreground'
            : 'absolute -left-[19px] size-1.5 rounded-full bg-warning'
        }
      />
      <GitCommitHorizontal className="size-3 shrink-0 text-muted-foreground" />
      {url ? (
        <button
          type="button"
          title={t('projects.timeline.openCommit')}
          className="shrink-0 font-mono text-secondary hover:text-primary hover:underline"
          onClick={() => {
            openExternal(url).catch((error: unknown) =>
              toast.error(t('projects.timeline.openCommit'), { description: errorMessage(error) }),
            )
          }}
        >
          {commit.sha.slice(0, 7)}
        </button>
      ) : (
        <code className="shrink-0 text-muted-foreground">{commit.sha.slice(0, 7)}</code>
      )}
      <span className="min-w-0 flex-1 truncate text-foreground">{commit.subject}</span>
      {documented ? (
        <Link
          to="/s/$id"
          params={{ id: commit.documented_by ?? '' }}
          className="flex shrink-0 items-center gap-1 text-muted-foreground hover:text-primary"
          title={documentedTitle}
        >
          <CircleCheck className="size-3" />
          {t('projects.timeline.documented')}
        </Link>
      ) : (
        <span className="shrink-0 text-warning">{t('projects.timeline.undocumented')}</span>
      )}
      <span className="shrink-0 text-muted-foreground">{formatDateTime(commit.when)}</span>
    </li>
  )
}
