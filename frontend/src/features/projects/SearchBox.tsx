import { Search, X } from 'lucide-react'

import { useT } from '@/i18n'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface SearchBoxProps {
  value: string
  onChange: (value: string) => void
  /** Hay texto sin buscar todavía o una búsqueda en camino. */
  busy?: boolean
  resultCount?: number
}

/** Caja de búsqueda. El debounce lo aplica quien la usa. */
export function SearchBox({ value, onChange, busy = false, resultCount }: SearchBoxProps) {
  const t = useT()

  return (
    <div className="flex items-center gap-2">
      <div className="relative min-w-0 flex-1">
        <Search
          className={cn(
            'pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 transition-colors',
            busy ? 'animate-pulse text-primary' : 'text-muted-foreground',
          )}
        />
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={t('projects.search.placeholder')}
          className="pl-7"
          aria-label={t('projects.search.label')}
        />
        {value.length > 0 ? (
          <Button
            variant="ghost"
            size="icon-sm"
            className="absolute right-0.5 top-1/2 -translate-y-1/2"
            onClick={() => onChange('')}
            aria-label={t('projects.search.clear')}
          >
            <X className="size-3" />
          </Button>
        ) : null}
      </div>
      {/* Ancho fijo: el texto cambia entre «buscando…» y el recuento, y si la
          caja de al lado cambiara de ancho con él, todo bailaría al escribir. */}
      <span
        aria-live="polite"
        className={cn(
          'w-[14ch] shrink-0 text-right text-2xs',
          busy ? 'text-primary' : 'text-muted-foreground',
        )}
      >
        {busy
          ? t('projects.search.searching')
          : typeof resultCount === 'number'
            ? t('projects.search.resultCount', { count: resultCount })
            : null}
      </span>
    </div>
  )
}
