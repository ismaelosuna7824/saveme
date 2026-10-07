import { QueryClient } from '@tanstack/react-query'

/**
 * La caché de datos de la app. Vive en su propio módulo porque la comparten el
 * árbol de React (`main.tsx`) y el router, cuyos `loader` la llenan antes de
 * pintar una pantalla.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 10_000,
    },
  },
})

/**
 * Cuánto conserva una navegación la pantalla anterior mientras llegan los datos
 * de la nueva. El core es local y responde en milisegundos: casi siempre la
 * pantalla nueva aparece ya completa. Si tarda más, se pinta con su esqueleto en
 * vez de dejar la app congelada sin respuesta al clic.
 */
const NAVIGATION_HOLD_MS = 400

/**
 * Espera a que la caché tenga los datos de una pantalla, como mucho
 * `NAVIGATION_HOLD_MS`. No falla nunca: el error lo enseña el componente con
 * su panel de error, igual que antes de que existieran los `loader`.
 */
export function holdForData(...loads: Promise<unknown>[]): Promise<void> {
  return Promise.race([
    Promise.all(loads).then(
      () => undefined,
      () => undefined,
    ),
    new Promise<void>((resolve) => window.setTimeout(resolve, NAVIGATION_HOLD_MS)),
  ])
}
