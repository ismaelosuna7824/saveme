import { useMemo, useState, type DragEvent } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  ChevronDown,
  ChevronRight,
  FilePlus,
  FileText,
  Folder,
  FolderPlus,
  Pencil,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'

import { errorMessage } from '@/api/client'
import { useCreateNote, useDeleteNote, useMoveNote, useNotesTree } from '@/api/queries'
import type { NoteEntry } from '@/api/types'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'

import { buildTree, displayName, dropVerdict, freeName, parentOf, type TreeNode } from './tree'

/** Lo que se está arrastrando ahora mismo. Vive en el estado del componente padre. */
interface Dragging {
  entry: NoteEntry
}

interface NotesTreeProps {
  activePath: string | null
}

/**
 * Árbol de notas de la barra lateral.
 *
 * El árbol lo compone la interfaz a partir de la lista plana del API. Las carpetas
 * vienen del servidor y no se deducen de las rutas de los archivos, así que una
 * carpeta vacía se ve: es donde vas a soltar cosas.
 */
export function NotesTree({ activePath }: NotesTreeProps) {
  const t = useT()
  const navigate = useNavigate()
  const notes = useNotesTree()
  const create = useCreateNote()
  const move = useMoveNote()
  const remove = useDeleteNote()

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [dragging, setDragging] = useState<Dragging | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<NoteEntry | null>(null)

  const entries = useMemo(() => notes.data?.items ?? [], [notes.data])
  const tree = useMemo(() => buildTree(entries), [entries])

  const open = (path: string) => {
    void navigate({ to: '/notes/$', params: { _splat: path } })
  }

  const toggle = (path: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const startRename = (entry: NoteEntry) => {
    setRenaming(entry.rel_path)
    setDraft(displayName(entry))
  }

  const commitRename = (entry: NoteEntry) => {
    const clean = draft.trim()
    setRenaming(null)
    if (clean === '' || clean === displayName(entry)) return

    const parent = parentOf(entry.rel_path)
    const name = entry.is_dir ? clean : `${clean}.md`
    const to = parent === null ? name : `${parent}/${name}`

    move.mutate(
      { from: entry.rel_path, to },
      {
        onSuccess: () => {
          toast.success(t('notes.renamed', { name: clean }))
          // Si estaba abierta, la ruta vieja ya no existe: se sigue a la nueva.
          if (activePath === entry.rel_path) open(to)
        },
        onError: (error) =>
          toast.error(t('notes.renameFailed'), { description: errorMessage(error) }),
      },
    )
  }

  const addNote = (dir: string | null) => {
    const path = freeName(dir, t('notes.untitled'), '.md', entries)
    create.mutate(
      { path, kind: 'file', title: t('notes.untitled') },
      {
        onSuccess: () => open(path),
        onError: (error) =>
          toast.error(t('notes.createFailed'), { description: errorMessage(error) }),
      },
    )
  }

  const addFolder = (dir: string | null) => {
    const path = freeName(dir, t('notes.newFolderName'), '', entries)
    create.mutate(
      { path, kind: 'dir' },
      {
        onError: (error) =>
          toast.error(t('notes.createFailed'), { description: errorMessage(error) }),
      },
    )
  }

  /** Suelta lo que se arrastra dentro de una carpeta (o de la raíz si es null). */
  const dropInto = (targetDir: string | null) => {
    const dragged = dragging
    setDragging(null)
    setDropTarget(null)
    if (dragged === null) return

    const verdict = dropVerdict(dragged.entry, targetDir, entries)
    if (!verdict.ok) {
      // Los dos casos que no son un error se callan: soltar donde ya estaba no
      // merece un aviso, y meter una carpeta dentro de sí misma se explica.
      if (verdict.reason === 'into-itself') toast.error(t('notes.dropIntoItself'))
      if (verdict.reason === 'occupied') toast.error(t('notes.dropOccupied'))
      return
    }

    move.mutate(
      { from: dragged.entry.rel_path, to: verdict.to },
      {
        onSuccess: (result) => {
          toast.success(t('notes.moved', { count: result.moved }))
          // Si la nota abierta se movió —ella o la carpeta que la contiene—, hay
          // que seguirla: su ruta vieja ya no existe y el editor se quedaría
          // mostrando algo que no está.
          if (activePath !== null) {
            const moved = dragged.entry.rel_path
            const inside = activePath === moved || activePath.startsWith(moved + '/')
            if (inside) open(verdict.to + activePath.slice(moved.length))
          }
        },
        onError: (error) =>
          toast.error(t('notes.moveFailed'), { description: errorMessage(error) }),
      },
    )
  }

  const onRowDragOver = (event: DragEvent, dir: string | null) => {
    if (dragging === null) return
    const verdict = dropVerdict(dragging.entry, dir, entries)
    if (!verdict.ok && verdict.reason !== 'same-place') return
    // Solo se llama a preventDefault cuando el destino es válido: así el cursor
    // del sistema enseña si se puede soltar ahí o no.
    event.preventDefault()
    event.stopPropagation()
    setDropTarget(dir ?? ROOT_DROP)
  }

  const renderNode = (node: TreeNode) => {
    const { entry, depth } = node
    const isCollapsed = collapsed.has(entry.rel_path)
    const isActive = activePath === entry.rel_path
    const isDropTarget = dropTarget === entry.rel_path

    return (
      <div key={entry.rel_path}>
        <div
          draggable={renaming !== entry.rel_path}
          onDragStart={(event) => {
            setDragging({ entry })
            // `text/plain` es lo que hace que el arrastre funcione fuera de la
            // app también, y evita que algunos navegadores lo cancelen.
            event.dataTransfer.setData('text/plain', entry.rel_path)
            event.dataTransfer.effectAllowed = 'move'
          }}
          onDragEnd={() => {
            setDragging(null)
            setDropTarget(null)
          }}
          onDragOver={(event) => (entry.is_dir ? onRowDragOver(event, entry.rel_path) : undefined)}
          onDrop={(event) => {
            if (!entry.is_dir) return
            event.preventDefault()
            event.stopPropagation()
            dropInto(entry.rel_path)
          }}
          className={cn(
            'group flex items-center gap-1 pr-1 text-xs transition-colors',
            isDropTarget && 'bg-primary/15 ring-1 ring-inset ring-primary/45',
            !isDropTarget && isActive && 'bg-accent text-primary',
            !isDropTarget && !isActive && 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
          )}
          style={{ paddingLeft: `${depth * 10 + 8}px` }}
        >
          {entry.is_dir ? (
            <button
              type="button"
              onClick={() => toggle(entry.rel_path)}
              aria-label={isCollapsed ? t('notes.expand') : t('notes.collapse')}
              aria-expanded={!isCollapsed}
              className="shrink-0 rounded-sm p-0.5 hover:text-primary"
            >
              {isCollapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
            </button>
          ) : (
            <span className="w-4 shrink-0" />
          )}

          {entry.is_dir ? (
            <Folder className="size-3 shrink-0" />
          ) : (
            <FileText className="size-3 shrink-0" />
          )}

          {renaming === entry.rel_path ? (
            <input
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={() => commitRename(entry)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitRename(entry)
                if (event.key === 'Escape') setRenaming(null)
              }}
              className="min-w-0 flex-1 border border-input bg-sunken px-1 text-xs text-foreground outline-none"
            />
          ) : (
            <button
              type="button"
              onClick={() => (entry.is_dir ? toggle(entry.rel_path) : open(entry.rel_path))}
              className="min-w-0 flex-1 truncate py-1 text-left"
              title={entry.rel_path}
            >
              {displayName(entry)}
            </button>
          )}

          {/* Las acciones solo aparecen al pasar por encima: en un árbol con
              muchas notas, un botón por fila es ruido constante. */}
          <span className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            {entry.is_dir ? (
              <>
                <button
                  type="button"
                  title={t('notes.newNote')}
                  aria-label={t('notes.newNote')}
                  onClick={() => addNote(entry.rel_path)}
                  className="rounded-sm p-0.5 hover:text-primary"
                >
                  <FilePlus className="size-3" />
                </button>
                <button
                  type="button"
                  title={t('notes.newFolder')}
                  aria-label={t('notes.newFolder')}
                  onClick={() => addFolder(entry.rel_path)}
                  className="rounded-sm p-0.5 hover:text-primary"
                >
                  <FolderPlus className="size-3" />
                </button>
              </>
            ) : null}
            <button
              type="button"
              title={t('notes.rename')}
              aria-label={t('notes.rename')}
              onClick={() => startRename(entry)}
              className="rounded-sm p-0.5 hover:text-primary"
            >
              <Pencil className="size-3" />
            </button>
            <button
              type="button"
              title={t('notes.delete')}
              aria-label={t('notes.delete')}
              onClick={() => setPendingDelete(entry)}
              className="rounded-sm p-0.5 hover:text-destructive"
            >
              <Trash2 className="size-3" />
            </button>
          </span>
        </div>

        {entry.is_dir && !isCollapsed ? node.children.map(renderNode) : null}
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-col">
      <div className="term-rule mx-3 mt-2 mb-1">
        <span className="text-muted-foreground">{t('notes.title')}</span>
        <span className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            title={t('notes.newNote')}
            aria-label={t('notes.newNote')}
            onClick={() => addNote(null)}
            className="rounded-sm p-0.5 text-muted-foreground hover:text-primary"
          >
            <FilePlus className="size-3" />
          </button>
          <button
            type="button"
            title={t('notes.newFolder')}
            aria-label={t('notes.newFolder')}
            onClick={() => addFolder(null)}
            className="rounded-sm p-0.5 text-muted-foreground hover:text-primary"
          >
            <FolderPlus className="size-3" />
          </button>
        </span>
      </div>

      {/* Soltar aquí mueve a la raíz de las notas. */}
      <div
        onDragOver={(event) => onRowDragOver(event, null)}
        onDrop={(event) => {
          event.preventDefault()
          dropInto(null)
        }}
        className={cn('min-h-0 overflow-y-auto pb-2', dropTarget === ROOT_DROP && 'bg-primary/10')}
      >
        {notes.isLoading ? (
          <div className="space-y-1 px-3 py-1">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ) : null}

        {!notes.isLoading && entries.length === 0 ? (
          <p className="px-3 py-2 text-2xs text-muted-foreground">{t('notes.empty')}</p>
        ) : null}

        {tree.map(renderNode)}
      </div>

      <div className="shrink-0 border-t border-border px-2 py-1">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start"
          onClick={() => addNote(null)}
        >
          <FilePlus className="size-3" />
          {t('notes.newNote')}
        </Button>
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
        title={t('notes.deleteTitle', { name: pendingDelete === null ? '' : displayName(pendingDelete) })}
        description={
          pendingDelete?.is_dir === true
            ? t('notes.deleteFolderDescription')
            : t('notes.deleteDescription')
        }
        confirmLabel={t('notes.delete')}
        destructive
        pending={remove.isPending}
        onConfirm={() => {
          if (pendingDelete === null) return
          const target = pendingDelete
          remove.mutate(target.rel_path, {
            onSuccess: () => {
              setPendingDelete(null)
              toast.success(t('notes.deleted', { name: displayName(target) }))
              if (activePath !== null && activePath.startsWith(target.rel_path)) {
                void navigate({ to: '/notes' })
              }
            },
            onError: (error) =>
              toast.error(t('notes.deleteFailed'), { description: errorMessage(error) }),
          })
        }}
      />
    </div>
  )
}

/** Valor centinela para «la raíz de las notas» en el resaltado del destino. */
const ROOT_DROP = '\u0000root'
