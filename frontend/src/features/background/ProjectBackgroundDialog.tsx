import { useConfig } from '@/api/queries'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { BackgroundLookRows, BackgroundPreview } from '@/features/background/BackgroundControls'
import { useBackgroundActions } from '@/features/background/useBackgroundActions'
import { useBackgroundDraft } from '@/features/background/useBackgroundDraft'
import { useT } from '@/i18n'

/**
 * La imagen de fondo propia de un proyecto.
 *
 * Solo enseña y toca la del proyecto: la global se ajusta en Ajustes. Una imagen
 * nueva hereda el aspecto del fondo que se estaba viendo, para que elegirla no
 * cambie de golpe la visibilidad o el efecto a los que el usuario ya se había
 * acostumbrado.
 */
export function ProjectBackgroundDialog({
  project,
  name,
  open,
  onOpenChange,
}: {
  project: string
  name: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const t = useT()
  const config = useConfig()
  const actions = useBackgroundActions()
  const target = { kind: 'project', project } as const
  const own = config.data?.project_backgrounds?.[project] ?? null
  const global = config.data?.background ?? null
  const draft = useBackgroundDraft(own, (setting) => actions.tune(target, setting))
  const pick = () => void actions.choose(target, own, global)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('settings.background.project.title')}</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-2">
          <DialogDescription>{t('settings.background.project.description', { project: name })}</DialogDescription>
          <BackgroundPreview background={draft.look} onPick={pick} />
          <p className="text-2xs text-muted-foreground">
            {own
              ? t('settings.background.project.overrides')
              : global
                ? t('settings.background.project.inheritsGlobal')
                : t('settings.background.project.none')}
          </p>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="outline" disabled={actions.busy} onClick={pick}>
              {own ? t('settings.background.project.change') : t('settings.background.project.choose')}
            </Button>
            {own ? (
              <Button
                size="sm"
                variant="destructive"
                disabled={actions.busy}
                onClick={() => void actions.remove(target)}
              >
                {t('settings.background.project.remove')}
              </Button>
            ) : null}
          </div>
        </DialogBody>
        {draft.look ? (
          <div className="border-b border-border">
            <BackgroundLookRows
              look={draft.look}
              tunable
              onTune={draft.tune}
              onCommit={draft.commit}
            />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
