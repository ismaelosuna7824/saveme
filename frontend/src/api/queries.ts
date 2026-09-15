/**
 * Hooks de datos. TanStack Query es la única puerta de entrada al core: ningún
 * componente llama a `fetch` directamente.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'

import { api, buildQuery } from './client'
import type {
  Category,
  Config,
  ConfigPatch,
  ConfirmProposalInput,
  ConfirmProposalResult,
  CreateProjectInput,
  Health,
  MCPConfigureInput,
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
  SummaryDetail,
  SummaryFilter,
  SummaryList,
  SummaryMeta,
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
  config: ['config'] as const,
  categories: ['categories'] as const,
  projects: ['projects'] as const,
  summaries: {
    all: ['summaries'] as const,
    list: (filter: SummaryFilter) => ['summaries', 'list', filter] as const,
    detail: (id: string) => ['summaries', 'detail', id] as const,
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
  tags: ['tags'] as const,
  mcp: {
    providers: ['mcp', 'providers'] as const,
    snippet: (key: string) => ['mcp', 'snippet', key] as const,
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

export function useProjects(): UseQueryResult<Project[]> {
  return useQuery({
    queryKey: queryKeys.projects,
    queryFn: ({ signal }) => api.get<Project[]>('/projects', signal),
    staleTime: 30_000,
  })
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
 * Todas las etiquetas del workspace, con cuántos resúmenes lleva cada una.
 *
 * El endpoint existía desde el principio y no lo llamaba nadie: las etiquetas se
 * pintaban pero no se podían usar para navegar. Ahora alimenta el contador de la
 * pantalla de una etiqueta.
 */
export function useTags(): UseQueryResult<Record<string, number>> {
  return useQuery({
    queryKey: queryKeys.tags,
    queryFn: () => api.get<Record<string, number>>('/tags'),
  })
}

export function useCategories(): UseQueryResult<Category[]> {
  return useQuery({
    queryKey: queryKeys.categories,
    queryFn: ({ signal }) => api.get<Category[]>('/categories', signal),
    // La taxonomía es estática mientras corre el proceso.
    staleTime: Infinity,
  })
}

export function useSummaries(
  filter: SummaryFilter,
  options: { enabled?: boolean } = {},
): UseQueryResult<SummaryList> {
  return useQuery({
    queryKey: queryKeys.summaries.list(filter),
    queryFn: ({ signal }) =>
      api.get<SummaryList>(`/summaries${buildQuery({ ...filter })}`, signal),
    staleTime: 15_000,
    enabled: options.enabled ?? true,
  })
}

export function useSummary(id: string): UseQueryResult<SummaryDetail> {
  return useQuery({
    queryKey: queryKeys.summaries.detail(id),
    queryFn: ({ signal }) => api.get<SummaryDetail>(`/summaries/${id}`, signal),
    // El contenido en disco manda: nunca servimos caché para editar.
    staleTime: 0,
    enabled: id.length > 0,
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
    mutationFn: ({ providers }: MCPConfigureInput) =>
      api.post<MCPUnconfigureResponse>('/mcp/unconfigure', { providers }),
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
    mutationFn: ({ providers }: MCPConfigureInput) =>
      api.post<MCPConfigureResponse>('/mcp/configure', { providers }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.mcp.providers })
    },
  })
}
