import { useState } from 'react'
import { ExternalLink, GitBranch, Unlink } from 'lucide-react'
import { toast } from 'sonner'

import { errorMessage } from '@/api/client'
import { useUnlinkRepo } from '@/api/queries'
import type { Project } from '@/api/types'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'
import { openExternal } from '@/lib/openExternal'

/**
 * El repo de código de un proyecto, en su cabecera.
 *
 * Se enseña lo que lo identifica —el remote, o el primer commit si no tiene—, no
 * su ruta: la ruta cambia y el vínculo no. Desvincular está aquí porque el vínculo
 * se crea solo y tiene que poder deshacerse sin editar ningún archivo a mano.
 */
export function ProjectRepoBadge({ project }: { project: Project }) {
  const t = useT()
  const unlink = useUnlinkRepo()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const repo = project.repo

  if (repo === undefined) {
    return (
      <span className="flex items-center gap-1 text-2xs text-muted-foreground" title={t('projects.repo.noneHint')}>
        <GitBranch className="size-3 shrink-0 opacity-60" />
        {t('projects.repo.none')}
      </span>
    )
  }

  const label = repo.remote ?? t('projects.repo.rootOnly', { sha: (repo.root_commit ?? '').slice(0, 7) })
  const webUrl = repo.web_url

  return (
    <span className="flex min-w-0 items-center gap-1 text-2xs text-muted-foreground">
      <GitBranch className="size-3 shrink-0" />
      {webUrl ? (
        <button
          type="button"
          className="flex min-w-0 items-center gap-1 text-secondary underline-offset-2 hover:text-primary hover:underline"
          title={t('projects.repo.linkedHint')}
          onClick={() => {
            openExternal(webUrl).catch((error: unknown) =>
              toast.error(t('projects.repo.openFailed'), { description: errorMessage(error) }),
            )
          }}
        >
          <code className="truncate">{label}</code>
          <ExternalLink className="size-2.5 shrink-0" />
        </button>
      ) : (
        <code className="truncate" title={t('projects.repo.linkedHint')}>
          {label}
        </code>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => setConfirmOpen(true)}
        title={t('projects.repo.unlink')}
        aria-label={t('projects.repo.unlink')}
      >
        <Unlink className="size-3" />
      </Button>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('projects.repo.unlinkTitle', { name: project.name })}
        description={t('projects.repo.unlinkDescription')}
        confirmLabel={t('projects.repo.unlink')}
        pending={unlink.isPending}
        onConfirm={() =>
          unlink.mutate(project.slug, {
            onSuccess: () => {
              setConfirmOpen(false)
              toast.success(t('projects.repo.unlinked'))
            },
            onError: (error) =>
              toast.error(t('projects.repo.unlinkFailed'), { description: errorMessage(error) }),
          })
        }
      />
    </span>
  )
}
