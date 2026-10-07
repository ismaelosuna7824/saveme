/**
 * El mapa de decisiones como diagrama de Mermaid.
 *
 * Es una función pura —recibe el grafo y devuelve el texto— para poder
 * comprobarla sin navegador: si un título rompe la sintaxis, el mapa entero sale
 * como error, y eso hay que verlo en `verify:mermaid` y no en la pantalla.
 *
 * Los nodos llevan ids propios (`n0`, `n1`…) y no los ids de los resúmenes: el id
 * de un resumen viene del frontmatter y puede llevar cualquier cosa. `nodeIds`
 * traduce de vuelta para abrir el resumen al pulsar.
 */
import type { ProjectGraph } from '@/api/types'

export interface DecisionMapLabels {
  /** Texto de la arista «sustituye a». */
  supersedes: string
}

export interface DecisionMapColors {
  /** Borde de los desactualizados. */
  warning: string
}

export interface DecisionMapDiagram {
  code: string
  /** `n3` → id del resumen. */
  nodeIds: Map<string, string>
}

/** Títulos de más de esto se recortan: el mapa se lee por la forma, no por el texto. */
const MAX_LABEL = 48

/**
 * Deja un título listo para ir entre comillas en una etiqueta de Mermaid. Las
 * comillas cierran la etiqueta y los `<`/`>` son HTML: se cambian por sus
 * entidades, que Mermaid pinta como el carácter.
 */
export function mermaidLabel(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  const short = clean.length > MAX_LABEL ? `${clean.slice(0, MAX_LABEL - 1)}…` : clean
  return short.replace(/"/g, '#quot;').replace(/</g, '#lt;').replace(/>/g, '#gt;')
}

export function decisionMapDiagram(
  graph: ProjectGraph,
  labels: DecisionMapLabels,
  colors: DecisionMapColors,
): DecisionMapDiagram {
  const nodeIds = new Map<string, string>()
  const local = new Map<string, string>()
  const lines = ['flowchart LR']

  graph.nodes.forEach((node, index) => {
    const id = `n${index}`
    nodeIds.set(id, node.id)
    local.set(node.id, id)
    const date = node.created_at.slice(0, 10)
    lines.push(`  ${id}["${mermaidLabel(node.title)}<br/><small>${node.category} · ${date}</small>"]`)
  })

  for (const edge of graph.edges) {
    const from = local.get(edge.from)
    const to = local.get(edge.to)
    if (from === undefined || to === undefined) continue
    lines.push(
      edge.kind === 'supersedes'
        ? `  ${from} -. ${mermaidLabel(labels.supersedes)} .-> ${to}`
        : `  ${from} --> ${to}`,
    )
  }

  // Lo sustituido, atenuado y con borde discontinuo; lo desactualizado, con el
  // color de aviso; lo de otro proyecto, con borde de puntos.
  lines.push('  classDef superseded opacity:0.5,stroke-dasharray:5 3')
  lines.push(`  classDef stale stroke:${colors.warning},stroke-width:2px`)
  lines.push('  classDef external stroke-dasharray:2 2')
  const byClass: Record<string, string[]> = { superseded: [], stale: [], external: [] }
  graph.nodes.forEach((node, index) => {
    if (node.superseded) byClass.superseded.push(`n${index}`)
    else if (node.stale) byClass.stale.push(`n${index}`)
    if (node.external) byClass.external.push(`n${index}`)
  })
  for (const [name, ids] of Object.entries(byClass)) {
    if (ids.length > 0) lines.push(`  class ${ids.join(',')} ${name}`)
  }

  return { code: lines.join('\n'), nodeIds }
}
