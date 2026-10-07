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
import { asArray, asStringArray } from '@/api/normalize'
import type { MCPNotice, MCPSnippet } from '@/api/types'
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
 * Nombres de los clientes MCP. El core los manda (`name`), pero algunos llevan
 * aclaraciones en español («CLI y VS Code», «Personalizado»). Están todos, también
 * las marcas que no cambian, porque los avisos nombran clientes por clave (`via`)
 * y sin entrada se vería la clave cruda.
 */
const PROVIDER_NAME_KEYS: Record<string, TranslationKey> = {
  opencode: 'onboarding.providerName.opencode',
  codex: 'onboarding.providerName.codex',
  'claude-code': 'onboarding.providerName.claude-code',
  'claude-desktop': 'onboarding.providerName.claude-desktop',
  cursor: 'onboarding.providerName.cursor',
  copilot: 'onboarding.providerName.copilot',
  'vscode-copilot': 'onboarding.providerName.vscode-copilot',
  'gemini-cli': 'onboarding.providerName.gemini-cli',
  antigravity: 'onboarding.providerName.antigravity',
  qwen: 'onboarding.providerName.qwen',
  kiro: 'onboarding.providerName.kiro',
  omp: 'onboarding.providerName.omp',
  pi: 'onboarding.providerName.pi',
  kilocode: 'onboarding.providerName.kilocode',
  amp: 'onboarding.providerName.amp',
  zcode: 'onboarding.providerName.zcode',
  'kimi-code': 'onboarding.providerName.kimi-code',
  devin: 'onboarding.providerName.devin',
  windsurf: 'onboarding.providerName.windsurf',
  hermes: 'onboarding.providerName.hermes',
  deepseek: 'onboarding.providerName.deepseek',
  orca: 'onboarding.providerName.orca',
  monocode: 'onboarding.providerName.monocode',
  t3code: 'onboarding.providerName.t3code',
  omnigent: 'onboarding.providerName.omnigent',
  generic: 'onboarding.providerName.generic',
  custom: 'onboarding.providerName.custom',
}

/** Nombre visible de un cliente MCP: traducción → nombre del core → clave. */
export function providerName(t: Translate, key: string, fallback?: string): string {
  const translationKey = PROVIDER_NAME_KEYS[key]
  return translationKey ? t(translationKey) : (fallback ?? key)
}

/**
 * Avisos y resultados del MCP por código (`code` en la respuesta del core). El
 * core sigue mandando `message` en español para la CLI; aquí se traduce por
 * código, nunca casando el texto.
 */
const MCP_NOTICE_KEYS: Record<string, TranslationKey> = {
  cli_own_command: 'onboarding.mcpNotice.cliOwnCommand',
  delegated: 'onboarding.mcpNotice.delegated',
  manual_unverified: 'onboarding.mcpNotice.manualUnverified',
  manual_merge: 'onboarding.mcpNotice.manualMerge',
  jsonc_paste: 'onboarding.mcpNotice.jsoncPaste',
  already_configured: 'onboarding.mcpNotice.alreadyConfigured',
  section_exists: 'onboarding.mcpNotice.sectionExists',
  remove_cli_command: 'onboarding.mcpNotice.removeCliCommand',
  remove_delegated: 'onboarding.mcpNotice.removeDelegated',
  remove_no_file: 'onboarding.mcpNotice.removeNoFile',
  remove_manual: 'onboarding.mcpNotice.removeManual',
  remove_jsonc: 'onboarding.mcpNotice.removeJsonc',
  remove_not_configured: 'onboarding.mcpNotice.removeNotConfigured',
  remove_entry_file_deleted: 'onboarding.mcpNotice.removeEntryFileDeleted',
  remove_not_in_file: 'onboarding.mcpNotice.removeNotInFile',
  remove_section_file_deleted: 'onboarding.mcpNotice.removeSectionFileDeleted',
  unknown_client: 'onboarding.mcpNotice.unknownClient',
  custom_missing: 'onboarding.mcpNotice.customMissing',
  custom_invalid: 'onboarding.mcpNotice.customInvalid',
  apply_failed: 'onboarding.mcpNotice.applyFailed',
  remove_failed: 'onboarding.mcpNotice.removeFailed',
  mcp_installed: 'onboarding.mcpNotice.installed',
  saveme_root: 'onboarding.mcpNotice.savemeRoot',
  manual_unconfirmed: 'onboarding.mcpNotice.manualUnconfirmed',
  path_unverified: 'onboarding.mcpNotice.pathUnverified',
  cli_no_env: 'onboarding.mcpNotice.cliNoEnv',
  pending_install: 'onboarding.mcpNotice.pendingInstall',
}

/**
 * Texto visible de un aviso del MCP: traducción por código → `message` del core.
 *
 * Las variables `provider` y `via` llegan como claves de cliente (no como
 * nombres, que pueden venir en español) y se nombran aquí con `providerName`.
 */
export function mcpNoticeText(t: Translate, notice: MCPNotice | null | undefined): string {
  if (!notice) return ''
  const translationKey = notice.code ? MCP_NOTICE_KEYS[notice.code] : undefined
  if (!translationKey) return notice.message ?? ''
  const vars: Record<string, string> = { ...(notice.vars ?? {}) }
  if (vars.provider !== undefined) vars.provider = providerName(t, vars.provider)
  if (vars.via !== undefined) {
    vars.via = vars.via
      .split(',')
      .filter((key) => key !== '')
      .map((key) => providerName(t, key))
      .join(', ')
  }
  return t(translationKey, vars)
}

/**
 * Avisos de un bloque, traducidos por código. Un core sin `notices` solo manda
 * `warnings` en español: se muestran tal cual antes que no mostrar nada.
 */
export function snippetWarnings(t: Translate, snippet: MCPSnippet): string[] {
  const notices = asArray<MCPNotice>(snippet.notices)
  if (notices.length === 0) return asStringArray(snippet.warnings)
  return notices.map((notice) => mcpNoticeText(t, notice)).filter((text) => text !== '')
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
