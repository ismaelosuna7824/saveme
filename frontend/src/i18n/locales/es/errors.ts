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
  invalid_decision: 'La decisión tiene que ser «accepted», «modified» o «cancelled».',
  no_streaming: 'El servidor no soporta streaming.',
} as const
