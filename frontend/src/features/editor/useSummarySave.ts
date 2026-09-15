import { useCallback, useState } from 'react'
import { toast } from 'sonner'

import { ApiError, errorMessage } from '@/api/client'
import { useSaveSummary } from '@/api/queries'
import type { SummaryDetail, SummaryMeta } from '@/api/types'
import type { EditorDocument } from '@/features/editor/useEditorDocument'
import { useT } from '@/i18n'

export interface UseSummarySaveArgs {
  id: string
  /** Lee el documento vivo sin re-suscribir el hook a cada pulsación. */
  getDocument: () => EditorDocument | null
  markSaved: (meta: SummaryMeta, snapshot: string) => void
  /** Trae el detalle fresco del core (hash de disco incluido). */
  fetchFresh: () => Promise<SummaryDetail>
  reloadFromDisk: () => Promise<SummaryDetail | null>
}

export interface SummarySaveController {
  saving: boolean
  conflictOpen: boolean
  conflictBusy: boolean
  /** Guarda. Devuelve `false` si hubo conflicto o error. */
  save: (baseHashOverride?: string) => Promise<boolean>
  /** Guardado manual (Cmd+S o botón): avisa por toast del resultado. */
  saveNow: () => Promise<void>
  reloadAndClose: () => Promise<void>
  overwrite: () => Promise<void>
  keepEditing: () => void
}

/**
 * Guardado de un resumen con concurrencia optimista.
 *
 * Se manda `base_hash` (el `content_hash` del archivo del que partimos). Si el
 * core responde 409 `hash_mismatch`, el archivo cambió en disco: se abre el
 * diálogo de conflicto y **no se descarta nada**. El humano decide entre traer
 * la versión del disco o imponer la suya reintentando con el hash fresco.
 */
export function useSummarySave({
  id,
  getDocument,
  markSaved,
  fetchFresh,
  reloadFromDisk,
}: UseSummarySaveArgs): SummarySaveController {
  const t = useT()
  const saveMutation = useSaveSummary()
  const [conflictOpen, setConflictOpen] = useState(false)
  const [conflictBusy, setConflictBusy] = useState(false)

  const save = useCallback(
    async (baseHashOverride?: string): Promise<boolean> => {
      const current = getDocument()
      if (current === null) return false
      // El snapshot es el texto que se manda: si el usuario sigue escribiendo
      // durante la petición, el documento queda sucio otra vez (no se pierde).
      const snapshot = current.content
      try {
        const result = await saveMutation.mutateAsync({
          id,
          content: snapshot,
          base_hash: baseHashOverride ?? current.baseHash,
        })
        markSaved(result.meta, snapshot)
        return true
      } catch (cause) {
        if (cause instanceof ApiError && cause.isHashMismatch) {
          setConflictOpen(true)
          return false
        }
        toast.error(t('editor.save.failed'), { description: errorMessage(cause) })
        return false
      }
    },
    [getDocument, id, markSaved, saveMutation, t],
  )

  const saveNow = useCallback(async () => {
    const current = getDocument()
    if (current === null) return
    if (current.content === current.savedContent) {
      toast.success(t('editor.save.nothing'))
      return
    }
    const saved = await save()
    if (saved) toast.success(t('common.state.saved'))
  }, [getDocument, save, t])

  const reloadAndClose = useCallback(async () => {
    setConflictBusy(true)
    const detail = await reloadFromDisk()
    setConflictBusy(false)
    setConflictOpen(false)
    if (detail === null) {
      toast.error(t('editor.save.reloadFailed'))
      return
    }
    toast.success(t('editor.save.reloaded'), { description: detail.meta.rel_path })
  }, [reloadFromDisk, t])

  const overwrite = useCallback(async () => {
    setConflictBusy(true)
    try {
      const fresh = await fetchFresh()
      const saved = await save(fresh.meta.content_hash)
      if (saved) {
        toast.success(t('editor.save.overwritten'))
        setConflictOpen(false)
      }
    } catch (cause) {
      toast.error(t('editor.save.fetchFailed'), {
        description: errorMessage(cause),
      })
    } finally {
      setConflictBusy(false)
    }
  }, [fetchFresh, save, t])

  return {
    saving: saveMutation.isPending,
    conflictOpen,
    conflictBusy,
    save,
    saveNow,
    reloadAndClose,
    overwrite,
    keepEditing: () => setConflictOpen(false),
  }
}
