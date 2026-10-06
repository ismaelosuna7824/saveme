import { invoke } from '@tauri-apps/api/core'
import { save } from '@tauri-apps/plugin-dialog'

import { IN_TAURI } from '@/api/client'

/** Dónde acabó el fichero: la ruta elegida, o `null` si lo descargó el navegador. */
export interface SavedFile {
  path: string | null
}

/**
 * Guarda un markdown donde diga el usuario.
 *
 * Dentro de Tauri abre la ventana de «guardar como» del sistema con el nombre ya
 * propuesto y escribe con `save_text_file`: escribir en un sitio sin preguntar
 * está mal aunque el sitio sea razonable, porque el sitio razonable no es el
 * mismo para todo el mundo. Fuera de Tauri —el navegador, durante el desarrollo—
 * no hay ventana del sistema que abrir, así que se descarga como cualquier enlace.
 *
 * Devuelve `null` si el usuario cancela. Cancelar no es un fallo: es el usuario
 * diciendo que no, y quien llama no debe decir nada, ni error ni éxito.
 */
export async function saveMarkdownFile(
  fileName: string,
  contents: string,
  filterName: string,
): Promise<SavedFile | null> {
  if (IN_TAURI) {
    const path = await save({
      defaultPath: fileName,
      filters: [{ name: filterName, extensions: ['md'] }],
    })
    if (path === null) return null

    await invoke('save_text_file', { path, contents })
    return { path }
  }

  const blob = new Blob([contents], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const enlace = document.createElement('a')
  enlace.href = url
  enlace.download = fileName
  document.body.append(enlace)
  enlace.click()
  enlace.remove()
  // Revocar en el mismo tick puede cancelar la descarga: el navegador todavía no
  // ha leído el blob.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return { path: null }
}
