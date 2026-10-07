/**
 * Textos de `errors`.
 *
 * El core responde los errores con un sobre `{code, message}` y el mensaje viene
 * en español. Traducir ese mensaje desde el cliente no siempre es posible: en
 * muchos lleva pegado el detalle de la validación —"el slug no es válido: …"— y
 * reescribirlo aquí sería duplicar la lógica del backend y quedarse corto.
 *
 * Así que se traduce por **código**, y solo los que tienen un mensaje fijo. Los
 * demás conservan el texto del servidor: es la única fuente del detalle, y un
 * envoltorio traducido alrededor de un detalle en español se lee peor que el
 * detalle solo.
 */
export const errors = {
  // --- Errores que produce el propio cliente HTTP, sin llegar al core ---
  /** No hubo respuesta: el core está caído o el puerto no escucha. */
  network_error: 'No pude hablar con el core en {base}. {detail}',
  /** Respuesta con un estado HTTP que no traía sobre de error. */
  http: 'El core respondió {status} sin explicar por qué.',

  // --- Errores del core con mensaje fijo, que el usuario puede provocar ---
  invalid_language: 'El idioma tiene que ser «es», «en» o vacío para usar el del sistema.',
  invalid_root: 'La carpeta raíz no puede estar vacía.',
  no_providers: 'No pediste configurar ningún cliente.',
  missing_provider: 'Falta decir qué cliente hay que configurar.',
  unknown_provider: 'Ese cliente no está en la lista de los que sé configurar.',
  invalid_custom: 'La definición del cliente personalizado no es válida.',
  invalid_decision: 'La decisión tiene que ser «accepted», «modified» o «cancelled».',
  no_streaming: 'El servidor no soporta streaming.',
  proposal_not_found: 'Esa propuesta no existe, o el enlace es de otra.',
  proposal_expired: 'La propuesta venció. Un agente tiene que volver a proponerla.',
  proposal_resolved: 'Esa propuesta ya se resolvió: se aprobó o se descartó antes.',
  root_from_env: 'La carpeta raíz la fija SAVEME_ROOT en el entorno: cámbiala ahí.',
  missing_path: 'Falta la ruta.',
  already_exists: 'Ya hay algo en ese sitio.',
  into_itself: 'Una carpeta no se puede mover dentro de sí misma.',
  invalid_date: 'La fecha no se entiende: tiene que ser AAAA-MM-DD.',
  invalid_image: 'Ese archivo no es una imagen que se pueda usar de fondo.',
  image_too_large: 'La imagen pasa de 64 MB.',
  invalid_background: 'La imagen de fondo no existe o no se importó.',
  background_not_found: 'Esa imagen de fondo ya no está.',
  invalid_project_icon: 'Ese icono o color no existe.',

  /**
   * Códigos cuyo mensaje lleva el detalle pegado («el slug "x" no está
   * normalizado…»). El core escribe en español, así que en español se enseña su
   * mensaje tal cual —es el único con el detalle— y en los demás idiomas este
   * texto general (ver `translateError`).
   */
  generic: {
    invalid: 'La entrada no es válida.',
    not_found: 'No encontré lo que pediste: puede que se haya borrado.',
    internal: 'Algo falló en el core.',
    invalid_json: 'La petición no es JSON válido.',
    config_save_failed: 'No pude guardar la configuración.',
    stats_failed: 'No pude calcular las estadísticas.',
    tags_failed: 'No pude leer las etiquetas.',
    list_projects_failed: 'No pude leer los proyectos.',
    list_failed: 'No pude leer los resúmenes.',
    list_proposals_failed: 'No pude leer las propuestas.',
    reindex_failed: 'No pude reindexar.',
    image_save_failed: 'No pude guardar la imagen.',
    background_read_failed: 'No pude leer la imagen de fondo.',
    install_failed: 'No pude instalar el servidor MCP.',
    install_path: 'No pude decidir dónde instalar el servidor MCP.',
    snippet_failed: 'No pude preparar la configuración de ese cliente.',
  },
} as const
