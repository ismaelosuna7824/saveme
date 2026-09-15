import { useEffect, useState } from 'react'
import { Download, RefreshCw } from 'lucide-react'

import { IN_TAURI } from '@/api/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useAppUpdate } from '@/features/update/useAppUpdate'
import { useT } from '@/i18n'

/**
 * Versión de la app y comprobación de actualizaciones.
 *
 * Existe porque el aviso automático solo aparece **cuando hay algo que anunciar**,
 * y eso hace imposible distinguir «estás al día» de «esto no funciona». Aquí se
 * puede preguntar a mano y ver la respuesta, que es lo que convierte el
 * actualizador en algo en lo que se puede confiar.
 *
 * La versión que se enseña es la de la **app** —la que compara el actualizador—,
 * no la del core de Go que lleva dentro. Son dos números distintos: la del core
 * lleva el `git describe` del build, y confundirlas hace que uno se pregunte por
 * qué no le ofrecen una versión que cree que tiene.
 */
export function SettingsApp() {
  const t = useT()
  const [version, setVersion] = useState<string | null>(null)
  const { stage, version: nueva, checkState, checkNow, install } = useAppUpdate()

  useEffect(() => {
    // Fuera de Tauri no hay versión que preguntar, y en el navegador esto no pinta
    // nada: la sección se queda con el aviso de que hace falta la app.
    if (!IN_TAURI) return
    let alive = true
    void (async () => {
      const { getVersion } = await import('@tauri-apps/api/app')
      const v = await getVersion()
      if (alive) setVersion(v)
    })()
    return () => {
      alive = false
    }
  }, [])

  const busy = checkState === 'checking' || stage === 'downloading' || stage === 'installed'

  return (
    <div className="space-y-2">
      <div className="space-y-1 border border-border bg-panel px-2 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-foreground">{t('settings.app.title')}</span>
          {version !== null ? (
            <Badge variant="secondary">v{version}</Badge>
          ) : (
            <Badge variant="muted">{t('settings.app.unknownVersion')}</Badge>
          )}
        </div>

        <p className="text-2xs text-muted-foreground">{t('settings.app.blurb')}</p>

        {/* El resultado de la comprobación pedida a mano. La automática no deja
            rastro a propósito: si falla por falta de red, nadie tiene por qué
            enterarse. */}
        {stage === 'available' && nueva !== null ? (
          <p className="text-2xs text-accent">{t('settings.app.available', { version: nueva })}</p>
        ) : null}
        {checkState === 'up-to-date' ? (
          <p className="text-2xs text-secondary">{t('settings.app.upToDate')}</p>
        ) : null}
        {checkState === 'failed' ? (
          <p className="text-2xs text-destructive">{t('settings.app.checkFailed')}</p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {stage === 'available' ? (
          <Button size="sm" onClick={install} disabled={busy}>
            <Download className="size-3" />
            {t('settings.app.installNow')}
          </Button>
        ) : null}
        <Button size="sm" variant="outline" onClick={checkNow} disabled={busy}>
          <RefreshCw className="size-3" />
          {checkState === 'checking' ? t('settings.app.checking') : t('settings.app.check')}
        </Button>
        <span className="text-2xs text-muted-foreground">{t('settings.app.signed')}</span>
      </div>
    </div>
  )
}
