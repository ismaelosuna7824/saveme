import { useState } from 'react'

import type { BackgroundSetting } from '@/api/types'

function sameLook(a: BackgroundSetting, b: BackgroundSetting): boolean {
  return (
    a.image === b.image &&
    a.effect === b.effect &&
    a.show_on === b.show_on &&
    a.empty_visibility === b.empty_visibility &&
    a.document_visibility === b.document_visibility &&
    a.blur === b.blur
  )
}

/**
 * El aspecto que se está ajustando, antes de guardarlo.
 *
 * Mientras se arrastra un deslizador manda el borrador —la vista previa cambia
 * en vivo—, y al soltar se guarda. Si lo guardado ya es igual, no se escribe
 * nada: soltar, salir del control y pulsar una tecla disparan los tres el
 * guardado, y sin esto serían tres escrituras del mismo valor.
 */
export function useBackgroundDraft(
  saved: BackgroundSetting | null,
  save: (setting: BackgroundSetting) => Promise<unknown>,
) {
  const [draft, setDraft] = useState<{ image: string; patch: Partial<BackgroundSetting> } | null>(null)
  // Un borrador de otra imagen no vale: al cambiarla se empieza de cero.
  const patch = draft !== null && saved !== null && draft.image === saved.image ? draft.patch : {}
  const look = saved === null ? null : { ...saved, ...patch }

  const tune = (next: Partial<BackgroundSetting>) => {
    if (saved === null) return
    setDraft({ image: saved.image, patch: { ...patch, ...next } })
  }

  const commit = (next: Partial<BackgroundSetting> = {}) => {
    if (saved === null || look === null) return
    const setting = { ...look, ...next }
    if (sameLook(setting, saved)) {
      setDraft(null)
      return
    }
    // Si el usuario sigue moviendo el control mientras se guarda, su borrador nuevo
    // no se pisa al terminar: solo se suelta el que se guardó.
    const pending = { image: saved.image, patch: { ...patch, ...next } }
    setDraft(pending)
    void save(setting).finally(() => setDraft((current) => (current === pending ? null : current)))
  }

  return { look, tune, commit }
}
