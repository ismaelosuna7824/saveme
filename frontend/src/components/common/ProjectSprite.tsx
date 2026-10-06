import { useMemo } from 'react'

import { useConfig } from '@/api/queries'
import type { ProjectIconChoice } from '@/api/types'
import { projectSprite, type ProjectSprite as Sprite } from '@/lib/projectSprite'
import { cn } from '@/lib/utils'

/**
 * Un dibujo de píxeles en SVG.
 *
 * Un `<rect>` por tramo horizontal de píxeles encendidos, con `crispEdges`: así
 * se ve nítido a cualquier tamaño, sin el emborronado de una imagen escalada. El
 * dibujo se centra en un lienzo cuadrado del lado más largo, para que bichos de
 * anchos distintos ocupen lo mismo en una lista.
 */
export function SpriteGlyph({
  sprite,
  className,
  dim = false,
}: {
  sprite: Sprite
  className?: string
  dim?: boolean
}) {
  const { rects, size } = useMemo(() => {
    const side = Math.max(sprite.width, sprite.height)
    const offsetX = (side - sprite.width) / 2
    const offsetY = (side - sprite.height) / 2
    const runs: { x: number; y: number; width: number }[] = []
    sprite.rows.forEach((row, y) => {
      let start = -1
      for (let x = 0; x <= row.length; x++) {
        const on = row[x] === '#'
        if (on && start < 0) start = x
        if (!on && start >= 0) {
          runs.push({ x: start + offsetX, y: y + offsetY, width: x - start })
          start = -1
        }
      }
    })
    return { rects: runs, size: side }
  }, [sprite])

  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      className={cn('size-3.5 shrink-0', dim ? 'opacity-35' : null, className)}
      style={{ color: sprite.color }}
    >
      {rects.map((rect) => (
        <rect
          key={`${rect.x}-${rect.y}`}
          x={rect.x}
          y={rect.y}
          width={rect.width}
          height={1}
          fill="currentColor"
        />
      ))}
    </svg>
  )
}

/**
 * El icono de un proyecto: el que eligió el usuario en `config.project_icons`
 * o, si no eligió, el que sale del slug.
 *
 * `dim` lo apaga, para proyectos sin resúmenes: hace el papel del punto gris que
 * había antes.
 */
export function ProjectSprite({
  slug,
  className,
  dim = false,
}: {
  slug: string
  className?: string
  dim?: boolean
}) {
  const config = useConfig()
  const choice: ProjectIconChoice | undefined = config.data?.project_icons?.[slug]
  const sprite = useMemo(
    () => projectSprite(slug, choice),
    [slug, choice?.sprite, choice?.color],
  )
  return <SpriteGlyph sprite={sprite} className={className} dim={dim} />
}
