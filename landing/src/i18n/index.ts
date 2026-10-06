import en from './en'
import es, { type Dict } from './es'

export type Lang = 'en' | 'es'

export const LANGS: readonly Lang[] = ['en', 'es']

export const LANG_NAMES: Record<Lang, string> = { en: 'English', es: 'Español' }

export const DICTS: Record<Lang, Dict> = { en, es }

/** Ruta de la portada en cada idioma. Inglés es el idioma por defecto y va sin prefijo. */
export const LANG_PATHS: Record<Lang, string> = { en: '/', es: '/es/' }
