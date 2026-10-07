/** Textos de `inbox`. Ver `es/common.ts` para el criterio. */
export const inbox = {
  projects: 'proyectos',
  newProject: 'nuevo',
  projectsLoadFailed: 'no pude listar los proyectos',
  projectsEmpty: {
    title: 'Todavía no hay proyectos',
    hint: 'Crea el primero: SaveMe generará dentro una carpeta por categoría.',
  },
  pending: {
    expiredTitle: 'confirmaciones vencidas',
    noneExpired: 'ninguna vencida',
    tabPending: 'pendientes',
    tabExpired: 'vencidas',
    title: 'confirmaciones pendientes',
    waiting: '{count} esperando decisión',
    none: 'nada pendiente',
  },
  proposalsLoadFailed: 'no pude leer las propuestas',
  empty: {
    title: 'No hay nada esperando tu aprobación',
    /** El nombre de la herramienta MCP se interpola como `<code>`. */
    hintBefore: 'Cuando un agente proponga un resumen con',
    hintAfter:
      ', aparecerá aquí. La propuesta vive 15 minutos: ese es su TTL. Nada se escribe en disco sin que tú decidas dónde.',
    guarantee: 'sin `confirm` no hay escritura',
  },
  accepted: {
    title: 'Resumen guardado',
    savedIn: 'Guardado en {category}',
  },
  confirmFailed: 'No pude confirmar la propuesta',
  discardReason: 'descartada desde el inbox de la UI',
  discarded: 'Propuesta descartada, no se escribió nada',
  discardFailed: 'No pude descartar la propuesta',
  expiry: {
    expired: 'caducada',
    minutesLeft: 'caduca en {count} min',
    at: 'expira {when}',
    expiredHint:
      'Se pasó el plazo, pero el resumen sigue intacto y puedes aprobarlo igual.',
  },
  whyCategory: 'por qué esta categoría',
  /** Por qué se propuso la categoría, montado desde `inference.kind`. */
  inference: {
    explicit: 'Lo pediste explícitamente.',
    none: 'No encontré señales claras en el título ni en el cuerpo, y {category} es el caso más común. Confírmalo o elige otra carpeta.',
    signals: 'El título y el cuerpo mencionan {evidence}, que es señal de {category}.',
    tie: '{category} y {runnerUp} tienen la misma evidencia ({evidence}), así que propongo {category} por ser la más específica. Confírmalo o elige otra carpeta.',
    tieUnknown: 'Hay otra categoría con la misma evidencia ({evidence}), así que propongo {category} por ser la más específica. Confírmalo o elige otra carpeta.',
  },
  orSaveIn: 'o guárdalo en',
  supersedes: 'deja sin vigencia',
  repo: {
    willLink: 'Al aprobarla, el repo {repo} quedará vinculado a este proyecto.',
    otherProject: 'Ojo: este repo ({repo}) está vinculado al proyecto {project}, no a este.',
  },
  filesTouched: {
    one: '{count} archivo',
    other: '{count} archivos',
  },
  alert: {
    title: 'confirmación pendiente',
    body: 'Un agente dejó un resumen esperando tu aprobación. Caduca en 15 minutos.',
  },
  tags: {
    title: 'etiquetas',
    count: {
      one: '{count} en uso',
      other: '{count} en uso',
    },
    empty: 'Todavía no hay ninguna. Se ponen al proponer un resumen.',
  },
  digest: {
    title: 'esta semana',
    counts: {
      one: '{count} resumen en {projects} proyecto',
      other: '{count} resúmenes en {projects} proyectos',
    },
    days: {
      one: '{count} día',
      other: '{count} días',
    },
    empty: 'No hay nada apuntado en los últimos {count} días.',
    failed: 'no pude leer lo de estos días',
  },
  diff: {
    tabProposal: 'propuesta',
    tabChanges: 'cambios',
    loading: 'calculando los cambios…',
    failed: 'no pude leer los cambios de esta propuesta',
    againstDisk: 'sobre lo que hay en disco',
    newSummary: 'resumen nuevo: no hay nada con lo que comparar',
    newSummaryHint: {
      one: 'Se creará con {count} línea.',
      other: 'Se creará con {count} líneas.',
    },
  },
  retarget: {
    action: 'Guardar en otra carpeta',
    title: 'guardar en otra carpeta',
    project: 'proyecto',
    category: 'categoría',
    chooseProject: 'elige un proyecto',
    chooseCategory: 'elige una categoría',
    targetLabel: 'se escribirá en',
    descriptionBefore: 'La propuesta se marca como',
    descriptionAfter: 'en la auditoría: queda registrado que el destino no fue el inferido.',
    submit: 'guardar aquí',
    saved: 'Guardado en la carpeta elegida',
  },
} as const
