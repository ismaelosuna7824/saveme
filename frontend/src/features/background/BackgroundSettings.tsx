import { useConfig, useProjects } from '@/api/queries'
import { SectionHeader } from '@/components/common/SectionHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { BackgroundLookRows, BackgroundPreview } from '@/features/background/BackgroundControls'
import { useBackdropContext } from '@/features/background/useBackdropContext'
import { useBackgroundActions, type BackgroundTarget } from '@/features/background/useBackgroundActions'
import { useBackgroundDraft } from '@/features/background/useBackgroundDraft'
import { useT } from '@/i18n'
import { DEFAULT_BACKGROUND_LOOK, resolveBackground } from '@/lib/background'

/**
 * La imagen de fondo en Ajustes → Apariencia.
 *
 * Enseña y ajusta el fondo **que se ve en la pantalla de detrás**: si es la de un
 * proyecto con imagen propia, esa; si no, la global. Así lo que se toca aquí es
 * lo que el usuario estaba mirando al abrir Ajustes.
 */
export function BackgroundSettings() {
  const t = useT()
  const config = useConfig()
  const projects = useProjects()
  const { project } = useBackdropContext()
  const actions = useBackgroundActions()

  const resolved = resolveBackground(
    config.data ?? { background: null, project_backgrounds: {} },
    project,
  )
  const target: BackgroundTarget =
    resolved.source === 'project' && project !== null ? { kind: 'project', project } : { kind: 'global' }
  const draft = useBackgroundDraft(resolved.setting, (setting) => actions.tune(target, setting))

  const nameOf = (slug: string) => projects.data?.find((item) => item.slug === slug)?.name ?? slug
  const pick = () => void actions.choose(target, resolved.setting)
  const look = draft.look

  return (
    <section className="space-y-2">
      <SectionHeader title={t('settings.background.title')} hint={t('settings.background.hint')} />
      <p className="text-2xs text-muted-foreground">{t('settings.background.lead')}</p>

      <div className="border border-border bg-panel">
        <div className="space-y-2 px-2 py-2">
          <BackgroundPreview background={look} onPick={pick} />

          <div className="flex flex-wrap items-center gap-2">
            <span
              className="min-w-0 flex-1 truncate text-xs text-foreground"
              title={look?.image}
            >
              {look ? look.image : (
                <span className="text-muted-foreground">{t('settings.background.placeholder')}</span>
              )}
            </span>
            {resolved.source ? (
              <Badge variant="outline">
                {resolved.source === 'project'
                  ? t('settings.background.badgeProject')
                  : t('settings.background.badgeGlobal')}
              </Badge>
            ) : null}
            <Button size="sm" variant="outline" disabled={actions.busy} onClick={pick}>
              {look ? t('settings.background.change') : t('settings.background.choose')}
            </Button>
            {look ? (
              <Button size="sm" variant="ghost" disabled={actions.busy} onClick={() => void actions.remove(target)}>
                {t('settings.background.remove')}
              </Button>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-2xs text-muted-foreground">
            <span className="min-w-0 flex-1">
              {resolved.source === 'project' && project !== null
                ? resolved.shadowsGlobal
                  ? t('settings.background.originShadows', { project: nameOf(project) })
                  : t('settings.background.originProject', { project: nameOf(project) })
                : t('settings.background.originGlobal')}
            </span>
            {resolved.shadowsGlobal ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={actions.busy}
                onClick={() =>
                  void actions.removeAll(Object.keys(config.data?.project_backgrounds ?? {}))
                }
              >
                {t('settings.background.removeAll')}
              </Button>
            ) : null}
          </div>

          {resolved.others.length > 0 ? (
            <div className="space-y-1">
              <div className="text-2xs uppercase tracking-[0.12em] text-muted-foreground">
                {t('settings.background.others')}
              </div>
              <ul className="space-y-0.5">
                {resolved.others.map((other) => (
                  <li key={other.project} className="flex items-center gap-2 text-2xs">
                    <span className="min-w-0 flex-1 truncate text-foreground">{nameOf(other.project)}</span>
                    <span className="truncate text-muted-foreground">{other.setting.image}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={actions.busy}
                      aria-label={t('settings.background.removeFor', { project: nameOf(other.project) })}
                      onClick={() => void actions.remove({ kind: 'project', project: other.project })}
                    >
                      {t('settings.background.remove')}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <BackgroundLookRows
          look={look ?? { ...DEFAULT_BACKGROUND_LOOK, image: '' }}
          tunable={look !== null}
          onTune={draft.tune}
          onCommit={draft.commit}
        />
      </div>
    </section>
  )
}
