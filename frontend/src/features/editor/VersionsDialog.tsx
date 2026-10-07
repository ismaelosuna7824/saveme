import { useEffect, useMemo, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { toast } from 'sonner'

import { ApiError, errorMessage } from '@/api/client'
import { useRestoreVersion, useSummaryVersion, useSummaryVersions } from '@/api/queries'
import { DiffLines } from '@/components/common/DiffLines'
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
import { Skeleton } from '@/components/ui/skeleton'
import { useT, type TranslationKey } from '@/i18n'
import { diffCounts, diffLines } from '@/lib/diff'
import { formatBytes, formatDateTime, formatRelative } from '@/lib/format'

const REASON_KEYS: Record<string, TranslationKey> = {
  agent: 'editor.versions.reason.agent',
  edit: 'editor.versions.reason.edit',
  restore: 'editor.versions.reason.restore',
}

/**
 * Historial de un resumen: lo que había antes de cada reescritura.
 *
 * Existe porque una actualización del agente reemplaza el cuerpo entero, y lo que
 * el agente no repitió se perdía sin forma de recuperarlo. El diff va de la
 * versión elegida a lo que hay ahora —«qué cambiaría si la restauro»—, que es la
 * pregunta que hay que contestar antes de pulsar el botón.
 *
 * Restaurar con cambios sin guardar se bloquea: el autoguardado los manda en un
 * segundo, y restaurar por encima los tiraría sin que nadie los viera irse.
 */
export function VersionsDialog({
  summaryId,
  baseHash,
  dirty,
  open,
  onOpenChange,
  onRestored,
}: {
  summaryId: string
  /** Hash del archivo que tiene cargado el editor: viaja como `base_hash`. */
  baseHash: string
  dirty: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Se llama tras restaurar, para que el editor traiga el archivo del disco. */
  onRestored: () => void
}) {
  const t = useT()
  const versions = useSummaryVersions(summaryId, open)
  const [selected, setSelected] = useState<string | null>(null)
  const detail = useSummaryVersion(summaryId, open ? selected : null)
  const restore = useRestoreVersion()

  const items = useMemo(() => versions.data?.items ?? [], [versions.data])

  // Al abrir se elige la más reciente, que es casi siempre la que se busca: lo
  // que había justo antes del último cambio.
  useEffect(() => {
    if (!open) {
      setSelected(null)
      return
    }
    if (selected === null && items.length > 0) setSelected(items[0].version)
  }, [open, items, selected])

  const lines = useMemo(
    () => (detail.data ? diffLines(detail.data.current, detail.data.content) : []),
    [detail.data],
  )
  const counts = useMemo(() => diffCounts(lines), [lines])

  const onRestore = () => {
    if (selected === null) return
    restore.mutate(
      { id: summaryId, version: selected, base_hash: baseHash },
      {
        onSuccess: () => {
          toast.success(t('editor.versions.restored'))
          onRestored()
          onOpenChange(false)
        },
        onError: (error) => {
          const changed = error instanceof ApiError && error.isHashMismatch
          toast.error(
            changed ? t('editor.versions.restoreChanged') : t('editor.versions.restoreFailed'),
            changed ? undefined : { description: errorMessage(error) },
          )
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('editor.versions.title')}</DialogTitle>
        </DialogHeader>

        <DialogBody className="space-y-3">
          <DialogDescription>{t('editor.versions.description')}</DialogDescription>

          {versions.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : versions.error ? (
            <p className="text-2xs text-destructive">{t('editor.versions.loadFailed')}</p>
          ) : items.length === 0 ? (
            <p className="border border-border bg-sunken px-2 py-2 text-2xs text-muted-foreground">
              {t('editor.versions.empty')}
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-[14rem_1fr]">
              <ul className="max-h-72 divide-y divide-border overflow-y-auto border border-border">
                {items.map((item) => (
                  <li key={item.version}>
                    <button
                      type="button"
                      onClick={() => setSelected(item.version)}
                      aria-pressed={item.version === selected}
                      title={formatDateTime(item.replaced_at)}
                      className={
                        item.version === selected
                          ? 'w-full bg-accent px-2 py-1.5 text-left text-2xs text-foreground'
                          : 'w-full px-2 py-1.5 text-left text-2xs text-muted-foreground hover:bg-accent/50'
                      }
                    >
                      <span className="block">
                        {t(REASON_KEYS[item.reason] ?? 'editor.versions.reason.edit')}
                      </span>
                      <span className="block opacity-70">
                        {formatRelative(item.replaced_at)} · {formatBytes(item.size)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>

              <div className="min-w-0 border border-border bg-sunken">
                {detail.isLoading || selected === null ? (
                  <p className="px-2 py-3 text-2xs text-muted-foreground">
                    {t('editor.versions.loading')}
                  </p>
                ) : detail.error || !detail.data ? (
                  <p className="px-2 py-3 text-2xs text-destructive">
                    {t('editor.versions.loadFailed')}
                  </p>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2 border-b border-border px-2 py-1 text-2xs">
                      <span className="text-secondary">+{counts.added}</span>
                      <span className="text-destructive">−{counts.removed}</span>
                      <span className="text-muted-foreground">
                        {counts.added === 0 && counts.removed === 0
                          ? t('editor.versions.same')
                          : t('editor.versions.againstNow')}
                      </span>
                    </div>
                    <DiffLines lines={lines} />
                  </>
                )}
              </div>
            </div>
          )}

          {dirty && items.length > 0 ? (
            <p className="text-2xs text-muted-foreground">{t('editor.versions.dirtyHint')}</p>
          ) : null}
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            {t('common.actions.cancel')}
          </Button>
          <Button
            size="sm"
            disabled={selected === null || dirty || restore.isPending || !detail.data}
            onClick={onRestore}
          >
            <RotateCcw className="size-3" />
            {t('editor.versions.restore')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
