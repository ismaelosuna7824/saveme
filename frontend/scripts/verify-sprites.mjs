#!/usr/bin/env bun
/**
 * Verificación de los iconos de proyecto.
 *
 * Los bichos están dibujados a mano como cadenas de texto, y un carácter de más
 * en una fila no rompe nada: deja un icono torcido que nadie ve hasta que le toca
 * a un proyecto. Aquí se comprueba que cada dibujo sea rectangular, simétrico y
 * reconocible, y que el reparto por slug sea estable y use todos los dibujos.
 *
 * Uso:  bun run verify:sprites
 */
import {
  automaticSprite,
  hashSlug,
  PROJECT_SPRITE_COLORS,
  PROJECT_SPRITES,
  projectSprite,
} from '../src/lib/projectSprite.ts'
import { projects as esProjects } from '../src/i18n/locales/es/projects.ts'
import { projects as enProjects } from '../src/i18n/locales/en/projects.ts'

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

section('Dibujos')
PROJECT_SPRITES.forEach(({ key, rows }) => {
  const width = rows[0].length
  const lit = rows.join('').split('').filter((c) => c === '#').length
  const ok =
    rows.every((row) => row.length === width && /^[#.]+$/.test(row)) &&
    rows.every((row) => row === [...row].reverse().join('')) &&
    width <= 12 &&
    rows.length <= 12 &&
    lit >= width * rows.length * 0.3 &&
    // Sin filas ni columnas vacías en los bordes: el dibujo llena su caja.
    rows[0].includes('#') &&
    rows.at(-1).includes('#') &&
    rows.some((row) => row[0] === '#')
  check(`${key}: ${width}×${rows.length}, rectangular, simétrico y lleno`, ok)
})
check('no hay dos dibujos iguales', new Set(PROJECT_SPRITES.map(({ rows }) => rows.join('/'))).size === PROJECT_SPRITES.length)

section('Nombres')
{
  // La misma forma que exige el core (`config.ValidProjectIcon`): un nombre que
  // no la cumpla no se podría guardar.
  const keyShape = /^[a-z][a-z0-9-]{0,23}$/
  const spriteKeys = PROJECT_SPRITES.map((sprite) => sprite.key)
  const colorKeys = PROJECT_SPRITE_COLORS.map((color) => color.key)
  check('los nombres de dibujo son únicos y con forma de clave',
    new Set(spriteKeys).size === spriteKeys.length && spriteKeys.every((key) => keyShape.test(key)))
  check('los de color también',
    new Set(colorKeys).size === colorKeys.length && colorKeys.every((key) => keyShape.test(key)))
  check('cada dibujo y cada color tiene su nombre traducido en los dos idiomas',
    [esProjects, enProjects].every((locale) =>
      spriteKeys.every((key) => locale.icon.sprites[key]) && colorKeys.every((key) => locale.icon.colors[key])))
}

section('Elección del usuario')
{
  const auto = automaticSprite('alfa')
  const other = PROJECT_SPRITES.find((sprite) => sprite.key !== auto.sprite.key)
  const otherColor = PROJECT_SPRITE_COLORS.find((color) => color.key !== auto.color.key)

  const shapeOnly = projectSprite('alfa', { sprite: other.key })
  check('elegir solo la forma deja el color automático',
    shapeOnly.spriteKey === other.key && shapeOnly.colorKey === auto.color.key)
  const colorOnly = projectSprite('alfa', { color: otherColor.key })
  check('elegir solo el color deja la forma automática',
    colorOnly.colorKey === otherColor.key && colorOnly.spriteKey === auto.sprite.key)
  const unknown = projectSprite('alfa', { sprite: 'dragon-del-futuro', color: 'ultravioleta' })
  check('un nombre desconocido se pinta como automático',
    unknown.spriteKey === auto.sprite.key && unknown.colorKey === auto.color.key)
  const empty = projectSprite('alfa', { sprite: '', color: '' })
  check('vacío es automático', empty.spriteKey === auto.sprite.key && empty.colorKey === auto.color.key)
}

section('Reparto por slug')
{
  // Vectores de referencia de FNV-1a: si el hash cambiara, todos los proyectos
  // cambiarían de icono al actualizar la app.
  check('el hash es FNV-1a de 32 bits', hashSlug('') === 0x811c9dc5 && hashSlug('a') === 0xe40c292c && hashSlug('foobar') === 0xbf9cf968)

  const sample = Array.from({ length: 400 }, (_, i) => `proyecto-${i}`)
  const shapes = new Set(sample.map((slug) => projectSprite(slug).rows))
  const colors = new Set(sample.map((slug) => projectSprite(slug).color))
  check(`se usan todos los dibujos (${shapes.size}/${PROJECT_SPRITES.length})`, shapes.size === PROJECT_SPRITES.length)
  check(`y todos los colores (${colors.size}/${PROJECT_SPRITE_COLORS.length})`, colors.size === PROJECT_SPRITE_COLORS.length)

  const near = ['app', 'app-2', 'app-api', 'api-app']
  const looks = new Set(near.map((slug) => `${projectSprite(slug).rows.join('')}|${projectSprite(slug).color}`))
  check('slugs parecidos no se parecen', looks.size === near.length)
}

console.log('')
if (failures > 0) {
  console.log(`\x1b[31m${failures} problema(s) en los iconos de proyecto\x1b[0m`)
  process.exit(1)
}
console.log('\x1b[32mIconos de proyecto verificados.\x1b[0m')
