import { cn } from '@/lib/utils'

export type StatusTone = 'ok' | 'warn' | 'error' | 'idle'

const TONES: Record<StatusTone, string> = {
  ok: 'bg-secondary shadow-[0_0_6px_rgba(127,216,143,0.7)]',
  warn: 'bg-primary shadow-[0_0_6px_rgba(255,180,84,0.7)]',
  error: 'bg-destructive shadow-[0_0_6px_rgba(255,107,107,0.7)]',
  idle: 'bg-muted-foreground',
}

/** Punto de estado, tipo LED de panel. */
export function StatusDot({ tone, className }: { tone: StatusTone; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-block size-1.5 shrink-0 rounded-full align-middle', TONES[tone], className)}
    />
  )
}
