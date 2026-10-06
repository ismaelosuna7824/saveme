/**
 * Los enlaces de descarga apuntan siempre a la última Release de GitHub.
 *
 * Los ficheros llevan la versión en el nombre (`SaveMe_0.3.0_universal.dmg`), así
 * que `releases/latest/download/<nombre>` no sirve: el nombre cambia en cada
 * versión. Se resuelve contra la API, dos veces:
 *
 * 1. Al construir la página, para que el HTML ya salga con enlaces directos.
 * 2. En el navegador, al cargar, para que una Release publicada después del
 *    último despliegue se vea sin volver a construir.
 *
 * Si las dos fallan (sin red, límite de la API), cada enlace se queda en la página
 * de la última Release, que nunca está desactualizada.
 */

export const REPO = 'ismaelosuna7824/saveme'
export const REPO_URL = `https://github.com/${REPO}`
export const LATEST_RELEASE_URL = `${REPO_URL}/releases/latest`
export const LATEST_RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`

export type AssetKey = 'dmg' | 'exe' | 'msi' | 'deb' | 'appimage'

export const ASSET_KEYS: readonly AssetKey[] = ['dmg', 'exe', 'msi', 'deb', 'appimage']

/** Qué fichero de la Release es cada instalable. Los `.sig` son del actualizador. */
const ASSET_PATTERNS: Record<AssetKey, RegExp> = {
  dmg: /\.dmg$/i,
  exe: /-setup\.exe$/i,
  msi: /\.msi$/i,
  deb: /\.deb$/i,
  appimage: /\.AppImage$/i,
}

export interface ReleaseAsset {
  name: string
  url: string
  size: number
}

export interface LatestRelease {
  /** Versión sin la `v` del tag: `0.3.0`. */
  version: string
  url: string
  publishedAt: string
  assets: Partial<Record<AssetKey, ReleaseAsset>>
}

interface GitHubRelease {
  tag_name: string
  html_url: string
  published_at: string
  assets: { name: string; browser_download_url: string; size: number }[]
}

export function parseRelease(raw: GitHubRelease): LatestRelease {
  const assets: LatestRelease['assets'] = {}
  for (const key of ASSET_KEYS) {
    const asset = raw.assets.find((item) => ASSET_PATTERNS[key].test(item.name))
    if (asset) assets[key] = { name: asset.name, url: asset.browser_download_url, size: asset.size }
  }
  return {
    version: raw.tag_name.replace(/^v/, ''),
    url: raw.html_url,
    publishedAt: raw.published_at,
    assets,
  }
}

export async function fetchLatestRelease(token?: string): Promise<LatestRelease> {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const response = await fetch(LATEST_RELEASE_API, { headers })
  if (!response.ok) throw new Error(`GitHub API ${response.status}`)
  return parseRelease((await response.json()) as GitHubRelease)
}

/** Enlace de un instalable, o la página de la última Release si no se conoce. */
export function assetHref(release: LatestRelease | null, key: AssetKey): string {
  return release?.assets[key]?.url ?? LATEST_RELEASE_URL
}

export function formatSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
