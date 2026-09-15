/**
 * Lógica del árbol de notas.
 *
 * Está aparte de los componentes a propósito: lo que decide **si un arrastre es
 * legal** es donde están los errores sutiles —mover una carpeta dentro de sí
 * misma, pisar un archivo que ya existe, soltar algo sobre su propia carpeta— y
 * eso se puede comprobar sin navegador.
 */
import type { NoteEntry } from '@/api/types'

export interface TreeNode {
  entry: NoteEntry
  depth: number
  children: TreeNode[]
}

/**
 * Compone el árbol a partir de la lista plana que devuelve el API.
 *
 * Los directorios salen de lo que el API manda —no se deducen de las rutas de los
 * archivos— porque una carpeta vacía es una carpeta de verdad y tiene que verse:
 * es donde el usuario va a soltar cosas.
 *
 * Una ruta cuyo padre no está en la lista se cuelga de la raíz en vez de
 * desaparecer. No debería pasar, pero perder una nota por un dato raro es peor
 * que mostrarla en el sitio equivocado.
 */
export function buildTree(entries: readonly NoteEntry[]): TreeNode[] {
  const byPath = new Map<string, TreeNode>()
  for (const entry of entries) {
    byPath.set(entry.rel_path, { entry, depth: 0, children: [] })
  }

  const roots: TreeNode[] = []
  for (const entry of entries) {
    const node = byPath.get(entry.rel_path)
    if (node === undefined) continue
    const parentPath = parentOf(entry.rel_path)
    const parent = parentPath === null ? undefined : byPath.get(parentPath)
    if (parent === undefined) {
      roots.push(node)
    } else {
      parent.children.push(node)
    }
  }

  const assignDepth = (nodes: TreeNode[], depth: number): void => {
    for (const node of nodes) {
      node.depth = depth
      assignDepth(node.children, depth + 1)
    }
  }
  assignDepth(roots, 0)

  return roots
}

/** La carpeta que contiene a `path`, o null si está en la raíz de notas. */
export function parentOf(path: string): string | null {
  const index = path.lastIndexOf('/')
  return index === -1 ? null : path.slice(0, index)
}

/** Quita la extensión `.md`, que es lo que se ve al renombrar una nota. */
export function displayName(entry: NoteEntry): string {
  return entry.is_dir ? entry.name : entry.name.replace(/\.md$/i, '')
}

export type DropVerdict =
  | { ok: true; to: string }
  | { ok: false; reason: 'into-itself' | 'same-place' | 'occupied' }

/**
 * Decide si soltar `dragging` dentro de la carpeta `target` es legal, y con qué
 * ruta final.
 *
 * Los tres casos que se rechazan, y por qué cada uno:
 *
 *  - **into-itself**: mover una carpeta dentro de sí misma o de un descendiente
 *    suyo. Dejaría el árbol en un estado imposible. El backend también lo rechaza,
 *    pero saberlo aquí evita mandar la petición y que el usuario vea un error por
 *    algo que la interfaz ya podía saber.
 *  - **same-place**: soltarlo donde ya está. No es un error, pero tampoco una
 *    operación: no se manda nada.
 *  - **occupied**: ya hay algo con ese nombre. El backend devuelve 409; aquí se
 *    avisa antes de mover.
 */
export function dropVerdict(
  dragging: NoteEntry,
  targetDir: string | null,
  entries: readonly NoteEntry[],
): DropVerdict {
  const name = dragging.name
  const to = targetDir === null ? name : `${targetDir}/${name}`

  if (to === dragging.rel_path) return { ok: false, reason: 'same-place' }

  if (dragging.is_dir) {
    const prefix = dragging.rel_path + '/'
    // Soltar una carpeta sobre sí misma o sobre algo de dentro.
    if (to === dragging.rel_path || (targetDir !== null && (targetDir === dragging.rel_path || targetDir.startsWith(prefix)))) {
      return { ok: false, reason: 'into-itself' }
    }
  }

  if (entries.some((entry) => entry.rel_path === to)) {
    return { ok: false, reason: 'occupied' }
  }

  return { ok: true, to }
}

/**
 * Una ruta de destino que no choque con nada, para renombrar sin preguntar.
 *
 * Se usa para «Nueva nota» dentro de una carpeta con contenido: en vez de fallar
 * porque ya existe `sin-titulo.md`, se propone `sin-titulo-2.md`.
 */
export function freeName(
  dir: string | null,
  base: string,
  extension: string,
  entries: readonly NoteEntry[],
): string {
  const taken = new Set(entries.map((entry) => entry.rel_path))
  const join = (stem: string) =>
    dir === null ? `${stem}${extension}` : `${dir}/${stem}${extension}`

  if (!taken.has(join(base))) return join(base)
  for (let n = 2; n < 1000; n++) {
    const candidate = join(`${base}-${n}`)
    if (!taken.has(candidate)) return candidate
  }
  return join(`${base}-${Date.now()}`)
}
