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
  /** Salud del diario (`features/dashboard/HealthPanel.tsx`). */
  health: {
    title: 'salud del diario',
    hint: 'lo que envejece sin avisar',
    stale: 'por revisar',
    staleHint: 'Sus archivos tienen 3 o más commits posteriores: lo que cuentan puede haber dejado de ser verdad.',
    noFiles: 'sin archivos',
    noFilesHint: 'No dicen qué archivos tocaron, así que nunca podrán avisar de que se quedaron viejos.',
    noRepo: 'sin repo',
    noRepoHint: 'Proyectos sin repo vinculado: no se puede mirar su código. Se vinculan solos cuando un agente guarda un resumen pasando su directorio.',
    superseded: 'sustituidos',
    supersededHint: 'Ya los deja sin vigencia otro resumen: son historia, no la verdad actual.',
    allGood: 'Nada que mirar: ningún resumen desactualizado ni sin archivos.',
    repoMoved: 'repo no encontrado',
    repoMovedHint: 'El repo no está donde se vio por última vez. Se pone al día en cuanto un agente vuelve a guardar desde él.',
    noGit: 'Sin git en esta máquina: no se pueden contar commits.',
    commits: { one: '{count} commit', other: '{count} commits' },
    error: 'No pude calcular la salud del diario',
  },
} as const
