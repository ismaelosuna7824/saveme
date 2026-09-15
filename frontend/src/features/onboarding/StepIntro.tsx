import { useState, type ReactNode } from 'react'
import { Download, HardDrive, Server, ShieldCheck, Terminal } from 'lucide-react'

import { useInstallMCP, useMCPProviders } from '@/api/queries'
import type { MCPInstallResult } from '@/api/types'
import { ErrorPanel } from '@/components/common/ErrorPanel'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { CopyField } from '@/features/onboarding/CopyField'
import { useT } from '@/i18n'

/** Ruta futura documentada por el core cuando todavía no se instaló nada. */
const FUTURE_PATH = '~/.saveme/bin/saveme'

function Point({
  icon,
  title,
  children,
}: {
  icon: ReactNode
  title: string
  children: ReactNode
}) {
  return (
    <li className="flex gap-2">
      <span className="mt-0.5 shrink-0 text-primary">{icon}</span>
      <div className="min-w-0">
        <div className="text-xs text-foreground">{title}</div>
        <p className="text-2xs text-muted-foreground">{children}</p>
      </div>
    </li>
  )
}

/**
 * Paso 1: qué va a pasar, sin adornos.
 *
 * La promesa del producto es que no hay nada que descargar ni instalar: el MCP
 * es el mismo binario Go que la app. Aquí se dice eso y se deja instalar de
 * verdad, enseñando la ruta real que devolvió el core.
 */
export function StepIntro() {
  const t = useT()
  const providers = useMCPProviders()
  const install = useInstallMCP()
  const [installed, setInstalled] = useState<MCPInstallResult | null>(null)

  if (providers.isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }

  if (providers.error) {
    return (
      <ErrorPanel
        error={providers.error}
        title={t('onboarding.intro.readError')}
        onRetry={() => {
          void providers.refetch()
        }}
      />
    )
  }

  const binary = providers.data?.binary
  const destination = installed?.path ?? binary?.installed_path ?? ''
  const alreadyInstalled = destination.length > 0
  const onPath = installed?.on_path ?? binary?.on_path ?? false

  const doInstall = () => {
    install.mutate(undefined, { onSuccess: (result) => setInstalled(result) })
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-foreground">
        {t('onboarding.intro.lead.before')}
        <span className="text-primary">{t('onboarding.intro.lead.emphasis')}</span>
        {t('onboarding.intro.lead.after')}
      </p>

      <ul className="space-y-2.5">
        <Point
          icon={<Download className="size-3.5" />}
          title={t('onboarding.intro.binary.title')}
        >
          {t('onboarding.intro.binary.body')}
        </Point>
        <Point icon={<HardDrive className="size-3.5" />} title={t('onboarding.intro.ownFolder.title')}>
          {t('onboarding.intro.ownFolder.body')}
        </Point>
        <Point icon={<Server className="size-3.5" />} title={t('onboarding.intro.subcommand.title')}>
          {t('onboarding.intro.subcommand.body')}
        </Point>
      </ul>

      {alreadyInstalled ? (
        <CopyField label={t('onboarding.intro.alreadyAt')} value={destination} maxLines={2} />
      ) : (
        <div className="border border-dashed border-border px-2 py-1.5">
          <div className="text-2xs uppercase tracking-[0.12em] text-muted-foreground">
            {t('onboarding.intro.willBeCreatedAt')}
          </div>
          <code className="text-xs text-secondary">{FUTURE_PATH}</code>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <Button size="sm" onClick={doInstall} disabled={install.isPending}>
          <HardDrive className="size-3" />
          {install.isPending
            ? t('onboarding.intro.installing')
            : alreadyInstalled
              ? t('onboarding.intro.verify')
              : t('onboarding.intro.install')}
        </Button>
        <span className="text-2xs text-muted-foreground">
          {alreadyInstalled
            ? t('onboarding.intro.alreadyInstalled')
            : t('onboarding.intro.nothingDownloaded')}
        </span>
      </div>

      {install.error ? (
        <ErrorPanel
          error={install.error}
          title={t('onboarding.intro.installError')}
          onRetry={doInstall}
        />
      ) : null}

      {installed ? (
        <div className="space-y-1 border border-secondary/35 bg-secondary/5 px-2 py-1.5">
          <div className="flex items-center gap-1.5 text-2xs text-secondary">
            <ShieldCheck className="size-3" />
            {installed.message}
          </div>
          <code className="block break-all text-2xs text-foreground">{installed.path}</code>
          <p className="flex items-start gap-1.5 text-2xs text-muted-foreground">
            <Terminal className="mt-0.5 size-3 shrink-0" />
            {onPath
              ? t('onboarding.intro.onPath')
              : t('onboarding.intro.notOnPath')}
          </p>
        </div>
      ) : null}
    </div>
  )
}
