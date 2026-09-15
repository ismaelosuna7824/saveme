import { useState } from 'react'
import { Check, Minus, Plus } from 'lucide-react'
import { toast } from 'sonner'

import { errorMessage } from '@/api/client'
import { applyWindowOpacity } from '@/lib/translucency'
import { useConfig, useUpdateConfig } from '@/api/queries'
import type { ConfigPatch } from '@/api/types'
import { useUi } from '@/app/preferences'
import { ErrorPanel } from '@/components/common/ErrorPanel'
import { SectionHeader } from '@/components/common/SectionHeader'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { MODE_HINT_KEY, MODE_LABEL_KEY, PREVIEW_MODES } from '@/features/editor/mode'
import {
  clampFontSize,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  THEME_OPTIONS,
} from '@/features/settings/themeOptions'
import { LOCALES, LOCALE_LABEL, useT } from '@/i18n'
import { cn } from '@/lib/utils'

/** Tarjeta de opción única. Es un radio nativo: teclado y flechas salen gratis. */
function ChoiceCard({
  name,
  value,
  active,
  disabled,
  title,
  description,
  onSelect,
}: {
  name: string
  value: string
  active: boolean
  disabled: boolean
  title: string
  description: string
  onSelect: () => void
}) {
  return (
    <label
      className={cn(
        'flex items-start gap-2 border px-2 py-2 transition-colors motion-reduce:transition-none',
        active ? 'border-primary/45 bg-primary/5' : 'border-border bg-panel hover:border-border-strong',
        'focus-within:ring-1 focus-within:ring-ring',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        className="sr-only"
        checked={active}
        disabled={disabled}
        onChange={onSelect}
      />
      <span
        aria-hidden
        className={cn(
          'mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-xs border',
          active ? 'border-primary bg-primary' : 'border-border-strong bg-sunken',
        )}
      >
        {active ? <Check className="size-2.5 text-primary-foreground" strokeWidth={3} /> : null}
      </span>
      <span className="min-w-0">
        <span className="block text-xs text-foreground">{title}</span>
        <span className="block text-2xs text-muted-foreground">{description}</span>
      </span>
    </label>
  )
}

/**
 * Sección «Apariencia»: idioma, tema y preferencias del editor.
 *
 * Todo se guarda con `PUT /config`. El core fusiona el editor campo a campo, así
 * que cada control manda SOLO lo suyo: mandar `{editor:{wrap}}` no pisa
 * `font_size`, `preview_mode` ni `autosave_ms`.
 */
export function SettingsAppearance() {
  const t = useT()
  const config = useConfig()
  const update = useUpdateConfig()
  const { setPreviewMode } = useUi()

  const busy = update.isPending

  // Mientras se arrastra manda el borrador; el valor guardado vuelve a mandar en
  // cuanto la petición termina, para que la interfaz no se quede mintiendo si el
  // servidor acota el valor.
  const [draft, setDraft] = useState<number | null>(null)
  const opacityShown = draft ?? config.data?.opacity ?? 100

  const commitOpacity = (value: number) => {
    if (value === (config.data?.opacity ?? 100)) {
      setDraft(null)
      return
    }
    apply({ opacity: value }, t('settings.appearance.opacity.changed', { value }))
    setDraft(null)
  }
  const editor = config.data?.editor
  const theme = config.data?.theme ?? ''
  // Vacío significa «el del sistema», que es el valor por defecto del core.
  const language = config.data?.language ?? ''

  const apply = (patch: ConfigPatch, ok: string) => {
    update.mutate(patch, {
      onSuccess: () => toast.success(ok),
      onError: (error) =>
        toast.error(t('settings.appearance.saveFailed'), { description: errorMessage(error) }),
    })
  }

  if (config.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }

  if (config.error) {
    return (
      <ErrorPanel
        error={config.error}
        title={t('settings.appearance.loadFailed')}
        onRetry={() => {
          void config.refetch()
        }}
      />
    )
  }

  if (!config.data || !editor) return null

  const known = THEME_OPTIONS.some((option) => option.key === theme)

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <SectionHeader
          title={t('settings.appearance.language.title')}
          hint={t('settings.appearance.language.hint')}
        />
        <div
          role="radiogroup"
          aria-label={t('settings.appearance.language.title')}
          className="grid gap-1.5 sm:grid-cols-3"
        >
          <ChoiceCard
            name="settings-language"
            value=""
            active={language === ''}
            disabled={busy}
            title={t('settings.appearance.language.auto')}
            description={t('settings.appearance.language.autoDescription')}
            onSelect={() =>
              apply(
                { language: '' },
                t('settings.appearance.language.changed', {
                  name: t('settings.appearance.language.auto'),
                }),
              )
            }
          />
          {LOCALES.map((locale) => (
            <ChoiceCard
              key={locale}
              name="settings-language"
              value={locale}
              active={language === locale}
              disabled={busy}
              title={LOCALE_LABEL[locale]}
              // Cada idioma se describe en su propio idioma: quien busca el suyo
              // lo reconoce antes así. Los dos textos son iguales en los dos
              // diccionarios, y no es un descuido.
              description={t(
                locale === 'es'
                  ? 'settings.appearance.language.esDescription'
                  : 'settings.appearance.language.enDescription',
              )}
              onSelect={() =>
                apply(
                  { language: locale },
                  t('settings.appearance.language.changed', { name: LOCALE_LABEL[locale] }),
                )
              }
            />
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <SectionHeader
          title={t('settings.appearance.opacity.title')}
          hint={t('settings.appearance.opacity.hint')}
        />
        <div className="space-y-1.5 border border-border bg-panel px-2 py-2">
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={20}
              max={100}
              step={5}
              value={opacityShown}
              disabled={busy}
              aria-label={t('settings.appearance.opacity.title')}
              onChange={(event) => {
                const value = Number(event.target.value)
                // El valor vive en estado local mientras se arrastra. Sin esto el
                // input es controlado por la configuración del servidor, que no
                // cambia hasta que se guarda: el pulgar volvía solo al 100 % en
                // cada render y daba la impresión de que no se podía mover.
                setDraft(value)
                // Se aplica en vivo, sin guardar: hacerlo en cada paso escribiría
                // el archivo veinte veces por segundo.
                applyWindowOpacity(value)
              }}
              onMouseUp={(event) => commitOpacity(Number((event.target as HTMLInputElement).value))}
              onTouchEnd={(event) =>
                commitOpacity(Number((event.target as HTMLInputElement).value))
              }
              onKeyUp={(event) => commitOpacity(Number((event.target as HTMLInputElement).value))}
              onBlur={() => commitOpacity(opacityShown)}
              className="h-1.5 min-w-0 flex-1 cursor-pointer accent-[var(--color-primary)]"
            />
            <span className="w-10 shrink-0 text-right text-xs text-foreground">
              {config.data.opacity}%
            </span>
          </div>
          <p className="text-2xs text-muted-foreground">
            {t('settings.appearance.opacity.explain')}
          </p>
        </div>
      </section>

      <section className="space-y-2">
        <SectionHeader
          title={t('settings.appearance.theme.title')}
          hint={t('settings.appearance.theme.hint')}
        />
        <div
          role="radiogroup"
          aria-label={t('settings.appearance.theme.title')}
          className="grid gap-1.5 sm:grid-cols-2"
        >
          {THEME_OPTIONS.map((option) => (
            <ChoiceCard
              key={option.key}
              name="settings-theme"
              value={option.key}
              active={theme === option.key}
              disabled={busy}
              title={t(option.nameKey)}
              description={t(option.descriptionKey)}
              onSelect={() =>
                apply(
                  { theme: option.key },
                  t('settings.appearance.theme.activated', { name: t(option.nameKey) }),
                )
              }
            />
          ))}
        </div>
        {theme.length > 0 && !known ? (
          <p className="text-2xs text-primary/85">
            {t('settings.appearance.theme.unknown', { theme })}
          </p>
        ) : null}
      </section>

      <section className="space-y-2">
        <SectionHeader
          title={t('settings.appearance.editor.title')}
          hint={t('settings.appearance.editor.hint')}
        />

        <div className="space-y-1.5 border border-border bg-panel px-2 py-2">
          <div className="text-xs text-foreground">{t('settings.appearance.fontSize.label')}</div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="icon-sm"
              aria-label={t('settings.appearance.fontSize.decrease')}
              disabled={busy || editor.font_size <= FONT_SIZE_MIN}
              onClick={() =>
                apply(
                  { editor: { font_size: clampFontSize(editor.font_size - 1) } },
                  t('settings.appearance.fontSize.updated'),
                )
              }
            >
              <Minus className="size-3" />
            </Button>
            <span className="w-9 text-center text-xs text-primary">{editor.font_size}px</span>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label={t('settings.appearance.fontSize.increase')}
              disabled={busy || editor.font_size >= FONT_SIZE_MAX}
              onClick={() =>
                apply(
                  { editor: { font_size: clampFontSize(editor.font_size + 1) } },
                  t('settings.appearance.fontSize.updated'),
                )
              }
            >
              <Plus className="size-3" />
            </Button>
            <span className="text-2xs text-muted-foreground">
              {t('settings.appearance.fontSize.range', { min: FONT_SIZE_MIN, max: FONT_SIZE_MAX })}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 border border-border bg-panel px-2 py-2">
          <span className="min-w-0 flex-1">
            <span className="block text-xs text-foreground">
              {t('settings.appearance.wrap.label')}
            </span>
            <span className="block text-2xs text-muted-foreground">
              {t('settings.appearance.wrap.description')}
            </span>
          </span>
          <Switch
            checked={editor.wrap}
            disabled={busy}
            aria-label={t('settings.appearance.wrap.label')}
            onCheckedChange={(checked) =>
              apply(
                { editor: { wrap: checked } },
                checked
                  ? t('settings.appearance.wrap.on')
                  : t('settings.appearance.wrap.off'),
              )
            }
          />
        </div>

        <div className="space-y-1.5">
          <div className="text-xs text-foreground">
            {t('settings.appearance.previewMode.label')}
          </div>
          <div
            role="radiogroup"
            aria-label={t('settings.appearance.previewMode.label')}
            className="grid gap-1.5 sm:grid-cols-2"
          >
            {PREVIEW_MODES.map((mode) => (
              <ChoiceCard
                key={mode}
                name="settings-preview-mode"
                value={mode}
                active={editor.preview_mode === mode}
                disabled={busy}
                title={t(MODE_LABEL_KEY[mode])}
                description={t(MODE_HINT_KEY[mode])}
                onSelect={() => {
                  // Elegir el predeterminado limpia el override de esta sesión:
                  // si no, el editor seguiría con el modo que dejó Cmd+E.
                  setPreviewMode(null)
                  apply(
                    { editor: { preview_mode: mode } },
                    t('settings.appearance.previewMode.saved', { mode: t(MODE_LABEL_KEY[mode]) }),
                  )
                }}
              />
            ))}
          </div>
        </div>
      </section>

      {update.error ? (
        <ErrorPanel
          error={update.error}
          title={t('settings.appearance.lastSaveFailed')}
        />
      ) : null}
    </div>
  )
}
