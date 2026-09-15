import type { TranslationShape } from '../es'
import { common } from './common'
import { dashboard } from './dashboard'
import { editor } from './editor'
import { errors } from './errors'
import { inbox } from './inbox'
import { notes } from './notes'
import { onboarding } from './onboarding'
import { projects } from './projects'
import { settings } from './settings'
import { shell } from './shell'
import { update } from './update'

/**
 * Traducciones en inglés.
 *
 * El `satisfies` es la garantía: si falta una clave que exista en español, o
 * sobra una que no existe, esto no compila. No es una comprobación de estilo, es
 * lo que impide que una traducción se degrade con el tiempo.
 */
export const en = {
  common,
  shell,
  editor,
  projects,
  inbox,
  onboarding,
  settings,
  dashboard,
  errors,
  notes,
  update,
} satisfies TranslationShape
