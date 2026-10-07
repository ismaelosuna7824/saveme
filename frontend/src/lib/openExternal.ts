import { openUrl } from '@tauri-apps/plugin-opener'

import { IN_TAURI } from '@/api/client'

/**
 * Abre una dirección en el navegador del sistema.
 *
 * Dentro de Tauri el webview no abre ventanas: la URL se la pasa al navegador el
 * plugin, que solo admite las direcciones de `src-tauri/capabilities/default.json`
 * (compartir, y las páginas de repos y commits). Fuera de Tauri, una pestaña nueva.
 */
export async function openExternal(url: string): Promise<void> {
  if (IN_TAURI) await openUrl(url)
  else window.open(url, '_blank', 'noopener,noreferrer')
}
