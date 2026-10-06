import type { ReactNode } from 'react'
import { ImageIcon, ImageOff } from 'lucide-react'

import { API_BASE } from '@/api/client'
import type { BackgroundEffect, BackgroundSetting } from '@/api/types'
import { BackdropLayer, useImageLoad } from '@/components/common/BackdropLayer'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useT, type TranslationKey } from '@/i18n'
import {
  BACKGROUND_BLUR_MAX,
  BACKGROUND_EFFECTS,
  backgroundUrl,
  backgroundVisibility,
  effectTakesBlur,
} from '@/lib/background'
import { cn } from '@/lib/utils'

const EFFECT_LABEL: Record<BackgroundEffect, TranslationKey> = {
  none: 'settings.background.effect.none',
  dither: 'settings.background.effect.dither',
  ascii: 'settings.background.effect.ascii',
  halftone: 'settings.background.effect.halftone',
  scanlines: 'settings.background.effect.scanlines',
  haze: 'settings.background.effect.haze',
}

const EFFECT_HINT: Record<BackgroundEffect, TranslationKey> = {
  none: 'settings.background.effect.noneHint',
  dither: 'settings.background.effect.ditherHint',
  ascii: 'settings.background.effect.asciiHint',
  halftone: 'settings.background.effect.halftoneHint',
  scanlines: 'settings.background.effect.scanlinesHint',
  haze: 'settings.background.effect.hazeHint',
}

/** Aviso de que la imagen no se pudo cargar, con lo que se puede hacer. */
export function BackgroundFailure({
  onChange,
  onRemove,
  className,
}: {
  onChange: () => void
  onRemove?: () => void
  className?: string
}) {
  const t = useT()
  return (
    <div
      role="alert"
      className={cn('flex flex-col items-center gap-2 text-center text-2xs text-muted-foreground', className)}
    >
      <ImageOff className="size-4 text-destructive" />
      <span className="max-w-80">
        {t('settings.background.failure', { reason: t('settings.background.unreadable') })}
      </span>
      <div className="flex gap-1.5">
        <Button size="sm" variant="outline" onClick={onChange}>
          {t('settings.background.change')}
        </Button>
        {onRemove ? (
          <Button size="sm" variant="ghost" onClick={onRemove}>
            {t('settings.background.remove')}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

/** Una de las dos vistas previas: una pantalla sin documento o con uno abierto. */
function PreviewPane({
  label,
  src,
  background,
  hasDocument,
  onLoad,
  onError,
}: {
  label: string
  src: string
  background: BackgroundSetting
  hasDocument: boolean
  onLoad: () => void
  onError: () => void
}) {
  const visibility = backgroundVisibility(background, hasDocument)
  return (
    <div className="relative flex flex-col gap-2 overflow-hidden bg-background p-2 pt-8">
      <BackdropLayer
        src={src}
        visibility={visibility}
        blur={background.blur}
        effect={background.effect}
        onLoad={onLoad}
        onError={onError}
      />
      <span className="absolute left-2 top-2 border border-border bg-panel/80 px-1.5 py-0.5 text-2xs text-muted-foreground">
        {label} · {Math.round(visibility * 100)}%
      </span>
      {hasDocument ? (
        // Un documento abierto: la barra del editor y unas líneas de texto.
        <div className="relative flex flex-1 flex-col gap-1.5 border border-border bg-panel/70 p-2">
          <div className="h-1.5 w-1/2 bg-primary/70" />
          <div className="h-1 w-11/12 bg-foreground/45" />
          <div className="h-1 w-4/5 bg-foreground/45" />
          <div className="h-1 w-5/6 bg-foreground/45" />
          <div className="h-1 w-2/3 bg-foreground/45" />
        </div>
      ) : (
        // Una pantalla de listas: un par de tarjetas y aire alrededor.
        <div className="relative grid grid-cols-2 gap-1.5">
          <div className="h-8 border border-border bg-panel/70" />
          <div className="h-8 border border-border bg-panel/70" />
        </div>
      )}
    </div>
  )
}

/** Las dos vistas previas lado a lado, con el aspecto que se está ajustando. */
export function BackgroundPreview({
  background,
  onPick,
}: {
  background: BackgroundSetting | null
  onPick: () => void
}) {
  const t = useT()
  const src = background ? backgroundUrl(API_BASE, background.image) : undefined
  const { load, onLoad, onError } = useImageLoad(src)
  return (
    <div className="relative grid h-36 grid-cols-2 gap-px overflow-hidden border border-border bg-border">
      {background && src && load !== 'failed' ? (
        <>
          <PreviewPane
            label={t('settings.background.emptyPane')}
            src={src}
            background={background}
            hasDocument={false}
            onLoad={onLoad}
            onError={onError}
          />
          <PreviewPane
            label={t('settings.background.documentPane')}
            src={src}
            background={background}
            hasDocument
            onLoad={onLoad}
            onError={onError}
          />
        </>
      ) : null}
      {load === 'failed' ? (
        <div className="absolute inset-0 grid place-items-center bg-background">
          <BackgroundFailure onChange={onPick} className="px-4" />
        </div>
      ) : !background || load === 'loading' ? (
        <div className="absolute inset-0 grid place-items-center bg-background">
          <div className="flex flex-col items-center gap-1.5 text-2xs text-muted-foreground">
            <ImageIcon className="size-4" />
            {background ? t('settings.background.loading') : t('settings.background.none')}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function Row({
  label,
  hint,
  disabled,
  children,
}: {
  label: string
  hint: string
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border px-2 py-2',
        disabled ? 'opacity-50' : null,
      )}
    >
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="text-xs text-foreground">{label}</div>
        <p className="text-2xs text-muted-foreground">{hint}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  )
}

function SliderRow({
  label,
  hint,
  value,
  max,
  format,
  disabled,
  onChange,
  onCommit,
}: {
  label: string
  hint: string
  value: number
  max: number
  format: (value: number) => string
  disabled: boolean
  onChange: (value: number) => void
  onCommit: () => void
}) {
  return (
    <Row label={label} hint={hint} disabled={disabled}>
      <input
        type="range"
        min={0}
        max={max}
        step={1}
        value={value}
        disabled={disabled}
        aria-label={label}
        // Se ajusta en vivo y se guarda al soltar: guardar a cada paso escribiría
        // el archivo de configuración decenas de veces por segundo.
        onChange={(event) => onChange(Number(event.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        onBlur={onCommit}
        className="h-1.5 w-40 cursor-pointer accent-[var(--color-primary)] disabled:cursor-not-allowed"
      />
      <span className="w-10 text-right text-xs tabular-nums text-foreground">{format(value)}</span>
    </Row>
  )
}

/**
 * Los controles del aspecto: efecto, en qué pantallas se ve, las dos
 * visibilidades y el difuminado. `onTune` cambia el borrador (vista previa en
 * vivo) y `onCommit` lo guarda.
 */
export function BackgroundLookRows({
  look,
  tunable,
  onTune,
  onCommit,
}: {
  look: BackgroundSetting
  tunable: boolean
  onTune: (patch: Partial<BackgroundSetting>) => void
  onCommit: (patch?: Partial<BackgroundSetting>) => void
}) {
  const t = useT()
  const blurs = effectTakesBlur(look.effect)
  return (
    <>
      <Row label={t('settings.background.effect.label')} hint={t(EFFECT_HINT[look.effect])} disabled={!tunable}>
        <Select
          value={look.effect}
          disabled={!tunable}
          onValueChange={(value) => onCommit({ effect: value as BackgroundEffect })}
        >
          <SelectTrigger className="h-7 w-32" aria-label={t('settings.background.effect.label')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BACKGROUND_EFFECTS.map((effect) => (
              <SelectItem key={effect} value={effect}>
                {t(EFFECT_LABEL[effect])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>
      <Row
        label={t('settings.background.showOn.label')}
        hint={
          look.show_on === 'empty'
            ? t('settings.background.showOn.emptyHint')
            : t('settings.background.showOn.allHint')
        }
        disabled={!tunable}
      >
        <div
          role="radiogroup"
          aria-label={t('settings.background.showOn.label')}
          className="flex border border-border bg-sunken p-0.5"
        >
          {(['empty', 'all'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={look.show_on === value}
              disabled={!tunable}
              onClick={() => onCommit({ show_on: value })}
              className={cn(
                'px-2 py-0.5 text-2xs transition-colors',
                look.show_on === value
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {value === 'empty'
                ? t('settings.background.showOn.empty')
                : t('settings.background.showOn.all')}
            </button>
          ))}
        </div>
      </Row>
      <SliderRow
        label={t('settings.background.emptyVisibility.label')}
        hint={t('settings.background.emptyVisibility.hint')}
        value={Math.round(look.empty_visibility * 100)}
        max={100}
        format={(value) => `${value}%`}
        disabled={!tunable}
        onChange={(value) => onTune({ empty_visibility: value / 100 })}
        onCommit={() => onCommit()}
      />
      <SliderRow
        label={t('settings.background.documentVisibility.label')}
        hint={t('settings.background.documentVisibility.hint')}
        value={Math.round(look.document_visibility * 100)}
        max={100}
        format={(value) => `${value}%`}
        disabled={!tunable || look.show_on === 'empty'}
        onChange={(value) => onTune({ document_visibility: value / 100 })}
        onCommit={() => onCommit()}
      />
      <SliderRow
        label={t('settings.background.blur.label')}
        hint={blurs ? t('settings.background.blur.hint') : t('settings.background.blur.hintNone')}
        value={look.blur}
        max={BACKGROUND_BLUR_MAX}
        format={(value) => `${value}px`}
        disabled={!tunable || !blurs}
        onChange={(blur) => onTune({ blur })}
        onCommit={() => onCommit()}
      />
    </>
  )
}
