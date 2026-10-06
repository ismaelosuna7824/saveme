import { Check } from 'lucide-react'
import { toast } from 'sonner'

import { errorMessage } from '@/api/client'
import { useConfig, useUpdateConfig } from '@/api/queries'
import type { ProjectIconChoice } from '@/api/types'
import { SpriteGlyph } from '@/components/common/ProjectSprite'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useT, type TranslationKey } from '@/i18n'
import {
  automaticSprite,
  PROJECT_SPRITE_COLORS,
  PROJECT_SPRITES,
  projectSprite,
} from '@/lib/projectSprite'
import { cn } from '@/lib/utils'

const SPRITE_NAME: Record<string, TranslationKey> = {
  squid: 'projects.icon.sprites.squid',
  crab: 'projects.icon.sprites.crab',
  octopus: 'projects.icon.sprites.octopus',
  antenna: 'projects.icon.sprites.antenna',
  saucer: 'projects.icon.sprites.saucer',
  robot: 'projects.icon.sprites.robot',
  jelly: 'projects.icon.sprites.jelly',
  bat: 'projects.icon.sprites.bat',
  cat: 'projects.icon.sprites.cat',
  frog: 'projects.icon.sprites.frog',
  spider: 'projects.icon.sprites.spider',
  ghost: 'projects.icon.sprites.ghost',
}

const COLOR_NAME: Record<string, TranslationKey> = {
  green: 'projects.icon.colors.green',
  teal: 'projects.icon.colors.teal',
  blue: 'projects.icon.colors.blue',
  violet: 'projects.icon.colors.violet',
  pink: 'projects.icon.colors.pink',
  red: 'projects.icon.colors.red',
  orange: 'projects.icon.colors.orange',
  yellow: 'projects.icon.colors.yellow',
}

/**
 * Elegir el bicho y el color de un proyecto.
 *
 * Cada clic se guarda al momento, como el resto de preferencias: no hay botón de
 * guardar que olvidar, y el icono cambia a la vez en la lateral, la cabecera y
 * todas las pantallas. Forma y color se eligen por separado; cada uno tiene su
 * opción «automático», que es el que sale del nombre del proyecto.
 */
export function ProjectIconDialog({
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
  const update = useUpdateConfig()
  const choice: ProjectIconChoice = config.data?.project_icons?.[project] ?? {}
  const current = projectSprite(project, choice)
  const automatic = automaticSprite(project)

  const save = (next: ProjectIconChoice) => {
    const sprite = next.sprite ?? ''
    const color = next.color ?? ''
    update.mutate(
      { project_icons: { [project]: sprite === '' && color === '' ? null : { sprite, color } } },
      {
        onError: (error) =>
          toast.error(t('projects.icon.saveFailed'), { description: errorMessage(error) }),
      },
    )
  }

  const option = (selected: boolean) =>
    cn(
      'relative grid place-items-center border p-1.5 transition-colors',
      selected
        ? 'border-primary bg-primary/10'
        : 'border-border bg-sunken hover:border-border-strong hover:bg-accent/60',
    )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('projects.icon.title')}</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <DialogDescription className="sr-only">
            {t('projects.icon.description', { name })}
          </DialogDescription>

          <div className="flex items-center gap-3 border border-border bg-sunken px-3 py-2">
            <SpriteGlyph sprite={current} className="size-10" />
            <div className="min-w-0">
              <div className="truncate text-sm text-foreground">{name}</div>
              <div className="text-2xs text-muted-foreground">
                {choice.sprite || choice.color
                  ? t('projects.icon.custom')
                  : t('projects.icon.automaticHint')}
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="text-2xs uppercase tracking-[0.12em] text-muted-foreground">
              {t('projects.icon.shape')}
            </div>
            <div role="radiogroup" aria-label={t('projects.icon.shape')} className="grid grid-cols-7 gap-1.5">
              <button
                type="button"
                role="radio"
                aria-checked={!choice.sprite}
                title={t('projects.icon.automatic')}
                aria-label={t('projects.icon.automatic')}
                disabled={update.isPending}
                onClick={() => save({ ...choice, sprite: '' })}
                className={option(!choice.sprite)}
              >
                <SpriteGlyph
                  sprite={projectSprite(project, { sprite: automatic.sprite.key, color: current.colorKey })}
                  className="size-6"
                />
                <span className="absolute bottom-0 right-0.5 text-[8px] leading-none text-muted-foreground">
                  A
                </span>
              </button>
              {PROJECT_SPRITES.map((sprite) => (
                <button
                  key={sprite.key}
                  type="button"
                  role="radio"
                  aria-checked={choice.sprite === sprite.key}
                  title={t(SPRITE_NAME[sprite.key])}
                  aria-label={t(SPRITE_NAME[sprite.key])}
                  disabled={update.isPending}
                  onClick={() => save({ ...choice, sprite: sprite.key })}
                  className={option(choice.sprite === sprite.key)}
                >
                  <SpriteGlyph
                    sprite={projectSprite(project, { sprite: sprite.key, color: current.colorKey })}
                    className="size-6"
                  />
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="text-2xs uppercase tracking-[0.12em] text-muted-foreground">
              {t('projects.icon.color')}
            </div>
            <div role="radiogroup" aria-label={t('projects.icon.color')} className="flex flex-wrap gap-1.5">
              <button
                type="button"
                role="radio"
                aria-checked={!choice.color}
                title={t('projects.icon.automatic')}
                aria-label={t('projects.icon.automatic')}
                disabled={update.isPending}
                onClick={() => save({ ...choice, color: '' })}
                className={cn(option(!choice.color), 'size-8 p-0')}
              >
                <span className="size-4" style={{ backgroundColor: automatic.color.value }} />
                <span className="absolute bottom-0 right-0.5 text-[8px] leading-none text-muted-foreground">
                  A
                </span>
              </button>
              {PROJECT_SPRITE_COLORS.map((color) => (
                <button
                  key={color.key}
                  type="button"
                  role="radio"
                  aria-checked={choice.color === color.key}
                  title={t(COLOR_NAME[color.key])}
                  aria-label={t(COLOR_NAME[color.key])}
                  disabled={update.isPending}
                  onClick={() => save({ ...choice, color: color.key })}
                  className={cn(option(choice.color === color.key), 'size-8 p-0')}
                >
                  <span className="grid size-4 place-items-center" style={{ backgroundColor: color.value }}>
                    {choice.color === color.key ? <Check className="size-3 text-background" /> : null}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button
            variant="ghost"
            size="sm"
            disabled={update.isPending || (!choice.sprite && !choice.color)}
            onClick={() => save({})}
          >
            {t('projects.icon.reset')}
          </Button>
          <Button size="sm" onClick={() => onOpenChange(false)}>
            {t('common.actions.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
