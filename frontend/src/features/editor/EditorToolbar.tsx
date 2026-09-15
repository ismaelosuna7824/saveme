import { useState } from 'react'
import { ArrowLeft, Copy, Paperclip, Save, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { errorMessage } from '@/api/client'
import { useDeleteSummary } from '@/api/queries'
import type { PreviewMode, SummaryMeta } from '@/api/types'
import { asStringArray } from '@/api/normalize'
import { CategoryBadge } from '@/components/common/CategoryBadge'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { TagLink } from '@/components/common/TagLink'
import { StatusBadge } from '@/components/common/StatusBadge'
import { StatusDot } from '@/components/common/StatusDot'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ModeSwitch } from '@/features/editor/ModeSwitch'
import { useT, type TranslationKey } from '@/i18n'
import { formatDateTime, shortenPath } from '@/lib/format'
import { copyToClipboard } from '@/lib/hooks'

export interface EditorToolbarProps {
  meta: SummaryMeta
  titleDraft: string
  onTitleChange: (value: string) => void
  wordCount: number
  dirty: boolean
  saving: boolean
  savedAt: number | null
  now: number
  mode: PreviewMode
  onModeChange: (mode: PreviewMode) => void
  onSave: () => void
  onBack: () => void
  /** Se llama tras borrar, para que la página decida a dónde ir. */
  onDeleted?: () => void
}

/**
 * Unidad de `common.time` que corresponde a un instante pasado.
 *
 * `formatSecondsSince` devolvía el texto ya montado en español; aquí solo se
 * elige la unidad y el texto lo pone el traductor.
 */
function elapsed(now: number, since: number): { key: TranslationKey; count: number } {
  const seconds = Math.max(0, Math.round((now - since) / 1000))
  if (seconds < 60) return { key: 'common.time.seconds', count: seconds }
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return { key: 'common.time.minutes', count: minutes }
  return { key: 'common.time.hours', count: Math.floor(minutes / 60) }
}

/** Barra del editor: título editable, metadatos, estado de guardado y modo. */
export function EditorToolbar({
  meta,
  titleDraft,
  onTitleChange,
  wordCount,
  dirty,
  saving,
  savedAt,
  now,
  mode,
  onModeChange,
  onSave,
  onBack,
  onDeleted,
}: EditorToolbarProps) {
  const t = useT()
  const remove = useDeleteSummary()
  const [confirmOpen, setConfirmOpen] = useState(false)

  /**
   * Borra el resumen y avisa a la página.
   *
   * El diálogo se cierra **solo cuando la mutación termina**, no al pulsar: si
   * falla, el usuario tiene que poder reintentar sin volver a abrir nada.
   */
  const confirmDelete = () => {
    remove.mutate(meta.id, {
      onSuccess: () => {
        setConfirmOpen(false)
        toast.success(t('editor.delete.done'), { description: meta.rel_path })
        onDeleted?.()
      },
      onError: (error) => {
        toast.error(t('editor.delete.failed'), { description: errorMessage(error) })
      },
    })
  }

  const copyPath = async () => {
    const ok = await copyToClipboard(meta.abs_path)
    if (ok) toast.success(t('editor.toolbar.copyPathDone'), { description: meta.abs_path })
    else toast.error(t('editor.toolbar.copyPathFailed'))
  }

  const tags = asStringArray(meta.tags)
  const filesTouched = asStringArray(meta.files_touched)

  const ago = savedAt === null ? null : elapsed(now, savedAt)
  const saveState = saving
    ? t('common.state.saving')
    : dirty
      ? t('editor.toolbar.unsaved')
      : ago === null
        ? t('editor.toolbar.unchanged')
        : t('editor.toolbar.saved', { when: t(ago.key, { count: ago.count }) })

  return (
    <div className="shrink-0 border-b border-border bg-panel">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onBack}
          title={t('editor.toolbar.backTitle')}
          aria-label={t('common.actions.back')}
        >
          <ArrowLeft className="size-3.5" />
        </Button>

        <Input
          value={titleDraft}
          onChange={(event) => onTitleChange(event.target.value)}
          aria-label={t('editor.toolbar.titleLabel')}
          className="h-7 min-w-0 flex-1 border-transparent bg-transparent px-1 text-sm text-foreground focus-visible:border-input"
          placeholder={t('editor.toolbar.titlePlaceholder')}
        />

        <CategoryBadge category={meta.category} withDescription />
        <StatusBadge status={meta.status} />
        <ModeSwitch mode={mode} onChange={onModeChange} />

        <Button
          size="sm"
          onClick={onSave}
          disabled={!dirty || saving}
          title={t('editor.toolbar.saveTitle')}
        >
          <Save className="size-3" />
          {saving ? t('common.state.saving') : t('common.actions.save')}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 pb-1.5 text-2xs text-muted-foreground">
        <code className="text-secondary">{meta.rel_path}</code>
        <span>· {t('common.words', { count: wordCount })}</span>
        <span>· {t('editor.toolbar.updated', { date: formatDateTime(meta.updated_at) })}</span>
        {meta.author ? (
          <span>· {t('editor.toolbar.author', { author: meta.author })}</span>
        ) : null}
        {meta.agent ? <Badge variant="outline">{meta.agent}</Badge> : null}

        {tags.length > 0 ? (
          <span className="flex flex-wrap items-center gap-1">
            {tags.map((tag) => (
              <TagLink key={tag} tag={tag} />
            ))}
          </span>
        ) : null}

        {filesTouched.length > 0 ? (
          <span className="flex min-w-0 items-center gap-1" title={filesTouched.join('\n')}>
            <Paperclip className="size-3 shrink-0" />
            {filesTouched.length === 1 ? (
              <code className="truncate">{shortenPath(filesTouched[0], 40)}</code>
            ) : (
              <span>
                {t('editor.toolbar.files', { count: filesTouched.length })} ·{' '}
                <code>{shortenPath(filesTouched[0], 28)}</code>
              </span>
            )}
          </span>
        ) : null}

        <span className="ml-auto flex shrink-0 items-center gap-1.5" aria-live="polite">
          <StatusDot tone={saving ? 'warn' : dirty ? 'warn' : 'ok'} />
          {saveState}
        </span>

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => void copyPath()}
          title={t('editor.toolbar.copyPath')}
          aria-label={t('editor.toolbar.copyPath')}
        >
          <Copy className="size-3" />
        </Button>

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setConfirmOpen(true)}
          title={t('editor.delete.action')}
          aria-label={t('editor.delete.action')}
        >
          <Trash2 className="size-3" />
        </Button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('editor.delete.title', { title: meta.title })}
        description={t('editor.delete.description')}
        confirmLabel={t('editor.delete.action')}
        destructive
        pending={remove.isPending}
        onConfirm={confirmDelete}
      />
    </div>
  )
}
