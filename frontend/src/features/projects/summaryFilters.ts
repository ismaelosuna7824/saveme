import type { SummaryFilter } from '@/api/types'

/**
 * Lo que piden las pantallas de un proyecto. La ruta precarga con el mismo
 * filtro que usa el componente: la clave de caché sale de él, y una clave
 * distinta dejaría la precarga sin leer.
 */

/** Resumen general: los últimos tocados o, con texto, la búsqueda. */
export function projectOverviewFilter(project: string, query?: string): SummaryFilter {
  return { project, q: query, limit: 40 }
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
