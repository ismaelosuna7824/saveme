/** Textos de `editor`. Ver `es/common.ts` para el criterio. */
export const editor = {
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
    mermaid: {
      rendering: 'dibujando el diagrama…',
      showSource: 'Ver el código del diagrama',
      hideSource: 'Ocultar el código',
      error: 'El diagrama tiene un error de sintaxis',
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
