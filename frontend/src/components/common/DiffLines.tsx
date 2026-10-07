import type { DiffLine } from '@/lib/diff'

/**
 * Pinta un diff de líneas: lo que se va en rojo, lo que llega en verde.
 *
 * Lo comparten el diff de una propuesta (inbox) y el del historial de un
 * resumen: es la misma pregunta —qué líneas cambian— vista desde dos sitios.
 */
export function DiffLines({ lines }: { lines: DiffLine[] }) {
  return (
    // Se recorre el diff entero, sin recortarlo: si la lista es larga, el
    // contenedor scrollea. Esconder cambios sería justo lo contrario de lo que
    // esta vista existe para hacer.
    <div className="max-h-64 overflow-y-auto">
      {lines.map((line, index) => (
        <div
          key={index}
          className={
            line.kind === 'added'
              ? 'flex gap-2 bg-secondary/10 px-2 font-mono text-2xs text-secondary'
              : line.kind === 'removed'
                ? 'flex gap-2 bg-destructive/10 px-2 font-mono text-2xs text-destructive'
                : 'flex gap-2 px-2 font-mono text-2xs text-muted-foreground'
          }
        >
          <span className="w-3 shrink-0 select-none text-center opacity-60">
            {line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '}
          </span>
          {/* `whitespace-pre-wrap` y no `pre`: una línea larga se envuelve en vez
              de obligar a desplazarse en horizontal. */}
          <span className="whitespace-pre-wrap break-words">{line.text}</span>
        </div>
      ))}
    </div>
  )
}
