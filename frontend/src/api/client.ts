/**
 * Cliente HTTP tipado contra el core Go.
 *
 * La base sale de `window.__SAVEME__.apiBase`, que el shell de Tauri inyecta
 * antes de que cargue el bundle con el puerto real en el que quedó el core.
 *
 * Hace falta la URL absoluta porque dentro de Tauri la página se sirve por el
 * protocolo interno de la app: una ruta relativa `/api` no apuntaría al daemon,
 * apuntaría a los assets del bundle. Fuera de Tauri (Vite en desarrollo, o el
 * navegador) se usa `/api` relativo y el proxy de Vite lo reenvía a 127.0.0.1:7411.
 */
import { translateError } from '@/i18n'

import type { ApiErrorBody } from './types'

declare global {
  interface Window {
    __SAVEME__?: {
      apiBase?: string
      inTauri?: boolean
      corePort?: number
      /** true en macOS, donde la barra de título nativa está oculta. */
      macos?: boolean
    }
  }
}

export const API_BASE = window.__SAVEME__?.apiBase ?? '/api'

/** true cuando la interfaz corre dentro de la ventana de escritorio. */
export const IN_TAURI = window.__SAVEME__?.inTauri === true

/**
 * true en macOS.
 *
 * Importa porque ahí la barra de título nativa va en modo `Overlay` (ver
 * `src-tauri/src/main.rs`): los semáforos de la ventana flotan sobre la esquina
 * superior izquierda de la interfaz, así que la barra superior tiene que
 * reservarles sitio o quedarían encima de las migas de pan.
 */
export const IS_MACOS = window.__SAVEME__?.macos === true

/** Error tipado del core. Conserva el código del envelope de error. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }

  /** 409 + `hash_mismatch`: el archivo cambió en disco desde que lo cargamos. */
  get isHashMismatch(): boolean {
    return this.status === 409 && this.code === 'hash_mismatch'
  }

  get isConflict(): boolean {
    return this.status === 409
  }

  get isNotFound(): boolean {
    return this.status === 404
  }

  /** status 0 = no hubo respuesta (core caído, puerto cerrado, fetch abortado). */
  get isOffline(): boolean {
    return this.status === 0
  }
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null) return false
  const envelope = (value as { error?: unknown }).error
  if (typeof envelope !== 'object' || envelope === null) return false
  const { code, message } = envelope as { code?: unknown; message?: unknown }
  return typeof code === 'string' && typeof message === 'string'
}

function describeCause(cause: unknown): string {
  if (cause instanceof Error) return cause.message
  return String(cause)
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE'

interface RequestOptions {
  method?: Method
  body?: unknown
  signal?: AbortSignal
}

export type QueryValue = string | number | boolean | null | undefined

/** Construye `?a=1&b=2` omitiendo los valores vacíos. */
export function buildQuery(params: Record<string, QueryValue>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    search.set(key, String(value))
  }
  const query = search.toString()
  return query ? `?${query}` : ''
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal } = options
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      signal,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause
    throw new ApiError(
      0,
      'network_error',
      translateError('network_error', `No pude hablar con el core en ${API_BASE}`, {
        base: API_BASE,
        detail: describeCause(cause),
      }),
    )
  }

  const raw = await response.text()
  let parsed: unknown = null
  if (raw.length > 0) {
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = null
    }
  }

  if (!response.ok) {
    if (isApiErrorBody(parsed)) {
      throw new ApiError(response.status, parsed.error.code, parsed.error.message)
    }
    throw new ApiError(
      response.status,
      `http_${response.status}`,
      translateError('http', raw.trim() || `El core respondió ${response.status}`, {
        status: response.status,
      }),
    )
  }

  return parsed as T
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, { signal }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}

/**
 * Códigos cuyo texto ya se tradujo al construir el error.
 *
 * Solo en el punto donde nace el error está el detalle —la URL base, el motivo
 * del fallo—, así que ahí se interpola. Volver a traducirlo aquí dejaría los
 * `{placeholders}` a la vista.
 */
const LOCALIZED_CODES: ReadonlySet<string> = new Set(['network_error'])

function isPreLocalized(code: string): boolean {
  return code.startsWith('http_') || LOCALIZED_CODES.has(code)
}

/**
 * Mensaje legible para cualquier error que llegue a la UI.
 *
 * Los errores del core se traducen por código; los que llevan el detalle de la
 * validación pegadito se quedan con el texto del servidor, que es la única
 * fuente de ese detalle.
 */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (isPreLocalized(error.code)) return error.message
    return translateError(error.code, error.message)
  }
  if (error instanceof Error) return error.message
  return String(error)
}
