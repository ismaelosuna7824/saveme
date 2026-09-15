import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ArrowLeft, Save } from 'lucide-react'
import { toast } from 'sonner'

import { errorMessage } from '@/api/client'
import { useConfig, useNoteFile, useSaveNote, useUpdateConfig } from '@/api/queries'
import { SplitPane } from '@/components/common/SplitPane'
import { StatusDot } from '@/components/common/StatusDot'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ModeSwitch } from '@/features/editor/ModeSwitch'
import { PreviewPane } from '@/features/editor/PreviewPane'
import { toggleTaskAtLine } from '@/features/editor/toggleTask'
import { useAutosave } from '@/features/editor/useAutosave'
import { useMarkdownEditor } from '@/features/editor/useMarkdownEditor'
import type { PreviewMode } from '@/api/types'
import { useUi } from '@/app/preferences'
import { useT } from '@/i18n'

interface NoteEditorProps {
  path: string
}

/**
 * Editor de una nota.
 *
 * Reutiliza el motor del editor de resúmenes —CodeMirror con Live Preview, el
 * panel de lectura sincronizado, los cuatro modos— pero **sin nada de
 * frontmatter**: una nota es markdown libre, sin id, sin categoría y sin hash de
 * conflicto. Eso es lo que la separa de un resumen, y por eso no se reutiliza
 * `useEditorDocument` sino solo las piezas de edición.
 */
export function NoteEditor({ path }: NoteEditorProps) {
  const t = useT()
  const navigate = useNavigate()
  const config = useConfig()
  const file = useNoteFile(path)
  const save = useSaveNote()
  const updateConfig = useUpdateConfig()
  const { previewOverride, setPreviewMode, cyclePreviewMode } = useUi()

  const hostRef = useRef<HTMLDivElement | null>(null)
  const previewRef = useRef<HTMLDivElement | null>(null)

  const [doc, setDoc] = useState<string | null>(null)
  const [saved, setSaved] = useState('')
  const [adoptVersion, setAdoptVersion] = useState(0)

  // El documento se adopta cuando llega del disco, y **al cambiar de nota**: sin
  // el `path` en las dependencias, abrir otra nota seguiría enseñando la anterior.
  useEffect(() => {
    if (file.data === undefined) return
    setDoc(file.data.content)
    setSaved(file.data.content)
    setAdoptVersion((v) => v + 1)
  }, [file.data, path])

  const mode: PreviewMode = previewOverride ?? config.data?.editor.preview_mode ?? 'live'
  const wrap = config.data?.editor.wrap ?? true
  const fontSize = config.data?.editor.font_size ?? 14
  const autosaveMs = config.data?.editor.autosave_ms ?? 1200

  const persist = useCallback(
    (content: string) => {
      save.mutate(
        { path, content },
        {
          onSuccess: () => setSaved(content),
          onError: (error) =>
            toast.error(t('notes.saveFailed'), { description: errorMessage(error) }),
        },
      )
    },
    [path, save, t],
  )

  useAutosave({
    content: doc ?? '',
    savedContent: saved,
    delayMs: autosaveMs,
    enabled: doc !== null,
    onSave: () => {
      if (doc !== null) persist(doc)
    },
  })

  const editor = useMarkdownEditor({
    hostRef,
    ready: doc !== null,
    initialDoc: doc ?? '',
    docToAdopt: doc ?? '',
    adoptVersion,
    wrap,
    fontSize,
    livePreviewEnabled: mode === 'live',
    onDocChange: setDoc,
  })

  /**
   * Elegir un modo en el control segmentado.
   *
   * Se usa el **fijador**, no el ciclo: `cyclePreviewMode` avanza desde el modo
   * que le pasas y devuelve el siguiente, así que pasárselo aquí hacía que pulsar
   * «source» acabara en «split» y «preview» diera la vuelta hasta «live». En
   * `Cmd+E` sí es el ciclo lo que se quiere.
   *
   * Se persiste igual que en el editor de resúmenes: el modo es una preferencia,
   * no algo de cada nota, y los dos editores tienen que comportarse igual.
   */
  const changeMode = useCallback(
    (next: PreviewMode) => {
      if (next === mode) return
      setPreviewMode(next)
      updateConfig.mutate({ editor: { preview_mode: next } })
    },
    [mode, setPreviewMode, updateConfig],
  )

  // `Cmd+E` cicla los modos. El atajo global ya lo hace, pero solo cuando no hay
  // un editor delante: aquí se captura para que no se lo coma el navegador.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return
      if (event.key.toLowerCase() !== 'e') return
      event.preventDefault()
      cyclePreviewMode(mode)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [cyclePreviewMode, mode])

  const words = useMemo(() => {
    const text = (doc ?? '').trim()
    return text === '' ? 0 : text.split(/\s+/).length
  }, [doc])

  const dirty = doc !== null && doc !== saved
  const onToggleTask = useCallback(
    (line: number, checked: boolean) => toggleTaskAtLine(editor.view, line, checked),
    [editor.view],
  )

  if (file.isLoading || doc === null) {
    return (
      <div className="space-y-3 p-3">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (file.error) {
    return (
      <div className="p-4 text-xs text-destructive">
        {t('notes.loadFailed')}: {errorMessage(file.error)}
      </div>
    )
  }

  const name = path.split('/').pop() ?? path

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-border px-3 py-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => void navigate({ to: '/notes' })}
            title={t('common.actions.back')}
            aria-label={t('common.actions.back')}
          >
            <ArrowLeft className="size-3" />
          </Button>
          <span className="min-w-0 flex-1 truncate text-sm text-foreground" title={path}>
            {name.replace(/\.md$/i, '')}
          </span>

          <ModeSwitch mode={mode} onChange={changeMode} />

          <Button
            size="sm"
            onClick={() => persist(doc)}
            disabled={!dirty || save.isPending}
            title={t('editor.toolbar.saveTitle')}
          >
            <Save className="size-3" />
            {save.isPending ? t('common.state.saving') : t('common.actions.save')}
          </Button>
        </div>

        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-2xs text-muted-foreground">
          <code className="truncate text-secondary">{path}</code>
          <span>· {t('common.words', { count: words })}</span>
          <span className="ml-auto flex shrink-0 items-center gap-1.5" aria-live="polite">
            <StatusDot tone={save.isPending ? 'warn' : dirty ? 'warn' : 'ok'} />
            {save.isPending
              ? t('common.state.saving')
              : dirty
                ? t('editor.toolbar.unsaved')
                : t('common.state.saved')}
          </span>
        </div>
      </div>

      <SplitPane
        visible={mode === 'preview' ? 'right' : mode === 'split' ? 'both' : 'left'}
        left={<div ref={hostRef} className="h-full min-h-0 overflow-hidden" />}
        right={
          <PreviewPane
            previewRef={previewRef}
            content={doc}
            lineOffset={0}
            onToggleTask={onToggleTask}
          />
        }
      />
    </div>
  )
}
