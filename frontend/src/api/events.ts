/**
 * Suscripción SSE a `/api/events`.
 *
 * El core emite `event: <tipo>` con `data: <json>` y manda `hello` al conectar,
 * así que tras una reconexión se invalida todo: la caché pudo quedar vieja
 * mientras el stream estaba caído. EventSource reconecta solo, pero aquí se
 * cierra y se reabre con backoff exponencial para poder observar el estado y
 * para no martillar al core si está reiniciándose.
 */
import { useEffect, useRef, useState } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'

import { API_BASE } from './client'
import { queryKeys } from './queries'

/** Tipos de evento del contrato (§6). */
export const SERVER_EVENT_TYPES = [
  'summary.created',
  'summary.updated',
  'summary.deleted',
  'proposal.created',
  'proposal.resolved',
  'project.created',
  'index.rebuilt',
  'hello',
] as const

export type ServerEventType = (typeof SERVER_EVENT_TYPES)[number]

const MAX_DELAY_MS = 30_000
const BASE_DELAY_MS = 500

function invalidateForEvent(queryClient: QueryClient, type: string): void {
  switch (type) {
    case 'summary.created':
    case 'summary.updated':
    case 'summary.deleted':
      void queryClient.invalidateQueries({ queryKey: queryKeys.summaries.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects })
      void queryClient.invalidateQueries({ queryKey: queryKeys.stats })
      break
    case 'proposal.created':
    case 'proposal.resolved':
      void queryClient.invalidateQueries({ queryKey: queryKeys.proposals.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.stats })
      break
    case 'project.created':
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects })
      void queryClient.invalidateQueries({ queryKey: queryKeys.stats })
      break
    case 'index.rebuilt':
    case 'hello':
      // El índice entero pudo cambiar (o acabamos de reconectar): todo a la
      // basura menos lo que es configurable/estático.
      void queryClient.invalidateQueries()
      break
    default:
      break
  }
}

export interface ServerEventsState {
  connected: boolean
  /** Último tipo de evento recibido, para el indicador de estado. */
  lastEventType: string | null
  lastEventAt: number | null
}

export function useServerEvents(): ServerEventsState {
  const queryClient = useQueryClient()
  const [connected, setConnected] = useState(false)
  const [lastEventType, setLastEventType] = useState<string | null>(null)
  const [lastEventAt, setLastEventAt] = useState<number | null>(null)
  const handlersRef = useRef({ setConnected, setLastEventType, setLastEventAt })

  useEffect(() => {
    handlersRef.current = { setConnected, setLastEventType, setLastEventAt }
  })

  useEffect(() => {
    let disposed = false
    let source: EventSource | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let attempt = 0

    const scheduleReconnect = () => {
      if (disposed) return
      attempt += 1
      const delay = Math.min(BASE_DELAY_MS * 2 ** Math.min(attempt - 1, 6), MAX_DELAY_MS)
      retryTimer = setTimeout(open, delay)
    }

    function open() {
      if (disposed) return
      source = new EventSource(`${API_BASE}/events`)

      source.onopen = () => {
        attempt = 0
        handlersRef.current.setConnected(true)
      }

      source.onerror = () => {
        handlersRef.current.setConnected(false)
        source?.close()
        source = null
        scheduleReconnect()
      }

      for (const type of SERVER_EVENT_TYPES) {
        source.addEventListener(type, () => {
          handlersRef.current.setLastEventType(type)
          handlersRef.current.setLastEventAt(Date.now())
          invalidateForEvent(queryClient, type)
        })
      }
    }

    open()

    return () => {
      disposed = true
      source?.close()
      if (retryTimer) clearTimeout(retryTimer)
    }
  }, [queryClient])

  return { connected, lastEventType, lastEventAt }
}
