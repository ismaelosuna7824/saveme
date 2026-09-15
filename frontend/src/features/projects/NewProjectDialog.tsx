import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'

import { useT } from '@/i18n'

import { errorMessage } from '@/api/client'
import { useCreateProject } from '@/api/queries'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { slugify } from '@/lib/slug'

interface NewProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Alta de proyecto. El slug se previsualiza mientras escribes porque es lo que
 * acaba siendo el nombre del directorio en disco (`SaveMe App` → `saveme-app`).
 */
export function NewProjectDialog({ open, onOpenChange }: NewProjectDialogProps) {
  const t = useT()
  const [name, setName] = useState('')
  const [slugDraft, setSlugDraft] = useState<string | null>(null)
  const create = useCreateProject()
  const navigate = useNavigate()

  const effectiveSlug = slugDraft !== null ? slugify(slugDraft) : slugify(name)

  const close = () => {
    onOpenChange(false)
    setName('')
    setSlugDraft(null)
  }

  const submit = () => {
    const trimmed = name.trim()
    if (trimmed.length === 0) return

    create.mutate(
      { name: trimmed, slug: effectiveSlug.length > 0 ? effectiveSlug : undefined },
      {
        onSuccess: (project) => {
          toast.success(t('projects.newProject.created', { name: project.name }), {
            description: t('projects.newProject.createdHint', { path: project.path }),
          })
          close()
          void navigate({ to: '/p/$project', params: { project: project.slug } })
        },
        onError: (error) => {
          toast.error(t('projects.newProject.createFailed'), { description: errorMessage(error) })
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('projects.newProject.title')}</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="new-project-name">{t('projects.newProject.nameLabel')}</Label>
            <Input
              id="new-project-name"
              value={name}
              autoFocus
              placeholder="SaveMe App"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submit()
              }}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-project-slug">{t('projects.newProject.slugLabel')}</Label>
            <Input
              id="new-project-slug"
              value={slugDraft ?? effectiveSlug}
              placeholder="saveme-app"
              onChange={(event) => setSlugDraft(event.target.value)}
            />
          </div>
          <DialogDescription>{t('projects.newProject.description')}</DialogDescription>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={close}>
            {t('common.actions.cancel')}
          </Button>
          <Button
            size="sm"
            onClick={submit}
            disabled={create.isPending || name.trim().length === 0}
          >
            {create.isPending ? t('projects.newProject.creating') : t('projects.newProject.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
