#!/usr/bin/env node
/**
 * Verificación de las transiciones de la interfaz en un navegador de verdad.
 *
 * Los fallos que esto persigue no se ven en ninguna prueba unitaria porque duran
 * uno o dos fotogramas: un esqueleto que asoma al cambiar de proyecto, el fondo
 * que se apaga mientras se decodifica la imagen nueva, un ancestro con `opacity`
 * que corta el `backdrop-filter` de las tarjetas a cada letra de una búsqueda, el
 * editor que se pinta un instante sin título. Todos se arreglaron alguna vez y
 * todos vuelven con un cambio inocente.
 *
 * Cómo lo mira:
 *
 *   1. Compila el core y lo arranca con workspace, configuración y HOME
 *      temporales (nunca los del usuario), en un puerto propio.
 *   2. Siembra tres proyectos con resúmenes en varias categorías y dos fondos:
 *      uno global y otro propio de un proyecto.
 *   3. Compila la interfaz a una carpeta temporal y la sirve con `vite preview`,
 *      que hace de proxy de `/api` hacia ese core. Es el mismo build que empaqueta
 *      la app, y a diferencia de `vite dev` no recarga la página a mitad de la
 *      prueba cuando descubre una dependencia nueva.
 *   4. Abre Chromium sin ventana, retrasa las respuestas del core para que los
 *      estados intermedios duren varios fotogramas, e instala en la página un
 *      muestreador por `requestAnimationFrame` que mira cada fotograma antes de
 *      pintarse.
 *   5. Recorre la app como una persona —barra lateral, pestañas, abrir un resumen
 *      y volver con Escape, buscar— y falla con el paso y el fotograma exactos si
 *      algún fotograma enseña lo que no debe.
 *
 * El muestreo vive dentro de la página y no depende de este proceso: si el
 * navegador no llegara a dibujar (rAF parado), cada paso lo detecta por el número
 * de fotogramas muestreados y falla en vez de dar un verde falso.
 *
 * Se ejecuta con node (no con bun): Playwright solo garantiza node como runtime.
 *
 * Uso:  node scripts/verify-transitions.mjs
 *       (o `make test-ui`). Puertos: SAVEME_UI_CORE_PORT y SAVEME_UI_WEB_PORT.
 */
import { spawn, execFileSync } from 'node:child_process'
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const FRONTEND = join(ROOT, 'frontend')
// Playwright es dependencia de desarrollo del frontend, no de la raíz: con el
// instalador aislado de bun solo se resuelve desde `frontend/`.
const { chromium } = createRequire(join(FRONTEND, 'package.json'))('playwright')
const VITE = join(FRONTEND, 'node_modules', 'vite', 'bin', 'vite.js')

// Fijos y lejos de los de siempre: 7411 es el core del usuario (puede estar
// abierto mientras esto corre), 7456 el del e2e y 1420 el `vite dev`.
const CORE_PORT = Number(process.env.SAVEME_UI_CORE_PORT ?? 7581)
const WEB_PORT = Number(process.env.SAVEME_UI_WEB_PORT ?? 7582)
const CORE = `http://127.0.0.1:${CORE_PORT}`
const WEB = `http://127.0.0.1:${WEB_PORT}`

// Retrasos artificiales. El core local contesta en milisegundos, así que un
// estado intermedio malo (un esqueleto, una lista atenuada) duraría menos de un
// fotograma y podría escaparse del muestreo. Con esto dura varios. Los dos caben
// en los 400 ms que un `loader` retiene la pantalla anterior, de modo que la app
// sana sigue sin enseñar nada intermedio.
const IMAGE_DELAY_MS = 250
const SUMMARIES_DELAY_MS = 120

// Lo que se deja correr cada paso después de llegar a su estado final: cubre el
// fundido entre fondos (300 ms) y el retraso de la imagen.
const SETTLE_MS = 700
// Por debajo de esto el muestreador no ha visto de verdad el paso. A 60 fps un
// paso dura decenas de fotogramas; 10 fps ya es un navegador que no dibuja.
const MIN_FPS = 10
const MIN_FRAMES = 8

// Con la ruta canónica (en macOS el temporal cuelga de un enlace, /var →
// /private/var): así el workspace que reporta el core se compara tal cual.
const WORK = realpathSync(mkdtempSync(join(tmpdir(), 'saveme-ui.')))
const WORKSPACE = join(WORK, 'ws')
const children = []
let browser = null

let passed = 0
let failed = 0

function ok(label) {
  console.log(`  \x1b[32m✓\x1b[0m ${label}`)
  passed++
}

function bad(label) {
  console.log(`  \x1b[31m✗\x1b[0m ${label}`)
  failed++
}

function section(title) {
  console.log(`\n\x1b[1m${title}\x1b[0m`)
}

/** Error que corta la verificación: el entorno no se pudo montar. */
class SetupError extends Error {}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// --- Entorno ---------------------------------------------------------------

/**
 * El entorno de `scripts/env.sh`: las cachés de Go y bun fuera de $HOME, igual
 * que en el e2e. Se calcula una vez y lo heredan todos los procesos hijos.
 */
function buildEnv() {
  const raw = execFileSync('bash', ['-c', 'source scripts/env.sh >/dev/null && env -0'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  const env = {}
  for (const entry of raw.split('\0')) {
    const eq = entry.indexOf('=')
    if (eq > 0) env[entry.slice(0, eq)] = entry.slice(eq + 1)
  }
  // `env.sh` apunta SAVEME_ROOT al workspace de desarrollo; aquí no se usa.
  delete env.SAVEME_ROOT
  return env
}

function portFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)))
  })
}

/** Lanza un proceso con su salida a un log; lo apaga `cleanup`. */
function launch(name, command, args, options) {
  const logPath = join(WORK, `${name}.log`)
  const fd = openSync(logPath, 'a')
  const child = spawn(command, args, { ...options, stdio: ['ignore', fd, fd] })
  closeSync(fd)
  const entry = { name, child, logPath, exited: false }
  child.once('exit', () => {
    entry.exited = true
  })
  children.push(entry)
  return entry
}

/** Corre un comando hasta el final; si falla, enseña su log y corta. */
function run(name, command, args, options) {
  const entry = launch(name, command, args, options)
  return new Promise((resolve, reject) => {
    entry.child.once('error', (err) => reject(new SetupError(`${name}: ${err.message}`)))
    entry.child.once('exit', (code) => {
      if (code === 0) resolve()
      else reject(new SetupError(`${name} terminó con código ${code}\n${logTail(entry.logPath)}`))
    })
  })
}

function logTail(path, lines = 40) {
  try {
    return readFileSync(path, 'utf8').split('\n').slice(-lines).join('\n')
  } catch {
    return '(sin log)'
  }
}

/**
 * Espera a que `/api/health` conteste por `base` y sea **nuestro** core: el que
 * sirve el workspace temporal. Un puerto libre al empezar puede ocuparlo otro
 * proceso un instante después —otro core que cae al puerto siguiente si el suyo
 * está cogido, por ejemplo—, y entonces la prueba hablaría con un extraño.
 */
async function waitOurCore(base, entry, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (entry.exited) {
      throw new SetupError(`${entry.name} se cerró al arrancar\n${logTail(entry.logPath)}`)
    }
    let health = null
    try {
      const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1000) })
      if (response.ok) health = await response.json()
    } catch {
      // Todavía no escucha.
    }
    if (health) {
      if (health.root_dir === WORKSPACE) return
      throw new SetupError(
        `en ${base} contesta otro proceso (workspace ${health.root_dir}), no el de esta prueba; ` +
          'elige otros puertos con SAVEME_UI_CORE_PORT / SAVEME_UI_WEB_PORT',
      )
    }
    await sleep(150)
  }
  throw new SetupError(`${base} no respondió en ${timeoutMs / 1000} s\n${logTail(entry.logPath)}`)
}

async function stop(entry) {
  if (entry.exited) return
  entry.child.kill('SIGTERM')
  const deadline = Date.now() + 3000
  while (!entry.exited && Date.now() < deadline) await sleep(50)
  if (!entry.exited) entry.child.kill('SIGKILL')
}

let cleaned = false
async function cleanup() {
  if (cleaned) return
  cleaned = true
  if (browser) await browser.close().catch(() => {})
  // Al revés de como se lanzaron: la interfaz antes que el core al que llama.
  for (const entry of [...children].reverse()) await stop(entry)
  rmSync(WORK, { recursive: true, force: true })
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    void cleanup().finally(() => process.exit(130))
  })
}

// --- Core y datos ----------------------------------------------------------

async function api(method, path, body, headers = { 'Content-Type': 'application/json' }) {
  const response = await fetch(`${CORE}/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body),
  })
  const text = await response.text()
  if (!response.ok) {
    throw new SetupError(`${method} /api${path} → ${response.status}: ${text.slice(0, 300)}`)
  }
  return text ? JSON.parse(text) : null
}

const PROJECTS = [
  { name: 'Alfa', slug: 'alfa', categories: ['feature', 'feature', 'fix', 'fix', 'design'] },
  // El del fondo propio: entrar y salir de él cambia la imagen detrás de todo.
  { name: 'Bravo', slug: 'bravo', categories: ['feature', 'feature', 'fix'], ownBackground: true },
  { name: 'Charlie', slug: 'charlie', categories: ['feature', 'design', 'design'] },
]

async function seed() {
  // Idioma fijo: los selectores usan las etiquetas accesibles en inglés.
  await api('PUT', '/config', { onboarded: true, language: 'en' })
  ok('configuración: sin asistente de bienvenida, interfaz en inglés')

  for (const project of PROJECTS) {
    await api('POST', '/projects', { name: project.name, slug: project.slug })
    for (const [index, category] of project.categories.entries()) {
      await api('POST', '/summaries', {
        project: project.slug,
        category,
        title: `${project.name} ${category} ${index + 1}`,
        body:
          `Notas sobre transiciones de la interfaz en ${project.name}, entrada ${index + 1}.\n\n` +
          `## Detalle\n\nTexto de relleno para que el editor tenga varias líneas que pintar.\n`,
      })
    }
    const list = await api('GET', `/summaries?project=${project.slug}`)
    if (list.total !== project.categories.length) {
      throw new SetupError(
        `el proyecto ${project.slug} tiene ${list.total} resúmenes y se crearon ${project.categories.length}`,
      )
    }
  }
  ok(`${PROJECTS.length} proyectos con resúmenes en varias categorías`)

  const upload = async (file) =>
    (await api('POST', '/backgrounds', readFileSync(join(ROOT, file)), { 'Content-Type': 'image/png' })).image
  const globalImage = await upload('landing/public/icon.png')
  const projectImage = await upload('landing/public/favicon.png')
  const own = PROJECTS.find((project) => project.ownBackground)
  await api('PUT', '/config', {
    background: { image: globalImage },
    project_backgrounds: { [own.slug]: { image: projectImage } },
  })
  ok(`fondo global y fondo propio para «${own.name}»`)
}

// --- Muestreador (corre dentro de la página) -------------------------------

/**
 * Se instala antes que la app y mira cada fotograma en su `requestAnimationFrame`,
 * es decir, el DOM tal como se va a pintar. Solo guarda contadores y las primeras
 * incidencias de cada tipo, para que leerlo no cueste más que el paso.
 */
function installSampler() {
  const MAX_PER_KIND = 3
  const NOT_FOUND = /not found|couldn['’]t find|doesn['’]t exist|error 404|no encontr|no existe/i
  let current = null

  const describe = (el) => {
    const classes = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 6) : []
    return `<${el.tagName.toLowerCase()}${classes.length ? ` class="${classes.join(' ')}"` : ''}>`
  }

  /** El primer ancestro de una `.backdrop-surface` que le corta el cristal. */
  const dimmedAncestor = () => {
    const checked = new Set()
    for (const surface of document.querySelectorAll('.backdrop-surface')) {
      for (let el = surface.parentElement; el; el = el.parentElement) {
        // Si ya se miró, también se miraron todos los suyos hacia arriba.
        if (checked.has(el)) break
        checked.add(el)
        const style = getComputedStyle(el)
        if (Number(style.opacity) < 1 || style.filter !== 'none') {
          return `${describe(el)} con opacity ${style.opacity} y filter ${style.filter}`
        }
      }
    }
    return null
  }

  const inspect = () => {
    const found = []
    const main = document.querySelector('main')
    if (!main) {
      found.push(['main', 'no hay <main> en la página'])
    } else {
      if ([...main.querySelectorAll('.animate-pulse')].some((el) => !(el instanceof SVGElement))) {
        found.push(['skeleton', 'esqueleto (.animate-pulse) en main'])
      }
      const text = main.textContent ?? ''
      const match = NOT_FOUND.exec(text)
      if (match) {
        const at = Math.max(0, match.index - 30)
        found.push(['notFound', `main dice «${text.slice(at, match.index + 50).trim()}»`])
      }
      const title = main.querySelector('input[aria-label="Summary title"]')
      const editor = main.querySelector('.cm-editor')
      if (title || editor) {
        current.editorFrames++
        if (!title) found.push(['editor', 'editor pintado sin el campo de título'])
        else if (title.value.trim() === '') found.push(['editor', 'editor pintado con el título vacío'])
        const lines = [...main.querySelectorAll('.cm-editor .cm-line')]
        if (lines.length === 0) found.push(['editor', 'editor pintado sin .cm-editor .cm-line'])
        else if (!lines.some((line) => (line.textContent ?? '').trim() !== '')) {
          found.push(['editor', 'editor pintado con todas las líneas vacías'])
        }
      }
    }
    if (!document.querySelector('[data-backdrop]')) {
      found.push(['backdrop', 'falta [data-backdrop]: el fondo desapareció'])
    }
    const dimmed = dimmedAncestor()
    if (dimmed) found.push(['dimmed', `ancestro de .backdrop-surface sin cristal: ${dimmed}`])
    return found
  }

  const frame = () => {
    if (current) {
      current.frames++
      let found
      try {
        found = inspect()
      } catch (err) {
        found = [['sampler', `el muestreador falló: ${err}`]]
      }
      for (const [kind, detail] of found) {
        const bucket = (current.kinds[kind] ??= { count: 0, first: [] })
        bucket.count++
        if (bucket.first.length < MAX_PER_KIND) {
          bucket.first.push({ frame: current.frames, path: location.pathname, detail })
        }
      }
    }
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)

  window.__uiSampler = {
    begin(step) {
      current = { step, frames: 0, editorFrames: 0, kinds: {}, started: performance.now() }
    },
    /** Deja correr `ms` (con un temporizador, no con rAF) y devuelve lo visto. */
    finish(ms) {
      return new Promise((resolve) => {
        setTimeout(() => {
          const report = { ...current, elapsed: performance.now() - current.started }
          current = null
          resolve(report)
        }, ms)
      })
    },
  }
}

// --- Recorrido -------------------------------------------------------------

const KIND_LABELS = {
  skeleton: 'sin esqueleto en main',
  backdrop: 'el fondo ([data-backdrop]) no desaparece',
  dimmed: 'ningún ancestro de .backdrop-surface con opacidad < 1 o filtro',
  editor: 'el editor nunca se pinta sin texto ni con el título vacío',
  notFound: 'sin «not found»',
  main: 'la página siempre tiene <main>',
  sampler: 'el muestreador no falla',
}

let stepNumber = 0

/**
 * Un paso: empieza a contar, hace la acción, espera al estado final (sondeando
 * con temporizador, para no depender de rAF) y deja correr `SETTLE_MS` más.
 */
async function step(page, name, action, ready, arg) {
  stepNumber++
  const label = `${stepNumber}. ${name}`
  section(label)
  await page.evaluate((stepName) => window.__uiSampler.begin(stepName), label)
  let reached = true
  try {
    await action()
    await page.waitForFunction(ready, arg, { polling: 50, timeout: 10_000 })
  } catch (err) {
    reached = false
    bad(`no llegó a su estado final: ${String(err.message).split('\n')[0]}`)
  }
  const report = await page.evaluate((ms) => window.__uiSampler.finish(ms), SETTLE_MS)

  const minimum = Math.max(MIN_FRAMES, Math.floor((report.elapsed / 1000) * MIN_FPS))
  if (report.frames >= minimum) {
    ok(`${report.frames} fotogramas muestreados en ${Math.round(report.elapsed)} ms`)
  } else {
    bad(
      `solo ${report.frames} fotogramas en ${Math.round(report.elapsed)} ms (mínimo ${minimum}): ` +
        'requestAnimationFrame no corrió y el paso no se vio de verdad',
    )
  }

  for (const kind of ['skeleton', 'backdrop', 'dimmed', 'editor', 'notFound', 'main', 'sampler']) {
    const bucket = report.kinds[kind]
    if (!bucket) {
      // Lo que no puede pasar en el paso no se anuncia: el editor solo cuenta si
      // se llegó a pintar, y `main`/`sampler` son averías del entorno.
      if (kind === 'editor') {
        if (report.editorFrames > 0) ok(`${KIND_LABELS.editor} (${report.editorFrames} fotogramas con editor)`)
      } else if (kind !== 'main' && kind !== 'sampler') {
        ok(KIND_LABELS[kind])
      }
      continue
    }
    const first = bucket.first[0]
    bad(
      `paso ${label}: ${first.detail} — fotograma ${first.frame} de ${report.frames} (ruta ${first.path}); ` +
        `${bucket.count} fotograma${bucket.count === 1 ? '' : 's'} en total`,
    )
    for (const more of bucket.first.slice(1)) {
      console.log(`      también en el fotograma ${more.frame} (ruta ${more.path}): ${more.detail}`)
    }
  }
  return reached
}

const sidebarLink = (page, slug) => page.locator(`a[href="/p/${slug}"]:not(main a)`).first()

/**
 * La pantalla del proyecto ya enseña ese proyecto con su lista. `path` exige la
 * ruta exacta; `prefix`, solo su comienzo (Escape vuelve a la categoría del
 * resumen, que depende de cuál se abrió).
 */
function projectShown({ slug, name, path, prefix }) {
  const main = document.querySelector('main')
  const where = prefix ? location.pathname.startsWith(prefix) : location.pathname === (path ?? `/p/${slug}`)
  return (
    where &&
    (main?.querySelector('header')?.textContent ?? '').includes(name) &&
    main.querySelector('a[href^="/s/"]') !== null &&
    main.querySelector('input[aria-label="Summary title"]') === null
  )
}

function editorShown() {
  const main = document.querySelector('main')
  const title = main?.querySelector('input[aria-label="Summary title"]')
  return (
    location.pathname.startsWith('/s/') &&
    title != null &&
    title.value.trim() !== '' &&
    [...main.querySelectorAll('.cm-editor .cm-line')].some((line) => (line.textContent ?? '').trim() !== '')
  )
}

function tabShown({ index, from }) {
  const tab = document.querySelectorAll('main [role=tab]')[index]
  const main = document.querySelector('main')
  return (
    tab?.getAttribute('data-state') === 'active' &&
    location.pathname !== from &&
    main.querySelector('a[href^="/s/"]') !== null
  )
}

function searchShown({ value, results }) {
  const main = document.querySelector('main')
  const input = main?.querySelector('input[aria-label="Search summaries"]')
  if (!input || input.value !== value) return false
  // El icono de la lupa late mientras el debounce no suelta el texto o la
  // búsqueda está en camino.
  if (main.querySelector('svg.animate-pulse')) return false
  const links = main.querySelectorAll('a[href^="/s/"]').length
  return results ? links > 0 : links === 0
}

async function walk(page) {
  const [alfa, bravo, charlie] = PROJECTS

  section('Carga inicial (no cuenta)')
  await page.goto(`${WEB}/`)
  try {
    await page.waitForFunction(
      (slugs) =>
        document.querySelector('[data-backdrop]') !== null &&
        slugs.every((slug) => document.querySelector(`a[href="/p/${slug}"]`) !== null) &&
        document.querySelector('main .animate-pulse:not(svg)') === null,
      PROJECTS.map((project) => project.slug),
      { polling: 50, timeout: 20_000 },
    )
    ok('la portada cargó con el fondo y los tres proyectos en la barra lateral')
  } catch (err) {
    // Qué faltaba, para no tener que adivinar con un simple «timeout».
    const state = await page
      .evaluate((slugs) => ({
        url: location.href,
        backdrop: document.querySelector('[data-backdrop]') !== null,
        missing: slugs.filter((slug) => document.querySelector(`a[href="/p/${slug}"]`) === null),
        skeleton: document.querySelector('main .animate-pulse:not(svg)') !== null,
        main: (document.querySelector('main')?.textContent ?? '(sin <main>)').slice(0, 160),
      }), PROJECTS.map((project) => project.slug))
      .catch(() => null)
    throw new SetupError(
      `la portada no terminó de cargar: ${String(err.message).split('\n')[0]}` +
        (state ? `\n      estado: ${JSON.stringify(state)}` : ''),
    )
  }
  // El fundido del fondo inicial termina antes de empezar a contar.
  await sleep(SETTLE_MS)

  // Proyectos por la barra lateral, entrando y saliendo del que tiene fondo propio.
  for (const project of [alfa, bravo, charlie, bravo, alfa]) {
    await step(
      page,
      `Barra lateral → «${project.name}»${project.ownBackground ? ' (fondo propio)' : ''}`,
      () => sidebarLink(page, project.slug).click(),
      projectShown,
      { slug: project.slug, name: project.name },
    )
  }

  // Pestañas de categoría con datos, y vuelta a «todas».
  const tabs = await page.$$eval('main [role=tab]', (elements) =>
    elements.map((el, index) => ({
      index,
      label: (el.firstChild?.textContent ?? el.textContent ?? '').trim(),
      count: Number(el.querySelector('span:last-child')?.textContent ?? '0'),
    })),
  )
  const withData = tabs.filter((tab) => tab.index > 0 && tab.count > 0)
  if (withData.length < 2) {
    bad(`se esperaban al menos 2 pestañas de categoría con datos y hay ${withData.length}`)
  }
  for (const tab of [...withData, tabs[0]]) {
    const from = new URL(page.url()).pathname
    await step(
      page,
      `Pestaña «${tab.label}» de «${alfa.name}»`,
      () => page.locator('main [role=tab]').nth(tab.index).click(),
      tabShown,
      { index: tab.index, from },
    )
  }

  // Abrir un resumen desde una categoría y volver con Escape.
  const firstTab = withData[0]
  await step(
    page,
    `Pestaña «${firstTab.label}» antes de abrir un resumen`,
    () => page.locator('main [role=tab]').nth(firstTab.index).click(),
    tabShown,
    { index: firstTab.index, from: new URL(page.url()).pathname },
  )
  const categoryPath = new URL(page.url()).pathname
  await step(
    page,
    'Abrir un resumen desde la categoría',
    () => page.locator('main a[href^="/s/"]').first().click(),
    editorShown,
  )
  await step(
    page,
    'Escape vuelve a la categoría',
    () => page.keyboard.press('Escape'),
    projectShown,
    { slug: alfa.slug, name: alfa.name, path: categoryPath },
  )

  // Lo mismo en el proyecto con fondo propio, desde su resumen general: el
  // documento abierto cambia la visibilidad del fondo.
  await step(
    page,
    `Barra lateral → «${bravo.name}» (fondo propio)`,
    () => sidebarLink(page, bravo.slug).click(),
    projectShown,
    { slug: bravo.slug, name: bravo.name },
  )
  await step(
    page,
    `Abrir un resumen de «${bravo.name}»`,
    () => page.locator('main a[href^="/s/"]').first().click(),
    editorShown,
  )
  await step(
    page,
    `Escape vuelve a la categoría del resumen de «${bravo.name}»`,
    () => page.keyboard.press('Escape'),
    projectShown,
    { slug: bravo.slug, name: bravo.name, prefix: `/p/${bravo.slug}/` },
  )
  await step(
    page,
    `Barra lateral → resumen general de «${bravo.name}», sin salir del proyecto`,
    () => sidebarLink(page, bravo.slug).click(),
    projectShown,
    { slug: bravo.slug, name: bravo.name },
  )

  // El buscador del resumen general: sin resultados, ampliada y borrada.
  const search = page.locator('main input[aria-label="Search summaries"]')
  await step(
    page,
    'Buscar algo que no existe',
    async () => {
      await search.click()
      await page.keyboard.type('transicionesx', { delay: 40 })
    },
    searchShown,
    { value: 'transicionesx', results: false },
  )
  await step(
    page,
    'Ampliar la búsqueda hasta que encuentra',
    () => page.keyboard.press('Backspace'),
    searchShown,
    { value: 'transiciones', results: true },
  )
  await step(
    page,
    'Borrar la búsqueda',
    async () => {
      await page.keyboard.press('ControlOrMeta+A')
      await page.keyboard.press('Backspace')
    },
    searchShown,
    { value: '', results: true },
  )
}

// --- Principal -------------------------------------------------------------

async function main() {
  console.log('SaveMe — transiciones de la interfaz')

  section('Preparación')
  for (const port of [CORE_PORT, WEB_PORT]) {
    if (!(await portFree(port))) {
      throw new SetupError(
        `el puerto ${port} está ocupado; libéralo o elige otro con SAVEME_UI_CORE_PORT / SAVEME_UI_WEB_PORT`,
      )
    }
  }
  const env = buildEnv()

  await run('go-build', 'go', ['build', '-o', 'bin/saveme', './cmd/saveme'], {
    cwd: join(ROOT, 'backend'),
    env,
  })
  ok('core compilado')

  // El core, aislado del todo: workspace, configuración y HOME temporales. HOME
  // también, porque `serve` pone al día la copia del MCP en ~/.saveme/bin.
  mkdirSync(join(WORK, 'home'))
  const core = launch(
    'core',
    join(ROOT, 'backend', 'bin', 'saveme'),
    ['serve', '--port', String(CORE_PORT), '--no-watch'],
    {
      cwd: WORK,
      env: {
        ...env,
        SAVEME_ROOT: WORKSPACE,
        SAVEME_CONFIG: join(WORK, 'config.json'),
        HOME: join(WORK, 'home'),
      },
    },
  )
  await waitOurCore(CORE, core)
  ok(`core escuchando en ${CORE}`)

  await seed()

  const dist = join(WORK, 'dist')
  await run('vite-build', process.execPath, [VITE, 'build', '--outDir', dist, '--emptyOutDir'], {
    cwd: FRONTEND,
    env,
  })
  ok('interfaz compilada')

  const web = launch(
    'vite-preview',
    process.execPath,
    [VITE, 'preview', '--outDir', dist, '--host', '127.0.0.1', '--port', String(WEB_PORT), '--strictPort'],
    { cwd: FRONTEND, env: { ...env, SAVEME_CORE_ORIGIN: CORE } },
  )
  // Por el proxy: si contesta la salud del core, la interfaz habla con él.
  await waitOurCore(WEB, web)
  ok(`interfaz en ${WEB}, con /api hacia el core`)

  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US' })
  await context.route(/\/api\/backgrounds\//, async (route) => {
    await sleep(IMAGE_DELAY_MS)
    await route.continue()
  })
  await context.route(/\/api\/summaries/, async (route) => {
    if (route.request().method() === 'GET') await sleep(SUMMARIES_DELAY_MS)
    await route.continue()
  })
  await context.addInitScript(installSampler)
  const page = await context.newPage()
  // Lo mismo que se espera a que un paso llegue a su estado final: un clic que
  // no encuentra su objetivo no tiene por qué esperar los 30 s de serie.
  page.setDefaultTimeout(10_000)
  const pageErrors = []
  page.on('pageerror', (err) => pageErrors.push(err.message))
  ok(`Chromium ${browser.version()} sin ventana, con ${IMAGE_DELAY_MS} ms de retraso en los fondos`)

  await walk(page)

  section('Consola')
  if (pageErrors.length === 0) ok('la página no lanzó excepciones')
  else for (const message of pageErrors.slice(0, 5)) bad(`excepción en la página: ${message}`)
}

let exitCode = 0
try {
  await main()
} catch (err) {
  if (err instanceof SetupError) bad(err.message)
  else bad(`fallo inesperado: ${err?.stack ?? err}`)
  exitCode = 1
} finally {
  await cleanup()
}

console.log(`\n\x1b[1mResultado: ${passed} pasaron, ${failed} fallaron\x1b[0m`)
if (failed > 0 || exitCode !== 0) process.exit(1)
console.log('Transiciones verificadas.')
