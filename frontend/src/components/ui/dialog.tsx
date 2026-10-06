import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type * as React from 'react'

import { cn } from '@/lib/utils'

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogPortal = DialogPrimitive.Portal
const DialogClose = DialogPrimitive.Close

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      className={cn('ui-overlay fixed inset-0 z-50 bg-background/85 backdrop-blur-[1px]', className)}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        className={cn(
          'ui-pop term-panel fixed left-1/2 top-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-0 shadow-[0_0_0_1px_rgba(0,0,0,0.6),0_18px_50px_-12px_rgba(0,0,0,0.9)]',
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

/**
 * La X de cerrar, para ponerla **dentro** de la fila de cabecera.
 *
 * Antes iba en posición absoluta a 8px de la esquina, igual para todos los
 * diálogos. Como cada cabecera tiene su altura, la X quedaba descentrada respecto
 * al título —más baja— y en las cabeceras finas pisaba el borde inferior. Dentro
 * de la fila la centra el propio flex, mida lo que mida la cabecera. El margen
 * negativo vertical evita que el botón haga crecer una cabecera fina.
 */
function DialogCloseButton({ className }: { className?: string }) {
  return (
    <DialogPrimitive.Close
      className={cn(
        '-my-1 inline-flex shrink-0 items-center justify-center rounded-sm p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        className,
      )}
      aria-label="Cerrar"
    >
      <X className="size-3.5" />
    </DialogPrimitive.Close>
  )
}

/**
 * Cabecera estándar de un diálogo, con la X de cerrar al final de la fila.
 *
 * La X lleva `order-1` porque la cabecera pinta un `├` con `::after` empujado a
 * la derecha: sin el orden, la X quedaría entre el título y esa marca.
 */
function DialogHeader({
  className,
  children,
  showClose = true,
  ...props
}: React.ComponentProps<'div'> & { showClose?: boolean }) {
  return (
    <div className={cn('term-panel-header', className)} {...props}>
      {children}
      {showClose ? <DialogCloseButton className="order-1" /> : null}
    </div>
  )
}

function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex flex-col-reverse gap-2 border-t border-border px-3 py-2 sm:flex-row sm:justify-end',
        className,
      )}
      {...props}
    />
  )
}

function DialogBody({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('px-3 py-3 text-xs', className)} {...props} />
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn('text-2xs font-medium uppercase tracking-[0.14em] text-muted-foreground', className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn('text-xs text-muted-foreground', className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogBody,
  DialogClose,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
