import { useEffect, type ReactNode } from 'react'

import { useServerEvents } from '@/api/events'
import { useConfig } from '@/api/queries'
import { useUi } from '@/app/preferences'
import { ProjectSidebar } from '@/components/layout/ProjectSidebar'
import { TopBar } from '@/components/layout/TopBar'
import { useGlobalShortcuts } from '@/components/layout/useGlobalShortcuts'
import { CommandPalette } from '@/features/command/CommandPalette'
import { OnboardingGate } from '@/features/onboarding/OnboardingGate'
import { SettingsDialog } from '@/features/settings/SettingsDialog'
import { resolveTheme } from '@/features/settings/themeOptions'
import { UpdateNotice } from '@/features/update/UpdateNotice'
import { applyWindowOpacity } from '@/lib/translucency'

/**
 * Refleja `config.theme` en `<html data-theme>`.
 *
 * El valor pasa por `resolveTheme` antes de llegar al DOM: si la configuración
 * trae un tema que esta versión no conoce, se pinta el de por defecto en vez de
 * dejar el atributo sin coincidir con ninguna regla y quedarse sin colores.
 */
function useThemeSync(): void {
  const { data } = useConfig()
  const theme = data?.theme
  const opacity = data?.opacity

  useEffect(() => {
    document.documentElement.dataset['theme'] = resolveTheme(theme)
  }, [theme])

  // La opacidad depende del tema —translucir es reescribir el color de fondo del
  // tema con alpha—, así que se vuelve a aplicar cada vez que cambia cualquiera
  // de los dos.
  useEffect(() => {
    applyWindowOpacity(opacity ?? 100)
  }, [theme, opacity])
}

/** Marco de la aplicación: barra superior, navegación lateral y contenido. */
export function AppShell({ children }: { children: ReactNode }) {
  const events = useServerEvents()
  const { settingsOpen, setSettingsOpen } = useUi()
  useThemeSync()
  useGlobalShortcuts()

  return (
    <div className="flex h-full flex-col bg-background">
      <TopBar events={events} />
      <div className="flex min-h-0 flex-1">
        <ProjectSidebar />
        <main className="min-w-0 flex-1 overflow-hidden">{children}</main>
      </div>
      <CommandPalette />
      {/* Los dos overlays de la app viven aquí, como hermanos. La paleta de
          comandos no debería ser dueña del diálogo de Ajustes: solo comparte el
          estado con él a través de `useUi()`. */}
      <OnboardingGate />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      {/* El aviso de versión nueva se pinta encima de la app, pero no es un
          diálogo: no bloquea nada y se puede apartar. */}
      <UpdateNotice />
      <div className="scanlines" aria-hidden />
    </div>
  )
}
