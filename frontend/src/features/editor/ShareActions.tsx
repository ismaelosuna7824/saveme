import { useState } from 'react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { AtSign, ClipboardCopy, ExternalLink, FileDown, Mail, Share2 } from 'lucide-react'
import { toast } from 'sonner'

import { errorMessage, IN_TAURI } from '@/api/client'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  shareDocument,
  shareFileName,
  shareUrl,
  type ShareTarget,
} from '@/features/editor/shareMarkdown'
import { useT } from '@/i18n'
import { copyToClipboard } from '@/lib/hooks'
import { saveMarkdownFile } from '@/lib/saveText'

export interface ShareActionsProps {
  /** Título actual (el borrador de la barra), que manda sobre el guardado. */
  title: string
  /** Contenido actual del editor, con frontmatter. */
  content: string
  relPath: string
  id: string
}

/**
 * Sacar un resumen de SaveMe: guardarlo como `.md` o compartirlo.
 *
 * Se trabaja con lo que hay en el editor, no con lo guardado: lo que se comparte
 * es lo que el usuario está viendo. El documento se monta al pulsar y no en cada
 * pulsación de tecla.
 *
 * Slack, Teams y Discord no tienen una dirección para publicar desde fuera, pero
 * entienden el markdown pegado, así que para ellos se copia. X, LinkedIn y el
 * correo sí la tienen y se abren con el texto puesto. Facebook no admite texto en
 * su dirección de compartir (solo enlaces): se copia y se abre para pegarlo.
 */
export function ShareActions({ title, content, relPath, id }: ShareActionsProps) {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const fileName = shareFileName(relPath, id)

  const download = async () => {
    setBusy(true)
    try {
      const doc = shareDocument(title, content)
      const saved = await saveMarkdownFile(fileName, doc.markdown, t('editor.share.filterName'))
      if (saved === null) return
      toast.success(t('editor.share.downloaded'), {
        description: saved.path ?? t('editor.share.downloadedBrowser', { file: fileName }),
      })
    } catch (error) {
      toast.error(t('editor.share.downloadFailed'), { description: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  const copy = async (text: string, hint?: string) => {
    if (await copyToClipboard(text)) toast.success(t('editor.share.copied'), { description: hint })
    else toast.error(t('editor.share.copyFailed'))
  }

  // Dentro de Tauri el webview no abre ventanas: la URL se la pasa al navegador
  // del sistema el plugin, que solo admite las direcciones de compartir.
  const open = async (url: string) => {
    try {
      if (IN_TAURI) await openUrl(url)
      else window.open(url, '_blank', 'noopener,noreferrer')
    } catch (error) {
      toast.error(t('editor.share.openFailed'), { description: errorMessage(error) })
    }
  }

  const post = (target: ShareTarget) => void open(shareUrl(target, shareDocument(title, content)))

  const facebook = async () => {
    if (!(await copyToClipboard(shareDocument(title, content).text))) {
      toast.error(t('editor.share.copyFailed'))
      return
    }
    toast.success(t('editor.share.facebookCopied'), { description: t('editor.share.facebookHint') })
    await open('https://www.facebook.com/')
  }

  // La hoja de compartir del sistema solo existe donde el webview la implementa;
  // donde no, la opción no se enseña.
  const canSystemShare = typeof navigator.share === 'function'
  const systemShare = async () => {
    const doc = shareDocument(title, content)
    const file = new File([doc.markdown], fileName, { type: 'text/markdown' })
    try {
      if (navigator.canShare?.({ files: [file] }) === true) {
        await navigator.share({ title: doc.title, files: [file] })
      } else {
        await navigator.share({ title: doc.title, text: doc.markdown })
      }
    } catch (error) {
      // Cerrar la hoja sin elegir nada no es un fallo.
      if (error instanceof DOMException && error.name === 'AbortError') return
      toast.error(t('editor.share.openFailed'), { description: errorMessage(error) })
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={busy}
        onClick={() => void download()}
        title={t('editor.share.download')}
        aria-label={t('editor.share.download')}
      >
        <FileDown className="size-3" />
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            title={t('editor.share.action')}
            aria-label={t('editor.share.action')}
          >
            <Share2 className="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[15rem]">
          <DropdownMenuItem onSelect={() => void download()}>
            <FileDown />
            {t('editor.share.download')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>{t('editor.share.heading')}</DropdownMenuLabel>
          <DropdownMenuItem
            onSelect={() =>
              void copy(shareDocument(title, content).markdown, t('editor.share.copiedSlack'))
            }
          >
            <ClipboardCopy />
            {t('editor.share.copyMarkdown')}
            <DropdownMenuShortcut>{t('editor.share.copyMarkdownHint')}</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void copy(shareDocument(title, content).text)}>
            <ClipboardCopy />
            {t('editor.share.copyText')}
            <DropdownMenuShortcut>{t('editor.share.copyTextHint')}</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => post('x')}>
            <AtSign />
            {t('editor.share.x')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => post('linkedin')}>
            <ExternalLink />
            {t('editor.share.linkedin')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void facebook()}>
            <ExternalLink />
            {t('editor.share.facebook')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => post('email')}>
            <Mail />
            {t('editor.share.email')}
          </DropdownMenuItem>
          {canSystemShare ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void systemShare()}>
                <Share2 />
                {t('editor.share.system')}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}
