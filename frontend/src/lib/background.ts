/**
 * La imagen de fondo: qué se ve, dónde y cuánto.
 *
 * Funciones puras, sin React ni DOM, para que la guardia
 * (`scripts/verify-background.mjs`) las pruebe a palo seco. El pintado vive en
 * `backdropEffects.ts` y el componente en `components/layout/AppBackdrop.tsx`.
 */
import type { BackgroundEffect, BackgroundSetting, Config } from '@/api/types'

export const BACKGROUND_EFFECTS: readonly BackgroundEffect[] = [
  'none',
  'dither',
  'ascii',
  'halftone',
  'scanlines',
  'haze',
]

/** Lo mismo que `config.MaxBackgroundBlur` en el core. */
export const BACKGROUND_BLUR_MAX = 24

/** El aspecto de una imagen recién elegida, igual que los valores del core. */
export const DEFAULT_BACKGROUND_LOOK: Omit<BackgroundSetting, 'image'> = {
  effect: 'none',
  show_on: 'all',
  empty_visibility: 0.6,
  document_visibility: 0.3,
  blur: 0,
}

/**
 * Si el efecto admite difuminado. Los que dibujan su propia textura (puntos,
 * caracteres, píxeles) se convertirían en una mancha.
 */
export function effectTakesBlur(effect: BackgroundEffect): boolean {
  return effect === 'none' || effect === 'scanlines' || effect === 'haze'
}

/**
 * Cuánto se ve la imagen en una pantalla, de 0 a 1.
 *
 * Sin documento manda la visibilidad «vacía». Con un documento abierto, la de
 * documento, salvo que el fondo sea solo para pantallas vacías.
 */
export function backgroundVisibility(look: BackgroundSetting, hasDocument: boolean): number {
  if (!hasDocument) return look.empty_visibility
  return look.show_on === 'empty' ? 0 : look.document_visibility
}

/**
 * Si una ruta enseña un documento: un resumen abierto en el editor o una nota.
 * El resto —inbox, proyectos, etiquetas, la lista de notas— son pantallas
 * «vacías», sin texto largo delante.
 */
export function isDocumentPath(pathname: string): boolean {
  return pathname.startsWith('/s/') || (pathname.startsWith('/notes/') && pathname.length > '/notes/'.length)
}

export interface ResolvedBackground {
  /** El fondo que se ve, o `null` si no hay. */
  setting: BackgroundSetting | null
  /** De dónde sale: del proyecto, el global, o ninguno. */
  source: 'project' | 'global' | null
  /** El proyecto tiene imagen propia y además hay una global que tapa. */
  shadowsGlobal: boolean
  /** Otros proyectos con imagen propia, para poder quitarlas desde Ajustes. */
  others: { project: string; setting: BackgroundSetting }[]
}

/** El fondo de un proyecto: el suyo si tiene, si no el global. */
export function resolveBackground(
  config: Pick<Config, 'background' | 'project_backgrounds'>,
  project: string | null,
): ResolvedBackground {
  const projects = config.project_backgrounds ?? {}
  const own = project === null ? undefined : projects[project]
  const global = config.background ?? null
  return {
    setting: own ?? global,
    source: own ? 'project' : global ? 'global' : null,
    shadowsGlobal: Boolean(own && global),
    others: Object.entries(projects)
      .filter(([slug]) => slug !== project)
      .map(([slug, setting]) => ({ project: slug, setting })),
  }
}

/** La URL de una imagen de fondo en el core. */
export function backgroundUrl(apiBase: string, image: string): string {
  return `${apiBase}/backgrounds/${encodeURIComponent(image)}`
}
