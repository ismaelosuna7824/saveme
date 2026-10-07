import { useEffect, useState } from 'react'
import { useRouterState } from '@tanstack/react-router'

/** Valor que solo se propaga tras `delayMs` sin cambios. */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])

  return debounced
}

/**
 * La ruta de la pantalla que se ve ahora mismo.
 *
 * No es `location.pathname`: `location` cambia nada más empezar a navegar, y la
 * pantalla nueva se pinta cuando su `loader` trae los datos. Lo que acompaña al
 * contenido —pestañas, fondo— tiene que cambiar a la vez que él, no antes.
 */
export function useShownPathname(): string {
  return useRouterState({
    select: (state) => state.matches[state.matches.length - 1]?.pathname ?? state.location.pathname,
  })
}

/**
 * Cambia cuando cambia el tema del documento.
 *
 * Hace falta para los diagramas: el SVG se genera con los colores **incrustados**,
 * así que cambiar de tema no recolorea uno ya dibujado, hay que volver a
 * renderizarlo. Se observa el atributo del `<html>`, que es donde `useThemeSync`
 * deja el tema activo.
 */
export function useDocumentTheme(): string {
  const [theme, setTheme] = useState(
    () => (typeof document === 'undefined' ? '' : (document.documentElement.dataset['theme'] ?? '')),
  )

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setTheme(document.documentElement.dataset['theme'] ?? '')
    })
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })
    return () => {
      observer.disconnect()
    }
  }, [])

  return theme
}

/** Copia al portapapeles devolviendo si salió bien, sin lanzar. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
