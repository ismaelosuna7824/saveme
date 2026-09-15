/**
 * Opciones de apariencia.
 *
 * `config.theme` es una cadena libre en el core —no valida el valor, para que un
 * tema nuevo no obligue a tocar el backend—, así que la lista de temas válidos
 * vive aquí. Cada uno tiene su bloque de tokens en `styles.css`
 * (`html[data-theme='…']`); `phosphor` es el `@theme` base y no necesita bloque.
 *
 * Si el archivo de configuración trae un valor que aquí no está, la sección lo
 * dice en vez de fingir que es uno de estos.
 *
 * Los textos NO viven aquí: la lista guarda claves de traducción y quien la pinta
 * las resuelve con `t()`. Así el mismo tema se llama «ámbar» o «amber» según el
 * idioma, sin duplicar la lista.
 *
 * El orden es el del ciclo del botón de la barra superior: el siguiente tema de
 * la lista es al que salta.
 */
import type { TranslationKey } from '@/i18n'

export interface ThemeOption {
  /** Valor exacto que se guarda en `config.theme`. */
  key: string
  /** Claves de traducción, no texto: el nombre visible depende del idioma. */
  nameKey: TranslationKey
  descriptionKey: TranslationKey
}

/** El tema por defecto, y el que define el `@theme` base de `styles.css`. */
export const DEFAULT_THEME = 'phosphor'

export const THEME_OPTIONS: readonly ThemeOption[] = [
  {
    key: 'phosphor',
    nameKey: 'settings.appearance.theme.option.phosphor.name',
    descriptionKey: 'settings.appearance.theme.option.phosphor.description',
  },
  {
    key: 'amber',
    nameKey: 'settings.appearance.theme.option.amber.name',
    descriptionKey: 'settings.appearance.theme.option.amber.description',
  },
  {
    key: 'green',
    nameKey: 'settings.appearance.theme.option.green.name',
    descriptionKey: 'settings.appearance.theme.option.green.description',
  },
  {
    key: 'ice',
    nameKey: 'settings.appearance.theme.option.ice.name',
    descriptionKey: 'settings.appearance.theme.option.ice.description',
  },
  {
    key: 'plasma',
    nameKey: 'settings.appearance.theme.option.plasma.name',
    descriptionKey: 'settings.appearance.theme.option.plasma.description',
  },
  {
    key: 'paper',
    nameKey: 'settings.appearance.theme.option.paper.name',
    descriptionKey: 'settings.appearance.theme.option.paper.description',
  },
  {
    key: 'solarized',
    nameKey: 'settings.appearance.theme.option.solarized.name',
    descriptionKey: 'settings.appearance.theme.option.solarized.description',
  },
  {
    key: 'gruvbox',
    nameKey: 'settings.appearance.theme.option.gruvbox.name',
    descriptionKey: 'settings.appearance.theme.option.gruvbox.description',
  },
  {
    key: 'nord',
    nameKey: 'settings.appearance.theme.option.nord.name',
    descriptionKey: 'settings.appearance.theme.option.nord.description',
  },
  {
    key: 'mono',
    nameKey: 'settings.appearance.theme.option.mono.name',
    descriptionKey: 'settings.appearance.theme.option.mono.description',
  },
  {
    key: 'plain',
    nameKey: 'settings.appearance.theme.option.plain.name',
    descriptionKey: 'settings.appearance.theme.option.plain.description',
  },
]

const BY_KEY = new Map(THEME_OPTIONS.map((option) => [option.key, option]))

/** Normaliza lo que venga de la configuración a un tema que exista de verdad. */
export function resolveTheme(value: string | undefined): string {
  if (value !== undefined && BY_KEY.has(value)) return value
  return DEFAULT_THEME
}

export function themeOption(key: string): ThemeOption | undefined {
  return BY_KEY.get(key)
}

/** Tema siguiente en el ciclo, para el botón de la barra superior. */
export function nextTheme(value: string | undefined): string {
  const current = resolveTheme(value)
  const index = THEME_OPTIONS.findIndex((option) => option.key === current)
  return THEME_OPTIONS[(index + 1) % THEME_OPTIONS.length]!.key
}

/** Rango del tamaño de fuente del editor, en píxeles. */
export const FONT_SIZE_MIN = 11
export const FONT_SIZE_MAX = 20

export function clampFontSize(value: number): number {
  if (!Number.isFinite(value)) return FONT_SIZE_MIN
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(value)))
}
