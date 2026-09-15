import type { ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog'
import { useT } from '@/i18n'

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Lo que va a pasar, en una línea. Debería nombrar el objeto concreto. */
  title: string
  /** Por qué, o qué consecuencias tiene. Es lo que hace decidir bien. */
  description: ReactNode
  confirmLabel?: string
  /** Texto del botón que no hace nada. Por defecto, «cancelar». */
  cancelLabel?: string
  /** La acción es destructiva: el botón se pinta en rojo. */
  destructive?: boolean
  pending?: boolean
  onConfirm: () => void
}

/**
 * Confirmación para acciones que no se pueden deshacer de un clic.
 *
 * Se construye sobre el `Dialog` que ya existe en vez de traer un
 * `AlertDialog`: la app tiene una sola forma de diálogo —el marco de terminal con
 * su cabecera— y meter un segundo primitivo por una confirmación habría dejado
 * dos estilos para lo mismo.
 *
 * El botón de confirmar **no se deshabilita solo**: mientras la acción está en
 * marcha se muestra `pending`, y el cierre lo decide quien lo usa. Deshabilitarlo
 * en el primer clic escondería el caso raro en el que la acción falla y el
 * diálogo se queda abierto: el usuario tiene que poder volver a intentarlo.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  destructive = false,
  pending = false,
  onConfirm,
}: ConfirmDialogProps) {
  const t = useT()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <TriangleAlert
            className={destructive ? 'size-3 text-destructive' : 'size-3 text-primary'}
          />
          {title}
        </DialogHeader>

        <DialogBody className="space-y-2">
          <div className="text-xs text-muted-foreground">{description}</div>
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={pending}>
            {cancelLabel ?? t('common.actions.cancel')}
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'outline'}
            size="sm"
            onClick={onConfirm}
            disabled={pending}
          >
            {confirmLabel ?? t('common.actions.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
