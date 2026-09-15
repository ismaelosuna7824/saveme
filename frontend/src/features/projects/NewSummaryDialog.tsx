import { useState } from 'react'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'

import { errorMessage } from '@/api/client'
import { useCategories, useCreateSummary } from '@/api/queries'
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
import { Textarea } from '@/components/ui/textarea'
import { categoryLabel } from '@/features/projects/CategoryCounts'
import { useT } from '@/i18n'

/**
 * Escribir un resumen desde la app.
 *
 * Hasta ahora la interfaz era la única puerta por la que **no** se podía escribir:
 * un resumen entraba si lo proponía un agente o si lo tecleabas en la terminal.
 * No añade capacidad nueva —el camino de dos fases ya estaba entero—, solo quita
 * la que faltaba.
 *
 * Trae su propio botón para que montarlo sea una línea: el diálogo vive aquí y no
 * en el proyecto, que no tiene por qué saber qué diálogos existen.
 */
export function NewSummaryDialog({ project }: { project: string }) {
  const t = useT()
  const categorias = useCategories()
  const crear = useCreateSummary()

  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('')
  const [body, setBody] = useState('')

  // La categoría se elige de la taxonomía y no se escribe a mano: una inventada
  // crearía una carpeta que el reconciliador no reconoce. Vacío significa
  // «infiere tú», que es lo que hace el núcleo con el texto.
  const guardar = () => {
    crear.mutate(
      { project, title: title.trim(), body, category, tags: [] },
      {
        onSuccess: (res) => {
          setOpen(false)
          setTitle('')
          setCategory('')
          setBody('')
          toast.success(
            res.created ? t('projects.newSummary.saved') : t('projects.newSummary.already'),
            { description: res.rel_path },
          )
        },
        onError: (error) => {
          toast.error(t('projects.newSummary.failed'), { description: errorMessage(error) })
        },
      },
    )
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => setOpen(true)}
        title={t('projects.newSummary.action')}
        aria-label={t('projects.newSummary.action')}
      >
        <Plus className="size-3" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t('projects.newSummary.title')}</DialogTitle>
          </DialogHeader>

          <DialogBody className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="new-summary-title">{t('projects.newSummary.titleLabel')}</Label>
              <Input
                id="new-summary-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
              />
            </div>

            <div className="space-y-1">
              <Label>{t('projects.newSummary.categoryLabel')}</Label>
              <div className="flex flex-wrap gap-1">
                {(categorias.data ?? []).map((cat) => (
                  <Button
                    key={cat.key}
                    size="sm"
                    variant={cat.key === category ? 'default' : 'outline'}
                    onClick={() => setCategory(cat.key === category ? '' : cat.key)}
                  >
                    {categoryLabel(t, cat.key, cat.label)}
                  </Button>
                ))}
              </div>
              {/* La categoría vacía no es «sin elegir»: es una decisión, y se dice
                  cuál para que no parezca que falta rellenar algo. */}
              <p className="text-2xs text-muted-foreground">
                {category === ''
                  ? t('projects.newSummary.inferHint')
                  : t('projects.newSummary.chosenHint')}
              </p>
            </div>

            <div className="space-y-1">
              <Label htmlFor="new-summary-body">{t('projects.newSummary.bodyLabel')}</Label>
              <Textarea
                id="new-summary-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={12}
                className="font-mono text-xs"
              />
            </div>

            {/* La explicación va al final y no debajo del título: se lee cuando ya
                se sabe qué hay que rellenar, y así no empuja los campos. */}
            <DialogDescription>{t('projects.newSummary.description')}</DialogDescription>
          </DialogBody>

          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              {t('common.actions.cancel')}
            </Button>
            <Button
              size="sm"
              disabled={title.trim() === '' || body.trim() === '' || crear.isPending}
              onClick={guardar}
            >
              {t('projects.newSummary.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
