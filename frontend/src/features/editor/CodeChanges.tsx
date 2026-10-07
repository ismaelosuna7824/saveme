import { GitCommitHorizontal, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'

import { errorMessage } from '@/api/client'
import { useFreshness } from '@/api/queries'
import type { SummaryMeta } from '@/api/types'
import { useT } from '@/i18n'
import { formatDateTime } from '@/lib/format'
import { openExternal } from '@/lib/openExternal'

/**
 * El código detrás de un resumen: su commit, enlazado a su página si el repo del
 * proyecto está en GitHub, GitLab o Bitbucket, y cuántos commits tocaron sus
 * archivos después de escribirlo.
 *
 * Si no se puede contar —sin repo vinculado, repo movido sin que un agente lo haya
 * vuelto a ver, sin git— no se enseña nada: un aviso que no se puede resolver
 * desde aquí solo es ruido.
 */
export function CodeChanges({ meta }: { meta: SummaryMeta }) {
  const t = useT()
  const freshness = useFreshness(meta.id).data
  const sha = meta.commit_sha ?? ''
  const url = meta.commit_url

  const commit =
    sha.length === 0 ? null : url ? (
      <button
        type="button"
        className="flex items-center gap-1 text-secondary underline-offset-2 hover:text-primary hover:underline"
        title={t('editor.code.openCommit')}
        onClick={() => {
          openExternal(url).catch((error: unknown) =>
            toast.error(t('editor.code.openFailed'), { description: errorMessage(error) }),
          )
        }}
      >
        <GitCommitHorizontal className="size-3 shrink-0" />
        <code>{t('editor.code.commit', { sha: sha.slice(0, 7) })}</code>
      </button>
    ) : (
      <span className="flex items-center gap-1">
        <GitCommitHorizontal className="size-3 shrink-0" />
        <code>{t('editor.code.commit', { sha: sha.slice(0, 7) })}</code>
      </span>
    )

  const changed =
    freshness && freshness.available && freshness.count > 0 ? (
      <span
        className={
          freshness.stale ? 'flex items-center gap-1 text-warning' : 'flex items-center gap-1'
        }
        title={[
          freshness.stale ? t('editor.code.staleHint') : t('editor.code.changedHint'),
          ...freshness.latest.map(
            (c) => `${c.sha.slice(0, 7)} · ${formatDateTime(c.when)} · ${c.subject}`,
          ),
        ].join('\n')}
      >
        {freshness.stale ? <TriangleAlert className="size-3 shrink-0" /> : null}
        {t('editor.code.changed', { count: freshness.count })}
      </span>
    ) : null

  if (commit === null && changed === null) return null
  return (
    <>
      {commit}
      {changed}
    </>
  )
}
