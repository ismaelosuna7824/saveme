import { useMemo, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'

import { useT } from '@/i18n'

import { useTags } from '@/api/queries'
import type { SummaryStatus } from '@/api/types'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { statusLabel } from '@/lib/labels'
import { cn } from '@/lib/utils'
import { hasOverviewFilters, type OverviewFilters } from '@/features/projects/summaryFilters'

/** Los estados de `domain.Status*`, en el orden en que se ofrecen. */
const STATUSES: SummaryStatus[] = ['confirmed', 'draft', 'unmanaged']

interface SearchFiltersProps {
  project: string
  value: OverviewFilters
  onChange: (next: OverviewFilters) => void
}

/**
 * Filtros del buscador: etiqueta, estado y fechas de creación. Cada uno se
 * aplica al momento (no hay texto que esperar) y se quita con su propia «x».
 */
export function SearchFilters({ project, value, onChange }: SearchFiltersProps) {
  const t = useT()
  const tagCounts = useTags(project)

  // Las etiquetas del proyecto, las más usadas primero. La elegida se ofrece
  // aunque ya no esté (la quitaron del último resumen que la llevaba): si no,
  // el selector la enseñaría vacía con el filtro todavía puesto.
  const tags = useMemo(() => {
    const entries = Object.entries(tagCounts.data ?? {}).sort(
      ([a, countA], [b, countB]) => countB - countA || a.localeCompare(b),
    )
    if (value.tag && !entries.some(([tag]) => tag === value.tag)) entries.unshift([value.tag, 0])
    return entries
  }, [tagCounts.data, value.tag])

  const set = (patch: OverviewFilters) => onChange({ ...value, ...patch })

  return (
    <div
      role="group"
      aria-label={t('projects.search.filters.label')}
      className="mt-1.5 flex flex-wrap items-center gap-1.5 text-2xs"
    >
      <span className="text-muted-foreground">{t('projects.search.filters.label')}:</span>

      <FilterChip
        active={Boolean(value.tag)}
        removeLabel={t('projects.search.filters.remove', { name: t('projects.search.filters.tag') })}
        onRemove={() => set({ tag: undefined })}
      >
        <Select value={value.tag ?? ''} onValueChange={(tag) => set({ tag: tag || undefined })}>
          <SelectTrigger
            aria-label={t('projects.search.filters.byTag')}
            className="h-6 w-auto max-w-[16rem] gap-1 border-0 bg-transparent px-1.5 text-2xs"
          >
            <span className="text-muted-foreground">{t('projects.search.filters.tag')}:</span>
            {/* El valor se pinta aquí y no se copia del item: el item lleva
                también el recuento, que en el selector cerrado sobra. */}
            <SelectValue placeholder={t('projects.search.filters.any')}>
              {value.tag ? `#${value.tag}` : undefined}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {tags.length === 0 ? (
              <p className="px-2 py-1 text-2xs text-muted-foreground">
                {t('projects.search.filters.noTags')}
              </p>
            ) : (
              tags.map(([tag, count]) => (
                <SelectItem key={tag} value={tag}>
                  #{tag}
                  {count > 0 ? <span className="ml-1 text-muted-foreground">{count}</span> : null}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
      </FilterChip>

      <FilterChip
        active={Boolean(value.status)}
        removeLabel={t('projects.search.filters.remove', {
          name: t('projects.search.filters.status'),
        })}
        onRemove={() => set({ status: undefined })}
      >
        <Select
          value={value.status ?? ''}
          onValueChange={(status) => set({ status: status || undefined })}
        >
          <SelectTrigger
            aria-label={t('projects.search.filters.byStatus')}
            className="h-6 w-auto gap-1 border-0 bg-transparent px-1.5 text-2xs"
          >
            <span className="text-muted-foreground">{t('projects.search.filters.status')}:</span>
            <SelectValue placeholder={t('projects.search.filters.any')} />
          </SelectTrigger>
          <SelectContent>
            {STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {statusLabel(t, status)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FilterChip>

      <FilterChip
        active={Boolean(value.from)}
        removeLabel={t('projects.search.filters.remove', { name: t('projects.search.filters.from') })}
        onRemove={() => set({ from: undefined })}
      >
        <DateFilter
          label={t('projects.search.filters.from')}
          ariaLabel={t('projects.search.filters.fromDate')}
          value={value.from}
          max={value.to}
          onCommit={(from) => set({ from })}
        />
      </FilterChip>

      <FilterChip
        active={Boolean(value.to)}
        removeLabel={t('projects.search.filters.remove', { name: t('projects.search.filters.to') })}
        onRemove={() => set({ to: undefined })}
      >
        <DateFilter
          label={t('projects.search.filters.to')}
          ariaLabel={t('projects.search.filters.toDate')}
          value={value.to}
          min={value.from}
          onCommit={(to) => set({ to })}
        />
      </FilterChip>

      {hasOverviewFilters(value) ? (
        <button
          type="button"
          className="px-1 text-muted-foreground transition-colors hover:text-primary"
          onClick={() => onChange({})}
        >
          {t('projects.search.filters.clearAll')}
        </button>
      ) : null}
    </div>
  )
}

/** Marco de un filtro: borde de acento cuando está puesto, y su «x» para quitarlo. */
function FilterChip({
  active,
  removeLabel,
  onRemove,
  children,
}: {
  active: boolean
  removeLabel: string
  onRemove: () => void
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        'flex h-6 items-center rounded-sm border transition-colors',
        active ? 'border-primary/45 text-primary' : 'border-border',
      )}
    >
      {children}
      {active ? (
        <button
          type="button"
          aria-label={removeLabel}
          title={removeLabel}
          className="flex h-full items-center px-1 text-muted-foreground transition-colors hover:text-primary"
          onClick={onRemove}
        >
          <X className="size-3" />
        </button>
      ) : null}
    </div>
  )
}

/**
 * Un día AAAA-MM-DD. Lo que se está tecleando vive aquí hasta que es una fecha
 * completa: un `<input type="date">` da por buena «0002-03-10» al teclear el
 * primer dígito del año, y mandarla al filtro lanzaría una búsqueda por tecla
 * con fechas que nadie quiso.
 */
function DateFilter({
  label,
  ariaLabel,
  value,
  min,
  max,
  onCommit,
}: {
  label: string
  ariaLabel: string
  value: string | undefined
  min?: string
  max?: string
  onCommit: (value: string | undefined) => void
}) {
  const [draft, setDraft] = useState(value ?? '')
  // Si el filtro cambia por fuera (su «x», «quitar filtros»), el borrador lo sigue.
  const [committed, setCommitted] = useState(value)
  if (committed !== value) {
    setCommitted(value)
    setDraft(value ?? '')
  }

  return (
    <label className="flex h-full items-center gap-1 pl-1.5">
      <span className="text-muted-foreground">{label}:</span>
      <Input
        type="date"
        aria-label={ariaLabel}
        value={draft}
        min={min}
        max={max}
        className="h-full w-[8rem] border-0 bg-transparent px-0.5 py-0 text-2xs text-inherit"
        onChange={(event) => {
          const next = event.target.value
          setDraft(next)
          if (next === '') onCommit(undefined)
          else if (/^[1-9]\d{3}-\d{2}-\d{2}$/.test(next)) onCommit(next)
        }}
      />
    </label>
  )
}
