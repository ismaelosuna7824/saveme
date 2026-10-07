import { useEffect, useState, type ReactNode } from 'react'

import { API_BASE } from '@/api/client'
import { useConfig } from '@/api/queries'
import type { BackgroundSetting } from '@/api/types'
import { BackdropLayer, useImageLoad } from '@/components/common/BackdropLayer'
import { BackgroundFailure } from '@/features/background/BackgroundControls'
import { useBackdropContext } from '@/features/background/useBackdropContext'
import { useBackgroundActions, type BackgroundTarget } from '@/features/background/useBackgroundActions'
import { backgroundUrl, backgroundVisibility, resolveBackground } from '@/lib/background'
import { cn } from '@/lib/utils'

/** Lo que dura el fundido entre dos fondos; igual que `duration-300` de las capas. */
const FADE_MS = 300

interface Layer {
  src: string
  setting: BackgroundSetting
}

/**
 * La ventana entera con la imagen de fondo detrás.
 *
 * Va detrás de todo el marco —barra superior, lateral, contenido y barra de
 * estado—, no solo del contenido: recortada al área central parecía una foto
 * pegada en una caja, con la lateral y las barras como bloques opacos que la
 * cortaban. Cuando se ve, el marco lleva `data-backdrop`: los paneles pasan a
 * ser algo translúcidos y las barras (`.app-chrome`) se vuelven cristal
 * esmerilado (ver `styles.css`).
 *
 * Al cambiar de imagen —otro proyecto con su propio fondo— la anterior se queda
 * debajo hasta que la nueva termina de aparecer encima. Sin eso, mientras la
 * nueva se decodifica no se veía ninguna: los paneles pasaban a opacos y
 * volvían a translúcidos, un parpadeo en cada cambio de proyecto.
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
  const target: BackgroundTarget =
    resolved.source === 'project' && project !== null ? { kind: 'project', project } : { kind: 'global' }

  // El fondo que ya terminó de aparecer. Mientras llega otro, sigue pintado debajo.
  const [painted, setPainted] = useState<Layer | null>(null)
  const incoming: Layer | null =
    background && src && load !== 'failed' ? { src, setting: background } : null
  // Volver a una imagen que ya está pintada no espera a cargarla otra vez: su
  // canvas sigue montado y no vuelve a avisar de que cargó.
  const ready = incoming !== null && (load === 'loaded' || painted?.src === incoming.src)
  const outgoing = painted && painted.src !== incoming?.src ? painted : null

  useEffect(() => {
    if (background && src && ready) {
      if (painted?.src === src) {
        // Mismo fondo con otros ajustes: se apuntan ya, para que si luego se va
        // fundiendo lo haga con el aspecto que tenía en pantalla.
        if (painted.setting !== background) setPainted({ src, setting: background })
        return
      }
      const timer = window.setTimeout(() => setPainted({ src, setting: background }), FADE_MS)
      return () => window.clearTimeout(timer)
    }
    if ((!background || load === 'failed') && painted !== null) {
      const timer = window.setTimeout(() => setPainted(null), FADE_MS)
      return () => window.clearTimeout(timer)
    }
  }, [background, src, ready, load, painted])

  const incomingVisibility = incoming ? backgroundVisibility(incoming.setting, hasDocument) : 0
  const outgoingVisibility = outgoing ? backgroundVisibility(outgoing.setting, hasDocument) : 0
  const incomingShown = ready && incomingVisibility > 0
  // La saliente se ve mientras haya otra llegando; si no llega ninguna, se funde.
  const outgoingShown = incoming !== null && outgoingVisibility > 0
  const visible = incomingShown || (outgoing !== null && outgoingVisibility > 0)

  return (
    <div data-backdrop={visible ? '' : undefined} className="relative h-full w-full overflow-hidden">
      {outgoing ? (
        <BackdropLayer
          key={outgoing.src}
          src={outgoing.src}
          visibility={outgoingVisibility}
          blur={outgoing.setting.blur}
          effect={outgoing.setting.effect}
          className={cn(
            'absolute inset-0 transition-opacity duration-300',
            outgoingShown ? 'opacity-100' : 'opacity-0',
          )}
        />
      ) : null}
      {incoming ? (
        <BackdropLayer
          key={incoming.src}
          src={incoming.src}
          visibility={incomingVisibility}
          blur={incoming.setting.blur}
          effect={incoming.setting.effect}
          onLoad={onLoad}
          onError={onError}
          className={cn(
            'absolute inset-0 transition-opacity duration-300',
            incomingShown ? 'opacity-100' : 'opacity-0',
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
