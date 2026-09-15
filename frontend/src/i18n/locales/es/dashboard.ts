/**
 * Textos de `dashboard`. Ver `es/common.ts` para el criterio.
 *
 * Los plurales van anidados (`done: { one, other }`), como en `common.words`: es
 * la forma que `AnyPath` reconoce y que `translate` resuelve con `{ count }`.
 */
export const dashboard = {
  stats: {
    title: 'estado global',
    hint: 'viene de GET /stats',
    projects: 'proyectos',
    summaries: 'resúmenes',
    pending: 'pendientes',
    error: 'No pude leer las estadísticas: {message}',
    empty: 'Todavía no hay resúmenes indexados. Un agente puede proponer el primero con `saveme_summary_propose`.',
  },
  reindex: {
    title: 'Reconstruir el índice desde el disco',
    running: 'reindexando…',
    done: {
      one: 'Índice reconstruido: {count} archivo',
      other: 'Índice reconstruido: {count} archivos',
    },
    detail: '+{added} nuevos · ~{updated} actualizados · -{removed} quitados · {duration} ms',
    failed: 'No pude reindexar',
  },
} as const
