import type { ReactNode } from 'react'

import { API_BASE } from '@/api/client'
import { useConfig } from '@/api/queries'
import { BackdropLayer, useImageLoad } from '@/components/common/BackdropLayer'
import { BackgroundFailure } from '@/features/background/BackgroundControls'
import { useBackdropContext } from '@/features/background/useBackdropContext'
import { useBackgroundActions, type BackgroundTarget } from '@/features/background/useBackgroundActions'
import { backgroundUrl, backgroundVisibility, resolveBackground } from '@/lib/background'
import { cn } from '@/lib/utils'

/**
 * La ventana entera con la imagen de fondo detrás.
 *
 * Va detrás de todo el marco —barra superior, lateral, contenido y barra de
 * estado—, no solo del contenido: recortada al área central parecía una foto
 * pegada en una caja, con la lateral y las barras como bloques opacos que la
 * cortaban. Cuando se ve, el marco lleva `data-backdrop`: los paneles pasan a
 * ser algo translúcidos y las barras (`.app-chrome`) se vuelven cristal
 * esmerilado (ver `styles.css`).
 */
export function AppBackdrop({ children }: { children: ReactNode }) {
  const config = useConfig()
  const { project, hasDocument } = useBackdropContext()
  const actions = useBackgroundActions()

  const resolved = resolveBackground(
    config.data ?? { background: null, project_backgrounds: {} },
    project,
  )
  const background = resolved.setting
  const src = background ? backgroundUrl(API_BASE, background.image) : undefined
  const { load, onLoad, onError } = useImageLoad(src)
  const visibility = background ? backgroundVisibility(background, hasDocument) : 0
  const visible = src !== undefined && load === 'loaded' && visibility > 0
  const target: BackgroundTarget =
    resolved.source === 'project' && project !== null ? { kind: 'project', project } : { kind: 'global' }

  return (
    <div data-backdrop={visible ? '' : undefined} className="relative h-full w-full overflow-hidden">
      {background && src && load !== 'failed' ? (
        <BackdropLayer
          src={src}
          visibility={visibility}
          blur={background.blur}
          effect={background.effect}
          onLoad={onLoad}
          onError={onError}
          className={cn(
            'absolute inset-0 transition-opacity duration-300',
            visible ? 'opacity-100' : 'opacity-0',
          )}
        />
      ) : null}
      <div className="relative flex h-full flex-col">{children}</div>
      {load === 'failed' ? (
        <BackgroundFailure
          className="absolute left-1/2 top-12 z-10 -translate-x-1/2 border border-border bg-panel px-4 py-3 shadow-lg"
          onChange={() => void actions.choose(target, background)}
          onRemove={() => void actions.remove(target)}
        />
      ) : null}
    </div>
  )
}
