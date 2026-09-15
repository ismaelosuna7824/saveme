import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Check, Copy } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'
import { copyToClipboard } from '@/lib/hooks'
import { cn } from '@/lib/utils'

interface CopyFieldProps {
  /** Rótulo en mayúsculas del bloque. */
  label: string
  /** Texto exacto que se copia y se muestra. */
  value: string
  hint?: string
  /** Máximo de líneas visibles antes de hacer scroll. */
  maxLines?: number
  className?: string
}

/**
 * Bloque de texto con botón de copiar.
 *
 * Si el portapapeles no está disponible (permiso denegado, contexto no seguro,
 * WebView sin soporte) no se miente diciendo «copiado»: se selecciona el texto
 * para que el usuario lo copie a mano.
 */
export function CopyField({ label, value, hint, maxLines = 10, className }: CopyFieldProps) {
  const t = useT()
  const textRef = useRef<HTMLPreElement | null>(null)
  const timerRef = useRef<number | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    },
    [],
  )

  const selectAll = () => {
    const node = textRef.current
    if (node === null) return
    const range = document.createRange()
    range.selectNodeContents(node)
    const selection = window.getSelection()
    if (selection === null) return
    selection.removeAllRanges()
    selection.addRange(range)
  }

  const copy = async () => {
    const ok = await copyToClipboard(value)
    if (ok) {
      setCopied(true)
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => setCopied(false), 1600)
      toast.success(t('onboarding.copy.success'))
      return
    }
    selectAll()
    toast.error(t('onboarding.copy.error'), {
      description: t('onboarding.copy.errorHint'),
    })
  }

  return (
    <div className={cn('border border-border bg-sunken', className)}>
      <div className="flex items-center gap-2 border-b border-border px-2 py-1">
        <span className="truncate text-2xs uppercase tracking-[0.12em] text-muted-foreground">
          {label}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto shrink-0"
          onClick={() => void copy()}
        >
          {copied ? <Check className="size-3 text-secondary" /> : <Copy className="size-3" />}
          {copied ? t('common.actions.copied') : t('common.actions.copy')}
        </Button>
      </div>
      {hint ? <p className="px-2 pt-1 text-2xs text-muted-foreground">{hint}</p> : null}
      <pre
        ref={textRef}
        style={{ maxHeight: `${maxLines * 1.6}em` }}
        className="overflow-auto px-2 py-1.5 text-xs leading-relaxed whitespace-pre-wrap break-words text-secondary"
      >
        {value}
      </pre>
    </div>
  )
}
