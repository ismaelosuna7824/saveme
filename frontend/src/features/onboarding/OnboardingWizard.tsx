import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ArrowLeft, ArrowRight, Check, SkipForward } from 'lucide-react'

import { errorMessage } from '@/api/client'
import { useMCPProviders, useUpdateConfig } from '@/api/queries'
import type { MCPProvider } from '@/api/types'
import { ErrorPanel } from '@/components/common/ErrorPanel'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { StepApply } from '@/features/onboarding/StepApply'
import { StepDone } from '@/features/onboarding/StepDone'
import { StepIntro } from '@/features/onboarding/StepIntro'
import { StepProviders } from '@/features/onboarding/StepProviders'
import { useT, type TranslationKey } from '@/i18n'
import { cn } from '@/lib/utils'

const STEP_TITLE_KEYS = [
  'onboarding.nav.intro',
  'onboarding.nav.providers',
  'onboarding.nav.apply',
  'onboarding.nav.done',
] as const satisfies readonly TranslationKey[]
const LAST_STEP = STEP_TITLE_KEYS.length - 1

interface OnboardingWizardProps {
  open: boolean
  /** Cierra el asistente. El que llama decide si además lo marca como visto. */
  onClose: () => void
}

/**
 * Asistente de configuración del MCP.
 *
 * Cuatro pasos: explicar qué va a pasar, elegir clientes, aplicarlo y decir qué
 * queda por hacer. Todo lo que muestra viene del core, sin inventar rutas ni
 * estados: el binario es el mismo que ejecuta la app, así que no hay descargas.
 */
export function OnboardingWizard({ open, onClose }: OnboardingWizardProps) {
  const t = useT()
  // Solo se consulta con el asistente abierto: cerrado no hay nada que mostrar y
  // no tiene sentido golpear al core en cada arranque.
  const providers = useMCPProviders({ enabled: open })
  const updateConfig = useUpdateConfig()

  const stepTitles = STEP_TITLE_KEYS.map((key) => t(key))

  const [step, setStep] = useState(0)
  const [selected, setSelected] = useState<string[]>([])
  const [preselected, setPreselected] = useState(false)

  // La preselección es lo detectado que aún no está configurado y se puede
  // escribir solo: es el caso en el que el asistente aporta algo.
  useEffect(() => {
    if (preselected || !providers.data) return
    setSelected(
      providers.data.providers
        .filter((provider) => provider.installed && !provider.configured && provider.writable)
        .map((provider) => provider.key),
    )
    setPreselected(true)
  }, [preselected, providers.data])

  const toggle = (key: string) => {
    setSelected((previous) =>
      previous.includes(key) ? previous.filter((item) => item !== key) : [...previous, key],
    )
  }

  const selectDetected = () => {
    const detected = (providers.data?.providers ?? [])
      .filter((provider) => provider.installed && provider.writable)
      .map((provider) => provider.key)
    setSelected((previous) => [...new Set([...previous, ...detected])])
  }

  /**
   * Salir del asistente lo marca como visto: queda accesible desde la paleta.
   * Si el core no responde igual se cierra, pero se dice por qué. El paso vuelve
   * al principio para que reabrirlo no vuelva a aplicar lo que ya se aplicó.
   */
  const finish = () => {
    setStep(0)
    updateConfig.mutate(
      { onboarded: true },
      {
        onError: (error) =>
          toast.error(t('onboarding.wizard.saveFailed'), {
            description: errorMessage(error),
          }),
      },
    )
    onClose()
  }

  const body = () => {
    if (step === LAST_STEP) return <StepDone />

    if (providers.isLoading) {
      return (
        <div className="space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      )
    }

    if (providers.error) {
      return (
        <ErrorPanel
          error={providers.error}
          title={t('onboarding.wizard.coreUnavailable')}
          onRetry={() => {
            void providers.refetch()
          }}
        />
      )
    }

    const list: MCPProvider[] = providers.data?.providers ?? []
    if (step === 0) return <StepIntro />
    if (step === 1) {
      return (
        <StepProviders
          providers={list}
          selected={selected}
          onToggle={toggle}
          onSelectDetected={selectDetected}
          onClear={() => setSelected([])}
        />
      )
    }
    return <StepApply providers={list} selected={selected} />
  }

  // Sin el core no hay nada que configurar: el único camino es reintentar (el
  // ErrorPanel lo ofrece) o salir.
  const nextDisabled = (step === 1 && selected.length === 0) || providers.error !== null
  const hint =
    step === 1 && selected.length === 0 ? t('onboarding.wizard.emptySelection') : null

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) finish()
      }}
    >
      <DialogContent className="flex max-h-[92vh] w-[calc(100vw-2rem)] flex-col sm:max-w-3xl">
        <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2 pr-8">
          <DialogTitle className="shrink-0 text-2xs uppercase tracking-[0.14em] text-primary">
            {t('onboarding.wizard.title')}
          </DialogTitle>
          <div className="flex items-center gap-1" aria-hidden>
            {stepTitles.map((title, index) => (
              <span
                key={title}
                className={cn('h-1 w-6', index <= step ? 'bg-primary' : 'bg-border-strong')}
              />
            ))}
          </div>
          <span className="ml-auto shrink-0 text-2xs text-muted-foreground">
            {t('onboarding.nav.step', {
              current: step + 1,
              total: stepTitles.length,
              title: stepTitles[step],
            })}
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <DialogDescription className="sr-only">
            {t('onboarding.wizard.description')}
          </DialogDescription>
          {body()}
        </div>

        <DialogFooter className="shrink-0">
          {hint ? <span className="mr-auto text-2xs text-muted-foreground">{hint}</span> : null}
          <Button variant="ghost" size="sm" onClick={finish}>
            <SkipForward className="size-3" />
            {t('common.actions.skip')}
          </Button>
          {step > 0 ? (
            <Button variant="outline" size="sm" onClick={() => setStep(step - 1)}>
              <ArrowLeft className="size-3" />
              {t('common.actions.back')}
            </Button>
          ) : null}
          {step < LAST_STEP ? (
            <Button size="sm" disabled={nextDisabled} onClick={() => setStep(step + 1)}>
              {t('common.actions.next')}
              <ArrowRight className="size-3" />
            </Button>
          ) : (
            <Button size="sm" onClick={finish}>
              <Check className="size-3" />
              {t('common.actions.finish')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
