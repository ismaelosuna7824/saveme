import { useEffect } from 'react'

import { useConfig } from '@/api/queries'
import type { PreviewMode } from '@/api/types'
import { useUi } from '@/app/preferences'

/**
 * Atajos globales:
 * - `Cmd/Ctrl+K` abre y cierra la paleta de comandos.
 * - `Cmd/Ctrl+E` cicla source → split → preview desde cualquier pantalla.
 *
 * `Cmd+S` vive en el keymap de CodeMirror (solo tiene sentido con el editor
 * abierto y hay que evitar el diálogo de "guardar página" del navegador).
 */
export function useGlobalShortcuts(): void {
  const { togglePalette, cyclePreviewMode, previewOverride } = useUi()
  const { data: config } = useConfig()
  const currentMode: PreviewMode = previewOverride ?? config?.editor.preview_mode ?? 'split'

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey
      if (!modifier) return
      const key = event.key.toLowerCase()

      if (key === 'k') {
        event.preventDefault()
        togglePalette()
        return
      }

      if (key === 'e') {
        event.preventDefault()
        cyclePreviewMode(currentMode)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [togglePalette, cyclePreviewMode, currentMode])
}
