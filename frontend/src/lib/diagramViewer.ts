/**
 * Qué diagrama está abierto en el visor a pantalla completa.
 *
 * Es estado de módulo y no un contexto de React porque lo abren dos mundos: el
 * bloque de la preview (React) y el widget del modo en vivo (CodeMirror, DOM a
 * pelo, sin acceso a ningún proveedor). El visor se monta una sola vez en la raíz
 * y se suscribe aquí con `useSyncExternalStore`.
 */

export interface OpenDiagram {
  /** Código Mermaid: el visor lo vuelve a dibujar si cambia el tema. */
  code: string
  /** SVG ya dibujado, para enseñarlo al instante sin esperar a Mermaid. */
  svg: string
}

let current: OpenDiagram | null = null
const listeners = new Set<() => void>()

function publish(next: OpenDiagram | null): void {
  current = next
  for (const listener of listeners) listener()
}

export function openDiagramViewer(diagram: OpenDiagram): void {
  publish(diagram)
}

export function closeDiagramViewer(): void {
  publish(null)
}

export function subscribeDiagramViewer(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function openDiagram(): OpenDiagram | null {
  return current
}
