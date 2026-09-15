import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

import type { PreviewMode } from '@/api/types'
import { nextPreviewMode } from '@/features/editor/mode'

interface UiContextValue {
  /** Paleta de comandos (Cmd+K). */
  paletteOpen: boolean
  setPaletteOpen: (open: boolean) => void
  openPalette: () => void
  togglePalette: () => void
  /**
   * Modo del editor elegido por el usuario en esta sesión. `null` significa
   * "usa `config.editor.preview_mode`", que es el valor que persiste el core.
   */
  previewOverride: PreviewMode | null
  setPreviewMode: (mode: PreviewMode | null) => void
  /** Ciclo source → split → preview, para Cmd+E y la paleta. */
  cyclePreviewMode: (current: PreviewMode) => PreviewMode
  /**
   * Asistente de configuración del MCP. Se abre solo en el primer arranque; la
   * paleta de comandos lo reabre cuando el usuario quiere configurar otro cliente.
   */
  onboardingOpen: boolean
  setOnboardingOpen: (open: boolean) => void
  /**
   * Ajustes de la aplicación (tema, preferencias del editor, MCP y workspace).
   * Se abre desde la barra superior o desde la paleta de comandos.
   */
  settingsOpen: boolean
  setSettingsOpen: (open: boolean) => void
}

const UiContext = createContext<UiContextValue | null>(null)

export function UiProvider({ children }: { children: ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [previewOverride, setPreviewOverride] = useState<PreviewMode | null>(null)
  const [onboardingOpen, setOnboardingOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const openPalette = useCallback(() => setPaletteOpen(true), [])
  const togglePalette = useCallback(() => setPaletteOpen((open) => !open), [])

  const cyclePreviewMode = useCallback((current: PreviewMode): PreviewMode => {
    const next = nextPreviewMode(current)
    setPreviewOverride(next)
    return next
  }, [])

  const value = useMemo<UiContextValue>(
    () => ({
      paletteOpen,
      setPaletteOpen,
      openPalette,
      togglePalette,
      previewOverride,
      setPreviewMode: setPreviewOverride,
      cyclePreviewMode,
      onboardingOpen,
      setOnboardingOpen,
      settingsOpen,
      setSettingsOpen,
    }),
    [
      paletteOpen,
      openPalette,
      togglePalette,
      previewOverride,
      cyclePreviewMode,
      onboardingOpen,
      settingsOpen,
    ],
  )

  return <UiContext.Provider value={value}>{children}</UiContext.Provider>
}

export function useUi(): UiContextValue {
  const value = useContext(UiContext)
  if (value === null) throw new Error('useUi() solo funciona dentro de <UiProvider>')
  return value
}
