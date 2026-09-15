import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { FileQuestion } from 'lucide-react'

import { useConfig, useUpdateConfig } from '@/api/queries'
import type { PreviewMode, SummaryMeta } from '@/api/types'
import { useUi } from '@/app/preferences'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorPanel } from '@/components/common/ErrorPanel'
import { SplitPane } from '@/components/common/SplitPane'
import { useNow } from '@/components/common/useNow'
import { Skeleton } from '@/components/ui/skeleton'
import { ConflictDialog } from '@/features/editor/ConflictDialog'
import { EditorToolbar } from '@/features/editor/EditorToolbar'
import { PreviewPane } from '@/features/editor/PreviewPane'
import { documentBody } from '@/features/editor/documentBody'
import { setFrontmatterField } from '@/features/editor/frontmatter'
import { useAutosave } from '@/features/editor/useAutosave'
import { useEditorDocument } from '@/features/editor/useEditorDocument'
import { toggleTaskAtLine } from '@/features/editor/toggleTask'
import { useMarkdownEditor } from '@/features/editor/useMarkdownEditor'
import { useScrollSync } from '@/features/editor/useScrollSync'
import { useSummarySave } from '@/features/editor/useSummarySave'
import { useT } from '@/i18n'
import { countWords } from '@/lib/format'

const AUTOSAVE_FALLBACK_MS = 1200

/** El editor de markdown: fuente, preview y guardado con concurrencia optimista. */
export function EditorPage({ id }: { id: string }) {
  const t = useT()
  const navigate = useNavigate()
  const config = useConfig()
  const { previewOverride, setPreviewMode } = useUi()

  const {
    doc,
    isLoading,
    error,
    dirty,
    adoptVersion,
    setContent,
    markSaved,
    fetchFresh,
    reloadFromDisk,
    refetch,
  } = useEditorDocument(id)

  const now = useNow(1000)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const previewRef = useRef<HTMLDivElement | null>(null)
  const [titleDraft, setTitleDraft] = useState('')

  // El modo vive en la config del core, así que la elección sobrevive al
  // reinicio. `previewOverride` solo cubre el instante entre que el usuario
  // cambia de modo y la config vuelve del servidor.
  const mode: PreviewMode = previewOverride ?? config.data?.editor.preview_mode ?? 'live'
  const wrap = config.data?.editor.wrap ?? true
  const fontSize = config.data?.editor.font_size ?? 14
  const autosaveMs = config.data?.editor.autosave_ms ?? AUTOSAVE_FALLBACK_MS

  const documentRef = useRef(doc)
  useEffect(() => {
    documentRef.current = doc
  }, [doc])
  const getDocument = useCallback(() => documentRef.current, [])

  // Cambiar de modo lo persiste el core, así que la próxima vez el editor abre
  // donde lo dejaste. El override de sesión se pone de inmediato para que el
  // cambio se vea sin esperar al viaje de ida y vuelta.
  const updateConfig = useUpdateConfig()
  const changeMode = useCallback(
    (next: PreviewMode) => {
      // Si el modo no cambia de verdad, no se toca nada. Un `onValueChange`
      // espurio (un remontaje del control segmentado, por ejemplo) no debe
      // reescribir la preferencia del usuario ni gastar una escritura.
      if (next === mode) return
      setPreviewMode(next)
      updateConfig.mutate({ editor: { preview_mode: next } })
    },
    [mode, setPreviewMode, updateConfig],
  )

  const saver = useSummarySave({ id, getDocument, markSaved, fetchFresh, reloadFromDisk })
  const save = saver.save

  useAutosave({
    content: doc?.content ?? '',
    savedContent: doc?.savedContent ?? '',
    delayMs: autosaveMs,
    enabled: doc !== null,
    onSave: () => {
      void save()
    },
  })

  const editor = useMarkdownEditor({
    hostRef,
    ready: doc !== null,
    initialDoc: doc?.content ?? '',
    docToAdopt: doc?.content ?? '',
    adoptVersion,
    wrap,
    fontSize,
    livePreviewEnabled: mode === 'live',
    onDocChange: setContent,
  })
  const editorView = editor.view

  useScrollSync({
    view: editorView,
    previewRef,
    enabled: mode === 'split' && doc !== null,
  })

  /**
   * Marca o desmarca una casilla de tarea del preview.
   *
   * Reescribe solo los tres caracteres del marcador (`[ ]` ↔ `[x]`), no la línea
   * entera: así el texto de la tarea queda intacto y el historial de deshacer
   * registra un cambio mínimo en vez de reemplazar el documento.
   *
   * El cambio va por el editor y no por el estado de React a propósito: el
   * editor es la fuente de verdad mientras se escribe, y de ahí sale el autoguardado.
   */
  const onToggleTask = useCallback(
    (line: number, checked: boolean) => toggleTaskAtLine(editorView, line, checked),
    [editorView],
  )

  // Al cambiar de modo el panel del editor cambia de ancho (o vuelve de ancho 0),
  // así que hay que pedirle a CodeMirror que vuelva a medir.
  useEffect(() => {
    if (editorView === null) return
    const frame = requestAnimationFrame(() => editorView.requestMeasure())
    return () => cancelAnimationFrame(frame)
  }, [mode, editorView])

  /**
   * Vuelve a la pantalla de la que salió el editor.
   *
   * Acepta el `meta` a mano porque tras **borrar** el documento desaparece del
   * índice y `documentRef` puede quedar vacío antes de que esto se ejecute: si se
   * leyera de ahí, borrar te dejaría en la portada en vez de en la categoría.
   */
  const goBackTo = useCallback(
    (meta: SummaryMeta | undefined) => {
      if (meta !== undefined && meta.project_slug.length > 0) {
        if (meta.category.length > 0 && meta.category !== 'uncategorized') {
          void navigate({
            to: '/p/$project/$category',
            params: { project: meta.project_slug, category: meta.category },
          })
          return
        }
        void navigate({ to: '/p/$project', params: { project: meta.project_slug } })
        return
      }
      void navigate({ to: '/' })
    },
    [navigate],
  )

  const goBack = useCallback(() => {
    goBackTo(documentRef.current?.meta)
  }, [goBackTo])

  // El título vive en el frontmatter: se edita reescribiendo esa línea, y el
  // único escritor del documento sigue siendo CodeMirror.
  const documentTitle = doc?.meta.title
  const documentId = doc?.meta.id
  useEffect(() => {
    if (documentTitle === undefined) return
    setTitleDraft(documentTitle)
  }, [documentId, documentTitle, adoptVersion])

  const changeTitle = useCallback(
    (value: string) => {
      setTitleDraft(value)
      if (editorView === null) return
      const text = editorView.state.doc.toString()
      const updated = setFrontmatterField(text, 'title', value)
      if (updated === text) return
      editorView.dispatch({
        changes: { from: 0, to: editorView.state.doc.length, insert: updated },
      })
    },
    [editorView],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey

      // Cmd+S se maneja aquí (y no en el keymap de CodeMirror) para que también
      // funcione con el foco en la caja del título.
      if (modifier && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void saver.saveNow()
        return
      }

      if (event.key !== 'Escape') return
      if (saver.conflictOpen) return
      event.preventDefault()
      goBack()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [goBack, saver.conflictOpen, saver.saveNow])

  const preview = useMemo(() => documentBody(doc?.content ?? ''), [doc?.content])
  const words = useMemo(() => countWords(doc?.content ?? ''), [doc?.content])

  if (isLoading) {
    return (
      <div className="space-y-3 p-3">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-3">
        <ErrorPanel error={error} title={t('editor.page.openFailed')} onRetry={refetch} />
      </div>
    )
  }

  if (doc === null) {
    return (
      <div className="p-4">
        <EmptyState
          icon={<FileQuestion className="size-4" />}
          title={t('editor.page.notFound', { id })}
          hint={t('editor.page.notFoundHint')}
        />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <EditorToolbar
        meta={doc.meta}
        titleDraft={titleDraft}
        onTitleChange={changeTitle}
        wordCount={words}
        dirty={dirty}
        saving={saver.saving}
        savedAt={doc.savedAt}
        now={now}
        mode={mode}
        onModeChange={changeMode}
        onSave={() => {
          void saver.saveNow()
        }}
        onBack={goBack}
        onDeleted={() => goBackTo(doc.meta)}
      />

      <SplitPane
        visible={mode === 'preview' ? 'right' : mode === 'split' ? 'both' : 'left'}
        left={<div ref={hostRef} className="h-full min-h-0 overflow-hidden" />}
        right={
          <PreviewPane
            previewRef={previewRef}
            content={preview.body}
            lineOffset={preview.lineOffset}
            onToggleTask={onToggleTask}
          />
        }
      />

      <ConflictDialog
        open={saver.conflictOpen}
        localContent={doc.content}
        busy={saver.conflictBusy}
        onReloadFromDisk={() => {
          void saver.reloadAndClose()
        }}
        onOverwrite={() => {
          void saver.overwrite()
        }}
        onKeepEditing={saver.keepEditing}
      />
    </div>
  )
}
