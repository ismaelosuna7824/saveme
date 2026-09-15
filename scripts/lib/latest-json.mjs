/**
 * El `latest.json` que lee el actualizador de Tauri.
 *
 * Es el fichero que decide si una app instalada se entera de que hay versión
 * nueva, y tiene tres formas de estar mal que no se ven hasta que ya has
 * publicado:
 *
 *  1. **Falta una plataforma.** Tauri valida el fichero entero antes de mirar la
 *     versión, así que una entrada incompleta no rompe «esa» plataforma: rompe el
 *     fichero para todas. Por eso se exige que estén las cuatro.
 *  2. **La clave de macOS no es la que toca.** En un binario **universal** el
 *     mismo `.app.tar.gz` sirve para las dos arquitecturas, pero Tauri busca por
 *     `darwin-<arquitectura de la máquina>`. Con una sola clave, la mitad de los
 *     Mac se quedan sin actualizaciones y no hay ningún error que lo delate: el
 *     updater simplemente no encuentra su plataforma.
 *  3. **La firma no es la del fichero.** La firma va **dentro** del JSON, no como
 *     URL. Si no coincide con el binario, la instalación falla en el cliente.
 *
 * La lógica vive aquí, separada del script que lee el disco, para poder probarla
 * sin construir nada: `scripts/verify-update.mjs` la ejercita con casos de todas
 * las formas.
 */

/** Las cuatro claves que tiene que tener un `latest.json` completo. */
export const REQUIRED_PLATFORMS = [
  'darwin-aarch64',
  'darwin-x86_64',
  'windows-x86_64',
  'linux-x86_64',
]

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

/**
 * Qué claves de plataforma corresponden a un artefacto.
 *
 * Devuelve una lista porque el `.app.tar.gz` de macOS es el único caso que puede
 * valer para dos: el binario universal.
 */
export function targetsFor(fileName, { macos = 'universal' } = {}) {
  if (fileName.endsWith('.app.tar.gz')) {
    if (macos === 'universal') return ['darwin-aarch64', 'darwin-x86_64']
    if (macos === 'aarch64') return ['darwin-aarch64']
    if (macos === 'x86_64') return ['darwin-x86_64']
    throw new Error(`macos debe ser universal, aarch64 o x86_64; llegó «${macos}»`)
  }

  // Linux: el AppImage se reutiliza tal cual como paquete de actualización.
  if (fileName.endsWith('.AppImage')) return ['linux-x86_64']

  // Windows: el instalador NSIS es el que usa el updater por defecto
  // (`installMode: passive`). El .msi también sirve, y se acepta como respaldo
  // para no quedarse sin Windows si algún día solo se construye el msi.
  if (fileName.endsWith('-setup.exe')) return ['windows-x86_64']
  if (fileName.endsWith('.msi')) return ['windows-x86_64']

  // Cualquier otra cosa (instaladores normales, .sig sueltos, .dmg…) no es un
  // paquete de actualización y se ignora en silencio: la carpeta lleva de todo.
  return []
}

/**
 * Preferencia entre dos artefactos que reclaman la misma clave.
 *
 * Gana el instalador NSIS sobre el MSI, porque es el que el updater usa por
 * defecto en Windows.
 */
function preferencia(name) {
  if (name.endsWith('-setup.exe')) return 0
  if (name.endsWith('.msi')) return 1
  return 2
}

/**
 * Construye el objeto que se serializa como `latest.json`.
 *
 * @param {object} opciones
 * @param {string} opciones.version   Versión nueva, sin la `v`.
 * @param {string} [opciones.notes]   Notas que verá el usuario.
 * @param {string} [opciones.pubDate] Fecha RFC 3339.
 * @param {string} opciones.baseUrl   URL de descarga de la release, sin barra final.
 * @param {Array<{name: string, signature: string}>} opciones.artifacts
 * @param {'universal'|'aarch64'|'x86_64'} [opciones.macos]
 */
export function buildLatestJson({
  version,
  notes = '',
  pubDate,
  baseUrl,
  artifacts,
  macos = 'universal',
}) {
  if (typeof version !== 'string' || !SEMVER.test(version)) {
    throw new Error(`«${version}» no es una versión válida para el latest.json`)
  }
  if (typeof baseUrl !== 'string' || baseUrl === '' || baseUrl.endsWith('/')) {
    throw new Error(`baseUrl tiene que ser una URL sin barra final; llegó «${baseUrl}»`)
  }

  // Ordenar antes de resolver deja la regla de preferencia en una sola línea: el
  // primero que reclame una clave se la queda.
  const ordenados = [...artifacts].sort((a, b) => preferencia(a.name) - preferencia(b.name))

  const platforms = {}
  for (const artifact of ordenados) {
    const signature = (artifact.signature ?? '').trim()
    if (signature === '') {
      throw new Error(`el artefacto ${artifact.name} no trae firma`)
    }
    for (const target of targetsFor(artifact.name, { macos })) {
      // Ya ocupada: es el respaldo (el .msi cuando también hay .exe). Se ignora.
      if (platforms[target] !== undefined) continue
      platforms[target] = {
        signature,
        url: `${baseUrl}/${encodeURIComponent(artifact.name)}`,
      }
    }
  }

  const faltan = REQUIRED_PLATFORMS.filter((p) => platforms[p] === undefined)
  if (faltan.length > 0) {
    throw new Error(
      `el latest.json estaría incompleto: faltan ${faltan.join(', ')}. ` +
        'Tauri valida el fichero entero antes de mirar la versión, así que esto ' +
        'dejaría sin actualizaciones a todas las plataformas, no solo a esas.',
    )
  }

  return {
    version,
    notes,
    pub_date: pubDate ?? new Date().toISOString(),
    platforms,
  }
}
