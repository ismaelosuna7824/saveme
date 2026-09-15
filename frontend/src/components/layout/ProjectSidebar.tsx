import { Link, useRouterState } from '@tanstack/react-router'
import { Inbox, FolderGit2 } from 'lucide-react'

import { useProjects, useStats } from '@/api/queries'
import type { Project } from '@/api/types'
import { StatusDot } from '@/components/common/StatusDot'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { NotesTree } from '@/features/notes/NotesTree'
import { formatRelative } from '@/lib/format'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'

function ProjectLink({ project, active }: { project: Project; active: boolean }) {
  return (
    <Link
      to="/p/$project"
      params={{ project: project.slug }}
      className={cn(
        'flex items-center gap-2 border-l-2 px-3 py-1.5 transition-colors',
        active
          ? 'border-primary bg-accent text-primary'
          : 'border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground',
      )}
    >
      <StatusDot tone={project.total > 0 ? 'ok' : 'idle'} />
      <span className="min-w-0 flex-1 truncate text-xs">{project.name}</span>
      <span className="shrink-0 text-2xs text-muted-foreground">{project.total}</span>
    </Link>
  )
}

/** Navegación lateral: inbox + proyectos. */
export function ProjectSidebar() {
  const t = useT()
  const projects = useProjects()
  const stats = useStats()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const inInbox = pathname === '/'
  // El splat de la ruta `/notes/$` es la ruta de la nota abierta, para marcarla.
  const activeNotePath = pathname.startsWith('/notes/')
    ? decodeURIComponent(pathname.slice('/notes/'.length))
    : null

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-panel">
      <nav className="flex flex-col py-1">
        <Link
          to="/"
          className={cn(
            'flex items-center gap-2 border-l-2 px-3 py-1.5 text-xs transition-colors',
            inInbox
              ? 'border-primary bg-accent text-primary'
              : 'border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground',
          )}
        >
          <Inbox className="size-3.5" />
          <span className="flex-1">{t('shell.nav.inbox')}</span>
          {stats.data && stats.data.pending_proposals > 0 ? (
            <Badge variant="default">{stats.data.pending_proposals}</Badge>
          ) : null}
        </Link>
      </nav>

      {/* Las notas van arriba del todo: son lo que más se usa y no dependen de
          ningún proyecto. */}
      <div className="flex min-h-0 flex-[2] flex-col border-t border-border">
        <NotesTree activePath={activeNotePath} />
      </div>

      <div className="term-rule mx-3 mt-2 mb-1">
        <span className="text-muted-foreground">{t('shell.nav.projects')}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {projects.isLoading ? (
          <div className="space-y-1 px-3">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-4/5" />
            <Skeleton className="h-5 w-3/5" />
          </div>
        ) : null}

        {projects.data?.length === 0 ? (
          <p className="px-3 py-2 text-2xs text-muted-foreground">
            {t('shell.sidebar.empty')}
          </p>
        ) : null}

        {projects.data?.map((project) => (
          <ProjectLink
            key={project.slug}
            project={project}
            active={pathname.startsWith(`/p/${project.slug}`)}
          />
        ))}
      </div>

      <div className="border-t border-border px-3 py-2 text-2xs text-muted-foreground">
        {projects.data && projects.data.length > 0 ? (
          <span>
            <FolderGit2 className="mr-1 inline size-3 align-[-2px]" />
            {t('shell.sidebar.lastActivity', {
              when: formatRelative(
                projects.data.reduce<string | null>((latest, project) => {
                  if (!project.last_activity) return latest
                  if (!latest) return project.last_activity
                  return project.last_activity > latest ? project.last_activity : latest
                }, null),
              ),
            })}
          </span>
        ) : (
          <span>{t('shell.sidebar.waiting')}</span>
        )}
      </div>
    </aside>
  )
}
