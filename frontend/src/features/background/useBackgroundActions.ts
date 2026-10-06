import { toast } from 'sonner'

import { errorMessage } from '@/api/client'
import { useUpdateConfig, useUploadBackground } from '@/api/queries'
import type { BackgroundSetting, ConfigPatch } from '@/api/types'
import { pickImageFile } from '@/features/background/pickImage'
import { useT } from '@/i18n'
import { DEFAULT_BACKGROUND_LOOK } from '@/lib/background'

/** A qué fondo se aplica un cambio: el global o el propio de un proyecto. */
export type BackgroundTarget = { kind: 'global' } | { kind: 'project'; project: string }

function patchFor(target: BackgroundTarget, setting: BackgroundSetting | null): ConfigPatch {
  return target.kind === 'global'
    ? { background: setting }
    : { project_backgrounds: { [target.project]: setting } }
}

/**
 * Elegir, ajustar y quitar imágenes de fondo.
 *
 * Elegir es dos pasos: subir la imagen al core, que guarda una copia, y guardar
 * en la configuración el fondo que la usa. Si el usuario cancela el selector no
 * pasa nada, ni error ni aviso.
 */
export function useBackgroundActions() {
  const t = useT()
  const update = useUpdateConfig()
  const upload = useUploadBackground()

  const save = (patch: ConfigPatch, ok?: string) =>
    update.mutateAsync(patch).then(
      () => {
        if (ok) toast.success(ok)
      },
      (error: unknown) => {
        toast.error(t('settings.background.saveFailed'), { description: errorMessage(error) })
      },
    )

  /**
   * Elige una imagen nueva para `target`. Se conserva el aspecto que ya tenía; si
   * no tenía, se hereda `inherited` (el fondo que se veía) o el de por defecto.
   */
  const choose = async (
    target: BackgroundTarget,
    current: BackgroundSetting | null,
    inherited: BackgroundSetting | null = null,
  ) => {
    const file = await pickImageFile()
    if (file === null) return
    let image: string
    try {
      image = (await upload.mutateAsync(file)).image
    } catch (error) {
      toast.error(t('settings.background.pickFailed'), { description: errorMessage(error) })
      return
    }
    const look = current ?? inherited ?? { ...DEFAULT_BACKGROUND_LOOK, image }
    await save(patchFor(target, { ...look, image }), t('settings.background.saved'))
  }

  const tune = (target: BackgroundTarget, setting: BackgroundSetting) => save(patchFor(target, setting))

  const remove = (target: BackgroundTarget) =>
    save(patchFor(target, null), t('settings.background.removed'))

  /** Quita la global y la de todos los proyectos. */
  const removeAll = (projects: string[]) =>
    save(
      {
        background: null,
        project_backgrounds: Object.fromEntries(projects.map((project) => [project, null])),
      },
      t('settings.background.removed'),
    )

  return { choose, tune, remove, removeAll, busy: update.isPending || upload.isPending }
}
