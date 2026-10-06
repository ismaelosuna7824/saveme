/**
 * Firebase Analytics.
 *
 * Va en un `<script>` de Astro, que sale como módulo: se descarga en paralelo y se
 * ejecuta después de pintar el HTML, así que no retrasa la primera vista.
 *
 * La configuración sale de las variables `PUBLIC_FIREBASE_*` (ver `.env.example`).
 * Son públicas por diseño: Firebase las espera en el cliente. Sin `apiKey`,
 * `appId` o `measurementId` no se inicializa nada y `track` no hace nada; así un
 * `bun run dev` sin configurar no manda eventos a ningún proyecto.
 */
import { initializeApp } from 'firebase/app'
import { type Analytics, getAnalytics, isSupported, logEvent } from 'firebase/analytics'

type EventParams = Record<string, string | number | boolean>

const config = {
  apiKey: import.meta.env.PUBLIC_FIREBASE_API_KEY,
  authDomain: import.meta.env.PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.PUBLIC_FIREBASE_APP_ID,
  measurementId: import.meta.env.PUBLIC_FIREBASE_MEASUREMENT_ID,
}

let analytics: Promise<Analytics | null> | null = null

/**
 * Inicializa una sola vez; `page_view` lo manda Firebase solo al inicializar.
 * Los eventos que llegan antes esperan a esta misma promesa en vez de perderse.
 */
export function initAnalytics(): Promise<Analytics | null> {
  analytics ??= (async () => {
    if (!config.apiKey || !config.appId || !config.measurementId) {
      if (import.meta.env.DEV) console.info('[analytics] PUBLIC_FIREBASE_* not set: analytics disabled')
      return null
    }
    // `isSupported` es falso con cookies o IndexedDB bloqueados; ahí no hay nada que medir.
    if (!(await isSupported())) return null
    return getAnalytics(initializeApp(config))
  })().catch((error: unknown) => {
    console.warn('[analytics] failed to initialise', error)
    return null
  })
  return analytics
}

export async function track(event: string, params: EventParams = {}): Promise<void> {
  const instance = await initAnalytics()
  if (instance) logEvent(instance, event, params)
}
