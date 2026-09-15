/**
 * Textos del aviso de versión nueva. Ver `es/common.ts` para el criterio.
 *
 * El tono es el de la barra de estado, no el de un diálogo de sistema: la app
 * avisa y deja decidir, no interrumpe. Por eso no hay «más tarde» con insistencia
 * ni cuenta atrás.
 */
export const update = {
  title: 'versión nueva disponible',
  /** El número va aparte para poder pintarlo con su propio estilo. */
  version: 'v{version}',
  install: 'actualizar',
  later: 'ahora no',
  downloading: 'descargando…',
  installing: 'instalando…',
  restarting: 'reiniciando…',
  notes: 'novedades',
  failed: 'no pude actualizar',
  failedHint: 'puedes descargarla a mano desde la página de releases',
} as const
