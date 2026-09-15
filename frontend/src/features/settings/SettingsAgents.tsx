import { useState } from 'react'
import { Plug, RefreshCw, Trash2, Wrench } from 'lucide-react'
import { toast } from 'sonner'

import { errorMessage } from '@/api/client'
import { useMCPProviders, useUnconfigureMCP } from '@/api/queries'
import type { MCPProvider } from '@/api/types'
import { ErrorPanel } from '@/components/common/ErrorPanel'
import { SectionHeader } from '@/components/common/SectionHeader'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ManualSnippet, StepApply } from '@/features/onboarding/StepApply'
import { StepProviders } from '@/features/onboarding/StepProviders'
import { MCPBinaryPanel } from '@/features/settings/MCPBinaryPanel'
import { useT } from '@/i18n'

/**
 * Sección «Agentes»: el MCP.
 *
 * Reutiliza tal cual los dos pasos del asistente que hacen el trabajo
 * (`StepProviders` para elegir clientes y `StepApply` para aplicarlo), con dos
 * diferencias deliberadas: aquí NO se preselecciona nada —es una re-ejecución,
 * elige el usuario— y la configuración la dispara un botón, no la entrada al
 * paso. La vía manual por cliente es el escape para formatos que no sabemos
 * escribir.
 */
export function SettingsAgents() {
  const t = useT()
  const providers = useMCPProviders()
  const unconfigure = useUnconfigureMCP()
  const [selected, setSelected] = useState<string[]>([])
  const [manualKey, setManualKey] = useState<string | null>(null)

  const list: MCPProvider[] = providers.data?.providers ?? []

  const toggle = (key: string) => {
    setSelected((previous) =>
      previous.includes(key) ? previous.filter((item) => item !== key) : [...previous, key],
    )
  }

  const selectDetected = () => {
    const detected = list
      .filter((provider) => provider.installed && provider.writable)
      .map((provider) => provider.key)
    setSelected((previous) => [...new Set([...previous, ...detected])])
  }

  if (providers.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    )
  }

  if (providers.error) {
    return (
      <ErrorPanel
        error={providers.error}
        title={t('settings.agents.offline')}
        onRetry={() => {
          void providers.refetch()
        }}
      />
    )
  }

  /**
   * Quita SaveMe del archivo de un cliente.
   *
   * El resultado se cuenta tal como lo devuelva el core —quitado, no había nada,
   * o hay que hacerlo a mano— en vez de dar por hecho que se quitó: hay clientes
   * cuyo formato no sabemos reescribir (JSONC) y ahí lo único honesto es decirlo.
   */
  const removeFrom = (provider: MCPProvider) => {
    unconfigure.mutate(
      { providers: [provider.key] },
      {
        onSuccess: (data) => {
          const result = data.results[0]
          const description = result?.message
          switch (result?.action) {
            case 'removed':
              toast.success(t('settings.agents.removed', { name: provider.name }), { description })
              break
            case 'not-configured':
              toast.info(t('settings.agents.notConfigured', { name: provider.name }), { description })
              break
            default:
              toast.warning(t('settings.agents.removeManual'), { description })
          }
        },
        onError: (error) =>
          toast.error(t('settings.agents.removeFailed'), { description: errorMessage(error) }),
      },
    )
  }

  const renderFooter = (provider: MCPProvider) => {
    const open = manualKey === provider.key
    return (
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={open}
            onClick={() => setManualKey(open ? null : provider.key)}
          >
            <Wrench className="size-3" />
            {open ? t('common.actions.close') : t('common.actions.configureManually')}
          </Button>
          {/* Solo se ofrece quitarlo de donde consta que está: en el resto no hay
              nada que borrar y el botón sería ruido. */}
          {provider.configured ? (
            <Button
              variant="ghost"
              size="sm"
              title={t('settings.agents.removeHint')}
              aria-label={t('settings.agents.removeHint')}
              disabled={unconfigure.isPending}
              onClick={() => removeFrom(provider)}
            >
              <Trash2 className="size-3" />
              {t('settings.agents.remove')}
            </Button>
          ) : null}
        </div>
        {open ? <ManualSnippet providerKey={provider.key} /> : null}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {providers.data ? (
        <section className="space-y-2">
          <SectionHeader title={t('settings.binary.title')} hint="GET /mcp/providers" />
          <MCPBinaryPanel binary={providers.data.binary} />
        </section>
      ) : null}

      <section className="space-y-2">
        <SectionHeader
          title={t('settings.agents.title')}
          hint={t('settings.agents.selectedHint')}
        />
        <p className="text-2xs text-muted-foreground">
          {t('settings.agents.explainBefore')}
          <code className="text-secondary">{t('settings.agents.explainCode')}</code>
          {t('settings.agents.explainAfter')}
          <span className="text-foreground">{t('settings.agents.explainManual')}</span>
          {t('settings.agents.explainEnd')}
        </p>
        <StepProviders
          providers={list}
          selected={selected}
          onToggle={toggle}
          onSelectDetected={selectDetected}
          onClear={() => setSelected([])}
          renderFooter={renderFooter}
        />
      </section>

      {selected.length > 0 ? (
        <section className="space-y-2">
          <SectionHeader
            title={t('settings.agents.apply')}
            hint={t('settings.agents.marked', { count: selected.length })}
          />
          <StepApply
            key={selected.join(',')}
            providers={list}
            selected={selected}
            autoRun={false}
            renderActions={({ run, pending, done }) => (
              <div className="flex flex-wrap items-center gap-2 border border-border bg-sunken px-2 py-1.5">
                <Button size="sm" onClick={run} disabled={pending}>
                  <Plug className="size-3" />
                  {done
                    ? t('settings.agents.reconfigure')
                    : t('settings.agents.configureSelected')}
                </Button>
                <span className="text-2xs text-muted-foreground">
                  {done
                    ? t('settings.agents.rewriteNote')
                    : t('settings.agents.willWrite', { count: selected.length })}
                </span>
              </div>
            )}
          />
        </section>
      ) : (
        <p className="text-2xs text-muted-foreground">
          {t('settings.agents.noneSelected')}
        </p>
      )}

      <p className="flex items-start gap-1.5 border border-border bg-sunken px-2 py-2 text-2xs text-muted-foreground">
        <RefreshCw className="mt-0.5 size-3 shrink-0 text-primary" />
        <span>
          Los clientes leen su configuración de MCP al arrancar: reinicia el que acabas de
          configurar para que sus tools aparezcan.
        </span>
      </p>
    </div>
  )
}
