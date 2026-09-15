import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Check, Clock, FolderInput, GitCompare, Paperclip, Trash2, User } from 'lucide-react'

import { useT } from '@/i18n'

import { errorMessage } from '@/api/client'
import { asArray, asStringArray } from '@/api/normalize'
import { useCancelProposal, useConfirmProposal } from '@/api/queries'
import type { Proposal, ProposalAlternative } from '@/api/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CategoryBadge } from '@/components/common/CategoryBadge'
import { Markdown } from '@/components/common/Markdown'
import { formatBytes, formatConfidence, formatDateTime, shortenPath } from '@/lib/format'
import { categoryLabel } from '@/features/projects/CategoryCounts'
import { RetargetDialog } from '@/features/inbox/RetargetDialog'
import { ProposalDiffView } from '@/features/inbox/ProposalDiffView'

function minutesLeft(expiresAt: string): number | null {
  const expires = new Date(expiresAt).getTime()
  if (Number.isNaN(expires)) return null
  return Math.round((expires - Date.now()) / 60_000)
}

function ConfidenceMeter({ confidence }: { confidence: number }) {
  const percent = Math.round(Math.max(0, Math.min(1, confidence)) * 100)
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 bg-sunken">
        <div className="h-full bg-primary" style={{ width: `${percent}%` }} />
      </div>
      <span className="text-2xs text-primary">{formatConfidence(confidence)}</span>
    </div>
  )
}

/**
 * Tarjeta de confirmación pendiente.
 *
 * Es el punto donde un humano aprueba lo que propuso un agente sin volver al
 * chat: aceptar, redirigir a otra carpeta o descartar. La inferencia y sus
 * alternativas siempre están a la vista, nunca se decide en silencio.
 */
export function ProposalCard({ proposal }: { proposal: Proposal }) {
  const t = useT()
  const confirm = useConfirmProposal()
  const cancel = useCancelProposal()
  const [retargetOpen, setRetargetOpen] = useState(false)
  // Ver los cambios se pide a propósito y no se carga solo: el cuerpo entero de
  // cada propuesta son varios kilobytes y el inbox puede tener muchas.
  const [showDiff, setShowDiff] = useState(false)

  // Los slices nulos de Go llegan como `null`: se normalizan en el borde.
  const alternatives = asArray<ProposalAlternative>(proposal.alternatives)
  const tags = asStringArray(proposal.tags)
  const filesTouched = asStringArray(proposal.files_touched)
  const evidence = asStringArray(proposal.inference?.evidence)

  const remaining = useMemo(() => minutesLeft(proposal.expires_at), [proposal.expires_at])
  const expired = remaining !== null && remaining <= 0
  const busy = confirm.isPending || cancel.isPending

  const accept = () => {
    confirm.mutate(
      { token: proposal.token, decision: 'accepted' },
      {
        onSuccess: (result) => {
          const written = result.summary ?? result.meta
          toast.success(t('inbox.accepted.title'), {
            description: written?.rel_path ?? proposal.rel_path,
          })
        },
        onError: (error) => {
          toast.error(t('inbox.confirmFailed'), { description: errorMessage(error) })
        },
      },
    )
  }

  const acceptIn = (category: string, label?: string) => {
    confirm.mutate(
      { token: proposal.token, decision: 'modified', override: { category } },
      {
        onSuccess: (result) => {
          const written = result.summary ?? result.meta
          toast.success(t('inbox.accepted.savedIn', { category: categoryLabel(t, category, label) }), {
            description: written?.rel_path ?? proposal.rel_path,
          })
        },
        onError: (error) => {
          toast.error(t('inbox.confirmFailed'), { description: errorMessage(error) })
        },
      },
    )
  }

  const discard = () => {
    cancel.mutate(
      { token: proposal.token, reason: t('inbox.discardReason') },
      {
        onSuccess: () => toast.success(t('inbox.discarded')),
        onError: (error) =>
          toast.error(t('inbox.discardFailed'), { description: errorMessage(error) }),
      },
    )
  }

  return (
    <article className="term-panel">
      <div className="term-panel-header">
        <span className="truncate normal-case tracking-normal text-foreground">{proposal.title}</span>
      </div>

      <div className="space-y-3 px-3 py-3">
        <div className="flex flex-wrap items-center gap-2 text-2xs text-muted-foreground">
          <CategoryBadge category={proposal.category} />
          <span className="text-border-strong">/</span>
          <code className="break-all text-secondary">
            {proposal.project_slug}/{proposal.category}/{proposal.filename}
          </code>
          {proposal.agent ? (
            <Badge variant="outline" className="gap-1">
              <User className="size-2.5" />
              {proposal.agent}
            </Badge>
          ) : null}
          <span className="ml-auto flex items-center gap-1">
            <Clock className="size-3" />
            {expired
              ? t('inbox.expiry.expired')
              : remaining !== null
                ? t('inbox.expiry.minutesLeft', { count: remaining })
                : t('inbox.expiry.at', { when: formatDateTime(proposal.expires_at) })}
          </span>
        </div>

        <div className="border-l-2 border-primary/50 bg-primary/5 px-2 py-1.5">
          <div className="flex items-center gap-2">
            <span className="text-2xs uppercase tracking-[0.12em] text-muted-foreground">
              {t('inbox.whyCategory')}
            </span>
            <ConfidenceMeter confidence={proposal.inference.confidence} />
          </div>
          <p className="mt-1 text-xs text-foreground">{proposal.inference.reason}</p>
          {evidence.length > 0 ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {evidence.slice(0, 8).map((item) => (
                <Badge key={item} variant="muted">
                  {item}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>

        {alternatives.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-2xs uppercase tracking-[0.12em] text-muted-foreground">
              {t('inbox.orSaveIn')}
            </span>
            {alternatives.map((alternative) => (
              <Button
                key={alternative.category}
                variant="outline"
                size="sm"
                disabled={busy}
                title={alternative.rel_path}
                onClick={() => acceptIn(alternative.category, alternative.label)}
              >
                {categoryLabel(t, alternative.category, alternative.label)}
              </Button>
            ))}
          </div>
        ) : null}

        {/* Dos formas de mirar lo mismo: el resumen tal como quedaría, o qué
            líneas cambian respecto a lo que ya hay en disco. Para una propuesta
            que crea un resumen nuevo, el diff es todo el texto añadido; para una
            que actualiza, es la única forma de ver qué se lleva por delante. */}
        <div className="flex flex-wrap items-center gap-1">
          <Button
            size="sm"
            variant={showDiff ? 'ghost' : 'outline'}
            onClick={() => setShowDiff(false)}
          >
            {t('inbox.diff.tabProposal')}
          </Button>
          <Button
            size="sm"
            variant={showDiff ? 'outline' : 'ghost'}
            onClick={() => setShowDiff(true)}
          >
            <GitCompare className="size-3" />
            {t('inbox.diff.tabChanges')}
          </Button>
        </div>

        {showDiff ? (
          <ProposalDiffView token={proposal.token} enabled={showDiff} />
        ) : (
          <div className="max-h-64 overflow-y-auto border border-border bg-sunken px-2 py-2">
            <Markdown content={proposal.preview} />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 text-2xs text-muted-foreground">
          <span>{formatBytes(proposal.body_bytes)}</span>
          {tags.length > 0 ? (
            <span className="flex flex-wrap gap-1">
              {tags.map((tag) => (
                <Badge key={tag} variant="muted">
                  #{tag}
                </Badge>
              ))}
            </span>
          ) : null}
          {filesTouched.length > 0 ? (
            <span className="flex items-center gap-1" title={filesTouched.join('\n')}>
              <Paperclip className="size-3" />
              {t('inbox.filesTouched', { count: filesTouched.length })} ·{' '}
              <code>{shortenPath(filesTouched[0], 34)}</code>
            </span>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
          <Button size="sm" onClick={accept} disabled={busy || expired}>
            <Check className="size-3" />
            {confirm.isPending ? t('common.state.saving') : t('common.actions.accept')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setRetargetOpen(true)} disabled={busy}>
            <FolderInput className="size-3" />
            {t('inbox.retarget.action')}
          </Button>
          <Button variant="destructive" size="sm" onClick={discard} disabled={busy}>
            <Trash2 className="size-3" />
            {t('common.actions.discard')}
          </Button>
          {expired ? (
            <span className="text-2xs text-destructive">{t('inbox.expiry.expiredHint')}</span>
          ) : null}
        </div>
      </div>

      <RetargetDialog proposal={proposal} open={retargetOpen} onOpenChange={setRetargetOpen} />
    </article>
  )
}
