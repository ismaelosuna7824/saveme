import { createFileRoute } from '@tanstack/react-router'
import { FileText } from 'lucide-react'

import { useT } from '@/i18n'

export const Route = createFileRoute('/notes/')({
  component: NotesIndex,
})

/** Cuando no hay ninguna nota abierta: el árbol está en la barra lateral. */
function NotesIndex() {
  const t = useT()
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      <FileText className="size-5 text-muted-foreground" />
      <p className="text-xs text-muted-foreground">{t('notes.pickOne')}</p>
      <p className="max-w-sm text-2xs text-muted-foreground">{t('notes.pickOneHint')}</p>
    </div>
  )
}
