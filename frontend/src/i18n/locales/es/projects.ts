/** Textos de `projects`. Ver `es/common.ts` para el criterio. */
export const projects = {
  /**
   * Etiquetas de las categorías que manda el core como clave (`feature`, `fix`…).
   * El `label` que viene del servidor es solo el respaldo para una categoría que
   * todavía no conozcamos. Si añades una aquí, añádela también en `en/`.
   */
  category: {
    feature: 'Feature',
    fix: 'Fix',
    chore: 'Chore',
    refactor: 'Refactor',
    docs: 'Docs',
    infra: 'Infra',
    design: 'Design',
    research: 'Research',
    incident: 'Incident',
    uncategorized: 'Sin categoría',
    folderLabel: 'carpeta',
    sortNewest: 'ordenados por fecha de creación, más nuevos primero',
    empty: {
      title: 'Nada en {category} todavía',
      hint: 'La carpeta existe (se crea con el proyecto), pero está vacía.',
    },
  },
  // Descripción de cada categoría. El core también las manda, en español
  // (`Category.description`); aquí están traducidas para que la interfaz no
  // mezcle idiomas. Si llega una categoría que esta versión no conoce, se usa la
  // del servidor como respaldo.
  categoryDescription: {
    feature: 'Funcionalidad nueva visible para quien usa el producto.',
    fix: 'Se corrigió un comportamiento incorrecto.',
    chore: 'Dependencias, tooling, versiones, limpieza.',
    refactor: 'Se reestructuró el código sin cambiar su comportamiento.',
    docs: 'Documentación, guías y comentarios explicativos.',
    infra: 'CI/CD, build, despliegue y observabilidad.',
    design: 'Decisión de arquitectura o de diseño (ADR ligero).',
    research: 'Spike, exploración o comparación de opciones.',
    incident: 'Post-mortem de algo que se rompió.',
    uncategorized: 'Archivos que no están en una carpeta de categoría conocida.',
  },
  /** Estados del ciclo de vida de un resumen (`SummaryStatus`). */
  status: {
    confirmed: 'confirmado',
    draft: 'borrador',
    unmanaged: 'sin gestionar',
  },
  summaryCount: {
    one: '{count} resumen',
    other: '{count} resúmenes',
  },
  lastActivity: 'última actividad',
  recentActivity: 'actividad reciente',
  /** Pestañas de categoría del proyecto. */
  tabs: {
    all: 'todas',
  },
  resultsShown: '{shown} de {total}',
  loadFailed: 'no pude cargar el proyecto',
  notFound: {
    title: 'No encontré el proyecto «{slug}»',
    hint: 'Puede que se haya renombrado o que el índice esté desactualizado. Reindexar lo resuelve.',
  },
  path: {
    copy: 'Copiar la ruta del proyecto',
    copied: 'Ruta copiada',
    copyFailed: 'No pude copiar la ruta',
  },
  counts: {
    none: 'sin resúmenes',
    entry: '{count} en {category}',
    more: '+{count} más',
  },
  list: {
    empty: 'Sin resúmenes aquí',
    loadFailed: 'no pude leer los resúmenes',
  },
  empty: {
    title: 'Este proyecto todavía no tiene resúmenes',
    hint: 'Cuando un agente confirme una propuesta (o tú escribas desde el editor) aparecerán aquí.',
  },
  search: {
    placeholder: 'buscar en títulos, resumen y cuerpo…',
    label: 'Buscar resúmenes',
    clear: 'Limpiar búsqueda',
    searching: 'buscando «{query}»…',
    results: 'resultados',
    resultCount: {
      one: '{count} resultado',
      other: '{count} resultados',
    },
    empty: {
      title: 'Nada coincide con «{query}»',
    },
  },
  newProject: {
    title: 'nuevo proyecto',
    nameLabel: 'nombre visible',
    slugLabel: 'slug (opcional)',
    description:
      'Se crearán las 9 carpetas de categoría dentro del proyecto, aunque estén vacías. El nombre visible se guarda en la base de datos; el slug es el directorio en disco.',
    submit: 'crear proyecto',
    creating: 'creando…',
    created: 'Proyecto {name} creado',
    createdHint: 'Directorio: {path}',
    createFailed: 'No pude crear el proyecto',
  },
    delete: {
      action: 'borrar el proyecto',
      title: '¿borrar «{name}»?',
      subtitle: 'Se archiva el proyecto entero',
      description:
        'Su carpeta va a la papelera con sus {count} resúmenes dentro. No se destruye nada: puedes recuperarlo desde Ajustes → espacio de trabajo.',
      done: 'Proyecto archivado',
      failed: 'No pude archivar el proyecto',
    },
  tag: {
    explain: 'Resúmenes de cualquier proyecto que llevan esta etiqueta.',
    empty: {
      title: 'Nada con la etiqueta #{tag}',
      hint: 'Puede que se la hayas quitado a todos, o que el índice esté viejo: prueba a reindexar desde Ajustes.',
    },
  },
} as const
