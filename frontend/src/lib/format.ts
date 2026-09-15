/**
 * Formateo de fechas, tamaños y textos.
 *
 * Las funciones que producen texto visible usan `translate()`, no `useT()`: son
 * utilidades puras que se llaman desde el render pero también desde sitios que no
 * son componentes. El idioma activo lo mantiene el proveedor de i18n.
 *
 * `formatDateTime` y `formatConfidence` son neutrales al idioma a propósito: el
 * formato `2026-02-14 10:33` es el mismo en todas partes y un porcentaje no se
 * traduce. Lo que sí cambia es la distancia relativa y el separador decimal.
 */
import { activeLocaleTag, translate } from '@/i18n'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

function parse(value: string | null | undefined): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function pad(value: number): string {
  return value.toString().padStart(2, '0')
}

/** `2026-02-14 10:33` en hora local. */
export function formatDateTime(value: string | null | undefined): string {
  const date = parse(value)
  if (!date) return '—'
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

/** Distancia relativa corta: `hace 3 min`, `ayer`, `hace 4 d`. */
export function formatRelative(value: string | null | undefined, now = Date.now()): string {
  const date = parse(value)
  if (!date) return translate('common.time.noActivity')
  const diff = now - date.getTime()
  if (diff < 0) return translate('common.time.justNow')
  if (diff < MINUTE) return translate('common.time.moments')
  if (diff < HOUR) {
    return translate('common.time.minutes', { count: Math.floor(diff / MINUTE) })
  }
  if (diff < DAY) return translate('common.time.hours', { count: Math.floor(diff / HOUR) })
  const days = Math.floor(diff / DAY)
  if (days === 1) return translate('common.time.yesterday')
  if (days < 30) return translate('common.time.days', { count: days })
  if (days < 365) {
    return translate('common.time.months', { count: Math.floor(days / 30) })
  }
  return translate('common.time.years', { count: Math.floor(days / 365) })
}

/** Segundos transcurridos desde un timestamp local: `hace 4s`. */
export function formatSecondsSince(timestamp: number | null, now = Date.now()): string {
  if (timestamp === null) return translate('common.time.unsaved')
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000))
  if (seconds < 60) return translate('common.time.seconds', { count: seconds })
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return translate('common.time.minutes', { count: minutes })
  return translate('common.time.hours', { count: Math.floor(minutes / 60) })
}

/**
 * `12,4 KB` en español y `12.4 KB` en inglés.
 *
 * El separador decimal lo decide `Intl`, que es exactamente para lo que está: en
 * español es una coma y en inglés un punto, y fijarlo a mano garantizaba que una
 * de las dos interfaces se viera mal.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1000
  let unit = 0
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000
    unit += 1
  }
  const formatted = new Intl.NumberFormat(activeLocaleTag(), {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value)
  return `${formatted} ${units[unit]}`
}

/** Cuenta palabras ignorando el frontmatter YAML. */
export function countWords(content: string): number {
  const body = stripFrontmatter(content)
  const matches = body.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)
  return matches ? matches.length : 0
}

/** Quita el bloque `--- ... ---` inicial si existe (versión tolerante). */
export function stripFrontmatter(content: string): string {
  if (!content.startsWith('---')) return content
  const end = content.indexOf('\n---', 3)
  if (end === -1) return content
  const after = content.indexOf('\n', end + 1)
  return after === -1 ? '' : content.slice(after + 1)
}

/** Acorta una ruta larga por el medio: `frontend/…/Editor.tsx`. */
export function shortenPath(path: string, max = 48): string {
  if (path.length <= max) return path
  const parts = path.split('/')
  if (parts.length <= 2) return `…${path.slice(path.length - max + 1)}`
  return `${parts[0]}/…/${parts.slice(-2).join('/')}`
}

/** `72%` a partir de una confianza 0..1. */
export function formatConfidence(confidence: number): string {
  return `${Math.round(Math.max(0, Math.min(1, confidence)) * 100)}%`
}
