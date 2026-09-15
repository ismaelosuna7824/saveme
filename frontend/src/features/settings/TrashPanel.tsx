import { useState } from 'react'
import { RotateCcw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { ApiError, errorMessage } from '@/api/client'
import { useEmptyTrash, useRestoreFromTrash, useTrash } from '@/api/queries'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { ErrorPanel } from '@/components/common/ErrorPanel'
import { SectionHeader } from '@/components/common/SectionHeader'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useT } from '@/i18n'
import { formatBytes, formatRelative } from '@/lib/format'

/**
 * Papelera.
 *
 * Borrar en SaveMe archiva: el archivo se mueve con su ruta original y se puede
 * devolver. Esta sección es la que cierra esa promesa — sin ella, «no se
 * destruye» era cierto pero el usuario no tenía forma de recuperarlo desde la
 * app.
 *
 * Vaciar **sí** destruye, así que es la única acción de la interfaz con
 * confirmación de tipo destructivo y la única que no se puede deshacer.
 */
export function TrashPanel() {
  const t = useT()
  const trash = useTrash()
  const restore = useRestoreFromTrash()
  const empty = useEmptyTrash()
  const [confirmEmpty, setConfirmEmpty] = useState(false)

  const items = trash.data?.items ?? []

  if (trash.isLoading) return <Skeleton className="h-16 w-full" />

  if (trash.error) {
    return (
      <ErrorPanel
        error={trash.error}
        title={t('settings.trash.loadFailed')}
        onRetry={() => {
          void trash.refetch()
        }}
      />
    )
  }

  const restoreItem = (trashRel: string, relPath: string) => {
    restore.mutate(trashRel, {
      onSuccess: (result) =>
        toast.success(t('settings.trash.restored', { path: result.rel_path }), {
          description: relPath,
        }),
      onError: (error) => {
        // El caso que importa: ya hay algo en el destino. El core lo dice con un
        // 409 y el mensaje trae la ruta, así que en vez del error crudo se
        // explica qué hacer.
        const blocked = error instanceof ApiError && error.status === 409
        toast.error(
          blocked
            ? t('settings.trash.restoreBlocked', { path: relPath })
            : t('settings.trash.restoreFailed'),
          blocked ? undefined : { description: errorMessage(error) },
        )
      },
    })
  }

  return (
    <div className="space-y-2">
      <SectionHeader
        title={t('settings.trash.title')}
        hint={t('settings.trash.count', { count: items.length })}
      />

      {items.length === 0 ? (
        <p className="border border-border bg-sunken px-2 py-2 text-2xs text-muted-foreground">
          {t('settings.trash.empty')}
        </p>
      ) : (
        <>
          <ul className="divide-y divide-border border border-border">
            {items.map((item) => (
              <li
                key={item.trash_rel}
                className="flex flex-wrap items-center gap-2 px-2 py-1.5 text-2xs"
              >
                <span className="min-w-0 flex-1 truncate text-foreground" title={item.rel_path}>
                  {item.rel_path}
                </span>
                <span className="shrink-0 text-muted-foreground">{formatBytes(item.size)}</span>
                {item.deleted_at.length > 0 ? (
                  <span
                    className="shrink-0 text-muted-foreground"
                    title={item.deleted_at}
                  >
                    {t('settings.trash.deletedAt', { when: formatRelative(item.deleted_at) })}
                  </span>
                ) : null}
                <Button
                  variant="ghost"
                  size="sm"
                  title={t('settings.trash.restoreHint')}
                  disabled={restore.isPending}
                  onClick={() => restoreItem(item.trash_rel, item.rel_path)}
                >
                  <RotateCcw className="size-3" />
                  {t('settings.trash.restore')}
                </Button>
              </li>
            ))}
          </ul>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setConfirmEmpty(true)}
            disabled={empty.isPending}
          >
            <Trash2 className="size-3" />
            {t('settings.trash.emptyAction')}
          </Button>
        </>
      )}

      <ConfirmDialog
        open={confirmEmpty}
        onOpenChange={setConfirmEmpty}
        title={t('settings.trash.emptyTitle')}
        description={t('settings.trash.emptyDescription', { count: items.length })}
        confirmLabel={t('settings.trash.emptyAction')}
        destructive
        pending={empty.isPending}
        onConfirm={() => {
          empty.mutate(undefined, {
            onSuccess: (result) => {
              setConfirmEmpty(false)
              toast.success(t('settings.trash.emptied', { count: result.removed }))
            },
            onError: (error) =>
              toast.error(t('settings.trash.emptyFailed'), { description: errorMessage(error) }),
          })
        }}
      />
    </div>
  )
}
