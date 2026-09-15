import { useState } from 'react'
import { toast } from 'sonner'
import { FileText } from 'lucide-react'

import { api, errorMessage, IN_TAURI } from '@/api/client'
import { useChangelog } from '@/api/queries'
import type { Changelog } from '@/api/types'
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
import { buildChangelogMarkdown, changelogFileName } from '@/features/projects/changelogMarkdown'
import { useT } from '@/i18n'

/** Fecha de hoy en AAAA-MM-DD, en la zona del usuario. */
function hoyLocal(): string {
  const ahora = new Date()
  const mes = String(ahora.getMonth() + 1).padStart(2, '0')
  const dia = String(ahora.getDate()).padStart(2, '0')
  return `${ahora.getFullYear()}-${mes}-${dia}`
}

/** Hace `dias` días, en AAAA-MM-DD. */
function haceDias(dias: number): string {
  const fecha = new Date()
  fecha.setDate(fecha.getDate() - dias)
  const mes = String(fecha.getMonth() + 1).padStart(2, '0')
  const dia = String(fecha.getDate()).padStart(2, '0')
  return `${fecha.getFullYear()}-${mes}-${dia}`
}

/**
 * Saca las notas de versión de un proyecto como markdown.
 *
 * El rango se elige aquí en vez de exportar siempre lo mismo porque unas notas de
 * versión son de una entrega concreta: entre la etiqueta anterior y la de ahora.
 * Los dos campos vienen rellenos con lo que suele hacer falta —el último mes— para
 * que el caso corriente sea pulsar y listo.
 *
 * Donde se guarda lo decide el usuario, con la ventana de «guardar como» del
 * sistema, igual que en la exportación: el sitio razonable no es el mismo para
 * todo el mundo.
 */
export function ChangelogButton({ slug }: { slug: string }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [desde, setDesde] = useState(() => haceDias(30))
  const [hasta, setHasta] = useState(hoyLocal)
  const [busy, setBusy] = useState(false)

  // La vista previa se pide mientras se eligen las fechas: así se ve cuántas
  // entradas van a salir antes de guardar el fichero, y un rango mal puesto se
  // nota en el momento en vez de en el documento.
  const preview = useChangelog(open ? slug : '', desde, hasta)

  const run = async () => {
    setBusy(true)
    try {
      const data = await api.get<Changelog>(
        `/projects/${encodeURIComponent(slug)}/changelog?since=${desde}&until=${hasta}`,
      )
      const markdown = buildChangelogMarkdown(data, t)
      const nombre = changelogFileName(slug, data.to)

      if (IN_TAURI) {
        const { save } = await import('@tauri-apps/plugin-dialog')
        const destino = await save({
          defaultPath: nombre,
          filters: [{ name: t('projects.changelog.filterName'), extensions: ['md'] }],
        })
        // Cancelar no es un fallo: es el usuario diciendo que no.
        if (destino === null) return

        const { invoke } = await import('@tauri-apps/api/core')
        await invoke('save_text_file', { path: destino, contents: markdown })

        toast.success(t('projects.changelog.done'), {
          description: t('projects.changelog.doneCount', { count: data.count }),
        })
      } else {
        const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const enlace = document.createElement('a')
        enlace.href = url
        enlace.download = nombre
        document.body.append(enlace)
        enlace.click()
        enlace.remove()
        setTimeout(() => URL.revokeObjectURL(url), 1000)

        toast.success(t('projects.changelog.done'), {
          description: t('projects.changelog.doneCount', { count: data.count }),
        })
      }
      setOpen(false)
    } catch (error) {
      toast.error(t('projects.changelog.failed'), { description: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => setOpen(true)}
        title={t('projects.changelog.action')}
        aria-label={t('projects.changelog.action')}
      >
        <FileText className="size-3" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('projects.changelog.title')}</DialogTitle>
            <DialogDescription>
              {t('projects.changelog.description', { project: slug })}
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="space-y-3">
            <div className="grid gap-1.5 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="changelog-since">{t('projects.changelog.since')}</Label>
                <Input
                  id="changelog-since"
                  type="date"
                  value={desde}
                  max={hasta}
                  onChange={(event) => setDesde(event.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="changelog-until">{t('projects.changelog.until')}</Label>
                <Input
                  id="changelog-until"
                  type="date"
                  value={hasta}
                  min={desde}
                  onChange={(event) => setHasta(event.target.value)}
                />
              </div>
            </div>

            <p className="text-2xs text-muted-foreground" aria-live="polite">
              {preview.isLoading
                ? t('common.state.loading')
                : preview.data
                  ? preview.data.count === 0
                    ? t('projects.changelog.previewEmpty')
                    : t('projects.changelog.preview', {
                        count: preview.data.count,
                        sections: preview.data.sections.length,
                      })
                  : t('projects.changelog.previewFailed')}
            </p>
          </DialogBody>

          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              {t('common.actions.cancel')}
            </Button>
            <Button
              size="sm"
              disabled={busy || (preview.data?.count ?? 0) === 0}
              onClick={() => void run()}
            >
              {busy ? t('common.state.saving') : t('projects.changelog.download')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
