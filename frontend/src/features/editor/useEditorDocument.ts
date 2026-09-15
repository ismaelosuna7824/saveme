import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { api } from '@/api/client'
import { queryKeys, useSummary } from '@/api/queries'
import type { SummaryDetail, SummaryMeta } from '@/api/types'

export interface EditorDocument {
  meta: SummaryMeta
  /** Texto vivo del editor. */
  content: string
  /** Último texto que sabemos que está en disco. */
  savedContent: string
  /** Hash del archivo del que partimos; viaja como `base_hash` al guardar. */
  baseHash: string
  savedAt: number | null
}

export interface EditorDocumentState {
  doc: EditorDocument | null
  isLoading: boolean
  error: unknown
  dirty: boolean
  /** Se incrementa cuando el editor debe reemplazar su documento desde fuera. */
  adoptVersion: number
  setContent: (content: string) => void
  markSaved: (meta: SummaryMeta, snapshot: string) => void
  fetchFresh: () => Promise<SummaryDetail>
  reloadFromDisk: () => Promise<SummaryDetail | null>
  refetch: () => void
}

function isDirty(doc: EditorDocument): boolean {
  return doc.content !== doc.savedContent
}

/**
 * Estado del documento abierto en el editor.
 *
 * El servidor solo pisa el contenido local si no hay cambios sin guardar, o si
 * el usuario pidió explícitamente recargar del disco. Es la regla que evita
 * perder texto cuando otro proceso toca el archivo.
 */
export function useEditorDocument(id: string): EditorDocumentState {
  const query = useSummary(id)
  const queryClient = useQueryClient()

  const [doc, setDoc] = useState<EditorDocument | null>(null)
  const [adoptVersion, setAdoptVersion] = useState(0)

  const docRef = useRef<EditorDocument | null>(null)
  const adoptedHashRef = useRef<string | null>(null)
  const forceAdoptRef = useRef(false)

  useEffect(() => {
    docRef.current = doc
  }, [doc])

  useEffect(() => {
    const data = query.data
    if (data === undefined) return

    const forced = forceAdoptRef.current
    if (!forced && adoptedHashRef.current === data.meta.content_hash) return

    const current = docRef.current
    if (current !== null && isDirty(current) && !forced) return

    forceAdoptRef.current = false
    adoptedHashRef.current = data.meta.content_hash
    setDoc({
      meta: data.meta,
      content: data.content,
      savedContent: data.content,
      baseHash: data.meta.content_hash,
      savedAt: null,
    })
    setAdoptVersion((version) => version + 1)
  }, [query.data, query.dataUpdatedAt])

  const fetchFresh = useCallback(async (): Promise<SummaryDetail> => {
    return queryClient.fetchQuery({
      queryKey: queryKeys.summaries.detail(id),
      queryFn: ({ signal }) => api.get<SummaryDetail>(`/summaries/${id}`, signal),
      staleTime: 0,
    })
  }, [id, queryClient])

  const reloadFromDisk = useCallback(async (): Promise<SummaryDetail | null> => {
    forceAdoptRef.current = true
    try {
      return await fetchFresh()
    } catch {
      forceAdoptRef.current = false
      return null
    }
  }, [fetchFresh])

  const setContent = useCallback((content: string) => {
    setDoc((current) => (current === null ? current : { ...current, content }))
  }, [])

  const markSaved = useCallback((meta: SummaryMeta, snapshot: string) => {
    // El servidor reescribe `updated_at` en el frontmatter, así que el hash
    // nuevo no corresponde al texto local. Se marca como adoptado para que la
    // invalidación de la caché no reemplace lo que el usuario tiene delante.
    adoptedHashRef.current = meta.content_hash
    forceAdoptRef.current = false
    setDoc((current) =>
      current === null
        ? current
        : {
            ...current,
            meta,
            savedContent: snapshot,
            baseHash: meta.content_hash,
            savedAt: Date.now(),
          },
    )
  }, [])

  return {
    doc,
    isLoading: query.isLoading && doc === null,
    error: query.error,
    dirty: doc !== null && isDirty(doc),
    adoptVersion,
    setContent,
    markSaved,
    fetchFresh,
    reloadFromDisk,
    refetch: () => {
      void query.refetch()
    },
  }
}
