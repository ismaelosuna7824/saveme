import { useMemo, useState } from 'react'
import { Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import { Copy, FolderGit2, TriangleAlert, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { errorMessage } from '@/api/client'
import { useDeleteProject } from '@/api/queries'
import { useT } from '@/i18n'

import { useCategories } from '@/api/queries'
import { useProject } from '@/api/queries'
import { asCounts } from '@/api/normalize'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorPanel } from '@/components/common/ErrorPanel'
import { StatusDot } from '@/components/common/StatusDot'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { categoryLabel } from '@/features/projects/CategoryCounts'
import { copyToClipboard } from '@/lib/hooks'
import { formatRelative } from '@/lib/format'

interface ProjectLayoutProps {
  slug: string
}

/**
 * Marco de un proyecto: cabecera + pestañas de categoría.
 *
 * El contenido lo pone la ruta hija (`/p/$project` para el resumen general,
 * `/p/$project/$category` para una categoría concreta), así que las pestañas
 * son enlaces reales: se puede deep-linkear cualquier categoría.
 */
export function ProjectLayout({ slug }: ProjectLayoutProps) {
  const t = useT()
  const { project, isLoading, error, refetch } = useProject(slug)
  const categories = useCategories()
  const navigate = useNavigate()
  const removeProject = useDeleteProject()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const pathname = useRouterState({ select: (state) => state.location.pathname })

  const activeCategory = useMemo(() => {
    const parts = pathname.split('/').filter((part) => part.length > 0)
    return parts[0] === 'p' && parts[2] ? decodeURIComponent(parts[2]) : 'todas'
  }, [pathname])

  const tabs = useMemo(() => {
    const counts = asCounts(project?.counts)
    const list = (categories.data ?? [])
      .filter((category) => category.key !== 'uncategorized')
      .map((category) => ({
        key: category.key,
        label: categoryLabel(t, category.key, category.label),
        count: counts[category.key] ?? 0,
      }))
    const uncategorized = counts['uncategorized'] ?? 0
    if (uncategorized > 0) {
      list.push({
        key: 'uncategorized',
        label: categoryLabel(t, 'uncategorized'),
        count: uncategorized,
      })
    }
    return list
  }, [categories.data, project, t])

  const goToCategory = (key: string) => {
    if (key === 'todas') {
      void navigate({ to: '/p/$project', params: { project: slug } })
      return
    }
    void navigate({ to: '/p/$project/$category', params: { project: slug, category: key } })
  }

  const copyPath = async () => {
    if (!project) return
    const ok = await copyToClipboard(project.path)
    if (ok) toast.success(t('projects.path.copied'), { description: project.path })
    else toast.error(t('projects.path.copyFailed'))
  }

  if (isLoading) {
    return (
      <div className="space-y-3 p-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-3">
        <ErrorPanel error={error} title={t('projects.loadFailed')} onRetry={refetch} />
      </div>
    )
  }

  if (!project) {
    return (
      <div className="p-4">
        <EmptyState
          icon={<TriangleAlert className="size-4" />}
          title={t('projects.notFound.title', { slug })}
          hint={t('projects.notFound.hint')}
        />
      </div>
    )
  }

  const confirmDeleteProject = () => {
    removeProject.mutate(project.slug, {
      onSuccess: () => {
        setConfirmDelete(false)
        toast.success(t('projects.delete.done'), { description: project.slug })
        // El proyecto ya no existe: la portada es el único sitio coherente.
        void navigate({ to: '/' })
      },
      onError: (error) =>
        toast.error(t('projects.delete.failed'), { description: errorMessage(error) }),
    })
  }

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 border-b border-border px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusDot tone={project.total > 0 ? 'ok' : 'idle'} />
          <h1 className="text-sm text-primary">{project.name}</h1>
          <code className="text-2xs text-muted-foreground">{project.slug}</code>
          <span className="text-2xs text-muted-foreground">
            · {t('projects.summaryCount', { count: project.total })}
          </span>
          <span className="text-2xs text-muted-foreground">
            · {t('projects.lastActivity')} {formatRelative(project.last_activity)}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => void copyPath()}
              title={t('projects.path.copy')}
              aria-label={t('projects.path.copy')}
            >
              <Copy className="size-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setConfirmDelete(true)}
              title={t('projects.delete.action')}
              aria-label={t('projects.delete.action')}
            >
              <Trash2 className="size-3" />
            </Button>
          </div>
        </div>
        <div className="mt-0.5 flex items-center gap-1 text-2xs text-muted-foreground">
          <FolderGit2 className="size-3 shrink-0" />
          <code className="truncate" title={project.path}>
            {project.path}
          </code>
        </div>
      </header>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('projects.delete.title', { name: project.name })}
        description={t('projects.delete.description', { count: project.total })}
        confirmLabel={t('projects.delete.action')}
        destructive
        pending={removeProject.isPending}
        onConfirm={confirmDeleteProject}
      />

      <div className="shrink-0 px-3 pt-2">
        <Tabs value={activeCategory} onValueChange={goToCategory}>
          <TabsList>
            <TabsTrigger value="todas">
              {t('projects.tabs.all')}
              <span className="text-muted-foreground">{project.total}</span>
            </TabsTrigger>
            {tabs.map((tab) => (
              <TabsTrigger key={tab.key} value={tab.key}>
                {tab.label}
                <span className={tab.count > 0 ? 'text-muted-foreground' : 'text-border-strong'}>
                  {tab.count}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <Outlet />
      </div>
    </div>
  )
}
