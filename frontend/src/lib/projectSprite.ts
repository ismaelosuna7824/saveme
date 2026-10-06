/**
 * El icono de cada proyecto: un bicho de píxeles al estilo de los marcianitos.
 *
 * Por defecto sale del slug, así que el mismo proyecto tiene siempre el mismo
 * icono en todas las pantallas y en todas las máquinas, sin guardar nada. El
 * usuario puede elegir otro bicho y otro color (`config.project_icons`); lo que
 * no elija sigue saliendo del slug.
 *
 * Los dibujos están hechos a mano y no generados: un generador aleatorio de
 * píxeles da manchas tanto como bichos, y un icono feo es peor que ninguno.
 * Todos son simétricos —como los originales—, y la guardia
 * `scripts/verify-sprites.mjs` comprueba que lo sigan siendo.
 *
 * El orden de las listas decide el icono automático: añadir dibujos o colores
 * **al final** no le cambia el icono a nadie; reordenarlos, sí. Las elecciones
 * del usuario se guardan por nombre, así que a esas no les afecta el orden.
 */

import type { ProjectIconChoice } from '@/api/types'

export interface SpriteDrawing {
  /** Nombre estable con el que se guarda la elección. */
  key: string
  /** Cada fila es una cadena: `#` es un píxel encendido, `.` uno apagado. */
  rows: readonly string[]
}

export const PROJECT_SPRITES: readonly SpriteDrawing[] = [
  {
    key: 'squid',
    rows: ['...##...', '..####..', '.######.', '##.##.##', '########', '..#..#..', '.#.##.#.', '#.#..#.#'],
  },
  {
    key: 'crab',
    rows: [
      '..#.....#..',
      '...#...#...',
      '..#######..',
      '.##.###.##.',
      '###########',
      '#.#######.#',
      '#.#.....#.#',
      '...##.##...',
    ],
  },
  {
    key: 'octopus',
    rows: [
      '....####....',
      '.##########.',
      '############',
      '###..##..###',
      '############',
      '...##..##...',
      '..##.##.##..',
      '##........##',
    ],
  },
  {
    key: 'antenna',
    rows: ['.#.....#.', '..#...#..', '.#######.', '##.###.##', '#########', '.#.#.#.#.', '#.......#', '.#.....#.'],
  },
  {
    key: 'saucer',
    rows: ['....###....', '..#######..', '.##.#.#.##.', '###########', '..##...##..', '...#...#...'],
  },
  {
    key: 'robot',
    rows: ['...###...', '.#######.', '##..#..##', '#########', '.#.###.#.', '.#######.', '..#...#..', '.##...##.'],
  },
  {
    key: 'jelly',
    rows: ['..#####..', '.#######.', '##.#.#.##', '#########', '#.#.#.#.#', '#.#.#.#.#', '.#.#.#.#.'],
  },
  {
    key: 'bat',
    rows: [
      '#.........#',
      '##..###..##',
      '###.#.#.###',
      '###########',
      '.#########.',
      '..#.#.#.#..',
      '.#.......#.',
    ],
  },
  {
    key: 'cat',
    rows: ['#.......#', '##.....##', '#########', '#..###..#', '#########', '.#######.', '..#...#..', '.#.....#.'],
  },
  {
    key: 'frog',
    rows: ['.##...##.', '#..###..#', '#########', '##.###.##', '#########', '.#.....#.', '##.....##'],
  },
  {
    key: 'spider',
    rows: [
      '#..#...#..#',
      '.#..###..#.',
      '..#######..',
      '.##.###.##.',
      '###########',
      '..#######..',
      '.#.#...#.#.',
      '#.#.....#.#',
    ],
  },
  {
    key: 'ghost',
    rows: ['..####..', '.######.', '##.##.##', '########', '########', '########', '##.##.##', '#..##..#'],
  },
]

export interface SpriteColor {
  key: string
  value: string
}

/**
 * Ocho tonos con la misma luminosidad, para que ningún proyecto grite más que
 * otro. En oklch, como el resto del tema; se leen igual sobre fondo oscuro y
 * sobre el claro de `paper`.
 */
export const PROJECT_SPRITE_COLORS: readonly SpriteColor[] = [
  { key: 'green', value: 'oklch(0.72 0.16 150)' },
  { key: 'teal', value: 'oklch(0.72 0.11 195)' },
  { key: 'blue', value: 'oklch(0.68 0.14 250)' },
  { key: 'violet', value: 'oklch(0.66 0.18 295)' },
  { key: 'pink', value: 'oklch(0.70 0.19 350)' },
  { key: 'red', value: 'oklch(0.68 0.18 25)' },
  { key: 'orange', value: 'oklch(0.74 0.16 60)' },
  { key: 'yellow', value: 'oklch(0.80 0.15 95)' },
]

/**
 * FNV-1a de 32 bits. No hace falta nada criptográfico: solo que el mismo slug dé
 * siempre lo mismo y que slugs parecidos (`app`, `app-2`) caigan lejos.
 */
export function hashSlug(slug: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < slug.length; i++) {
    hash ^= slug.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export interface ProjectSprite {
  /** Nombre del dibujo y del color que se pintan. */
  spriteKey: string
  colorKey: string
  rows: readonly string[]
  color: string
  /** Ancho y alto del dibujo, en píxeles de sprite. */
  width: number
  height: number
}

/** El dibujo y el color que corresponden a un slug sin elección del usuario. */
export function automaticSprite(slug: string): { sprite: SpriteDrawing; color: SpriteColor } {
  const hash = hashSlug(slug)
  return {
    sprite: PROJECT_SPRITES[hash % PROJECT_SPRITES.length],
    color: PROJECT_SPRITE_COLORS[(hash >>> 8) % PROJECT_SPRITE_COLORS.length],
  }
}

/**
 * El icono de un proyecto: lo que eligió el usuario y, en lo que no eligió —o si
 * eligió un nombre que esta versión no conoce—, lo que sale del slug. La forma y
 * el color se resuelven por separado: se puede fijar uno y dejar el otro en
 * automático.
 */
export function projectSprite(slug: string, choice?: ProjectIconChoice): ProjectSprite {
  const automatic = automaticSprite(slug)
  const sprite = PROJECT_SPRITES.find((item) => item.key === choice?.sprite) ?? automatic.sprite
  const color = PROJECT_SPRITE_COLORS.find((item) => item.key === choice?.color) ?? automatic.color
  return {
    spriteKey: sprite.key,
    colorKey: color.key,
    rows: sprite.rows,
    color: color.value,
    width: sprite.rows[0].length,
    height: sprite.rows.length,
  }
}
