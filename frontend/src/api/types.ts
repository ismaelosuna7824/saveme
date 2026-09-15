/**
 * Tipos del contrato HTTP.
 *
 * Los nombres de campo son EXACTAMENTE los del JSON del core (snake_case) para
 * que no haya capa de traducción que se desincronice. Ver docs/ARCHITECTURE.md
 * §6 y backend/internal/domain/types.go.
 */

/** Modo de vista del editor. `config.editor.preview_mode`. */
/**
 * Modos del editor.
 *
 * `live` es el predeterminado: el editor renderiza el markdown en línea al
 * estilo Obsidian. `source` es el markdown crudo, `preview` la lectura a pantalla
 * completa y `split` las dos cosas a la vez.
 */
export type PreviewMode = 'live' | 'source' | 'split' | 'preview'

/** Estados del ciclo de vida de un resumen (domain.Status*). */
export type SummaryStatus = 'confirmed' | 'draft' | 'unmanaged'

/** Estados de una propuesta (domain.Proposal*). */
export type ProposalStatus = 'pending' | 'confirmed' | 'cancelled' | 'expired'

/** Decisión con la que se resuelve una propuesta. */
export type ProposalDecision = 'accepted' | 'modified'

export interface Category {
  key: string
  folder: string
  label: string
  description: string
}

export interface Project {
  slug: string
  name: string
  path: string
  created_at: string
  updated_at: string
  counts: Record<string, number>
  total: number
  last_activity: string | null
}

export interface SummaryMeta {
  id: string
  project_slug: string
  category: string
  title: string
  summary_line: string
  rel_path: string
  abs_path: string
  status: SummaryStatus | string
  author: string
  agent?: string
  commit_sha?: string
  tags: string[]
  files_touched: string[]
  related: string[]
  word_count: number
  size_bytes: number
  created_at: string
  updated_at: string
  content_hash: string
}

export interface SummaryDetail {
  meta: SummaryMeta
  content: string
}

/** Alternativa concreta que se le ofrece al usuario además de la inferida. */
export interface ProposalAlternative {
  category: string
  folder?: string
  label?: string
  rel_path: string
}

/** Explicación de por qué se propuso una categoría. Nunca decide en silencio. */
export interface ProposalInference {
  category: string
  reason: string
  confidence: number
  evidence?: string[]
}

export interface Proposal {
  token: string
  project_slug: string
  category: string
  title: string
  rel_path: string
  abs_path: string
  filename: string
  expires_at: string
  created_at: string
  status: ProposalStatus | string
  inference: ProposalInference
  alternatives: ProposalAlternative[]
  preview: string
  body_bytes: number
  agent?: string
  tags: string[]
  files_touched: string[]
}

/**
 * El antes y el después de una propuesta, para poder enseñar qué cambia antes de
 * aprobarla.
 *
 * Se pide a un endpoint aparte y no viene en el listado del inbox: son varios
 * kilobytes por propuesta.
 */
export interface ProposalDiff {
  rel_path: string
  /** `false` cuando la propuesta crea un resumen que todavía no existe. */
  exists: boolean
  /** Lo que hay ahora en disco; vacío si no hay archivo. */
  current: string
  /** El cuerpo entero que se escribiría al confirmar. */
  proposed: string
}

/** Un resumen dentro de una exportación, ya con el cuerpo sin frontmatter. */
export interface ExportEntry {
  id: string
  title: string
  rel_path: string
  created_at: string
  updated_at: string
  tags: string[]
  files_touched: string[]
  commit_sha?: string
  body: string
}

export interface ExportSection {
  category: string
  summaries: ExportEntry[]
}

/**
 * Todo un proyecto, para componer un documento con él.
 *
 * El backend devuelve datos y no el markdown montado: los títulos de sección los
 * lee una persona, y el idioma solo se conoce aquí.
 */
export interface ProjectExport {
  project: string
  generated_at: string
  count: number
  /** Resúmenes que el índice conocía y ya no se pudieron leer. */
  skipped: number
  sections: ExportSection[]
}

export interface DigestEntry {
  id: string
  project_slug: string
  category: string
  title: string
  summary_line: string
  rel_path: string
  created_at: string
  author: string
  commit_sha?: string
}

export interface DigestDay {
  /** AAAA-MM-DD. */
  date: string
  entries: DigestEntry[]
}

/** Un archivo que aparece en los resúmenes recientes de un proyecto. */
export interface BriefingFile {
  path: string
  count: number
  last_at: string
}

/**
 * «¿Dónde lo dejamos?» de un proyecto.
 *
 * `last_at` es opcional porque «nunca» y una fecha no son lo mismo: un proyecto
 * recién creado no tiene última vez, y eso hay que poder decirlo.
 */
export interface Briefing {
  project: string
  generated_at: string
  from: string
  days: number
  total: number
  active_days: number
  last_at?: string
  last: DigestEntry[]
  files: BriefingFile[]
  pending: Proposal[]
}

/** Lo escrito un día concreto. */
export interface ActivityDay {
  /** AAAA-MM-DD. */
  date: string
  count: number
  /** Reparto del día por categoría. Vacío, nunca nulo, cuando no hubo nada. */
  by_category: Record<string, number>
}

/**
 * Mapa de actividad de un proyecto.
 *
 * `entries` cubre **todos** los días de la ventana, del más viejo al más nuevo y
 * con los vacíos incluidos, así que el mapa se pinta recorriendo el array sin
 * calcular fechas en la interfaz.
 */
export interface ActivityMap {
  project: string
  generated_at: string
  from: string
  to: string
  days: number
  total: number
  active: number
  max: number
  by_category: Record<string, number>
  entries: ActivityDay[]
}

/** Un resumen dentro de unas notas de versión. */
export interface ChangelogEntry {
  id: string
  category: string
  title: string
  summary_line: string
  rel_path: string
  created_at: string
  author: string
  commit_sha?: string
  files_touched: string[]
  tags: string[]
}

export interface ChangelogSection {
  category: string
  entries: ChangelogEntry[]
}

/** El diario de un rango, agrupado como unas notas de versión. */
export interface Changelog {
  project: string
  from: string
  to: string
  count: number
  sections: ChangelogSection[]
}

/** Lo hecho en un rango de fechas, cruzando todos los proyectos. */
export interface Digest {
  from: string
  to: string
  days: number
  count: number
  projects: number
  groups: DigestDay[]
}

/**
 * Lo que devuelve escribir un resumen. `created: false` significa que ese
 * contenido exacto ya estaba guardado y se devolvió el que había.
 */
export interface WriteResult {
  summary: SummaryMeta
  created: boolean
  rel_path: string
  abs_path: string
  project_created?: boolean
}

export interface EditorPrefs {
  font_size: number
  wrap: boolean
  preview_mode: PreviewMode
  autosave_ms: number
  /** Teclas modales de vim en el editor de notas. Apagado por defecto. */
  vim_mode: boolean
}

export interface Config {
  version: number
  root_dir: string
  /** "" significa "el idioma del sistema". */
  language: '' | 'es' | 'en'
  port: number
  theme: string
  /** Opacidad de la ventana, en porcentaje. 100 es opaca del todo. */
  opacity: number
  editor: EditorPrefs
  onboarded: boolean
  /** Archivo de configuración que el core tiene cargado (`GET /config`). */
  config_path: string
  /**
   * `created` cuando la raíz configurada **no existía** y el core ha creado un
   * workspace vacío en este arranque. Es la señal de que puede que el usuario
   * haya movido su carpeta: la interfaz avisa en vez de dar por bueno el vacío.
   */
  root_state: 'ok' | 'created'
  /**
   * Carpetas recientes que sí existen y **tienen la marca de SaveMe**. Es la
   * lista de candidatas que se le ofrecen al usuario cuando su raíz desapareció.
   */
  root_suggestions: string[]
  /**
   * Hay un `root_dir` distinto guardado que todavía no se aplicó: el workspace
   * y SQLite se abren una sola vez al arrancar, así que exige reiniciar.
   */
  root_change_pending: boolean
  /** `SAVEME_ROOT` manda sobre este archivo y bloquea cambiar la raíz aquí. */
  root_from_env?: boolean
}

/** Cuerpo de `PUT /config`: todo opcional. */
export interface ConfigPatch {
  root_dir?: string
  opacity?: number
  theme?: string
  language?: '' | 'es' | 'en'
  editor?: Partial<EditorPrefs>
  /** Marca el asistente de bienvenida como visto (`PUT /config`). */
  onboarded?: boolean
}

export interface Health {
  ok: boolean
  version: string
  uptime_ms: number
  root_dir: string
  db_path: string
  port: number
}

export interface Stats {
  projects: number
  summaries: number
  by_category: Record<string, number>
  pending_proposals: number
}

export interface SummaryList {
  items: SummaryMeta[]
  total: number
  limit: number
  offset: number
}

export interface SummaryFilter {
  project?: string
  category?: string
  q?: string
  tag?: string
  status?: string
  limit?: number
  offset?: number
  sort?: string
}

export type SummarySort = 'updated' | 'created' | 'title'

export interface ReindexResult {
  /** Total de archivos leídos y reconciliados (`added + updated`). */
  indexed: number
  added: number
  updated: number
  removed: number
  /** Archivos con la misma huella: no hizo falta releerlos. */
  unchanged: number
  /** Proyectos vistos al recorrer el workspace. */
  projects_discovered: number
  duration_ms: number
  /** Fallos por archivo. El core omite el campo cuando no hubo ninguno. */
  errors?: string[]
}

/** Resultado de confirmar una propuesta. */
export interface ConfirmProposalResult {
  summary?: SummaryMeta
  meta?: SummaryMeta
}

/**
 * Destino alternativo al confirmar una propuesta (`decision: "modified"`).
 *
 * El contrato solo dice `override?` sin detallar su forma. Se mandan tanto
 * `project` como `project_slug` porque el backend todavía no existe: un decoder
 * Go ignora los campos desconocidos, así que el superconjunto es seguro y
 * tolera cualquiera de los dos nombres que acabe eligiendo el core.
 */
export interface ProposalOverride {
  project?: string
  project_slug?: string
  category?: string
  rel_path?: string
}

export interface ConfirmProposalInput {
  token: string
  decision: ProposalDecision
  override?: ProposalOverride
}

export interface CreateProjectInput {
  name: string
  slug?: string
}

export interface SaveSummaryInput {
  id: string
  content: string
  base_hash?: string
}

// --- Servidor MCP ------------------------------------------------------------
//
// El MCP es el mismo binario que la app (`saveme mcp`). Estos endpoints dejan
// que la interfaz lo instale y configure los clientes de IA del usuario.

/** Cómo se configura un cliente: archivo JSON/TOML, comando, o a mano. */
export type MCPProviderFormat = 'json' | 'toml' | 'cli' | 'manual'

/** Estado de un cliente de IA respecto al servidor MCP. */
export interface MCPProvider {
  key: string
  name: string
  /** Archivo de configuración. Ausente en los que se configuran por comando. */
  path?: string
  format: MCPProviderFormat | string
  /** El cliente parece estar en esta máquina. */
  installed: boolean
  /** Ya tiene `saveme` registrado. */
  configured: boolean
  /** Nuestro conocimiento del formato está confirmado contra su documentación. */
  verified: boolean
  /** Podemos escribir/fusionar su configuración solos. */
  writable: boolean
  note?: string
}

/** Dónde vive el binario: el estable, el del bundle y si además está en el PATH. */
export interface MCPBinaryStatus {
  /** "" si todavía no se instaló. */
  installed_path: string
  /** El binario que va dentro de la app. */
  self_path: string
  /** También se puede invocar como `saveme` a secas. */
  on_path: boolean
  /** Versión de la app, que es la que corre. */
  self_version: string
  /** Versión de la copia instalada; "" si no hay copia o no se pudo leer. */
  installed_version: string
  /**
   * Solo es `true` si hay copia y las dos versiones coinciden.
   *
   * El actualizador reemplaza el binario de dentro de la app, **no** la copia que
   * lanzan los clientes MCP: sin esto, tras cada actualización el agente seguiría
   * usando las herramientas viejas contra una app nueva, y sin ningún síntoma.
   */
  in_sync: boolean
  /** Por qué no se pudo leer la versión de la copia, si fue el caso. */
  version_error: string
}

export interface MCPProviders {
  /**
   * Ya viene ordenado por accionabilidad: instalados sin configurar, instalados
   * configurados, la entrada genérica/manual y el resto. No reordenar.
   */
  providers: MCPProvider[]
  binary: MCPBinaryStatus
}

/** Resultado de `POST /mcp/install`. Idempotente. */
export interface MCPInstallResult {
  path: string
  on_path: boolean
  message: string
}

export type MCPConfigureAction =
  | 'created'
  | 'merged'
  | 'updated'
  | 'already-configured'
  | 'manual'
  | 'unknown'
  | 'error'
  // Solo al quitar: se quitó, o no había nada que quitar.
  | 'removed'
  | 'not-configured'

export interface MCPConfigureResult {
  key: string
  /** Ausente cuando la acción es `unknown` (el core no conoce la clave). */
  name: string
  action: MCPConfigureAction
  /** Archivo de configuración tocado. */
  path?: string
  /** Explicación humana, segura de mostrar. */
  message?: string
  /** Copia de seguridad, si el archivo del cliente ya existía. */
  backup?: string
  /** Solo en `manual` + formato cli: el comando exacto que debe ejecutar. */
  command?: string
}

export interface MCPConfigureResponse {
  binary_path: string
  results: MCPConfigureResult[]
}

export interface MCPConfigureInput {
  providers: string[]
}

/**
 * Respuesta de quitar la configuración.
 *
 * No trae `binary_path` a propósito: quitar SaveMe de un cliente no desinstala el
 * binario, porque los demás clientes configurados seguirían apuntando a él.
 */
export interface MCPUnconfigureResponse {
  results: MCPConfigureResult[]
}

/** Bloque de configuración listo para pegar (`GET /mcp/snippet`). */
export interface MCPSnippet {
  provider: string
  name: string
  /** Dónde iría. Puede ser "" (se configura por comando). */
  path: string
  /** El texto exacto que hay que pegar. */
  body: string
  /**
   * Para el resaltado. Observado: `json`, `toml` y `manual` (los proveedores
   * manuales devuelven su formato tal cual, no `sh`).
   */
  language: 'json' | 'toml' | 'sh' | string
  writable: boolean
  verified: boolean
  /**
   * Avisos a leer antes de aplicar nada. Go serializa el slice vacío como
   * `null`: normalizar con `asStringArray` en el borde.
   */
  warnings: string[]
  binary: string
  /**
   * El binario todavía no está en su ruta estable: el bloque ya apunta ahí y
   * `warnings` lo explica, así que se puede pegar igual.
   *
   * Campo observado en el core real que aún no está en el contrato publicado.
   */
  pending_install?: boolean
  /**
   * Variables fijadas para que el MCP resuelva el mismo workspace que la app.
   * `null` cuando no hay ninguna que fijar (el caso normal).
   */
  env_fixed: Record<string, string> | null
}

/** Envoltorio de error del core. */
export interface ApiErrorBody {
  error: {
    code: string
    message: string
  }
}

/**
 * Un archivo en la papelera.
 *
 * `trash_rel` es dónde está ahora y `rel_path` dónde estaba: restaurar necesita el
 * primero y la interfaz enseña el segundo, que es el que el usuario reconoce.
 */
export interface TrashEntry {
  trash_rel: string
  rel_path: string
  name: string
  /** ISO-8601. Vacío si el sello de la carpeta no se pudo leer. */
  deleted_at: string
  size: number
}

export interface TrashResponse {
  items: TrashEntry[]
}

export interface RestoreResult {
  ok: boolean
  rel_path: string
}

export interface EmptyTrashResult {
  ok: boolean
  removed: number
}

/** Un archivo o una carpeta del árbol de notas. */
export interface NoteEntry {
  /** Relativa a la carpeta de notas: `ideas/nota.md`. */
  rel_path: string
  name: string
  is_dir: boolean
  size: number
  modified_at: string
}

/** Lo que el índice sabe de una nota. */
export interface NoteMeta {
  /** Relativa a la raíz del workspace: `notes/ideas/nota.md`. */
  rel_path: string
  title: string
  size_bytes: number
  modified_at: string
}

export interface NotesTreeResponse {
  items: NoteEntry[]
}

export interface NoteFileResponse {
  path: string
  content: string
}

export interface NoteSearchResponse {
  items: NoteMeta[]
}

export interface NoteInput {
  path: string
  kind?: 'file' | 'dir'
  title?: string
}
