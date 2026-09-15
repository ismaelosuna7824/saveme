import { Link } from '@tanstack/react-router'
import { FileText } from 'lucide-react'

import { useT } from '@/i18n'

import type { SummaryMeta } from '@/api/types'
import { asStringArray } from '@/api/normalize'
import { CategoryBadge } from '@/components/common/CategoryBadge'
import { TagLink } from '@/components/common/TagLink'
import { StatusBadge } from '@/components/common/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { formatDateTime, formatRelative } from '@/lib/format'

interface SummaryRowProps {
  summary: SummaryMeta
  showCategory?: boolean
}

/** Fila de un resumen: título, fecha, línea de resumen y etiquetas. */
export function SummaryRow({ summary, showCategory = false }: SummaryRowProps) {
  const t = useT()
  const tags = asStringArray(summary.tags)

  return (
    <Link
      to="/s/$id"
      params={{ id: summary.id }}
      className="block border-b border-border px-3 py-2 transition-colors last:border-b-0 hover:bg-accent/40"
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <FileText className="size-3 shrink-0 self-center text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-xs text-foreground">{summary.title}</span>
        {showCategory ? <CategoryBadge category={summary.category} /> : null}
        <StatusBadge status={summary.status} />
        <span
          className="shrink-0 text-2xs text-muted-foreground"
          title={formatDateTime(summary.updated_at)}
        >
          {formatDateTime(summary.created_at)}
        </span>
      </div>

      {summary.summary_line.length > 0 ? (
        <p className="mt-0.5 line-clamp-2 pl-5 text-2xs text-muted-foreground">
          {summary.summary_line}
        </p>
      ) : null}

      <div className="mt-1 flex flex-wrap items-center gap-2 pl-5 text-2xs text-muted-foreground">
        <code className="truncate" title={summary.abs_path}>
          {summary.rel_path}
        </code>
        <span>· {t('common.words', { count: summary.word_count })}</span>
        <span>· {formatRelative(summary.updated_at)}</span>
        {tags.length > 0 ? (
          <span className="flex flex-wrap gap-1">
            {tags.map((tag) => (
              <TagLink key={tag} tag={tag} />
            ))}
          </span>
        ) : null}
        {summary.agent ? <Badge variant="outline">{summary.agent}</Badge> : null}
      </div>
    </Link>
  )
}
