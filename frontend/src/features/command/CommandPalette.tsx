import { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import {
  Columns2,
  Eye,
  FileText,
  FilePlus2,
  FolderGit2,
  Inbox,
  LayoutList,
  Plug,
  RefreshCw,
  Settings,
} from 'lucide-react'

import { errorMessage } from '@/api/client'
import { asCounts } from '@/api/normalize'
import { useCategories, useConfig, useProjects, useReindex, useSummaries } from '@/api/queries'
import type { PreviewMode } from '@/api/types'
import { useUi } from '@/app/preferences'
import { MODE_LABEL_KEY } from '@/features/editor/mode'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command'
import { NewProjectDialog } from '@/features/projects/NewProjectDialog'
import { useT } from '@/i18n'
import { useDebouncedValue } from '@/lib/hooks'

/** Paleta de comandos (Cmd+K): navegar y ejecutar acciones. */
export function CommandPalette() {
  const t = useT()
  const {
    paletteOpen,
    setPaletteOpen,
    previewOverride,
    cyclePreviewMode,
    setOnboardingOpen,
    // Solo necesita abrir Ajustes; el diálogo lo monta `AppShell`, que es quien
    // debe poseerlo.
    setSettingsOpen,
  } = useUi()
  const [query, setQuery] = useState('')
  const [newProjectOpen, setNewProjectOpen] = useState(false)

  const navigate = useNavigate()
  const projects = useProjects()
  const categories = useCategories()
  const config = useConfig()
  const reindex = useReindex()

  const debouncedQuery = useDebouncedValue(query, 250)
  const searching = debouncedQuery.trim().length >= 2
  const summaries = useSummaries(
    { q: debouncedQuery.trim(), limit: 20 },
    { enabled: searching },
  )

  const currentMode: PreviewMode = previewOverride ?? config.data?.editor.preview_mode ?? 'split'

  /** Categorías con contenido, por proyecto. Las vacías no ensucian la lista. */
  const categoryEntries = useMemo(() => {
    const entries: { key: string; projectSlug: string; projectName: string; label: string; count: number }[] = []
    for (const project of projects.data ?? []) {
      for (const [key, count] of Object.entries(asCounts(project.counts))) {
        if (count <= 0) continue
        const meta = categories.data?.find((category) => category.key === key)
        entries.push({
          key,
          projectSlug: project.slug,
          projectName: project.name,
          label: meta?.label ?? key,
          count,
        })
      }
    }
    return entries.sort((a, b) => b.count - a.count).slice(0, 30)
  }, [projects.data, categories.data])

  const run = (action: () => void) => {
    setPaletteOpen(false)
    setQuery('')
    action()
  }

  const triggerReindex = () => {
    reindex.mutate(undefined, {
      onSuccess: (result) => {
        toast.success(t('shell.palette.reindexDone', { count: result.indexed }), {
          description: t('shell.palette.reindexDetail', {
            added: result.added,
            updated: result.updated,
            removed: result.removed,
            duration: result.duration_ms,
          }),
        })
      },
      onError: (error) =>
        toast.error(t('shell.palette.reindexFailed'), { description: errorMessage(error) }),
    })
  }

  return (
    <>
      <CommandDialog
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        title={t('shell.palette.title')}
        className="sm:max-w-2xl"
      >
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder={t('shell.palette.placeholder')}
        />
        <CommandList>
          <CommandEmpty>{t('shell.palette.noResults', { query })}</CommandEmpty>

          <CommandGroup heading={t('shell.palette.actions')}>
            <CommandItem
              value={t('shell.palette.search.inbox')}
              onSelect={() => run(() => void navigate({ to: '/' }))}
            >
              <Inbox />
              {t('shell.palette.goInbox')}
              <CommandShortcut>{t('shell.palette.goInboxHint')}</CommandShortcut>
            </CommandItem>
            <CommandItem
              value={t('shell.palette.search.newProject')}
              onSelect={() => run(() => setNewProjectOpen(true))}
            >
              <FilePlus2 />
              {t('shell.palette.newProject')}
            </CommandItem>
            <CommandItem
              value={t('shell.palette.search.reindex')}
              onSelect={() => run(triggerReindex)}
            >
              <RefreshCw />
              {t('shell.palette.reindex')}
            </CommandItem>
            <CommandItem
              value={t('shell.palette.search.mcp')}
              onSelect={() => run(() => setOnboardingOpen(true))}
            >
              <Plug />
              {t('shell.palette.configureMcp')}
            </CommandItem>
            <CommandItem
              value={t('shell.palette.search.settings')}
              onSelect={() => run(() => setSettingsOpen(true))}
            >
              <Settings />
              {t('shell.palette.settings')}
            </CommandItem>
            <CommandItem
              value={t('shell.palette.search.mode')}
              onSelect={() => run(() => cyclePreviewMode(currentMode))}
            >
              <Columns2 />
              {t('shell.palette.cycleMode')}
              <CommandShortcut>{t(MODE_LABEL_KEY[currentMode])}</CommandShortcut>
            </CommandItem>
          </CommandGroup>

          <CommandSeparator />

          <CommandGroup heading={t('shell.palette.projects')}>
            {(projects.data ?? []).map((project) => (
              <CommandItem
                key={project.slug}
                value={t('shell.palette.search.project', {
                  name: project.name,
                  slug: project.slug,
                })}
                onSelect={() =>
                  run(() => void navigate({ to: '/p/$project', params: { project: project.slug } }))
                }
              >
                <FolderGit2 />
                {project.name}
                <CommandShortcut>
                  {t('shell.palette.summaryCount', { count: project.total })}
                </CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>

          {categoryEntries.length > 0 ? (
            <>
              <CommandSeparator />
              <CommandGroup heading={t('shell.palette.categories')}>
                {categoryEntries.map((entry) => (
                  <CommandItem
                    key={`${entry.projectSlug}-${entry.key}`}
                    value={t('shell.palette.search.category', {
                      project: entry.projectName,
                      label: entry.label,
                      key: entry.key,
                    })}
                    onSelect={() =>
                      run(() =>
                        void navigate({
                          to: '/p/$project/$category',
                          params: { project: entry.projectSlug, category: entry.key },
                        }),
                      )
                    }
                  >
                    <LayoutList />
                    <span className="truncate">
                      {entry.projectName}
                      <span className="text-muted-foreground">/{entry.label}</span>
                    </span>
                    <CommandShortcut>{entry.count}</CommandShortcut>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          ) : null}

          {searching ? (
            <>
              <CommandSeparator />
              <CommandGroup heading={t('shell.palette.summaries')}>
                {summaries.isFetching && !summaries.data ? (
                  <CommandItem value={t('shell.palette.search.searching')} disabled>
                    <FileText />
                    {t('shell.palette.searching')}
                  </CommandItem>
                ) : null}
                {(summaries.data?.items ?? []).map((summary) => (
                  <CommandItem
                    key={summary.id}
                    value={t('shell.palette.search.summary', {
                      title: summary.title,
                      path: summary.rel_path,
                    })}
                    onSelect={() =>
                      run(() => void navigate({ to: '/s/$id', params: { id: summary.id } }))
                    }
                  >
                    <FileText />
                    <span className="min-w-0 flex-1 truncate">{summary.title}</span>
                    <CommandShortcut>
                      {summary.project_slug}/{summary.category}
                    </CommandShortcut>
                  </CommandItem>
                ))}
                {!summaries.isFetching && (summaries.data?.items.length ?? 0) === 0 ? (
                  <CommandItem value={t('shell.palette.search.empty')} disabled>
                    <Eye />
                    {t('shell.palette.noSummaryResults', { query: debouncedQuery })}
                  </CommandItem>
                ) : null}
              </CommandGroup>
            </>
          ) : null}
        </CommandList>
      </CommandDialog>

      <NewProjectDialog open={newProjectOpen} onOpenChange={setNewProjectOpen} />
      {/* Los ajustes se montan aquí porque el marco de la app no está en juego
          para esta tarea y la paleta siempre está montada, así que el botón de
          la barra superior y el comando comparten el mismo diálogo. */}
    </>
  )
}
