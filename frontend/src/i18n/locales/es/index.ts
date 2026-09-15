import type { DeepString } from '../../types'
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
 * Traducciones en español. **Es la fuente de verdad de las claves**: el inglés se
 * declara `satisfies` contra la forma de este objeto, así que añadir una clave
 * aquí y olvidarla allí no compila.
 */
export const es = {
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
} as const

/**
 * La forma que tiene que cumplir cualquier traducción.
 *
 * El `DeepString` es imprescindible: sin él, `typeof es` daría a cada texto su
 * tipo literal y el inglés tendría que decir exactamente las mismas palabras.
 * Lo que debe coincidir son las claves.
 */
export type TranslationShape = DeepString<typeof es>
