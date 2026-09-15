import type { ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'

import type { MCPProvider } from '@/api/types'
import { SectionHeader } from '@/components/common/SectionHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { useT } from '@/i18n'
import { providerNote } from '@/lib/labels'
import { cn } from '@/lib/utils'

interface StepProvidersProps {
  providers: MCPProvider[]
  selected: string[]
  onToggle: (key: string) => void
  onSelectDetected: () => void
  onClear: () => void
  /**
   * Contenido extra al pie de cada fila (vía manual de ajustes). Se pinta FUERA
   * del `<label>` a propósito: un botón dentro haría que pulsarlo marcara la
   * casilla además de abrir el panel. En el asistente no se pasa y la fila queda
   * exactamente como estaba.
   */
  renderFooter?: (provider: MCPProvider) => ReactNode
}

/**
 * Acorta una ruta por la izquierda.
 *
 * Lo que identifica al archivo es el final (`.../opencode/opencode.json`), así
 * que se recorta el principio y se conserva la cola. El `title` lleva la ruta
 * completa para quien la necesite entera.
 */
function tailPath(path: string, max = 58): string {
  if (path.length <= max) return path
  return `…${path.slice(path.length - max + 1)}`
}

function ProviderRow({
  provider,
  checked,
  onToggle,
  footer,
}: {
  provider: MCPProvider
  checked: boolean
  onToggle: () => void
  footer?: ReactNode
}) {
  const t = useT()
  const isGeneric = provider.key === 'generic'
  // La nota se traduce por clave; si el core manda un cliente nuevo, se enseña
  // la suya tal cual antes que nada.
  const note = providerNote(t, provider.key, provider.note)
  return (
    <div
      className={cn(
        'border transition-colors',
        checked ? 'border-primary/45 bg-primary/5' : 'border-border bg-panel hover:border-border-strong',
        isGeneric ? 'border-dashed' : null,
      )}
    >
      <label className="flex cursor-pointer items-start gap-2 px-2 py-2">
        <Checkbox
          checked={checked}
          onChange={onToggle}
          className="mt-0.5"
          aria-label={t('onboarding.providers.configure', { name: provider.name })}
        />
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-foreground">{provider.name}</span>
            {provider.installed ? (
              <Badge variant="secondary">{t('onboarding.providers.badge.installed')}</Badge>
            ) : (
              <Badge variant="muted">{t('onboarding.providers.badge.notDetected')}</Badge>
            )}
            {provider.configured ? (
              <Badge variant="info">{t('onboarding.providers.badge.configured')}</Badge>
            ) : null}
            {provider.verified ? null : (
              <Badge variant="destructive">
                <TriangleAlert className="size-2.5" />
                {t('onboarding.providers.badge.unverified')}
              </Badge>
            )}
            {provider.verified && !provider.writable ? (
              <Badge variant="outline">{t('onboarding.providers.badge.manual')}</Badge>
            ) : null}
          </div>

          {provider.path ? (
            <div className="truncate text-2xs text-muted-foreground" title={provider.path}>
              <code>{tailPath(provider.path)}</code>
            </div>
          ) : provider.format === 'cli' ? (
            <div className="text-2xs text-muted-foreground">{t('onboarding.providers.cliOnly')}</div>
          ) : (
            <div className="text-2xs text-muted-foreground">{t('onboarding.providers.noPath')}</div>
          )}

          {note ? <p className="text-2xs text-muted-foreground">{note}</p> : null}

          {isGeneric ? (
            <p className="text-2xs text-primary/85">{t('onboarding.providers.generic')}</p>
          ) : null}
        </div>
      </label>

      {footer !== undefined ? (
        <div className="border-t border-border px-2 py-1.5">{footer}</div>
      ) : null}
    </div>
  )
}

/**
 * Paso 2: elegir clientes.
 *
 * El orden de la lista lo decide el core (accionable primero) y aquí no se
 * reordena: solo se parte en dos grupos visuales, detectados y no detectados,
 * conservando el orden relativo dentro de cada uno.
 */
export function StepProviders({
  providers,
  selected,
  onToggle,
  onSelectDetected,
  onClear,
  renderFooter,
}: StepProvidersProps) {
  const t = useT()
  const detected = providers.filter((provider) => provider.installed)
  const undetected = providers.filter((provider) => !provider.installed)

  const group = (title: string, hint: string, items: MCPProvider[]) =>
    items.length === 0 ? null : (
      <div className="space-y-1.5">
        <SectionHeader title={title} hint={hint} />
        <div className="space-y-1.5">
          {items.map((provider) => (
            <ProviderRow
              key={provider.key}
              provider={provider}
              checked={selected.includes(provider.key)}
              onToggle={() => onToggle(provider.key)}
              footer={renderFooter ? renderFooter(provider) : undefined}
            />
          ))}
        </div>
      </div>
    )

  return (
    <div className="space-y-4">
      <p className="text-xs text-foreground">
        {t('onboarding.providers.lead.before')}
        <code className="text-secondary">saveme</code>
        {t('onboarding.providers.lead.after')}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-2xs text-muted-foreground">
          {selected.length === 0
            ? t('onboarding.providers.selectedNone')
            : t('onboarding.providers.selected', { count: selected.length })}
        </span>
        <Button variant="outline" size="sm" onClick={onSelectDetected}>
          {t('onboarding.providers.selectDetected')}
        </Button>
        <Button variant="ghost" size="sm" onClick={onClear} disabled={selected.length === 0}>
          {t('common.actions.none')}
        </Button>
      </div>

      {group(
        t('onboarding.providers.detected.title'),
        t('onboarding.providers.detected.hint'),
        detected,
      )}
      {group(
        t('onboarding.providers.undetected.title'),
        t('onboarding.providers.undetected.hint'),
        undetected,
      )}
    </div>
  )
}
