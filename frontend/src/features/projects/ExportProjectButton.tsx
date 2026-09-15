import { useState } from 'react'
import { toast } from 'sonner'
import { FileDown } from 'lucide-react'

import { api, errorMessage } from '@/api/client'
import type { ProjectExport } from '@/api/types'
import { Button } from '@/components/ui/button'
import { exportFileName, buildProjectMarkdown } from '@/features/projects/exportMarkdown'
import { useT } from '@/i18n'

/**
 * Descarga el proyecto entero como un solo markdown.
 *
 * Existe para poder enseñar el diario a alguien que no tiene SaveMe: un fichero,
 * sin la aplicación y sin el índice. Se pide al pulsar y no antes —son todos los
 * cuerpos del proyecto en una respuesta— y se compone aquí, que es donde se sabe
 * en qué idioma están los títulos.
 */
export function ExportProjectButton({ slug }: { slug: string }) {
  const t = useT()
  const [busy, setBusy] = useState(false)

  const run = async () => {
    setBusy(true)
    try {
      const data = await api.get<ProjectExport>(
        `/projects/${encodeURIComponent(slug)}/export`,
      )
      const markdown = buildProjectMarkdown(data, t)
      const nombre = exportFileName(slug, data.generated_at)

      const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const enlace = document.createElement('a')
      enlace.href = url
      enlace.download = nombre
      document.body.append(enlace)
      enlace.click()
      enlace.remove()
      // Revocar en el mismo tick puede cancelar la descarga en algunos motores:
      // el navegador todavía no ha leído el blob.
      setTimeout(() => URL.revokeObjectURL(url), 1000)

      toast.success(t('projects.export.done'), {
        description:
          data.skipped > 0
            ? t('projects.export.doneSkipped', { count: data.count, skipped: data.skipped })
            : t('projects.export.doneCount', { count: data.count }),
      })
    } catch (error) {
      toast.error(t('projects.export.failed'), { description: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      disabled={busy}
      onClick={() => void run()}
      title={t('projects.export.action')}
      aria-label={t('projects.export.action')}
    >
      <FileDown className="size-3" />
    </Button>
  )
}
