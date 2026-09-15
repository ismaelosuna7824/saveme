import { useEffect, useRef } from 'react'

export interface UseAutosaveArgs {
  /** Texto vivo: cada cambio reinicia el temporizador. */
  content: string
  savedContent: string
  delayMs: number
  enabled: boolean
  onSave: () => void
}

/**
 * Guardado automático con debounce (`config.editor.autosave_ms`, 1200 ms por
 * defecto). El temporizador se reinicia en cada pulsación, así que no se guarda
 * a mitad de una frase.
 */
export function useAutosave({
  content,
  savedContent,
  delayMs,
  enabled,
  onSave,
}: UseAutosaveArgs): void {
  const saveRef = useRef(onSave)

  useEffect(() => {
    saveRef.current = onSave
  })

  useEffect(() => {
    if (!enabled) return
    if (content === savedContent) return

    const timer = setTimeout(() => saveRef.current(), delayMs)
    return () => clearTimeout(timer)
  }, [content, savedContent, delayMs, enabled])
}
