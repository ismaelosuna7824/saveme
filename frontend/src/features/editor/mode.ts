import type { PreviewMode } from '@/api/types'
import type { TranslationKey } from '@/i18n'

/**
 * Orden del ciclo de `Cmd+E`.
 *
 * `live` va primero porque es el modo por defecto: es el que hace que el editor
 * se sienta como Obsidian.
 */
export const PREVIEW_MODES: readonly PreviewMode[] = ['live', 'source', 'split', 'preview']

/**
 * Claves de traducción de cada modo.
 *
 * Se exportan claves y no texto porque esto es un módulo, no un componente: el
 * idioma solo se conoce dentro de React, así que resolver el texto aquí sería
 * fijarlo al que estuviera activo al cargar el módulo. El consumidor hace
 * `t(MODE_LABEL_KEY[mode])`.
 */
export const MODE_LABEL_KEY: Record<PreviewMode, TranslationKey> = {
  live: 'editor.mode.live.label',
  source: 'editor.mode.source.label',
  split: 'editor.mode.split.label',
  preview: 'editor.mode.preview.label',
}

/** Clave de la ayuda de cada modo, para el `title` del control segmentado. */
export const MODE_HINT_KEY: Record<PreviewMode, TranslationKey> = {
  live: 'editor.mode.live.hint',
  source: 'editor.mode.source.hint',
  split: 'editor.mode.split.hint',
  preview: 'editor.mode.preview.hint',
}

export function isPreviewMode(value: string): value is PreviewMode {
  return (PREVIEW_MODES as readonly string[]).includes(value)
}

export function nextPreviewMode(current: PreviewMode): PreviewMode {
  return PREVIEW_MODES[(PREVIEW_MODES.indexOf(current) + 1) % PREVIEW_MODES.length]
}
