#!/usr/bin/env bun
/**
 * Verificación del actualizador.
 *
 * Lo que se comprueba aquí es la parte que **falla en silencio**: si el
 * `latest.json` sale mal, la app no da ningún error, simplemente deja de
 * actualizarse. Y el caso peor no es que falte el fichero —eso se nota— sino que
 * esté y le falte la clave de una plataforma: Tauri valida el JSON entero antes
 * de mirar la versión, así que un hueco deja sin actualizaciones a todo el mundo.
 *
 * Uso:  bun scripts/verify-update.mjs
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { REQUIRED_PLATFORMS, buildLatestJson, targetsFor } from './lib/latest-json.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

let failures = 0

function check(label, condition) {
  if (condition) console.log(`  \x1b[32m✓\x1b[0m ${label}`)
  else {
    console.log(`  \x1b[31m✗\x1b[0m ${label}`)
    failures++
  }
}

function section(title) {
  console.log(`\n\x1b[1m${title}\x1b[0m`)
}

/** ¿Lanza al construir con estas opciones? */
function throws(fn) {
  try {
    fn()
    return null
  } catch (err) {
    return err.message
  }
}

const BASE = 'https://github.com/ismaelosuna7824/saveme/releases/download/v0.2.0'

/** Los artefactos tal como los deja un empaquetado completo de las tres. */
const COMPLETOS = [
  { name: 'SaveMe.app.tar.gz', signature: 'firma-mac' },
  { name: 'SaveMe_0.2.0_x64-setup.exe', signature: 'firma-win' },
  { name: 'saveme_0.2.0_amd64.AppImage', signature: 'firma-linux' },
]

// --- 1. Qué plataforma le toca a cada fichero --------------------------------

section('1. Cada artefacto, a su plataforma')
{
  check('el .app.tar.gz universal vale para las dos arquitecturas de Mac', 
    JSON.stringify(targetsFor('SaveMe.app.tar.gz', { macos: 'universal' })) ===
      JSON.stringify(['darwin-aarch64', 'darwin-x86_64']))
  check('un Mac solo-arm cubre solo darwin-aarch64',
    JSON.stringify(targetsFor('SaveMe.app.tar.gz', { macos: 'aarch64' })) ===
      JSON.stringify(['darwin-aarch64']))
  check('un Mac solo-Intel cubre solo darwin-x86_64',
    JSON.stringify(targetsFor('SaveMe.app.tar.gz', { macos: 'x86_64' })) ===
      JSON.stringify(['darwin-x86_64']))
  check('el instalador NSIS es el de Windows',
    JSON.stringify(targetsFor('SaveMe_0.2.0_x64-setup.exe')) === JSON.stringify(['windows-x86_64']))
  check('el .msi también vale para Windows',
    JSON.stringify(targetsFor('SaveMe_0.2.0_x64_en-US.msi')) === JSON.stringify(['windows-x86_64']))
  check('el AppImage es el de Linux',
    JSON.stringify(targetsFor('saveme_0.2.0_amd64.AppImage')) === JSON.stringify(['linux-x86_64']))
  check('un .dmg no es paquete de actualización', targetsFor('SaveMe_0.2.0_universal.dmg').length === 0)
  check('un .deb tampoco', targetsFor('saveme_0.2.0_amd64.deb').length === 0)
}

// --- 2. El caso que deja a medio mundo sin actualizar ------------------------

section('2. El binario universal cubre las dos arquitecturas')
{
  const latest = buildLatestJson({ version: '0.2.0', baseUrl: BASE, artifacts: COMPLETOS })

  check('están las cuatro plataformas', REQUIRED_PLATFORMS.every((p) => latest.platforms[p] !== undefined))
  check('darwin-aarch64 y darwin-x86_64 apuntan al MISMO fichero',
    latest.platforms['darwin-aarch64'].url === latest.platforms['darwin-x86_64'].url)
  check('y llevan la misma firma',
    latest.platforms['darwin-aarch64'].signature === latest.platforms['darwin-x86_64'].signature)
  check('la firma va dentro del JSON, no como URL',
    latest.platforms['darwin-aarch64'].signature === 'firma-mac')
  check('la url sale de la base y el nombre del fichero',
    latest.platforms['windows-x86_64'].url === `${BASE}/SaveMe_0.2.0_x64-setup.exe`)
}

// --- 3. Lo que tiene que fallar ---------------------------------------------

section('3. Un latest.json incompleto no se escribe')
{
  const mensaje = throws(() =>
    buildLatestJson({
      version: '0.2.0',
      baseUrl: BASE,
      artifacts: COMPLETOS.filter((a) => !a.name.endsWith('.AppImage')),
    }),
  )
  check('sin Linux, falla', mensaje !== null)
  check('y el error dice qué falta', (mensaje ?? '').includes('linux-x86_64'))
  check('y explica por qué importa', (mensaje ?? '').includes('todas las plataformas'))

  check('una versión que no es semver, falla',
    throws(() => buildLatestJson({ version: 'v0.2', baseUrl: BASE, artifacts: COMPLETOS })) !== null)
  check('una baseUrl con barra final, falla',
    throws(() => buildLatestJson({ version: '0.2.0', baseUrl: `${BASE}/`, artifacts: COMPLETOS })) !== null)
  check('un artefacto sin firma, falla',
    throws(() =>
      buildLatestJson({
        version: '0.2.0',
        baseUrl: BASE,
        artifacts: [{ name: 'SaveMe.app.tar.gz', signature: '  ' }, ...COMPLETOS.slice(1)],
      }),
    ) !== null)
  check('pedir un macOS que no existe, falla',
    throws(() => targetsFor('SaveMe.app.tar.gz', { macos: 'sparc' })) !== null)
}

// --- 4. Windows: el .exe manda sobre el .msi ---------------------------------

section('4. Con los dos instaladores de Windows, gana el NSIS')
{
  const latest = buildLatestJson({
    version: '0.2.0',
    baseUrl: BASE,
    artifacts: [
      { name: 'SaveMe_0.2.0_x64_en-US.msi', signature: 'firma-msi' },
      { name: 'SaveMe.app.tar.gz', signature: 'firma-mac' },
      { name: 'SaveMe_0.2.0_x64-setup.exe', signature: 'firma-exe' },
      { name: 'saveme_0.2.0_amd64.AppImage', signature: 'firma-linux' },
    ],
  })
  check('windows-x86_64 apunta al .exe, no al .msi',
    latest.platforms['windows-x86_64'].url.endsWith('-setup.exe'))
  check('y lleva la firma del .exe', latest.platforms['windows-x86_64'].signature === 'firma-exe')
}

// --- 5. Ruido en la carpeta ---------------------------------------------------

section('5. Lo que no es una actualización se ignora')
{
  const latest = buildLatestJson({
    version: '0.2.0',
    baseUrl: BASE,
    artifacts: [
      ...COMPLETOS,
      { name: 'SaveMe_0.2.0_universal.dmg', signature: 'firma-dmg' },
      { name: 'saveme_0.2.0_amd64.deb', signature: 'firma-deb' },
    ],
  })
  check('el .dmg y el .deb no aparecen en el JSON',
    Object.values(latest.platforms).every((e) => !e.url.endsWith('.dmg') && !e.url.endsWith('.deb')))
  check('y siguen estando las cuatro plataformas',
    REQUIRED_PLATFORMS.every((p) => latest.platforms[p] !== undefined))
}

// --- 6. La configuración de la app -------------------------------------------

section('6. La app sabe dónde preguntar y con qué clave')
{
  const conf = JSON.parse(readFileSync(join(ROOT, 'src-tauri/tauri.conf.json'), 'utf8'))
  const updater = conf.plugins?.updater

  check('tauri.conf.json tiene configuración del actualizador', updater !== undefined)
  check('el endpoint apunta al latest.json de una release',
    Array.isArray(updater?.endpoints) && updater.endpoints.some((u) => u.endsWith('/latest.json')))
  check('el endpoint es del repositorio correcto',
    (updater?.endpoints ?? []).some((u) => u.includes('github.com/ismaelosuna7824/saveme')))
  check('hay clave pública', typeof updater?.pubkey === 'string' && updater.pubkey.length > 40)
  check('el endpoint usa https (Tauri lo exige en producción)',
    (updater?.endpoints ?? []).every((u) => u.startsWith('https://')))
  check('el bundle crea artefactos de actualización',
    conf.bundle?.createUpdaterArtifacts === true)

  const caps = JSON.parse(readFileSync(join(ROOT, 'src-tauri/capabilities/default.json'), 'utf8'))
  check('la ventana tiene permiso para el actualizador',
    (caps.permissions ?? []).includes('updater:default'))
  check('y para reiniciar tras instalar',
    (caps.permissions ?? []).includes('process:allow-restart'))
}

console.log('')
if (failures > 0) {
  console.log(`\x1b[31m${failures} problema(s) en el actualizador\x1b[0m`)
  process.exit(1)
}
console.log('\x1b[32mActualizador verificado.\x1b[0m')
