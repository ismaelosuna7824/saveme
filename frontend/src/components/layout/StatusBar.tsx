import { useMemo } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { Folder } from 'lucide-react'

import { useConfig } from '@/api/queries'
import { useT } from '@/i18n'

interface Atajo {
  keys: string
  label: string
}

/**
 * Atajos que aplican en la pantalla actual.
 *
 * La lista es corta a propósito y solo anuncia teclas **registradas de verdad en
 * esa pantalla**. La hoja de `?` los enumera todos sin distinguir, y eso vale
 * para descubrirlos, pero una barra que diga «⌘S guardar» en el inbox está
 * mintiendo: `⌘S` y `Esc` los registra `EditorPage`, y en el resto de la app no
 * existen. Lo mismo con `?` dentro de un editor: `ShortcutsDialog` lo ignora
 * mientras el foco esté en un campo de texto, y el contenido de CodeMirror lo es.
 */
function useAtajosDePantalla(): Atajo[] {
  const t = useT()
  const pathname = useRouterState({ select: (state) => state.location.pathname })

  return useMemo(() => {
    const segmentos = pathname.split('/').filter((segmento) => segmento.length > 0)
    const esEditorDeResumen = segmentos[0] === 's'
    const esEditorDeNota = segmentos[0] === 'notes'
    const editando = esEditorDeResumen || esEditorDeNota

    const atajos: Atajo[] = []

    // Solo el editor de resúmenes guarda a mano (`EditorPage` escucha `⌘S` y
    // `Esc`). El de notas guarda solo y no escucha `Esc`: su `Esc` lo consume
    // CodeMirror para salir de los modos de vim.
    if (esEditorDeResumen) {
      atajos.push({ keys: '⌘S', label: t('shell.shortcuts.save') })
      atajos.push({ keys: 'Esc', label: t('common.actions.back') })
    }

    if (editando) {
      atajos.push({ keys: '⌘E', label: t('shell.shortcuts.cycleMode') })
    }

    atajos.push({ keys: '⌘K', label: t('shell.shortcuts.palette') })

    if (!editando) {
      atajos.push({ keys: '?', label: t('shell.shortcuts.help') })
    }

    return atajos
  }, [pathname, t])
}

/**
 * Barra de estado inferior: los atajos que valen aquí y el workspace abierto.
 *
 * Va abajo y no arriba porque la superior ya está llena —migas, estado del core,
 * reindexar, tema, ajustes y la paleta—, y porque una barra de atajos es
 * información de contexto: se consulta, no se lee. La derecha muestra la raíz del
 * workspace, que no se veía en ningún otro sitio de la app y es justo lo que hay
 * que saber cuando alguien ha movido la carpeta.
 */
export function StatusBar() {
  const t = useT()
  const atajos = useAtajosDePantalla()
  const config = useConfig()
  const root = config.data?.root_dir ?? ''

  return (
    <footer className="flex h-6 shrink-0 items-center gap-3 border-t border-border bg-panel px-3 text-2xs text-muted-foreground">
      <nav className="flex min-w-0 items-center gap-3" aria-label={t('shell.shortcuts.title')}>
        {atajos.map((atajo) => (
          <span key={atajo.keys} className="flex shrink-0 items-center gap-1">
            <kbd className="rounded-sm border border-border px-1 font-mono text-2xs text-primary/85">
              {atajo.keys}
            </kbd>
            <span className="hidden truncate sm:inline">{atajo.label}</span>
          </span>
        ))}
      </nav>

      {root.length > 0 ? (
        <span className="ml-auto flex min-w-0 shrink items-center gap-1.5" title={root}>
          <Folder className="size-3 shrink-0" />
          {/* Se recorta por la derecha y el `title` lleva la ruta entera. El truco
              de darle la vuelta con `dir="rtl"` para cortar por la izquierda deja
              los signos de puntuación a merced del navegador, y aquí lo que
              importa es que se lea igual en todas partes. */}
          <span className="max-w-[36ch] truncate font-mono">{root}</span>
        </span>
      ) : null}
    </footer>
  )
}
