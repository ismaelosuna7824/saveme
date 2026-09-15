/**
 * Aviso de versión nueva.
 *
 * Pregunta al servidor de actualizaciones al abrir la app y, si hay algo,
 * deja que el usuario lo instale desde aquí. Quien descarga y verifica la firma
 * es el plugin de Rust: esto solo decide **cuándo** preguntar y **qué** enseñar.
 *
 * Dos decisiones que conviene entender:
 *
 * - **Un fallo al preguntar no se le enseña a nadie.** Sin red, en un avión, o
 *   con la release todavía sin `latest.json`, la comprobación falla. No es un
 *   problema del usuario y no hay nada que pueda hacer, así que la interfaz se
 *   queda como si no hubiera pasado nada. Un aviso de error aquí sería ruido en
 *   cada arranque.
 * - **Se pregunta una vez por sesión.** `StrictMode` monta los efectos dos veces
 *   en desarrollo; sin el candado, cada arranque pedía el `latest.json` dos veces.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import type { Update } from '@tauri-apps/plugin-updater'

import { IN_TAURI } from '@/api/client'

/** En qué punto va el asunto. */
export type UpdateStage =
  /** Nadie ha preguntado todavía, o no hay nada nuevo. */
  | 'idle'
  /** Hay una versión nueva y espera decisión. */
  | 'available'
  /** Descargando e instalando. */
  | 'downloading'
  /** Instalada; la app va a reiniciarse. */
  | 'installed'
  /** La instalación falló y el usuario debería enterarse. */
  | 'failed'

export interface AppUpdate {
  stage: UpdateStage
  /** Versión que ofrece el servidor, tal cual la anuncia. */
  version: string | null
  /** Notas de la release, si el servidor las manda. */
  notes: string | null
  /** 0..1 mientras descarga; `null` si el servidor no dijo cuánto pesa. */
  progress: number | null
  /**
   * Resultado de la última comprobación **pedida a mano**, para poder enseñarlo.
   *
   * La automática no tiene resultado visible a propósito —si falla, nadie tiene
   * que enterarse—, pero cuando alguien pulsa «buscar actualizaciones» se merece
   * una respuesta, aunque sea «ya estás al día».
   */
  checkState: CheckState
  /** Vuelve a preguntar, saltándose la comprobación ya hecha. */
  checkNow: () => void
  /** Descarga, instala y reinicia. */
  install: () => void
  /** Aparta el aviso hasta el próximo arranque. */
  dismiss: () => void
}

/** En qué quedó la última comprobación pedida a mano. */
export type CheckState = 'idle' | 'checking' | 'up-to-date' | 'failed'

/**
 * La comprobación en curso, compartida por toda la app.
 *
 * `null` significa «todavía no se ha preguntado». Guardar la promesa y no solo un
 * booleano permite que dos montajes simultáneos esperen a la misma petición en vez
 * de lanzar dos.
 */
let pending: Promise<Update | null> | null = null

function checkOnce(force = false): Promise<Update | null> {
  // Una comprobación pedida a mano descarta la anterior: si alguien vuelve a
  // preguntar es porque quiere la respuesta de ahora, no la de hace un rato.
  if (force) pending = null

  pending ??= import('@tauri-apps/plugin-updater')
    .then((mod) => mod.check())
    .catch((err: unknown) => {
      // Que un fallo no envenene el siguiente intento: sin esto, el primer error
      // dejaría la promesa rechazada cacheada para siempre.
      pending = null
      throw err
    })
  return pending
}

export function useAppUpdate(): AppUpdate {
  const [stage, setStage] = useState<UpdateStage>('idle')
  const [version, setVersion] = useState<string | null>(null)
  const [notes, setNotes] = useState<string | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [checkState, setCheckState] = useState<CheckState>('idle')

  // El `Update` de Tauri no es serializable y no pinta nada en el estado de React:
  // vive en una ref para poder instalarlo cuando el usuario pulse el botón.
  const updateRef = useRef<Update | null>(null)
  const dismissedRef = useRef(false)

  useEffect(() => {
    // Fuera de Tauri no hay plugin que llamar. Se comprueba aquí y no en el render
    // para que la importación dinámica no se evalúe en el navegador.
    if (!IN_TAURI) return

    let alive = true
    void (async () => {
      try {
        const found = await checkOnce()
        if (!alive || found === null) return
        updateRef.current = found
        setVersion(found.version)
        setNotes(found.body ?? null)
        setStage('available')
      } catch {
        // Ver la nota de arriba: fallar al preguntar no se enseña.
      }
    })()

    return () => {
      alive = false
    }
  }, [])

  const install = useCallback(() => {
    const update = updateRef.current
    if (update === null) return

    setStage('downloading')
    setProgress(null)

    void (async () => {
      try {
        let total = 0
        let done = 0

        await update.downloadAndInstall((event) => {
          switch (event.event) {
            case 'Started':
              total = event.data.contentLength ?? 0
              // Sin tamaño conocido no se inventa un porcentaje: se deja la barra
              // en modo «trabajando» en vez de mentir con un número.
              setProgress(total > 0 ? 0 : null)
              break
            case 'Progress':
              done += event.data.chunkLength
              if (total > 0) setProgress(Math.min(1, done / total))
              break
            case 'Finished':
              setProgress(1)
              break
          }
        })

        setStage('installed')
        const { relaunch } = await import('@tauri-apps/plugin-process')
        await relaunch()
      } catch {
        // Este sí se enseña: el usuario pidió actualizar y no se pudo.
        setStage('failed')
      }
    })()
  }, [])

  const dismiss = useCallback(() => {
    dismissedRef.current = true
    setStage('idle')
  }, [])

  /**
   * Pregunta otra vez y deja el resultado a la vista.
   *
   * Se descarta el «ya lo he apartado» porque quien pulsa el botón está pidiendo
   * justo lo contrario: que le enseñen lo que haya. Y si encuentra algo, el aviso
   * vuelve a salir.
   */
  const checkNow = useCallback(() => {
    setCheckState('checking')
    void (async () => {
      try {
        const found = await checkOnce(true)
        if (found === null) {
          updateRef.current = null
          setCheckState('up-to-date')
          return
        }
        updateRef.current = found
        setVersion(found.version)
        setNotes(found.body ?? null)
        dismissedRef.current = false
        setStage('available')
        setCheckState('idle')
      } catch {
        setCheckState('failed')
      }
    })()
  }, [])

  // `dismissedRef` no dispara renders a propósito: descartar es una decisión para
  // lo que queda de sesión, no un dato que la interfaz tenga que volver a leer.
  return {
    stage: dismissedRef.current ? 'idle' : stage,
    version,
    notes,
    progress,
    checkState,
    checkNow,
    install,
    dismiss,
  }
}
