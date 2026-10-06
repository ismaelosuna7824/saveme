/**
 * Etiquetas que vienen del core como claves.
 *
 * Las categorías y los estados llegan de la API como identificadores (`feature`,
 * `fix`, `confirmed`…), no como texto. Traducirlos exige un mapeo de clave a clave,
 * y ese mapeo tiene que vivir en un solo sitio: la primera versión lo tenía
 * duplicado en `CategoryCounts`, `CategoryBadge` y `StatusBadge`, que es
 * exactamente cómo una traducción empieza a desincronizarse.
 *
 * La precedencia al pintar es: traducción → texto que mande el servidor → clave
 * cruda. El paso del medio importa porque un core más nuevo puede enviar una
 * categoría que esta versión de la interfaz todavía no conoce, y es mejor mostrar
 * algo legible que un identificador.
 */
import type { Translate, TranslationKey } from '@/i18n'

const CATEGORY_KEYS: Record<string, TranslationKey> = {
  feature: 'projects.category.feature',
  fix: 'projects.category.fix',
  perf: 'projects.category.perf',
  security: 'projects.category.security',
  chore: 'projects.category.chore',
  refactor: 'projects.category.refactor',
  docs: 'projects.category.docs',
  infra: 'projects.category.infra',
  design: 'projects.category.design',
  research: 'projects.category.research',
  incident: 'projects.category.incident',
  uncategorized: 'projects.category.uncategorized',
}

const STATUS_KEYS: Record<string, TranslationKey> = {
  confirmed: 'projects.status.confirmed',
  draft: 'projects.status.draft',
  unmanaged: 'projects.status.unmanaged',
}

/**
 * Notas de cada cliente MCP, que el core también manda escritas.
 *
 * Mismo criterio que las categorías: se traducen por clave para que la interfaz
 * en inglés no enseñe párrafos en español, y el texto del core queda de respaldo
 * para un cliente que esta versión todavía no conozca. Los clientes sin nota
 * (`claude-desktop`, `cursor`, `gemini-cli`…) no tienen clave, y no pasa nada:
 * `fallback` será `undefined` y no se pinta nada.
 */
const PROVIDER_NOTE_KEYS: Record<string, TranslationKey> = {
  codex: 'onboarding.providerNote.codex',
  'claude-code': 'onboarding.providerNote.claude-code',
  copilot: 'onboarding.providerNote.copilot',
  'vscode-copilot': 'onboarding.providerNote.vscode-copilot',
  antigravity: 'onboarding.providerNote.antigravity',
  opencode: 'onboarding.providerNote.opencode',
  omp: 'onboarding.providerNote.omp',
  pi: 'onboarding.providerNote.pi',
  kilocode: 'onboarding.providerNote.kilocode',
  amp: 'onboarding.providerNote.amp',
  zcode: 'onboarding.providerNote.zcode',
  'kimi-code': 'onboarding.providerNote.kimi-code',
  devin: 'onboarding.providerNote.devin',
  windsurf: 'onboarding.providerNote.windsurf',
  hermes: 'onboarding.providerNote.hermes',
  deepseek: 'onboarding.providerNote.deepseek',
  orca: 'onboarding.providerNote.orca',
  monocode: 'onboarding.providerNote.monocode',
  t3code: 'onboarding.providerNote.t3code',
  omnigent: 'onboarding.providerNote.omnigent',
  generic: 'onboarding.providerNote.generic',
}

/** Nota visible de un cliente MCP, o cadena vacía si no tiene. */
export function providerNote(t: Translate, key: string, fallback?: string): string {
  const translationKey = PROVIDER_NOTE_KEYS[key]
  return translationKey ? t(translationKey) : (fallback ?? '')
}

/**
 * Descripciones de categoría, que el core también manda ya escritas.
 *
 * Se traducen por clave y no se pinta el texto del servidor porque si no la
 * interfaz en inglés enseñaría una frase en español. El texto del core queda como
 * respaldo: si un core más nuevo manda una categoría que aquí todavía no está, se
 * enseña la suya en vez de nada.
 */
const CATEGORY_DESCRIPTION_KEYS: Record<string, TranslationKey> = {
  feature: 'projects.categoryDescription.feature',
  fix: 'projects.categoryDescription.fix',
  perf: 'projects.categoryDescription.perf',
  security: 'projects.categoryDescription.security',
  chore: 'projects.categoryDescription.chore',
  refactor: 'projects.categoryDescription.refactor',
  docs: 'projects.categoryDescription.docs',
  infra: 'projects.categoryDescription.infra',
  design: 'projects.categoryDescription.design',
  research: 'projects.categoryDescription.research',
  incident: 'projects.categoryDescription.incident',
  uncategorized: 'projects.categoryDescription.uncategorized',
}

export function categoryLabelKey(key: string): TranslationKey | null {
  return CATEGORY_KEYS[key] ?? null
}

export function statusLabelKey(key: string): TranslationKey | null {
  return STATUS_KEYS[key] ?? null
}

/** Texto visible de una categoría. */
export function categoryLabel(t: Translate, key: string, fallback?: string): string {
  const translationKey = categoryLabelKey(key)
  return translationKey ? t(translationKey) : (fallback ?? key)
}

/** Descripción visible de una categoría. */
export function categoryDescription(t: Translate, key: string, fallback?: string): string {
  const translationKey = CATEGORY_DESCRIPTION_KEYS[key]
  return translationKey ? t(translationKey) : (fallback ?? '')
}

/** Texto visible de un estado. */
export function statusLabel(t: Translate, key: string, fallback?: string): string {
  const translationKey = statusLabelKey(key)
  return translationKey ? t(translationKey) : (fallback ?? key)
}
