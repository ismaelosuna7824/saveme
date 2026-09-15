import { Toaster as SonnerToaster, type ToasterProps } from 'sonner'

/**
 * Toaster con la paleta terminal. Las variables que sonner usa internamente
 * (`--normal-bg`, ...) se fijan en styles.css sobre `[data-sonner-toaster]`.
 */
function Toaster(props: ToasterProps) {
  return (
    <SonnerToaster
      theme="dark"
      position="bottom-right"
      closeButton
      toastOptions={{
        classNames: {
          toast:
            'group border border-border bg-panel text-foreground rounded-sm font-mono text-xs shadow-xl',
          title: 'text-xs text-foreground',
          description: 'text-2xs text-muted-foreground',
          actionButton: 'bg-primary text-primary-foreground rounded-sm text-2xs',
          cancelButton: 'bg-accent text-accent-foreground rounded-sm text-2xs',
          error: 'border-destructive/40',
          success: 'border-secondary/40',
          warning: 'border-primary/40',
          closeButton: 'border-border bg-panel text-muted-foreground',
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
