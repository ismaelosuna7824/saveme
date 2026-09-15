import { ArrowUpCircle, Download, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useAppUpdate } from '@/features/update/useAppUpdate'
import { useT } from '@/i18n'

/**
 * Aviso de versión nueva.
 *
 * Aparece abajo a la derecha, encima de todo, y **solo cuando hay algo que
 * hacer**: si no hay versión nueva, si la comprobación falló o si el usuario ya
 * lo apartó, no se pinta nada. Un aviso permanente de «estás al día» sería ruido
 * en cada arranque a cambio de nada.
 *
 * Se declara `aria-live="polite"` porque aparece solo, sin que nadie lo pida: así
 * un lector de pantalla lo anuncia cuando llega en vez de dejarlo ahí mudo.
 */
export function UpdateNotice() {
  const t = useT()
  const { stage, version, notes, progress, install, dismiss } = useAppUpdate()

  if (stage === 'idle') return null

  // Mientras se descarga o se instala no se puede cerrar: el trabajo ya está en
  // marcha y esconder el progreso dejaría al usuario sin saber qué pasa.
  const working = stage === 'downloading' || stage === 'installed'

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-auto fixed bottom-4 right-4 z-50 w-[min(26rem,calc(100vw-2rem))] border border-border-strong bg-panel p-3 shadow-lg"
    >
      <div className="flex items-start gap-2">
        <ArrowUpCircle className="mt-0.5 size-3.5 shrink-0 text-accent" />

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-2xs uppercase tracking-[0.14em] text-muted-foreground">
              {t('update.title')}
            </span>
            {version !== null ? (
              <span className="font-mono text-xs text-accent">
                {t('update.version', { version })}
              </span>
            ) : null}
          </div>

          {stage === 'failed' ? (
            <p className="mt-2 text-xs text-destructive">
              {t('update.failed')}
              <span className="text-muted-foreground"> · {t('update.failedHint')}</span>
            </p>
          ) : null}

          {/* Las notas son texto de la release: se pintan tal cual, con los saltos
              de línea que traiga, y con tope de alto para que una lista larga no
              se coma la pantalla. */}
          {notes !== null && notes.trim() !== '' && !working ? (
            <div className="mt-2">
              <div className="text-2xs uppercase tracking-[0.14em] text-muted-foreground">
                {t('update.notes')}
              </div>
              <p className="mt-1 max-h-32 overflow-y-auto whitespace-pre-line text-xs text-foreground">
                {notes}
              </p>
            </div>
          ) : null}

          {working ? (
            <div className="mt-2">
              <div className="flex items-baseline justify-between text-2xs uppercase tracking-[0.14em] text-muted-foreground">
                <span>
                  {stage === 'installed' ? t('update.restarting') : t('update.downloading')}
                </span>
                {progress !== null ? (
                  <span className="font-mono">{Math.round(progress * 100)}%</span>
                ) : null}
              </div>
              {/* Barra indeterminada cuando el servidor no dijo cuánto pesa: se
                  prefiere eso a inventar un porcentaje. */}
              <div className="mt-1 h-1 w-full bg-muted">
                <div
                  className="h-full bg-accent transition-[width] duration-200"
                  style={{ width: progress === null ? '100%' : `${Math.round(progress * 100)}%` }}
                />
              </div>
            </div>
          ) : null}

          {!working ? (
            <div className="mt-3 flex items-center gap-2">
              <Button size="sm" onClick={install} disabled={stage === 'failed'}>
                <Download />
                {t('update.install')}
              </Button>
              <Button size="sm" variant="ghost" onClick={dismiss}>
                {t('update.later')}
              </Button>
            </div>
          ) : null}
        </div>

        {!working ? (
          <button
            type="button"
            onClick={dismiss}
            title={t('update.later')}
            className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="size-3.5" />
            <span className="sr-only">{t('update.later')}</span>
          </button>
        ) : null}
      </div>
    </div>
  )
}
