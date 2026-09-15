import { useEffect, useRef } from 'react'

import { IN_TAURI } from '@/api/client'
import type { ServerEventsState } from '@/api/events'
import { useT } from '@/i18n'

/**
 * Avisa con una notificación del sistema cuando llega una propuesta.
 *
 * Existe porque el inbox es **pasivo** y las propuestas caducan: si un agente
 * propone un resumen mientras estás en otra ventana, no te enteras, y a los quince
 * minutos la propuesta vence. Todo el producto depende de que un humano apruebe, y
 * no había nada que lo avisara.
 *
 * Recibe el estado de eventos en vez de llamar a `useServerEvents()` por su cuenta:
 * ese hook abre una conexión SSE, y dos llamadas serían dos conexiones al mismo
 * stream.
 */
export function useProposalAlert(events: ServerEventsState): void {
  const t = useT()
  // El permiso se pide una vez por sesión. Preguntar en cada propuesta sería
  // insufrible, y el sistema ya recuerda la respuesta.
  const permiso = useRef<boolean | null>(null)

  useEffect(() => {
    if (!IN_TAURI) return
    if (events.lastEventType !== 'proposal.created') return

    let alive = true
    void (async () => {
      try {
        const { isPermissionGranted, requestPermission, sendNotification } =
          await import('@tauri-apps/plugin-notification')

        if (permiso.current === null) {
          permiso.current = await isPermissionGranted()
        }
        if (!permiso.current) {
          const respuesta = await requestPermission()
          permiso.current = respuesta === 'granted'
        }
        if (!alive || !permiso.current) return

        sendNotification({
          title: t('inbox.alert.title'),
          body: t('inbox.alert.body'),
        })
      } catch {
        // Sin permiso o sin soporte del sistema, la propuesta sigue en el inbox:
        // no poder avisar no puede romper nada.
      }
    })()

    return () => {
      alive = false
    }
    // `lastEventAt` va en las dependencias a propósito: dos propuestas seguidas
    // dejan el mismo `lastEventType`, y React no vuelve a ejecutar el efecto si
    // solo mira el tipo. La marca de tiempo cambia siempre.
  }, [events.lastEventType, events.lastEventAt, t])
}
