import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { errorMessage } from '@/api/client'
import { useCategories, useUpdateSummaryMeta } from '@/api/queries'
import type { SummaryMeta } from '@/api/types'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { categoryLabel } from '@/features/projects/CategoryCounts'
import { useT } from '@/i18n'

/**
 * Corregir la categoría y el título de un resumen ya guardado.
 *
 * Hasta ahora solo se podía cambiar el **contenido**: si un agente archivaba algo
 * bajo `feature` y era un `fix`, había que mover el archivo a mano y reindexar. El
 * MCP sí puede redirigir una propuesta antes de confirmarla, pero después ya no.
 *
 * La categoría se elige de la taxonomía y no se escribe a mano: escribirla libre
 * crearía carpetas que el reconciliador no reconoce, y el resumen acabaría en
 * «sin categoría» sin que nadie lo entienda.
 */
export function EditMetaDialog({
  summary,
  open,
  onOpenChange,
}: {
  summary: SummaryMeta
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const t = useT()
  const categorias = useCategories()
  const guardar = useUpdateSummaryMeta()

  const [title, setTitle] = useState(summary.title)
  const [category, setCategory] = useState(summary.category)

  // Cada vez que se abre, se parte de lo que hay: si no, reabrir después de
  // cancelar enseñaría los cambios que no se guardaron.
  useEffect(() => {
    if (open) {
      setTitle(summary.title)
      setCategory(summary.category)
    }
  }, [open, summary.title, summary.category])

  const sinCambios = title.trim() === summary.title && category === summary.category

  const onSubmit = () => {
    guardar.mutate(
      { id: summary.id, category, title: title.trim() },
      {
        onSuccess: (next) => {
          onOpenChange(false)
          toast.success(t('editor.meta.saved'), { description: next.rel_path })
        },
        onError: (error) => {
          toast.error(t('editor.meta.failed'), { description: errorMessage(error) })
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{t('editor.meta.title')}</DialogTitle>
        <DialogDescription>{t('editor.meta.description')}</DialogDescription>

        <div className="space-y-3">
          <label className="block space-y-1">
            <span className="text-2xs uppercase tracking-[0.14em] text-muted-foreground">
              {t('editor.meta.titleLabel')}
            </span>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>

          <div className="space-y-1">
            <span className="text-2xs uppercase tracking-[0.14em] text-muted-foreground">
              {t('editor.meta.categoryLabel')}
            </span>
            <div className="flex flex-wrap gap-1">
              {(categorias.data ?? []).map((cat) => (
                <Button
                  key={cat.key}
                  size="sm"
                  variant={cat.key === category ? 'default' : 'outline'}
                  onClick={() => setCategory(cat.key)}
                >
                  {categoryLabel(t, cat.key, cat.label)}
                </Button>
              ))}
            </div>
          </div>

          {/* Se avisa de que la ruta cambia: mover el archivo es lo que cambia la
              categoría, y enterarse después de que el resumen se mudó de carpeta
              sería desconcertante. */}
          {category !== summary.category ? (
            <p className="text-2xs text-muted-foreground">{t('editor.meta.moves')}</p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            {t('common.actions.cancel')}
          </Button>
          <Button
            size="sm"
            disabled={sinCambios || title.trim() === '' || guardar.isPending}
            onClick={onSubmit}
          >
            {t('editor.meta.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
