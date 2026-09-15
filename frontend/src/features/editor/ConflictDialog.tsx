import { ClipboardCopy, FileWarning, RefreshCw, Upload } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useT } from '@/i18n'
import { copyToClipboard } from '@/lib/hooks'

export interface ConflictDialogProps {
  open: boolean
  /** Texto local que está en riesgo; se puede copiar antes de decidir. */
  localContent: string
  busy: boolean
  onReloadFromDisk: () => void
  onOverwrite: () => void
  onKeepEditing: () => void
}

/**
 * Conflicto de concurrencia optimista (409 `hash_mismatch`).
 *
 * El archivo cambió en disco desde que se cargó, así que el `base_hash` que
 * mandamos ya no vale. Nunca se descarta texto sin preguntar: el usuario elige
 * entre traer la versión del disco o imponer la suya (reintentando con el hash
 * fresco), y siempre puede copiar su versión antes de decidir.
 */
export function ConflictDialog({
  open,
  localContent,
  busy,
  onReloadFromDisk,
  onOverwrite,
  onKeepEditing,
}: ConflictDialogProps) {
  const t = useT()

  const copyMine = async () => {
    const ok = await copyToClipboard(localContent)
    if (ok) toast.success(t('editor.conflict.copied'))
    else toast.error(t('editor.conflict.copyFailed'))
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onKeepEditing())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            <span className="flex items-center gap-2">
              <FileWarning className="size-3 text-primary" />
              {t('editor.conflict.title')}
            </span>
          </DialogTitle>
        </DialogHeader>

        <DialogBody className="space-y-3">
          <p className="text-xs text-foreground">
            {t('editor.conflict.bodyBefore')}{' '}
            <code className="text-primary">409 hash_mismatch</code>{' '}
            {t('editor.conflict.bodyAfter')}
          </p>

          <ul className="space-y-1 border border-border bg-sunken px-2 py-1.5 text-2xs text-muted-foreground">
            <li>
              <span className="text-secondary">{t('editor.conflict.reload')}</span> ·{' '}
              {t('editor.conflict.reloadHint')}
            </li>
            <li>
              <span className="text-primary">{t('editor.conflict.overwrite')}</span> ·{' '}
              {t('editor.conflict.overwriteHint')}
            </li>
            <li>
              <span>{t('editor.conflict.copyMine')}</span> · {t('editor.conflict.copyMineHint')}
            </li>
          </ul>

          <DialogDescription>{t('editor.conflict.keep')}</DialogDescription>
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onKeepEditing} disabled={busy}>
            {t('editor.conflict.keepEditing')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => void copyMine()} disabled={busy}>
            <ClipboardCopy className="size-3" />
            {t('editor.conflict.copyMine')}
          </Button>
          <Button variant="destructive" size="sm" onClick={onReloadFromDisk} disabled={busy}>
            <RefreshCw className={busy ? 'size-3 animate-spin' : 'size-3'} />
            {t('editor.conflict.reload')}
          </Button>
          <Button size="sm" onClick={onOverwrite} disabled={busy}>
            <Upload className="size-3" />
            {t('editor.conflict.overwrite')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
