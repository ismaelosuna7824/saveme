import { Search, X } from 'lucide-react'

import { useT } from '@/i18n'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface SearchBoxProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  resultCount?: number
}

/** Caja de búsqueda. El debounce lo aplica quien la usa. */
export function SearchBox({ value, onChange, placeholder, resultCount }: SearchBoxProps) {
  const t = useT()

  return (
    <div className="flex items-center gap-2">
      <div className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder ?? t('projects.search.placeholder')}
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
      {typeof resultCount === 'number' ? (
        <span className="shrink-0 text-2xs text-muted-foreground">
          {t('projects.search.resultCount', { count: resultCount })}
        </span>
      ) : null}
    </div>
  )
}
