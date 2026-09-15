import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { useT } from '@/i18n'

import { errorMessage } from '@/api/client'
import { useCategories, useConfirmProposal, useProjects } from '@/api/queries'
import type { Proposal } from '@/api/types'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { categoryLabel } from '@/features/projects/CategoryCounts'

interface RetargetDialogProps {
  proposal: Proposal | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * "Guardar en otra carpeta": el humano elige proyecto y categoría de destino.
 *
 * Confirma con `decision: "modified"` y manda el override. El core acepta
 * `project` y también `project_slug` como alias, así que basta con uno.
 */
export function RetargetDialog({ proposal, open, onOpenChange }: RetargetDialogProps) {
  const t = useT()
  const projects = useProjects()
  const categories = useCategories()
  const confirm = useConfirmProposal()

  const [projectSlug, setProjectSlug] = useState('')
  const [categoryKey, setCategoryKey] = useState('')

  useEffect(() => {
    if (!proposal) return
    setProjectSlug(proposal.project_slug)
    setCategoryKey(proposal.category)
  }, [proposal])

  const folder = categories.data?.find((category) => category.key === categoryKey)?.folder ?? categoryKey
  const projectName =
    projects.data?.find((project) => project.slug === projectSlug)?.name ?? projectSlug
  const targetPath = `${projectName}/${folder}/`

  const submit = () => {
    if (!proposal) return
    confirm.mutate(
      {
        token: proposal.token,
        decision: 'modified',
        override: { project: projectSlug, category: categoryKey },
      },
      {
        onSuccess: (result) => {
          const written = result.summary ?? result.meta
          toast.success(t('inbox.retarget.saved'), {
            description: written ? written.rel_path : targetPath,
          })
          onOpenChange(false)
        },
        onError: (error) => {
          toast.error(t('inbox.confirmFailed'), { description: errorMessage(error) })
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('inbox.retarget.title')}</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <div className="space-y-1">
            <Label>{t('inbox.retarget.project')}</Label>
            <Select value={projectSlug} onValueChange={setProjectSlug}>
              <SelectTrigger>
                <SelectValue placeholder={t('inbox.retarget.chooseProject')} />
              </SelectTrigger>
              <SelectContent>
                {(projects.data ?? []).map((project) => (
                  <SelectItem key={project.slug} value={project.slug}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label>{t('inbox.retarget.category')}</Label>
            <Select value={categoryKey} onValueChange={setCategoryKey}>
              <SelectTrigger>
                <SelectValue placeholder={t('inbox.retarget.chooseCategory')} />
              </SelectTrigger>
              <SelectContent>
                {(categories.data ?? [])
                  .filter((category) => category.key !== 'uncategorized')
                  .map((category) => (
                    <SelectItem key={category.key} value={category.key}>
                      {categoryLabel(t, category.key, category.label)} · {category.folder}/
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          <div className="border border-border bg-sunken px-2 py-1.5">
            <div className="text-2xs uppercase tracking-[0.12em] text-muted-foreground">
              {t('inbox.retarget.targetLabel')}
            </div>
            <div className="mt-0.5 break-all text-xs text-secondary">
              {targetPath}
              {proposal?.filename ?? ''}
            </div>
          </div>

          <DialogDescription>
            {t('inbox.retarget.descriptionBefore')}{' '}
            <span className="text-primary">modified</span>{' '}
            {t('inbox.retarget.descriptionAfter')}
          </DialogDescription>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            {t('common.actions.cancel')}
          </Button>
          <Button
            size="sm"
            onClick={submit}
            disabled={confirm.isPending || projectSlug.length === 0 || categoryKey.length === 0}
          >
            {confirm.isPending ? t('common.state.saving') : t('inbox.retarget.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
