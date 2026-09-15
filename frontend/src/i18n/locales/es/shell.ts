/**
 * Textos de `shell`. Ver `es/common.ts` para el criterio.
 *
 * Los plurales van anidados (`clave: { one, other }`), como en `common.words`: es
 * la forma que `AnyPath` reconoce y que `translate` resuelve con `{ count }`.
 */
export const shell = {
  nav: {
    inbox: 'inbox',
    projects: 'proyectos',
  },
  topBar: {
    breadcrumbs: 'Migas de pan',
    stats: '{projects} proyectos · {summaries} resúmenes · {pending} pendientes',
    loadingStats: 'cargando estado…',
    events: 'eventos',
    eventsConnected: 'conectado al stream de eventos',
    eventsConnectedLast: 'conectado · último evento: {type}',
    eventsDisconnected: 'sin stream de eventos: reintentando en segundo plano',
    settings: 'Ajustes',
    settingsHint: 'Ajustes: tema, MCP y workspace',
    paletteHint: 'Paleta de comandos',
  },
  sidebar: {
    expand: 'Desplegar el panel',
    collapse: 'Plegar el panel',
    empty: 'Sin proyectos todavía. Crea uno desde la paleta (⌘K) o desde el inbox.',
    lastActivity: 'último movimiento {when}',
    waiting: 'esperando proyectos',
  },
  shortcuts: {
    title: 'atajos de teclado',
    palette: 'Abrir la paleta de comandos',
    cycleMode: 'Cambiar el modo del editor',
    save: 'Guardar (con el editor abierto)',
    help: 'Esta lista',
    close: 'Cerrar lo que esté abierto',
  },
  theme: {
    changed: 'Tema: {name}',
    next: 'Cambiar a {name}',
    failed: 'No pude cambiar el tema',
    toggle: 'Cambiar tema',
  },
  breadcrumbs: {
    summary: 'resumen {id}',
  },
  boot: {
    tagline: 'diario técnico de proyecto',
    coreReady: 'core listo · v{version} · {rootDir}',
    failedTitle: 'el core no respondió',
    // La dirección del core se interpola aparte porque en pantalla lleva su <code>.
    failedBodyBefore: 'Probé {count} veces y no pude hablar con el core en',
    failedBodyAfter: '. La app necesita el daemon para leer y escribir tus resúmenes.',
    lastError: 'último error',
    noDetail: 'sin detalle',
    hintStart: '· Arranca el core: `make dev-core` o `saveme serve`.',
    hintPort: '· Comprueba que el puerto 7411 esté libre.',
    hintLog: '· Revisa el log del daemon en `.saveme/daemon.json` para el puerto real.',
    running: 'arranque',
    waiting: '[ {attempt}/{max} ] esperando al core en {address}…',
  },
  notFound: {
    code: 'error 404',
    title: 'Esa ruta no existe en SaveMe. Puede que el resumen se haya movido o borrado.',
    back: 'volver al inbox',
  },
  palette: {
    title: 'paleta de comandos',
    placeholder: 'buscar proyectos, categorías, resúmenes o ejecutar una acción…',
    noResults: 'nada por aquí con «{query}»',
    actions: 'acciones',
    projects: 'proyectos',
    categories: 'categorías con contenido',
    summaries: 'resúmenes',
    goInbox: 'ir al inbox',
    goInboxHint: 'pendientes',
    newProject: 'nuevo proyecto',
    reindex: 'reindexar desde el disco',
    configureMcp: 'configurar el MCP en otros agentes',
    settings: 'ajustes',
    cycleMode: 'cambiar modo del editor',
    searching: 'buscando…',
    noSummaryResults: 'sin resultados para «{query}»',
    mode: {
      live: 'edición en vivo',
      source: 'solo fuente',
      split: 'dividido',
      preview: 'solo preview',
    },
    summaryCount: {
      one: '{count} resumen',
      other: '{count} resúmenes',
    },
    reindexDone: {
      one: 'Índice reconstruido: {count} archivo',
      other: 'Índice reconstruido: {count} archivos',
    },
    reindexDetail: '+{added} · ~{updated} · -{removed} · {duration} ms',
    reindexFailed: 'No pude reindexar',
    /** `value` de cmdk: texto sobre el que se filtra, no se pinta. */
    search: {
      inbox: 'accion inbox pendientes',
      newProject: 'accion nuevo proyecto crear',
      reindex: 'accion reindexar indice disco',
      mcp: 'accion configurar mcp servidor agentes onboarding asistente',
      settings: 'accion ajustes settings preferencias tema apariencia editor workspace',
      mode: 'accion alternar modo vista preview source split',
      project: 'proyecto {name} {slug}',
      category: 'categoria {project} {label} {key}',
      summary: 'resumen {title} {path}',
      searching: 'buscando',
      empty: 'sin resultados',
    },
  },
} as const
