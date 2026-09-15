/** Textos de `dashboard`. Misma forma que `es/dashboard.ts`. */
export const dashboard = {
  stats: {
    title: 'global status',
    hint: 'comes from GET /stats',
    projects: 'projects',
    summaries: 'summaries',
    pending: 'pending',
    error: "Couldn't read the stats: {message}",
    empty: 'No summaries indexed yet. An agent can propose the first one with `saveme_summary_propose`.',
  },
  reindex: {
    title: 'Rebuild the index from disk',
    running: 'reindexing…',
    done: {
      one: 'Index rebuilt: {count} file',
      other: 'Index rebuilt: {count} files',
    },
    detail: '+{added} new · ~{updated} updated · -{removed} removed · {duration} ms',
    failed: "Couldn't reindex",
  },
} as const
