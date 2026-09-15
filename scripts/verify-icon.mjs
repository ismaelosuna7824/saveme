#!/usr/bin/env bun
/**
 * Verificación del icono.
 *
 * El fallo que se comprueba aquí se vio en el Dock: el icono salía con un
 * **cuadrado negro** alrededor. La causa no estaba en Tauri ni en el empaquetado,
 * sino en `scripts/make-icon.py`, que escribía el PNG sin canal alpha (tipo de
 * color 2) y pintaba de negro el exterior del rectángulo redondeado. Al
 * convertir a `.icns`, ese negro se horneaba como opaco.
 *
 * Mirar los bytes no basta: el PNG puede **declarar** un canal alpha (tipo 6) y
 * tenerlo entero a 255, que es exactamente lo que hace `tauri icon` al
 * re-codificar. Por eso se decodifican los píxeles y se lee el alpha de verdad,
 * tanto en el PNG como dentro del `.icns`, que es lo que macOS enseña.
 *
 * Uso:  bun scripts/verify-icon.mjs
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'

const ROOT = new URL('..', import.meta.url).pathname
const ICONS = join(ROOT, 'src-tauri/icons')

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

// Una esquina de 30x30 cae a medias dentro del redondeo, así que su alpha es 1 o
// 2, no 0. Eso es antialiasing correcto, no un fondo opaco: lo que se persigue es
// «transparente o casi», no «exactamente cero».
const ALPHA_TOLERANCE = 16

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

/** Decodifica un PNG a {width, height, colorType, pixels} con los filtros ya deshechos. */
function decodePng(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIG)) throw new Error('no es un PNG')

  let pos = 8
  let header = null
  const idat = []

  while (pos + 8 <= buf.length) {
    const length = buf.readUInt32BE(pos)
    const tag = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + length)
    if (tag === 'IHDR') {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        depth: data[8],
        colorType: data[9],
        interlace: data[12],
      }
    } else if (tag === 'IDAT') {
      idat.push(data)
    } else if (tag === 'IEND') break
    pos += 12 + length
  }

  if (!header) throw new Error('PNG sin IHDR')
  if (header.depth !== 8) throw new Error(`profundidad ${header.depth}, solo se admite 8`)
  if (header.interlace !== 0) throw new Error('PNG entrelazado, no soportado')

  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[header.colorType]
  if (channels === undefined) throw new Error(`tipo de color ${header.colorType}, no soportado`)

  const raw = inflateSync(Buffer.concat(idat))
  const stride = header.width * channels
  const pixels = Buffer.alloc(stride * header.height)
  let prev = Buffer.alloc(stride)
  let src = 0

  for (let y = 0; y < header.height; y++) {
    const filter = raw[src++]
    const line = Buffer.from(raw.subarray(src, src + stride))
    src += stride

    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0
      const b = prev[i]
      const c = i >= channels ? prev[i - channels] : 0
      if (filter === 1) line[i] = (line[i] + a) & 0xff
      else if (filter === 2) line[i] = (line[i] + b) & 0xff
      else if (filter === 3) line[i] = (line[i] + ((a + b) >> 1)) & 0xff
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
        line[i] = (line[i] + pred) & 0xff
      }
    }

    line.copy(pixels, y * stride)
    prev = line
  }

  return { ...header, channels, pixels }
}

/** Alpha de la esquina (x, y). */
function alphaAt(png, x, y) {
  const offset = (y * png.width + x) * png.channels + (png.channels - 1)
  return png.pixels[offset]
}

/** Los cuatro alpha de las esquinas. */
function corners(png) {
  return [
    alphaAt(png, 0, 0),
    alphaAt(png, 0, png.width - 1),
    alphaAt(png, png.height - 1, 0),
    alphaAt(png, png.width - 1, png.height - 1),
  ]
}

/** Todos los PNG embebidos en un .icns (cada uno es una entrada con su tamaño). */
function pngsInsideIcns(buf) {
  const found = []
  let from = 0
  for (;;) {
    const start = buf.indexOf(PNG_SIG, from)
    if (start < 0) break
    const end = buf.indexOf(Buffer.from('IEND'), start)
    if (end < 0) break
    try {
      found.push(decodePng(buf.subarray(start, end + 8)))
    } catch {
      // Una entrada que no se puede leer no invalida el resto.
    }
    from = start + 8
  }
  return found
}

/**
 * Los PNG del .ico. El formato admite entradas BMP además de PNG; las BMP se
 * omiten en vez de fallar, porque no se pueden leer con este decodificador.
 */
function pngsInsideIco(buf) {
  const count = buf.readUInt16LE(4)
  const found = []
  for (let i = 0; i < count; i++) {
    const entry = 6 + i * 16
    const size = buf.readUInt32LE(entry + 8)
    const offset = buf.readUInt32LE(entry + 12)
    const blob = buf.subarray(offset, offset + size)
    if (!blob.subarray(0, 8).equals(PNG_SIG)) continue
    try {
      found.push(decodePng(blob))
    } catch {
      // Igual que arriba: una entrada ilegible no invalida las demás.
    }
  }
  return found
}

// --- 1. El PNG que se versiona -----------------------------------------------

section('1. El PNG de origen')
{
  const png = decodePng(readFileSync(join(ICONS, 'icon.png')))
  check(
    `icon.png declara RGBA y no RGB (tipo ${png.colorType})`,
    png.colorType === 6,
  )
  const alphas = corners(png)
  check(
    `las cuatro esquinas son transparentes (${alphas.join(', ')})`,
    alphas.every((a) => a <= ALPHA_TOLERANCE),
  )
  const center = alphaAt(png, png.width >> 1, png.height >> 1)
  check(`el centro sigue opaco (alpha ${center}), no se ha vaciado el icono`, center === 255)
}

// --- 2. Todo PNG del bundle ---------------------------------------------------

section('2. Los PNG del bundle')
{
  const names = readdirSync(ICONS).filter((n) => n.endsWith('.png'))
  check('hay PNG en src-tauri/icons', names.length > 0)

  let opacos = 0
  let sinAlpha = 0
  for (const name of names) {
    const png = decodePng(readFileSync(join(ICONS, name)))
    if (png.colorType !== 6) {
      sinAlpha++
      console.log(`      \x1b[31m→ ${name} es tipo ${png.colorType}, sin canal alpha\x1b[0m`)
      continue
    }
    const alphas = corners(png)
    if (!alphas.every((a) => a <= ALPHA_TOLERANCE)) {
      opacos++
      console.log(`      \x1b[31m→ ${name} tiene esquinas opacas: ${alphas.join(', ')}\x1b[0m`)
    }
  }
  check(`${names.length} PNG, todos con canal alpha`, sinAlpha === 0)
  check('ninguno tiene las esquinas opacas', opacos === 0)
}

// --- 3. El .icns, que es lo que macOS enseña ---------------------------------

section('3. El .icns que ve el Dock')
{
  const icns = readFileSync(join(ICONS, 'icon.icns'))
  check('la cabecera es icns', icns.subarray(0, 4).toString('ascii') === 'icns')

  const pngs = pngsInsideIcns(icns)
  check(`lleva PNG dentro (${pngs.length})`, pngs.length > 0)

  const mayores = pngs.filter((p) => p.width >= 512)
  check(
    `incluye al menos un tamaño ≥512 (el mayor es ${Math.max(...pngs.map((p) => p.width))})`,
    mayores.length > 0,
  )

  const opacos = pngs.filter((p) => !corners(p).every((a) => a <= ALPHA_TOLERANCE))
  for (const p of opacos) {
    console.log(`      \x1b[31m→ ${p.width}x${p.height} con esquinas opacas: ${corners(p).join(', ')}\x1b[0m`)
  }
  check('ninguna de sus entradas tiene las esquinas opacas', opacos.length === 0)
}

// --- 4. El .ico de Windows ----------------------------------------------------

section('4. El .ico de Windows')
{
  // El mismo fallo del PNG de origen se cuela aquí: el .ico se genera desde el
  // mismo dibujo, así que si las esquinas salen negras el cuadrado negro aparece
  // también en Windows. Se comprueba por el mismo motivo que el .icns.
  const ico = readFileSync(join(ICONS, 'icon.ico'))
  check(
    'la cabecera es ico',
    ico.readUInt16LE(0) === 0 && ico.readUInt16LE(2) === 1,
  )

  const pngs = pngsInsideIco(ico)
  check(`lleva PNG dentro (${pngs.length})`, pngs.length > 0)

  const opacos = pngs.filter((p) => !corners(p).every((a) => a <= ALPHA_TOLERANCE))
  for (const p of opacos) {
    console.log(`      \x1b[31m→ ${p.width}x${p.height} con esquinas opacas: ${corners(p).join(', ')}\x1b[0m`)
  }
  check('ninguna de sus entradas tiene las esquinas opacas', opacos.length === 0)
}

console.log('')
if (failures > 0) {
  console.log(`\x1b[31m${failures} problema(s) en el icono\x1b[0m`)
  process.exit(1)
}
console.log('\x1b[32mIcono verificado.\x1b[0m')
