/** Textos de `inbox`. Ver `es/common.ts` para el criterio. */
export const inbox = {
  projects: 'proyectos',
  newProject: 'nuevo',
  projectsLoadFailed: 'no pude listar los proyectos',
  projectsEmpty: {
    title: 'Todavía no hay proyectos',
    hint: 'Crea el primero: SaveMe generará las 9 carpetas de categoría dentro.',
  },
  pending: {
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
    expiredHint: 'La propuesta caducó: pide al agente que la vuelva a proponer.',
  },
  whyCategory: 'por qué esta categoría',
  orSaveIn: 'o guárdalo en',
  filesTouched: {
    one: '{count} archivo',
    other: '{count} archivos',
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
