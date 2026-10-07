import type { SummaryFilter } from '@/api/types'

/**
 * Lo que piden las pantallas de un proyecto. La ruta precarga con el mismo
 * filtro que usa el componente: la clave de caché sale de él, y una clave
 * distinta dejaría la precarga sin leer.
 */

/**
 * Filtros del buscador del resumen general. Cada uno ausente es «sin filtro».
 * Las fechas son días `AAAA-MM-DD` en hora local, los dos incluidos.
 */
export interface OverviewFilters {
  tag?: string
  status?: string
  from?: string
  to?: string
}

export const OVERVIEW_FILTER_KEYS = ['tag', 'status', 'from', 'to'] as const

export function hasOverviewFilters(filters: OverviewFilters): boolean {
  return OVERVIEW_FILTER_KEYS.some((key) => Boolean(filters[key]))
}

/**
 * Resumen general: los últimos tocados o, con texto o filtros, la búsqueda.
 *
 * Solo se ponen las claves con valor: sin texto ni filtros sale exactamente el
 * filtro que precarga la ruta, y la primera pintura lee esa precarga.
 */
export function projectOverviewFilter(
  project: string,
  query?: string,
  filters: OverviewFilters = {},
): SummaryFilter {
  const filter: SummaryFilter = { project, limit: 40 }
  if (query) filter.q = query
  for (const key of OVERVIEW_FILTER_KEYS) {
    const value = filters[key]
    if (value) filter[key] = value
  }
  return filter
}

/**
 * Una categoría, del más nuevo al más viejo.
 *
 * Se pide `sort=created`: el contrato (§6) lista el parámetro `sort` sin
 * enumerar valores, así que `created` es una suposición razonable, no un valor
 * confirmado por el core.
 */
export function categoryFilter(project: string, category: string): SummaryFilter {
  return { project, category, limit: 200, sort: 'created' }
}
