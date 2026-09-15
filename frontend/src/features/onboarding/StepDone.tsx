import { RefreshCw, Terminal } from 'lucide-react'

import { CopyField } from '@/features/onboarding/CopyField'
import { useT } from '@/i18n'

/** El texto que enseña al agente a usar las tools del MCP con criterio. */
const GUIDE_COMMAND = 'saveme guide >> CLAUDE.md'

/**
 * Paso 4: lo que queda por hacer.
 *
 * Configurar el MCP hace que las tools existan; reiniciar el cliente hace que se
 * carguen, e instruir al agente hace que las usen bien (y que pregunten dónde
 * guardar en vez de inventarse una ruta).
 */
export function StepDone() {
  const t = useT()
  return (
    <div className="space-y-4">
      <p className="text-xs text-foreground">{t('onboarding.done.lead')}</p>

      <ol className="space-y-3">
        <li className="flex gap-2">
          <span className="mt-0.5 shrink-0 text-primary">
            <RefreshCw className="size-3.5" />
          </span>
          <div className="min-w-0 space-y-0.5">
            <div className="text-xs text-foreground">{t('onboarding.done.restart.title')}</div>
            <p className="text-2xs text-muted-foreground">{t('onboarding.done.restart.body')}</p>
          </div>
        </li>

        <li className="flex gap-2">
          <span className="mt-0.5 shrink-0 text-primary">
            <Terminal className="size-3.5" />
          </span>
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="text-xs text-foreground">{t('onboarding.done.guide.title')}</div>
            <p className="text-2xs text-muted-foreground">{t('onboarding.done.guide.body')}</p>
            <CopyField
              label={t('onboarding.done.guide.label')}
              value={GUIDE_COMMAND}
              maxLines={2}
            />
          </div>
        </li>
      </ol>

      <div className="border border-border bg-sunken px-2 py-2">
        <div className="text-2xs uppercase tracking-[0.12em] text-muted-foreground">
          {t('onboarding.done.check.title')}
        </div>
        <p className="mt-1 text-2xs text-muted-foreground">
          {t('onboarding.done.check.before')}
          <span className="text-secondary">{t('onboarding.done.check.emphasis')}</span>
          {t('onboarding.done.check.after')}
        </p>
      </div>

      <p className="text-2xs text-muted-foreground">{t('onboarding.done.reopen')}</p>
    </div>
  )
}
