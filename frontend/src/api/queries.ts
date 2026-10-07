/**
 * Hooks de datos. TanStack Query es la única puerta de entrada al core: ningún
 * componente llama a `fetch` directamente.
 */
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'

import { api, buildQuery } from './client'
import type {
  ActivityMap,
  Freshness,
  JournalHealth,
  ProjectGraph,
  ProjectTimeline,
  Briefing,
  Changelog,
  Digest,
  Category,
  Config,
  ConfigPatch,
  ConfirmProposalInput,
  ConfirmProposalResult,
  CreateProjectInput,
  Health,
  MCPConfigureInput,
  MCPCustomDef,
  MCPConfigureResponse,
  MCPUnconfigureResponse,
  MCPInstallResult,
  MCPProviders,
  MCPSnippet,
  Project,
  Proposal,
  ProposalDiff,
  ProposalStatus,
  ReindexResult,
  SaveSummaryInput,
  Stats,
  SecretFinding,
  SummaryDetail,
  SummaryFilter,
  SummaryList,
  SummaryLinks,
  SummaryMeta,
  SummaryVersionDetail,
  SummaryVersionList,
  WriteResult,
  EmptyTrashResult,
  RestoreResult,
  TrashResponse,
  NoteFileResponse,
  NoteMeta,
  NotesTreeResponse,
  NoteInput,
  NoteSearchResponse,
} from './types'

/** Claves de caché. Las mutaciones invalidan por prefijo. */
export const queryKeys = {
  health: ['health'] as const,
  stats: ['stats'] as const,
  digest: (days: number) => ['digest', days] as const,
  digestAll: ['digest'] as const,
  briefing: (slug: string, days: number) => ['briefing', slug, days] as const,
  activity: (slug: string, days: number) => ['activity', slug, days] as const,
  changelog: (slug: string, since: string, until: string) =>
    ['changelog', slug, since, until] as const,
  config: ['config'] as const,
  categories: ['categories'] as const,
  projects: ['projects'] as const,
  summaries: {
    all: ['summaries'] as const,
    list: (filter: SummaryFilter) => ['summaries', 'list', filter] as const,
    detail: (id: string) => ['summaries', 'detail', id] as const,
    // Bajo `summaries` a propósito: cualquier escritura que invalide los
    // resúmenes refresca también quién enlaza a quién.
    links: (id: string) => ['summaries', 'links', id] as const,
    // También bajo `summaries`: cada guardado puede dejar una versión nueva.
    versions: (id: string) => ['summaries', 'versions', id] as const,
    version: (id: string, version: string) => ['summaries', 'versions', id, version] as const,
    // Bajo `summaries`: un guardado puede cambiar los archivos apuntados.
    freshness: (id: string) => ['summaries', 'freshness', id] as const,
  },
  proposals: {
    all: ['proposals'] as const,
    list: (status: ProposalStatus | 'all') => ['proposals', 'list', status] as const,
    detail: (token: string) => ['proposals', 'detail', token] as const,
    // El diff se pide aparte porque no viaja en el listado: son varios kilobytes
    // por propuesta y casi nunca se miran todas a la vez.
    diff: (token: string) => ['proposals', 'diff', token] as const,
  },
  trash: ['trash'] as const,
  notes: {
    all: ['notes'] as const,
    tree: ['notes', 'tree'] as const,
    file: (path: string) => ['notes', 'file', path] as const,
    search: (query: string) => ['notes', 'search', query] as const,
  },
  /** `project` vacío son las de todo el workspace. */
  tags: (project = '') => ['tags', project] as const,
  // Mapa, historia y salud dependen de los resúmenes: se invalidan con ellos.
  graph: (slug: string) => ['graph', slug] as const,
  graphAll: ['graph'] as const,
  timeline: (slug: string) => ['timeline', slug] as const,
  timelineAll: ['timeline'] as const,
  journalHealth: ['journal-health'] as const,
  mcp: {
    providers: ['mcp', 'providers'] as const,
    snippet: (key: string) => ['mcp', 'snippet', key] as const,
    customSnippet: (def: MCPCustomDef | null) => ['mcp', 'snippet', 'custom', def] as const,
  },
} as const

// --- Lecturas ---------------------------------------------------------------

export function useHealth(refetchInterval: number | false = false): UseQueryResult<Health> {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: ({ signal }) => api.get<Health>('/health', signal),
    staleTime: 5_000,
    refetchInterval,
    retry: 0,
  })
}

/**
 * Opciones de las lecturas que también precargan las rutas.
 *
 * El hook y el `loader` de la ruta comparten clave, `queryFn` y `staleTime`: si
 * no, la ruta llenaría una entrada de caché que el componente no lee y la
 * pantalla volvería a pasar por el esqueleto.
 */
export const projectsQuery = () =>
  queryOptions({
    queryKey: queryKeys.projects,
    queryFn: ({ signal }) => api.get<Project[]>('/projects', signal),
    staleTime: 30_000,
  })

export const categoriesQuery = () =>
  queryOptions({
    queryKey: queryKeys.categories,
    queryFn: ({ signal }) => api.get<Category[]>('/categories', signal),
    // La taxonomía es estática mientras corre el proceso.
    staleTime: Infinity,
  })

export const summariesQuery = (filter: SummaryFilter) =>
  queryOptions({
    queryKey: queryKeys.summaries.list(filter),
    queryFn: ({ signal }) =>
      api.get<SummaryList>(`/summaries${buildQuery({ ...filter })}`, signal),
    staleTime: 15_000,
  })

export const summaryQuery = (id: string) =>
  queryOptions({
    queryKey: queryKeys.summaries.detail(id),
    queryFn: ({ signal }) => api.get<SummaryDetail>(`/summaries/${id}`, signal),
    // El contenido en disco manda: nunca servimos caché para editar.
    staleTime: 0,
  })

/**
 * Relacionados y enlaces inversos de un resumen, con su metadata. El loader de
 * `/s/$id` los precarga junto al detalle para que la sección no aparezca de golpe
 * después de abrir el editor.
 */
export const summaryLinksQuery = (id: string) =>
  queryOptions({
    queryKey: queryKeys.summaries.links(id),
    queryFn: ({ signal }) =>
      api.get<SummaryLinks>(`/summaries/${encodeURIComponent(id)}/links`, signal),
    staleTime: 15_000,
  })

export function useProjects(): UseQueryResult<Project[]> {
  return useQuery(projectsQuery())
}

/**
 * Un proyecto concreto.
 *
 * El contrato documenta `GET /projects/{slug}` → `ProjectDetail`, pero no define
 * la forma de `ProjectDetail`. Para no inventar campos que el core quizá no
 * devuelva, se deriva de `GET /projects`, que sí está tipado en el contrato.
 */
export function useProject(slug: string): {
  project: Project | null
  isLoading: boolean
  error: unknown
  refetch: () => void
} {
  const query = useProjects()
  const project = query.data?.find((candidate) => candidate.slug === slug) ?? null
  return {
    project,
    isLoading: query.isLoading,
    error: query.error,
    refetch: () => {
      void query.refetch()
    },
  }
}

/**
 * Las etiquetas en uso, con cuántos resúmenes lleva cada una: las de todo el
 * workspace o, con `project`, solo las de ese proyecto.
 *
 * Alimenta el contador de la pantalla de una etiqueta y, acotada a un proyecto,
 * el filtro por etiqueta de su buscador: ahí una etiqueta de otro proyecto solo
 * daría cero resultados.
 */
export function useTags(project?: string): UseQueryResult<Record<string, number>> {
  return useQuery({
    queryKey: queryKeys.tags(project),
    queryFn: ({ signal }) =>
      api.get<Record<string, number>>(`/tags${buildQuery({ project })}`, signal),
  })
}

export function useCategories(): UseQueryResult<Category[]> {
  return useQuery(categoriesQuery())
}

/**
 * `keepPrevious`: mientras llega una lista nueva del **mismo proyecto** (otra
 * búsqueda, por ejemplo), se sigue enseñando la anterior en vez de vaciar la
 * pantalla con un esqueleto. Entre proyectos no: la lista de otro proyecto bajo
 * esta cabecera sería mentira.
 */
export function useSummaries(
  filter: SummaryFilter,
  options: { enabled?: boolean; keepPrevious?: boolean } = {},
): UseQueryResult<SummaryList> {
  return useQuery({
    ...summariesQuery(filter),
    enabled: options.enabled ?? true,
    placeholderData: options.keepPrevious
      ? (previous, previousQuery) =>
          previousQuery?.queryKey[2].project === filter.project ? previous : undefined
      : undefined,
  })
}

export function useSummary(id: string): UseQueryResult<SummaryDetail> {
  return useQuery({ ...summaryQuery(id), enabled: id.length > 0 })
}

export function useSummaryLinks(id: string): UseQueryResult<SummaryLinks> {
  return useQuery({ ...summaryLinksQuery(id), enabled: id.length > 0 })
}

/** Las versiones anteriores de un resumen. Solo se piden con el historial abierto. */
export function useSummaryVersions(id: string, enabled: boolean): UseQueryResult<SummaryVersionList> {
  return useQuery({
    queryKey: queryKeys.summaries.versions(id),
    queryFn: ({ signal }) =>
      api.get<SummaryVersionList>(`/summaries/${encodeURIComponent(id)}/versions`, signal),
    enabled: enabled && id.length > 0,
  })
}

/** Una versión entera junto a lo que hay ahora en disco, para enseñar el diff. */
export function useSummaryVersion(id: string, version: string | null): UseQueryResult<SummaryVersionDetail> {
  return useQuery({
    queryKey: queryKeys.summaries.version(id, version ?? ''),
    queryFn: ({ signal }) =>
      api.get<SummaryVersionDetail>(
        `/summaries/${encodeURIComponent(id)}/versions/${encodeURIComponent(version ?? '')}`,
        signal,
      ),
    enabled: version !== null && id.length > 0,
    // Lo de "ahora" cambia con cada guardado: no se sirve de caché.
    staleTime: 0,
  })
}

/**
 * Posibles credenciales en un texto. Lo usa el menú de compartir con lo que hay
 * en el editor, guardado o no; solo se pide con el menú abierto.
 */
export function useSecretScan(text: string, enabled: boolean): UseQueryResult<{ items: SecretFinding[] }> {
  return useQuery({
    queryKey: ['secrets', text],
    queryFn: () => api.post<{ items: SecretFinding[] }>('/secrets/scan', { text }),
    enabled,
    staleTime: Infinity,
  })
}

/**
 * Cuántos commits tocaron los archivos de un resumen después de escribirlo. Lo
 * calcula el core con git sobre el repo vinculado al proyecto; no se repite a
 * cada momento porque cada consulta ejecuta git.
 */
export function useFreshness(id: string): UseQueryResult<Freshness> {
  return useQuery({
    queryKey: queryKeys.summaries.freshness(id),
    queryFn: ({ signal }) =>
      api.get<Freshness>(`/summaries/${encodeURIComponent(id)}/freshness`, signal),
    enabled: id.length > 0,
    staleTime: 60_000,
  })
}

/** El mapa de decisiones de un proyecto. */
export const projectGraphQuery = (slug: string) =>
  queryOptions({
    queryKey: queryKeys.graph(slug),
    queryFn: ({ signal }) => api.get<ProjectGraph>(`/projects/${encodeURIComponent(slug)}/graph`, signal),
    staleTime: 30_000,
  })

/** La historia de un proyecto: resúmenes y commits del repo vinculado. */
export const projectTimelineQuery = (slug: string) =>
  queryOptions({
    queryKey: queryKeys.timeline(slug),
    queryFn: ({ signal }) =>
      api.get<ProjectTimeline>(`/projects/${encodeURIComponent(slug)}/timeline`, signal),
    staleTime: 30_000,
  })

/**
 * Salud de todo el diario. Contar commits ejecuta git por resumen, así que no se
 * repite a cada momento.
 */
export function useJournalHealth(): UseQueryResult<JournalHealth> {
  return useQuery({
    queryKey: queryKeys.journalHealth,
    queryFn: ({ signal }) => api.get<JournalHealth>('/journal/health', signal),
    staleTime: 60_000,
  })
}

export function useProposals(
  status: ProposalStatus | 'all' = 'pending',
): UseQueryResult<Proposal[]> {
  return useQuery({
    queryKey: queryKeys.proposals.list(status),
    queryFn: ({ signal }) =>
      api.get<Proposal[]>(`/proposals${buildQuery({ status: status === 'all' ? '' : status })}`, signal),
    staleTime: 5_000,
  })
}

/**
 * El antes y el después de una propuesta.
 *
 * Se pide solo cuando hace falta (`enabled`): el cuerpo entero no viaja en el
 * listado del inbox, así que sin esto cada tarjeta traería varios kilobytes que
 * casi nadie mira.
 */
export function useProposalDiff(token: string, enabled: boolean): UseQueryResult<ProposalDiff> {
  return useQuery({
    queryKey: queryKeys.proposals.diff(token),
    queryFn: ({ signal }) =>
      api.get<ProposalDiff>(`/proposals/${encodeURIComponent(token)}/diff`, signal),
    // Una propuesta no cambia mientras está pendiente: su cuerpo se fijó al
    // crearla. Volver a pedirlo al desplegar y plegar sería gastar por nada.
    staleTime: Infinity,
    enabled,
  })
}

/**
 * Lo hecho en los últimos `days` días, de todos los proyectos.
 *
 * Se cachea por ventana: cambiar de 7 a 30 días y volver a 7 no vuelve a pedirlo.
 */
/**
 * Cambia la categoría y el título de un resumen guardado.
 *
 * Al terminar se invalida lo que depende de dónde vive el resumen —listados,
 * estadísticas y el propio detalle—, porque la categoría lo mueve de carpeta y
 * dejarlo cacheado enseñaría una ruta que ya no existe.
 */
/**
 * Escribe un resumen nuevo desde la interfaz.
 *
 * Pasa por el mismo camino de dos fases que un agente, así que hereda la
 * deduplicación y la inferencia de categoría sin reglas propias.
 */
export function useCreateSummary(): UseMutationResult<
  WriteResult,
  Error,
  {
    project: string
    title: string
    body: string
    category: string
    tags: string[]
  }
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input) => api.post<WriteResult>('/summaries', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.summaries.all })
      void qc.invalidateQueries({ queryKey: queryKeys.stats })
      void qc.invalidateQueries({ queryKey: queryKeys.projects })
      void qc.invalidateQueries({ queryKey: queryKeys.digestAll })
    },
  })
}

export function useUpdateSummaryMeta(): UseMutationResult<
  SummaryMeta,
  Error,
  { id: string; category: string; title: string }
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, category, title }) =>
      api.patch<SummaryMeta>(`/summaries/${encodeURIComponent(id)}`, { category, title }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.summaries.all })
      void qc.invalidateQueries({ queryKey: queryKeys.stats })
      void qc.invalidateQueries({ queryKey: queryKeys.digestAll })
    },
  })
}

export function useDigest(days: number): UseQueryResult<Digest> {
  return useQuery({
    queryKey: queryKeys.digest(days),
    queryFn: ({ signal }) => api.get<Digest>(`/digest${buildQuery({ days: String(days) })}`, signal),
    staleTime: 30_000,
  })
}

/**
 * «¿Dónde lo dejamos?» de un proyecto.
 *
 * Se refresca sola cada minuto y no se cachea más: un briefing es lo primero que
 * se mira al abrir un proyecto, y enseñar el de hace un rato justo cuando acaba de
 * llegar una propuesta nueva es la peor forma de fallar.
 */
export const briefingQuery = (slug: string, days: number) =>
  queryOptions({
    queryKey: queryKeys.briefing(slug, days),
    queryFn: ({ signal }) =>
      api.get<Briefing>(
        `/projects/${encodeURIComponent(slug)}/briefing${buildQuery({ days: String(days) })}`,
        signal,
      ),
    staleTime: 30_000,
  })

export function useBriefing(slug: string, days: number): UseQueryResult<Briefing> {
  return useQuery({ ...briefingQuery(slug, days), enabled: slug.length > 0 })
}

export const activityQuery = (slug: string, days: number) =>
  queryOptions({
    queryKey: queryKeys.activity(slug, days),
    queryFn: ({ signal }) =>
      api.get<ActivityMap>(
        `/projects/${encodeURIComponent(slug)}/activity${buildQuery({ days: String(days) })}`,
        signal,
      ),
    staleTime: 60_000,
  })

export function useActivity(slug: string, days: number): UseQueryResult<ActivityMap> {
  return useQuery({ ...activityQuery(slug, days), enabled: slug.length > 0 })
}

/**
 * Notas de versión de un proyecto entre dos fechas.
 *
 * Se pide con `since` y `until` vacíos cuando no se elige rango: el núcleo pone
 * entonces su ventana por defecto, y así la interfaz no tiene que duplicar cuál es
 * ni mantenerla en dos sitios.
 */
export function useChangelog(slug: string, since = '', until = ''): UseQueryResult<Changelog> {
  return useQuery({
    queryKey: queryKeys.changelog(slug, since, until),
    queryFn: ({ signal }) =>
      api.get<Changelog>(
        `/projects/${encodeURIComponent(slug)}/changelog${buildQuery({ since, until })}`,
        signal,
      ),
    staleTime: 30_000,
    enabled: slug.length > 0,
  })
}

export function useStats(): UseQueryResult<Stats> {
  return useQuery({
    queryKey: queryKeys.stats,
    queryFn: ({ signal }) => api.get<Stats>('/stats', signal),
    staleTime: 10_000,
  })
}

export function useConfig(): UseQueryResult<Config> {
  return useQuery({
    queryKey: queryKeys.config,
    queryFn: ({ signal }) => api.get<Config>('/config', signal),
    staleTime: 60_000,
  })
}

/**
 * Clientes de IA detectados y estado del binario MCP.
 *
 * El array llega ya ordenado por accionabilidad (detectado sin configurar
 * primero): la interfaz lo pinta tal cual, sin reordenar.
 */
export function useMCPProviders(
  options: { enabled?: boolean } = {},
): UseQueryResult<MCPProviders> {
  return useQuery({
    queryKey: queryKeys.mcp.providers,
    queryFn: ({ signal }) => api.get<MCPProviders>('/mcp/providers', signal),
    staleTime: 10_000,
    enabled: options.enabled ?? true,
  })
}

/** Bloque de configuración de un cliente, para la vía manual. */
export function useMCPSnippet(key: string | null): UseQueryResult<MCPSnippet> {
  return useQuery({
    queryKey: queryKeys.mcp.snippet(key ?? ''),
    queryFn: ({ signal }) =>
      api.get<MCPSnippet>(`/mcp/snippet${buildQuery({ provider: key })}`, signal),
    staleTime: 30_000,
    enabled: key !== null,
  })
}

/**
 * Bloque de un cliente personalizado. Se pide a demanda (`null` = no pedir) con
 * la definición que haya escrito el usuario; la clave de caché la incluye para
 * que cambiar un campo no enseñe el bloque anterior.
 */
export function useMCPCustomSnippet(def: MCPCustomDef | null): UseQueryResult<MCPSnippet> {
  return useQuery({
    queryKey: queryKeys.mcp.customSnippet(def),
    queryFn: ({ signal }) =>
      api.get<MCPSnippet>(
        `/mcp/snippet${buildQuery({
          provider: 'custom',
          path: def?.path,
          servers_key: def?.servers_key,
          entry_type: def?.entry_type,
          command_array: def?.command_array ? 'true' : undefined,
          env_key: def?.env_key,
        })}`,
        signal,
      ),
    enabled: def !== null,
  })
}

// --- Escrituras -------------------------------------------------------------

export function useSaveSummary(): UseMutationResult<
  { meta: SummaryMeta },
  Error,
  SaveSummaryInput
> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, content, base_hash }: SaveSummaryInput) =>
      api.put<{ meta: SummaryMeta }>(`/summaries/${id}`, { content, base_hash }),
    onSuccess: (result, variables) => {
      // La meta del detalle se actualiza al momento para que la toolbar y las
      // listas reflejen el nuevo título/hash sin esperar al refetch.
      queryClient.setQueryData<SummaryDetail>(queryKeys.summaries.detail(variables.id), (previous) =>
        previous ? { ...previous, meta: result.meta } : previous,
      )
      void queryClient.invalidateQueries({ queryKey: queryKeys.summaries.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects })
      void queryClient.invalidateQueries({ queryKey: queryKeys.stats })
    },
  })
}

export function useConfirmProposal(): UseMutationResult<
  ConfirmProposalResult,
  Error,
  ConfirmProposalInput
> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ token, decision, override }: ConfirmProposalInput) =>
      api.post<ConfirmProposalResult>(`/proposals/${token}/confirm`, { decision, override }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.proposals.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.summaries.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects })
      void queryClient.invalidateQueries({ queryKey: queryKeys.stats })
    },
  })
}

export function useCancelProposal(): UseMutationResult<
  { ok: boolean },
  Error,
  { token: string; reason?: string }
> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ token, reason }: { token: string; reason?: string }) =>
      api.post<{ ok: boolean }>(`/proposals/${token}/cancel`, { reason }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.proposals.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.stats })
    },
  })
}

/**
 * Lista lo que hay en la papelera.
 *
 * No se refresca sola: solo cambia cuando alguien borra o restaura, y eso pasa
 * por estas mismas mutaciones, que invalidan la clave.
 */
// --- Notas -------------------------------------------------------------------
//
// Las notas no pasan por el MCP: son de la interfaz. Estos hooks hablan con
// `/api/notes`, que es una API aparte de la de resúmenes a propósito.

/** El árbol completo de notas, en plano. El árbol lo compone la interfaz. */
export function useNotesTree(): UseQueryResult<NotesTreeResponse> {
  return useQuery({
    queryKey: queryKeys.notes.tree,
    queryFn: () => api.get<NotesTreeResponse>('/notes/tree'),
  })
}

/** El contenido de una nota concreta. */
export function useNoteFile(path: string | null): UseQueryResult<NoteFileResponse> {
  return useQuery({
    queryKey: queryKeys.notes.file(path ?? ''),
    queryFn: () =>
      api.get<NoteFileResponse>(`/notes/file${buildQuery({ path: path ?? '' })}`),
    enabled: path !== null && path !== '',
  })
}

/** Guarda una nota. El disco es la verdad; el índice se actualiza detrás. */
export function useSaveNote(): UseMutationResult<{ note: NoteMeta }, Error, { path: string; content: string }> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ path, content }: { path: string; content: string }) =>
      api.put<{ note: NoteMeta }>('/notes/file', { path, content }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notes.tree })
      // El contenido guardado pasa a ser el que hay en disco, así que la caché de
      // esa nota se actualiza sin volver a pedirla.
      queryClient.setQueryData(queryKeys.notes.file(variables.path), {
        path: variables.path,
        content: variables.content,
      })
    },
  })
}

/** Crea una nota o una carpeta. */
export function useCreateNote(): UseMutationResult<unknown, Error, NoteInput> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: NoteInput) => api.post<unknown>('/notes/create', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notes.all })
    },
  })
}

/**
 * Mueve o renombra una nota o una carpeta **con todo su contenido**.
 *
 * Es lo que hay detrás de arrastrar y soltar. El backend hace un `rename` del
 * sistema, así que es atómico; la interfaz solo tiene que invalidar el árbol.
 */
export function useMoveNote(): UseMutationResult<
  { ok: boolean; moved: number },
  Error,
  { from: string; to: string }
> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ from, to }: { from: string; to: string }) =>
      api.post<{ ok: boolean; moved: number }>('/notes/move', { from, to }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notes.all })
    },
  })
}

/** Archiva una nota o una carpeta entera. Se puede recuperar desde la papelera. */
export function useDeleteNote(): UseMutationResult<{ ok: boolean; archived_path: string }, Error, string> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (path: string) =>
      api.del<{ ok: boolean; archived_path: string }>(
        `/notes/file${buildQuery({ path })}`,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notes.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.trash })
    },
  })
}

/** Busca en el título y el cuerpo de las notas. */
export function useSearchNotes(query: string): UseQueryResult<NoteSearchResponse> {
  const trimmed = query.trim()
  return useQuery({
    queryKey: queryKeys.notes.search(trimmed),
    queryFn: () => api.get<NoteSearchResponse>(`/notes/search${buildQuery({ q: trimmed })}`),
    enabled: trimmed.length >= 2,
  })
}

export function useTrash(): UseQueryResult<TrashResponse> {
  return useQuery({
    queryKey: queryKeys.trash,
    queryFn: () => api.get<TrashResponse>('/trash'),
  })
}

/**
 * Borra un resumen.
 *
 * **Va a la papelera, no al vacío**: es la operación de todos los días y tiene
 * que ser reversible. El borrado definitivo es vaciar la papelera, que es una
 * acción distinta y con su propia confirmación.
 */
export function useDeleteSummary(): UseMutationResult<
  { ok: boolean; archived_path: string },
  Error,
  string
> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      api.del<{ ok: boolean; archived_path: string }>(`/summaries/${id}`),
    onSuccess: () => {
      // Todo lo que cuenta resúmenes cambia: la lista, el proyecto, las
      // categorías y las estadísticas de la barra.
      void queryClient.invalidateQueries({ queryKey: queryKeys.summaries.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects })
      void queryClient.invalidateQueries({ queryKey: queryKeys.categories })
      void queryClient.invalidateQueries({ queryKey: queryKeys.stats })
      void queryClient.invalidateQueries({ queryKey: queryKeys.trash })
    },
  })
}

/**
 * Vuelve a poner una versión anterior. Lleva `base_hash` como el guardado del
 * editor: si el archivo cambió desde que se cargó, el core responde 409 y no pisa
 * nada. Lo que había antes de restaurar queda a su vez en el historial.
 */
export function useRestoreVersion(): UseMutationResult<
  { meta: SummaryMeta },
  Error,
  { id: string; version: string; base_hash: string }
> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, version, base_hash }) =>
      api.post<{ meta: SummaryMeta }>(
        `/summaries/${encodeURIComponent(id)}/versions/${encodeURIComponent(version)}/restore`,
        { base_hash },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.summaries.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects })
    },
  })
}

/** Quita el vínculo de un proyecto con su repo de código. No toca ningún archivo. */
export function useUnlinkRepo(): UseMutationResult<{ ok: boolean }, Error, string> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (slug: string) => api.del<{ ok: boolean }>(`/projects/${slug}/repo`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects })
      void queryClient.invalidateQueries({ queryKey: queryKeys.summaries.all })
    },
  })
}

/** Archiva un proyecto entero: su carpeta va a la papelera con todo dentro. */
export function useDeleteProject(): UseMutationResult<{ ok: boolean }, Error, string> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (slug: string) => api.del<{ ok: boolean }>(`/projects/${slug}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects })
      void queryClient.invalidateQueries({ queryKey: queryKeys.summaries.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.categories })
      void queryClient.invalidateQueries({ queryKey: queryKeys.stats })
      void queryClient.invalidateQueries({ queryKey: queryKeys.trash })
    },
  })
}

/** Devuelve un archivo de la papelera a su sitio. Falla si el destino está ocupado. */
export function useRestoreFromTrash(): UseMutationResult<RestoreResult, Error, string> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (trashRel: string) =>
      api.post<RestoreResult>('/trash/restore', { trash_rel: trashRel }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.trash })
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects })
      void queryClient.invalidateQueries({ queryKey: queryKeys.summaries.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.categories })
      void queryClient.invalidateQueries({ queryKey: queryKeys.stats })
    },
  })
}

/**
 * Vacía la papelera. **Es irreversible**, y es la única acción de la app que lo
 * es: por eso vive en Ajustes y no al lado de cada archivo.
 */
export function useEmptyTrash(): UseMutationResult<EmptyTrashResult, Error, void> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.del<EmptyTrashResult>('/trash'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.trash })
    },
  })
}

export function useCreateProject(): UseMutationResult<Project, Error, CreateProjectInput> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateProjectInput) => api.post<Project>('/projects', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects })
      void queryClient.invalidateQueries({ queryKey: queryKeys.stats })
    },
  })
}

export function useReindex(): UseMutationResult<ReindexResult, Error, void> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<ReindexResult>('/reindex'),
    onSuccess: () => {
      void queryClient.invalidateQueries()
    },
  })
}

/**
 * Sube una imagen de fondo al core, que guarda una copia con un nombre derivado
 * de su contenido. No cambia la configuración: usarla es un `useUpdateConfig`.
 */
export function useUploadBackground(): UseMutationResult<{ image: string }, Error, Blob> {
  return useMutation({
    mutationFn: (file: Blob) => api.post<{ image: string }>('/backgrounds', file),
  })
}

export function useUpdateConfig(): UseMutationResult<Config, Error, ConfigPatch> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (patch: ConfigPatch) => api.put<Config>('/config', patch),
    onSuccess: (config) => {
      queryClient.setQueryData(queryKeys.config, config)
    },
  })
}

/**
 * Instala el binario MCP en su ubicación estable. Idempotente.
 *
 * Copia el binario que ya viene dentro de la app: no descarga nada.
 */
export function useInstallMCP(): UseMutationResult<MCPInstallResult, Error, void> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<MCPInstallResult>('/mcp/install'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.mcp.providers })
    },
  })
}

/**
 * Instala el binario (si hace falta) y configura los clientes pedidos.
 *
 * El core resuelve todos los clientes en una sola respuesta: el resultado trae
 * una entrada por clave, con la acción que aplicó a cada una.
 */
/**
 * Quita la entrada de SaveMe del archivo de cada cliente pedido.
 *
 * Es la operación simétrica de `useConfigureMCP`. No toca el binario instalado:
 * quitarlo de un cliente no es desinstalar SaveMe.
 */
export function useUnconfigureMCP(): UseMutationResult<
  MCPUnconfigureResponse,
  Error,
  MCPConfigureInput
> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ providers, custom }: MCPConfigureInput) =>
      api.post<MCPUnconfigureResponse>('/mcp/unconfigure', { providers, custom }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.mcp.providers })
    },
  })
}

export function useConfigureMCP(): UseMutationResult<
  MCPConfigureResponse,
  Error,
  MCPConfigureInput
> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ providers, custom }: MCPConfigureInput) =>
      api.post<MCPConfigureResponse>('/mcp/configure', { providers, custom }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.mcp.providers })
    },
  })
}
