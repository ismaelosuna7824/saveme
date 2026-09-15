import { useState } from 'react'
import { toast } from 'sonner'
import { HardDrive, ShieldCheck, Terminal } from 'lucide-react'

import { errorMessage } from '@/api/client'
import { useInstallMCP } from '@/api/queries'
import type { MCPBinaryStatus, MCPInstallResult } from '@/api/types'
import { ErrorPanel } from '@/components/common/ErrorPanel'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'

/**
 * Estado del binario MCP y botón para instalarlo.
 *
 * Es el mismo binario que ejecuta la app: no se descarga nada de internet, se
 * copia a una ruta estable para que las configuraciones de los clientes no
 * apunten dentro del `.app`. Instalar de nuevo es idempotente.
 */
export function MCPBinaryPanel({ binary }: { binary: MCPBinaryStatus }) {
  const t = useT()
  const install = useInstallMCP()
  const [result, setResult] = useState<MCPInstallResult | null>(null)

  const path = result?.path ?? binary.installed_path
  const onPath = result?.on_path ?? binary.on_path
  const installed = path.length > 0

  const doInstall = () => {
    install.mutate(undefined, {
      onSuccess: (next) => {
        setResult(next)
        toast.success(next.message)
      },
      onError: (error) => {
        toast.error(t('settings.binary.installFailedToast'), { description: errorMessage(error) })
      },
    })
  }

  return (
    <div className="space-y-2">
      <div className="space-y-1 border border-border bg-panel px-2 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-foreground">servidor MCP</span>
          {installed ? (
            <Badge variant="secondary">
              <ShieldCheck className="size-2.5" />
              instalado
            </Badge>
          ) : (
            <Badge variant="muted">{t('settings.binary.pending')}</Badge>
          )}
          {onPath ? (
            <Badge variant="info">{t('settings.binary.onPathBadge')}</Badge>
          ) : installed ? (
            <Badge variant="outline">{t('settings.binary.absoluteBadge')}</Badge>
          ) : null}
        </div>

        {installed ? (
          <code className="block break-all text-2xs text-muted-foreground">{path}</code>
        ) : (
          <p className="text-2xs text-muted-foreground">
            Se copiará a una carpeta propia de SaveMe. Los clientes apuntarán ahí, no dentro de la
            aplicación.
          </p>
        )}

        <p className="flex items-start gap-1.5 text-2xs text-muted-foreground">
          <Terminal className="mt-0.5 size-3 shrink-0" />
          {onPath
            ? t('settings.binary.onPathNote')
            : t('settings.binary.absoluteOnly')}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={doInstall} disabled={install.isPending}>
          <HardDrive className="size-3" />
          {install.isPending
            ? t('settings.binary.installing')
            : installed
              ? t('settings.binary.verify')
              : t('settings.binary.installNow')}
        </Button>
        <span className="text-2xs text-muted-foreground">
          {installed
            ? t('settings.binary.idempotent')
            : t('settings.binary.noDownload')}
        </span>
      </div>

      {install.error ? (
        <ErrorPanel error={install.error} title={t('settings.binary.installFailed')} onRetry={doInstall} />
      ) : null}
    </div>
  )
}
