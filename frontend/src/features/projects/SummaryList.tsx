import { FileText } from 'lucide-react'

import { useT } from '@/i18n'

import { asArray } from '@/api/normalize'
import type { SummaryList as SummaryListResult, SummaryMeta } from '@/api/types'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorPanel } from '@/components/common/ErrorPanel'
import { Skeleton } from '@/components/ui/skeleton'
import { SummaryRow } from '@/features/projects/SummaryRow'

interface SummaryListProps {
  result: SummaryListResult | undefined
  isLoading: boolean
  error: unknown
  onRetry: () => void
  showCategory?: boolean
  emptyTitle?: string
  emptyHint?: string
}

/** Lista de resúmenes con estados de carga, error y vacío. */
export function SummaryList({
  result,
  isLoading,
  error,
  onRetry,
  showCategory = false,
  emptyTitle,
  emptyHint,
}: SummaryListProps) {
  const t = useT()

  if (isLoading) {
    return (
      <div className="space-y-2 p-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-4/5" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-3">
        <ErrorPanel error={error} title={t('projects.list.loadFailed')} onRetry={onRetry} />
      </div>
    )
  }

  if (!result || asArray<SummaryMeta>(result.items).length === 0) {
    return (
      <div className="p-3">
        <EmptyState
          icon={<FileText className="size-4" />}
          title={emptyTitle ?? t('projects.list.empty')}
          hint={emptyHint}
        />
      </div>
    )
  }

  return (
    <div className="divide-y divide-border border-t border-border">
      {asArray<SummaryMeta>(result.items).map((summary) => (
        <SummaryRow key={summary.id} summary={summary} showCategory={showCategory} />
      ))}
    </div>
  )
}
