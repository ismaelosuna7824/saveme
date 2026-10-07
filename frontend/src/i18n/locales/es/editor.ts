/** Textos de `editor`. Ver `es/common.ts` para el criterio. */
export const editor = {
  /** Etiqueta accesible de la casilla de una tarea en el Live Preview. */
  task: {
    markDone: 'Marcar como hecha',
    markPending: 'Marcar como pendiente',
  },
  meta: {
    title: 'corregir categoría y título',
    description:
      'Cambiar la categoría mueve el resumen a su carpeta. El contenido no se toca.',
    titleLabel: 'título',
    categoryLabel: 'categoría',
    moves: 'Se moverá a otra carpeta.',
    save: 'guardar',
    saved: 'Metadatos corregidos',
    failed: 'No pude corregirlos',
  },
  /**
   * Nombre y ayuda de cada modo de vista. Las claves se consumen desde
   * `features/editor/mode.ts`, que las expone como mapas por `PreviewMode`.
   */
  mode: {
    live: {
      label: 'en vivo',
      hint: 'Renderiza el markdown mientras escribes. La sintaxis aparece solo en la línea del cursor.',
    },
    source: {
      label: 'fuente',
      hint: 'Markdown crudo, sin adornos.',
    },
    split: {
      label: 'dividido',
      hint: 'Fuente a la izquierda, preview a la derecha.',
    },
    preview: {
      label: 'preview',
      hint: 'Solo el documento renderizado.',
    },
  },
  /** Estados de la página cuando el resumen no se puede mostrar. */
  page: {
    openFailed: 'no pude abrir el resumen',
    notFound: 'No encontré el resumen {id}',
    notFoundHint:
      'Puede que se haya borrado o que el índice esté desactualizado. Reindexar lo resuelve.',
  },
  vim: {
    badgeTitle:
      'Modo de vim: las letras son órdenes. Pulsa i para escribir y Esc para volver a las órdenes.',
  },
  toolbar: {
    backTitle: 'Volver al proyecto (Esc)',
    titleLabel: 'Título del resumen',
    titlePlaceholder: 'título del resumen',
    saveTitle: 'Guardar (⌘S)',
    unsaved: 'cambios sin guardar',
    unchanged: 'sin cambios',
    // `{when}` es la forma relativa de `common.time` (que ya lleva el "hace").
    saved: 'guardado {when}',
    updated: 'actualizado {date}',
    author: 'autor {author}',
    // Plural de hermanos: se pasa la base (`editor.toolbar.files`) con `count` y
    // el traductor elige `_one` / `_other`.
    files_one: '{count} archivo',
    files_other: '{count} archivos',
    copyPath: 'Copiar la ruta del archivo',
    copyPathDone: 'Ruta copiada',
    copyPathFailed: 'No pude copiar la ruta',
  },
  /**
   * Resúmenes enlazados: los que este nombra en su `related` y los que lo nombran
   * a él (`features/editor/SummaryLinksRow.tsx`).
   */
  links: {
    label: 'Resúmenes enlazados',
    related: 'relacionados',
    backlinks: 'lo citan',
    supersedes: 'sustituye a',
    supersededBy: 'sustituido por',
    supersededHint: 'Ya no es la versión vigente: manda el resumen que lo sustituye.',
  },
  /**
   * El commit del resumen y lo que cambió después en sus archivos
   * (`features/editor/CodeChanges.tsx`).
   */
  code: {
    commit: 'commit {sha}',
    openCommit: 'Abrir el commit',
    openFailed: 'No pude abrir el commit',
    changed_one: '{count} commit posterior en sus archivos',
    changed_other: '{count} commits posteriores en sus archivos',
    changedHint: 'Commits que tocaron los archivos de este resumen después de escribirlo.',
    staleHint: 'Son bastantes: lo que cuenta puede estar desactualizado. Revísalo con el código delante.',
  },
  /**
   * Guardar el resumen como fichero y compartirlo. El documento sale sin
   * frontmatter y con el título arriba (`features/editor/shareMarkdown.ts`).
   */
  share: {
    download: 'Guardar como markdown…',
    filterName: 'Markdown',
    downloaded: 'Resumen guardado',
    downloadedBrowser: 'Descargado como {file}',
    downloadFailed: 'No pude guardarlo',
    action: 'Compartir el resumen',
    heading: 'compartir',
    copyMarkdown: 'Copiar markdown',
    copyMarkdownHint: 'Slack · Teams · Discord',
    copyText: 'Copiar como texto',
    copyTextHint: 'sin formato',
    copied: 'Copiado al portapapeles',
    copiedSlack: 'Pégalo en Slack, Teams o Discord: entienden el markdown.',
    copyFailed: 'No pude copiarlo',
    x: 'Publicar en X',
    linkedin: 'Publicar en LinkedIn',
    facebook: 'Publicar en Facebook',
    facebookCopied: 'Texto copiado',
    facebookHint: 'Facebook no deja rellenar la publicación: pégalo con ⌘V.',
    email: 'Enviar por correo',
    system: 'Más opciones del sistema…',
    openFailed: 'No pude abrirlo',
  },
  /**
   * Conflicto de escritura (409 `hash_mismatch`). El cuerpo va partido en dos
   * porque el código de error se pinta como `<code>` entre las dos mitades.
   */
  conflict: {
    title: 'el archivo cambió en disco',
    bodyBefore:
      'Otra persona, un agente o un editor externo escribió este archivo después de que lo cargáramos. El core rechazó el guardado con',
    bodyAfter: 'para no pisar nada. Tu texto sigue aquí.',
    reload: 'recargar del disco',
    reloadHint: 'descarta tus cambios locales y muestra la versión que está en el archivo.',
    overwrite: 'sobrescribir',
    overwriteHint: 'reintenta el guardado con el hash fresco: tu versión gana.',
    copyMine: 'copiar mi versión',
    copyMineHint: 'la manda al portapapeles por si quieres rescatarla.',
    copied: 'Tu versión está en el portapapeles',
    copyFailed: 'No pude copiar tu versión',
    keep: 'Nada se pierde hasta que elijas. Si cierras el diálogo, sigues editando y podrás guardar más tarde.',
    keepEditing: 'seguir editando',
  },
  /** Avisos del guardado manual y de la resolución del conflicto. */
  save: {
    failed: 'No pude guardar',
    nothing: 'No hay cambios que guardar',
    reloadFailed: 'No pude leer el archivo del disco',
    reloaded: 'Traído del disco',
    overwritten: 'Sobrescrito con tu versión',
    fetchFailed: 'No pude leer el archivo para sobrescribir',
  },
  /** Historial de versiones de un resumen (`features/editor/VersionsDialog.tsx`). */
  versions: {
    action: 'versiones anteriores',
    title: 'versiones anteriores',
    description:
      'Lo que había en el archivo antes de cada cambio: cada actualización del agente, cada sesión de edición y cada restauración. El diff enseña qué cambiaría al restaurar.',
    empty: 'Este resumen todavía no se ha reescrito: no hay versiones anteriores.',
    loading: 'leyendo la versión…',
    loadFailed: 'No pude leer el historial',
    againstNow: 'respecto a lo que hay ahora',
    same: 'igual que ahora',
    dirtyHint: 'Hay cambios sin guardar: espera a que se guarden para restaurar.',
    restore: 'restaurar esta versión',
    restored: 'Versión restaurada. Lo que había antes también quedó en el historial.',
    restoreChanged: 'El archivo cambió mientras mirabas. Vuelve a abrir el historial.',
    restoreFailed: 'No pude restaurarla',
    reason: {
      agent: 'antes de que el agente lo actualizara',
      edit: 'antes de una edición',
      restore: 'antes de restaurar otra versión',
    },
  },
    mermaid: {
      rendering: 'dibujando el diagrama…',
      showSource: 'Ver el código del diagrama',
      hideSource: 'Ocultar el código',
      error: 'El diagrama tiene un error de sintaxis',
      expand: 'Abrir a pantalla completa',
      expandHint: 'Doble clic para abrir a pantalla completa',
      viewerHint: 'arrastra para moverte · pellizca o ⌘/Ctrl + rueda para zoom · 0 encaja · 1 tamaño real',
      zoomIn: 'Acercar',
      zoomOut: 'Alejar',
      fit: 'Encajar en la pantalla',
      actualSize: 'Tamaño real (100 %)',
    },
    delete: {
      action: 'borrar el resumen',
      title: '¿borrar «{title}»?',
      description:
        'El archivo se mueve a la papelera, no se destruye. Puedes recuperarlo desde Ajustes → espacio de trabajo.',
      done: 'Resumen borrado',
      failed: 'No pude borrarlo',
    },
} as const
