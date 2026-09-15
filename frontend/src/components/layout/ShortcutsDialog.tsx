import { useEffect, useState } from 'react'

import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useT } from '@/i18n'

/**
 * La hoja de atajos, con `?`.
 *
 * La app tiene `⌘K` y `⌘E` desde el principio y no había forma de descubrirlos
 * salvo que alguien te lo contara. Una tecla que los liste es lo que convierte los
 * atajos en algo que se usa en vez de en algo que existe.
 *
 * No se registra en `useGlobalShortcuts` porque ese hook vive en el `AppShell` y
 * esto se gobierna solo: el diálogo sabe cuándo está abierto, y así el día que se
 * monte en otro sitio sigue funcionando.
 */
export function ShortcutsDialog() {
  const t = useT()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '?') return

      // Escribiendo, una interrogación es una interrogación. Sin esto, el atajo
      // secuestraría el signo en el editor y en cualquier campo de texto.
      const target = event.target as HTMLElement | null
      if (
        target !== null &&
        (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
      ) {
        return
      }

      event.preventDefault()
      setOpen((abierto) => !abierto)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const atajos = [
    { keys: '⌘K', label: t('shell.shortcuts.palette') },
    { keys: '⌘E', label: t('shell.shortcuts.cycleMode') },
    { keys: '⌘S', label: t('shell.shortcuts.save') },
    { keys: '?', label: t('shell.shortcuts.help') },
    { keys: 'Esc', label: t('shell.shortcuts.close') },
  ]

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('shell.shortcuts.title')}</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-1">
          {atajos.map((atajo) => (
            <div
              key={atajo.keys}
              className="flex items-baseline justify-between gap-3 border-b border-border pb-1 last:border-b-0"
            >
              <span className="text-xs text-foreground">{atajo.label}</span>
              <kbd className="shrink-0 rounded-sm border border-border px-1.5 py-0.5 font-mono text-2xs text-muted-foreground">
                {atajo.keys}
              </kbd>
            </div>
          ))}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
