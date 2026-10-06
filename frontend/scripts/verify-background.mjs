#!/usr/bin/env bun
/**
 * Verificación de la imagen de fondo.
 *
 * Pintar necesita un navegador; aquí se comprueba lo que decide qué se pinta y
 * dónde, que es lo que se rompe en silencio: qué fondo gana (el del proyecto o el
 * global), cuánto se ve en cada pantalla, qué cuenta como «con documento», y las
 * cuentas de los efectos y del encuadre.
 *
 * Uso:  bun run verify:background
 */
import {
  backgroundUrl,
  backgroundVisibility,
  BACKGROUND_EFFECTS,
  DEFAULT_BACKGROUND_LOOK,
  effectTakesBlur,
  isDocumentPath,
  resolveBackground,
} from '../src/lib/background.ts'
import { coverRect, fitWithin } from '../src/lib/backdropBitmap.ts'
import { ASCII_RAMP, asciiGlyph, ditherChannel, DITHER_LEVELS, inkOf } from '../src/lib/backdropEffects.ts'

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

const look = (over = {}) => ({ ...DEFAULT_BACKGROUND_LOOK, image: '0123456789abcdef.png', ...over })

section('Qué fondo gana')
{
  const global = look({ image: 'aaaaaaaaaaaaaaaa.png' })
  const own = look({ image: 'bbbbbbbbbbbbbbbb.png' })
  const config = { background: global, project_backgrounds: { alfa: own, beta: look() } }

  const alfa = resolveBackground(config, 'alfa')
  check('un proyecto con imagen propia usa la suya', alfa.setting === own && alfa.source === 'project')
  check('y se sabe que tapa a la global', alfa.shadowsGlobal)
  check('los demás proyectos con imagen salen como «otros»', alfa.others.map((o) => o.project).join() === 'beta')

  const gamma = resolveBackground(config, 'gamma')
  check('un proyecto sin imagen propia usa la global', gamma.setting === global && gamma.source === 'global')
  check('fuera de un proyecto también manda la global', resolveBackground(config, null).setting === global)

  const onlyOwn = resolveBackground({ background: null, project_backgrounds: { alfa: own } }, 'alfa')
  check('con imagen propia y sin global no hay nada que tapar', onlyOwn.source === 'project' && !onlyOwn.shadowsGlobal)

  const none = resolveBackground({ background: null, project_backgrounds: {} }, 'alfa')
  check('sin ninguna imagen no hay fondo', none.setting === null && none.source === null)
}

section('Cuánto se ve')
{
  const all = look({ show_on: 'all', empty_visibility: 0.6, document_visibility: 0.3 })
  check('sin documento, la visibilidad vacía', backgroundVisibility(all, false) === 0.6)
  check('con documento, la de documento', backgroundVisibility(all, true) === 0.3)
  const onlyEmpty = look({ show_on: 'empty' })
  check('«solo sin documento» la quita con un documento abierto', backgroundVisibility(onlyEmpty, true) === 0)
  check('y la mantiene sin documento', backgroundVisibility(onlyEmpty, false) === onlyEmpty.empty_visibility)
}

section('Qué es una pantalla con documento')
{
  check('un resumen abierto', isDocumentPath('/s/sm_01'))
  check('una nota abierta', isDocumentPath('/notes/ideas/plan.md'))
  check('la lista de notas no', !isDocumentPath('/notes') && !isDocumentPath('/notes/'))
  check('el inbox, un proyecto y una etiqueta no',
    !isDocumentPath('/') && !isDocumentPath('/p/alfa/feature') && !isDocumentPath('/t/editor'))
}

section('Efectos')
{
  check('el difuminado solo en los efectos sin textura propia',
    BACKGROUND_EFFECTS.filter(effectTakesBlur).join() === 'none,scanlines,haze')
  const near = (a, b) => Math.abs(a - b) < 1e-9
  check('la tinta en tema oscuro es la luz', near(inkOf(255, 255, 255, true), 1) && near(inkOf(0, 0, 0, true), 0))
  check('en tema claro es la sombra', near(inkOf(0, 0, 0, false), 1) && near(inkOf(255, 255, 255, false), 0))
  check('sin tinta no se dibuja carácter', asciiGlyph(0) === ' ')
  check('con toda la tinta, el último de la rampa', asciiGlyph(1) === ASCII_RAMP.at(-1))

  const levels = new Set()
  for (let v = 0; v <= 255; v += 5) for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) levels.add(ditherChannel(v, x, y))
  check(`el tramado deja solo ${DITHER_LEVELS} niveles por canal`, levels.size === DITHER_LEVELS)
  check('y los extremos se quedan en sus extremos', ditherChannel(0, 0, 0) === 0 && ditherChannel(255, 3, 3) === 255)
}

section('Encuadre')
{
  const big = fitWithin({ width: 4000, height: 2000 }, 1920)
  check('una imagen grande se reduce a 1920 por el lado largo', big.width === 1920 && big.height === 960)
  const small = fitWithin({ width: 800, height: 600 }, 1920)
  check('una pequeña no se agranda', small.width === 800 && small.height === 600)

  const rect = coverRect({ width: 1000, height: 500 }, { width: 400, height: 400 }, 0)
  check('cubre el destino entero', rect.width >= 400 && rect.height >= 400)
  check('centrada', Math.abs(rect.x + rect.width / 2 - 200) < 1e-9 && Math.abs(rect.y + rect.height / 2 - 200) < 1e-9)
  const bled = coverRect({ width: 1000, height: 500 }, { width: 400, height: 400 }, 10)
  check('con margen de difuminado se pasa del borde por cada lado', bled.x <= -10 && bled.y <= -10)
}

section('Dirección de la imagen')
{
  check('el nombre va escapado en la URL', backgroundUrl('/api', 'a b.png') === '/api/backgrounds/a%20b.png')
}

console.log('')
if (failures > 0) {
  console.log(`\x1b[31m${failures} problema(s) en la imagen de fondo\x1b[0m`)
  process.exit(1)
}
console.log('\x1b[32mImagen de fondo verificada.\x1b[0m')
