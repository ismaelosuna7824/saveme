import { splitFrontmatter } from '@/features/editor/frontmatter'

export interface DocumentBody {
  body: string
  /** Líneas del frontmatter: se suman a las líneas del cuerpo. */
  lineOffset: number
}

/**
 * El markdown que ve la preview.
 *
 * Se renderiza solo el cuerpo, sin el bloque YAML, porque el frontmatter no es
 * contenido humano. `lineOffset` devuelve las líneas del cuerpo al espacio del
 * archivo completo para que la sincronización de scroll siga cuadrando.
 */
export function documentBody(content: string): DocumentBody {
  const split = splitFrontmatter(content)
  if (split === null) return { body: content, lineOffset: 0 }
  return { body: split.body, lineOffset: split.lineOffset }
}
