/**
 * Todo lo que la landing hace en el navegador: elegir el instalable del sistema
 * de quien visita, refrescar los enlaces contra la última Release, las pestañas,
 * copiar comandos, recordar el idioma y mandar eventos a Analytics.
 *
 * La página funciona sin esto: el HTML ya sale con enlaces a la Release que
 * había al construir y la primera pestaña visible.
 */
import { LANG_STORAGE_KEY } from '../i18n/storage'
import { initAnalytics, track } from '../lib/analytics'
import {
  ASSET_KEYS,
  type AssetKey,
  fetchLatestRelease,
  formatSize,
  LATEST_RELEASE_URL,
  type LatestRelease,
} from '../lib/release'

type OS = 'macos' | 'windows' | 'linux'

/** El instalable que se ofrece primero en cada sistema. Linux no tiene uno solo: depende de la distribución. */
const PRIMARY_ASSET: Record<OS, AssetKey | null> = { macos: 'dmg', windows: 'exe', linux: null }

let release: LatestRelease | null = null

function detectOS(): OS | null {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string; mobile?: boolean } }
  const userAgent = navigator.userAgent.toLowerCase()
  if (nav.userAgentData?.mobile || /iphone|ipad|android/.test(userAgent)) return null
  // La fuente más fiable primero: `userAgentData` (Chromium), luego `platform`, y el user agent como último recurso.
  const platform = (nav.userAgentData?.platform || navigator.platform || userAgent).toLowerCase()
  if (/^win|windows/.test(platform)) return 'windows'
  if (/^mac|macos/.test(platform)) {
    // iPadOS se presenta como Mac; la pantalla táctil lo delata.
    return navigator.maxTouchPoints > 1 ? null : 'macos'
  }
  if (/linux|x11/.test(platform)) return 'linux'
  return null
}

// --- Enlaces de descarga ----------------------------------------------------

function applyRelease(): void {
  if (!release) return
  for (const link of document.querySelectorAll<HTMLAnchorElement>('a[data-asset]')) {
    const key = link.dataset.asset as AssetKey
    link.href = release.assets[key]?.url ?? LATEST_RELEASE_URL
  }
  for (const key of ASSET_KEYS) {
    const asset = release.assets[key]
    for (const size of document.querySelectorAll<HTMLElement>(`[data-asset-size="${key}"]`)) {
      size.textContent = asset ? formatSize(asset.size) : ''
    }
  }
  for (const version of document.querySelectorAll<HTMLElement>('[data-version]')) {
    version.textContent = `v${release.version}`
  }
  for (const link of document.querySelectorAll<HTMLAnchorElement>('a[data-release-link]')) {
    link.href = release.url
  }
}

function applyOS(os: OS | null): void {
  const hero = document.querySelector<HTMLAnchorElement>('a[data-hero-download]')
  const heroLabel = hero?.querySelector<HTMLElement>('[data-hero-label]')
  if (hero && heroLabel) {
    const asset = os ? PRIMARY_ASSET[os] : null
    heroLabel.textContent = hero.dataset[`label${os ? os[0].toUpperCase() + os.slice(1) : 'Other'}`] ?? ''
    if (asset) {
      // Hasta que responda la API, el enlace bueno es el que el HTML ya trae en la tarjeta de la plataforma.
      const built = document.querySelector<HTMLAnchorElement>(`[data-platform] a[data-asset="${asset}"]`)
      hero.dataset.asset = asset
      if (built) hero.href = built.href
    } else {
      delete hero.dataset.asset
      hero.href = '#download'
    }
    hero.dataset.trackOs = os ?? 'other'
  }
  if (!os) return
  document.querySelector(`[data-platform="${os}"]`)?.setAttribute('data-current', '')
  selectTab('install', os)
}

async function refreshRelease(): Promise<void> {
  try {
    release = await fetchLatestRelease()
  } catch {
    // Sin red o con el límite de la API agotado: se quedan los enlaces del HTML. Si
    // el HTML tampoco sabía la versión, el «buscando…» pasa a «ver en GitHub».
    for (const version of document.querySelectorAll<HTMLElement>('[data-version-fallback]')) {
      version.textContent = version.dataset.versionFallback ?? ''
    }
    return
  }
  applyRelease()
}

// --- Pestañas -----------------------------------------------------------------

function selectTab(group: string, key: string, focus = false): void {
  const root = document.querySelector<HTMLElement>(`[data-tabs="${group}"]`)
  if (!root) return
  for (const tab of root.querySelectorAll<HTMLButtonElement>('[role="tab"]')) {
    const selected = tab.dataset.tab === key
    tab.setAttribute('aria-selected', String(selected))
    tab.tabIndex = selected ? 0 : -1
    if (selected && focus) tab.focus()
  }
  for (const panel of root.querySelectorAll<HTMLElement>('[role="tabpanel"]')) {
    panel.hidden = panel.dataset.panel !== key
  }
}

function setupTabs(): void {
  for (const root of document.querySelectorAll<HTMLElement>('[data-tabs]')) {
    const group = root.dataset.tabs ?? ''
    const tabs = [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    root.addEventListener('click', (event) => {
      const tab = (event.target as Element).closest<HTMLButtonElement>('[role="tab"]')
      if (!tab?.dataset.tab) return
      selectTab(group, tab.dataset.tab)
      void track('select_tab', { group, tab: tab.dataset.tab })
    })
    root.addEventListener('keydown', (event) => {
      const current = tabs.indexOf(event.target as HTMLButtonElement)
      if (current === -1) return
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key]
      if (!step) return
      event.preventDefault()
      const next = tabs[(current + step + tabs.length) % tabs.length]
      if (next.dataset.tab) selectTab(group, next.dataset.tab, true)
    })
  }

  // `#install-windows` (los enlaces de cada plataforma, o un enlace compartido)
  // abre su pestaña además de bajar hasta la sección.
  const openInstallFromHash = () => {
    const match = /^#install-(macos|windows|linux)$/.exec(location.hash)
    if (!match) return
    selectTab('install', match[1])
    document.getElementById('install')?.scrollIntoView()
  }
  window.addEventListener('hashchange', openInstallFromHash)
  openInstallFromHash()
}

// --- Copiar comandos ----------------------------------------------------------

function setupCopy(): void {
  document.addEventListener('click', async (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-copy]')
    if (!button) return
    const original = button.textContent
    try {
      await navigator.clipboard.writeText(button.dataset.copy ?? '')
    } catch {
      return
    }
    button.textContent = button.dataset.copiedLabel ?? original
    button.setAttribute('data-copied', '')
    void track('copy_command', { command: (button.dataset.copy ?? '').split('\n')[0].slice(0, 100) })
    setTimeout(() => {
      button.textContent = original
      button.removeAttribute('data-copied')
    }, 1600)
  })
}

// --- Idioma y Analytics -----------------------------------------------------------

function setupTracking(): void {
  document.addEventListener('click', (event) => {
    const target = event.target as Element

    const langLink = target.closest<HTMLAnchorElement>('a[data-lang]')
    if (langLink?.dataset.lang) {
      try {
        localStorage.setItem(LANG_STORAGE_KEY, langLink.dataset.lang)
      } catch {
        // Sin almacenamiento la elección dura lo que dura la página; no pasa nada.
      }
      void track('select_language', { language: langLink.dataset.lang })
    }

    const tracked = target.closest<HTMLElement>('[data-track]')
    if (!tracked?.dataset.track) return
    const params: Record<string, string> = {}
    for (const [name, value] of Object.entries(tracked.dataset)) {
      // data-track-location → location, data-track-os → os
      if (name.startsWith('track') && name !== 'track' && value) params[name.slice(5).toLowerCase()] = value
    }
    if (tracked.dataset.asset) params.asset = tracked.dataset.asset
    if (release) params.version = release.version
    void track(tracked.dataset.track, params)
  })
}

const os = detectOS()
applyOS(os)
applyRelease()
setupTabs()
setupCopy()
setupTracking()
void initAnalytics()
void refreshRelease()
