/** Formatos que el core acepta como fondo (`sniffImage` en `api/backgrounds.go`). */
export const BACKGROUND_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,image/avif'

/**
 * Abre el selector de archivos del sistema para elegir una imagen.
 *
 * Es un `<input type="file">` y no el diálogo de Tauri: así no hace falta darle
 * al webview permiso para abrir archivos (solo tiene el de «guardar como»), y el
 * archivo elegido llega como `File`, que se sube al core tal cual. Funciona igual
 * en el navegador durante el desarrollo.
 *
 * Devuelve `null` si el usuario cancela.
 */
export function pickImageFile(): Promise<File | null> {
  // Constructor y no `Promise.withResolvers`: el proyecto compila contra ES2023,
  // que todavía no lo declara.
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = BACKGROUND_ACCEPT
    input.style.display = 'none'
    const finish = (file: File | null) => {
      input.remove()
      resolve(file)
    }
    input.addEventListener('change', () => finish(input.files?.[0] ?? null), { once: true })
    input.addEventListener('cancel', () => finish(null), { once: true })
    document.body.append(input)
    input.click()
  })
}
