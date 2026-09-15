import { useState } from 'react'

import { useConfig } from '@/api/queries'
import { useUi } from '@/app/preferences'
import { OnboardingWizard } from '@/features/onboarding/OnboardingWizard'

/**
 * Decide cuándo se ve el asistente de configuración del MCP.
 *
 * Se abre solo en el primer arranque (`config.onboarded === false`) y cuando la
 * paleta de comandos lo pide. Si `/config` falla no se muestra nada: el
 * asistente nunca puede impedir que la app cargue.
 */
export function OnboardingGate() {
  const config = useConfig()
  const { onboardingOpen, setOnboardingOpen } = useUi()
  const [dismissed, setDismissed] = useState(false)

  const firstRun = config.data?.onboarded === false && !dismissed

  return (
    <OnboardingWizard
      open={onboardingOpen || firstRun}
      onClose={() => {
        setOnboardingOpen(false)
        setDismissed(true)
      }}
    />
  )
}
