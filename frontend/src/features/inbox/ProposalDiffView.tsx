import { useMemo } from 'react'

import { useProposalDiff } from '@/api/queries'
import { DiffLines } from '@/components/common/DiffLines'
import { useT } from '@/i18n'
import { diffCounts, diffLines } from '@/lib/diff'

/**
 * Qué cambia una propuesta, antes de aprobarla.
 *
 * Existe porque confirmar una propuesta que **actualiza** un resumen que ya está
 * escrito es el momento delicado: el cuerpo se reemplaza entero y hasta ahora eso
 * se aprobaba a ciegas, viendo solo el texto nuevo. Con esto se ve qué líneas se
 * van y cuáles llegan.
 *
 * No se carga hasta que se pide: el cuerpo entero de cada propuesta son varios
 * kilobytes, y el listado del inbox puede tener muchas.
 */
export function ProposalDiffView({ token, enabled }: { token: string; enabled: boolean }) {
  const t = useT()
  const { data, isPending, error } = useProposalDiff(token, enabled)

  const lines = useMemo(
    () => (data ? diffLines(data.current, data.proposed) : []),
    [data],
  )
  const counts = useMemo(() => diffCounts(lines), [lines])

  if (!enabled) return null
  if (isPending) {
    return <p className="px-2 py-3 text-2xs text-muted-foreground">{t('inbox.diff.loading')}</p>
  }
  if (error || !data) {
    return <p className="px-2 py-3 text-2xs text-destructive">{t('inbox.diff.failed')}</p>
  }

  return (
    <div className="border border-border bg-sunken">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-2 py-1 text-2xs">
        {data.exists ? (
          <>
            <span className="text-secondary">+{counts.added}</span>
            <span className="text-destructive">−{counts.removed}</span>
            <span className="text-muted-foreground">{t('inbox.diff.againstDisk')}</span>
          </>
        ) : (
          <span className="text-muted-foreground">{t('inbox.diff.newSummary')}</span>
        )}
      </div>

      <DiffLines lines={lines} />

      {!data.exists ? (
        <p className="border-t border-border px-2 py-1 text-2xs text-muted-foreground">
          {t('inbox.diff.newSummaryHint', { count: counts.added })}
        </p>
      ) : null}
    </div>
  )
}
