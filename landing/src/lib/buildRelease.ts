/**
 * La última Release, consultada una sola vez al construir (las dos portadas
 * comparten la misma respuesta). Solo se importa desde el frontmatter de Astro.
 *
 * Si falla, la página se construye igual: los enlaces apuntan a la página de la
 * última Release y el script del navegador lo intenta otra vez al cargar.
 */
import { fetchLatestRelease, type LatestRelease } from './release'

export const latestRelease: Promise<LatestRelease | null> = fetchLatestRelease(import.meta.env.GITHUB_TOKEN).catch(
  (error: unknown) => {
    console.warn(`[release] could not resolve the latest GitHub release at build time: ${String(error)}`)
    return null
  },
)
