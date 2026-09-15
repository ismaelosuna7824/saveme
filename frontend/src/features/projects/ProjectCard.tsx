import { Link } from '@tanstack/react-router'
import { FolderGit2 } from 'lucide-react'

import { useT } from '@/i18n'

import type { Project } from '@/api/types'
import { StatusDot } from '@/components/common/StatusDot'
import { CategoryCounts } from '@/features/projects/CategoryCounts'
import { formatRelative } from '@/lib/format'

/** Ficha de proyecto: ruta en disco, total, reparto por categoría y actividad. */
export function ProjectCard({ project }: { project: Project }) {
  const t = useT()

  return (
    <Link
      to="/p/$project"
      params={{ project: project.slug }}
      className="block border border-border bg-panel px-2.5 py-2 transition-colors hover:border-border-strong hover:bg-accent/40"
    >
      <div className="flex items-center gap-2">
        <StatusDot tone={project.total > 0 ? 'ok' : 'idle'} />
        <span className="min-w-0 flex-1 truncate text-xs text-foreground">{project.name}</span>
        <span className="shrink-0 text-2xs text-primary">{project.total}</span>
      </div>
      <div className="mt-1 flex items-center gap-1 text-2xs text-muted-foreground">
        <FolderGit2 className="size-3 shrink-0" />
        <code className="truncate" title={project.path}>
          {project.path}
        </code>
      </div>
      <div className="mt-1.5">
        <CategoryCounts project={project} />
      </div>
      <div className="mt-1 text-2xs text-muted-foreground">
        {t('projects.lastActivity')}: {formatRelative(project.last_activity)}
      </div>
    </Link>
  )
}
