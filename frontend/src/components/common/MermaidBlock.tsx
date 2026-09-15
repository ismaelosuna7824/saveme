import { useEffect, useState } from 'react'
import { Code2, TriangleAlert } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'
import { renderDiagram } from '@/lib/mermaid'

interface MermaidBlockProps {
  code: string
  /** Línea del markdown fuente, para la sincronización de scroll. */
  dataLine?: number
}

type State =
  | { status: 'loading' }
  | { status: 'ok'; svg: string }
  | { status: 'error'; error: string }

/**
 * Cambia cuando cambia el tema del documento.
 *
 * Hace falta porque el SVG se genera con los colores **incrustados**: cambiar de
 * tema no recolorea un diagrama ya dibujado, hay que volver a renderizarlo.
 * Mientras no exista SVG esto devuelve una cadena vacía, que como dependencia de
 * `useEffect` se comporta igual.
 */
function useDocumentTheme(): string {
  const [theme, setTheme] = useState(
    () => (typeof document === 'undefined' ? '' : (document.documentElement.dataset['theme'] ?? '')),
  )

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setTheme(document.documentElement.dataset['theme'] ?? '')
    })
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })
    return () => {
      observer.disconnect()
    }
  }, [])

  return theme
}

/**
 * Diagrama Mermaid.
 *
 * Tres cosas que no son obvias:
 *
 *  - **Un diagrama roto no rompe la preview.** Si la sintaxis falla, se enseña el
 *    error y el código fuente, y el resto del documento sigue renderizándose. Un
 *    diagrama a medio escribir es el estado más común mientras se escribe.
 *  - **El SVG se inyecta con `dangerouslySetInnerHTML`**, pero no es HTML del
 *    documento: lo genera Mermaid a partir del código, y con `securityLevel:
 *    'strict'` las etiquetas van saneadas. El texto del diagrama viene de un
 *    archivo que puede haber escrito un agente, así que ese modo no es opcional.
 *  - **Se vuelve a renderizar al cambiar de tema**, porque el SVG lleva los
 *    colores dentro. El código fuente siempre está a un clic: un diagrama que no
 *    se puede leer es peor que el texto que lo describe.
 */
export function MermaidBlock({ code, dataLine }: MermaidBlockProps) {
  const t = useT()
  const theme = useDocumentTheme()
  const [state, setState] = useState<State>({ status: 'loading' })
  const [showSource, setShowSource] = useState(false)

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })

    void renderDiagram(code).then((result) => {
      // El componente puede haberse ido —o haber cambiado el código— mientras
      // Mermaid dibujaba; sin esto se escribiría estado en un árbol muerto.
      if (cancelled) return
      if (result.svg !== undefined) setState({ status: 'ok', svg: result.svg })
      else setState({ status: 'error', error: result.error ?? '' })
    })

    return () => {
      cancelled = true
    }
  }, [code, theme])

  const sourceVisible = showSource || state.status === 'error'

  return (
    <div className="code-block mermaid-block" data-line={dataLine} data-diagram="mermaid">
      <div className="code-block__bar">
        <span>mermaid</span>
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto"
          aria-expanded={sourceVisible}
          title={sourceVisible ? t('editor.mermaid.hideSource') : t('editor.mermaid.showSource')}
          aria-label={sourceVisible ? t('editor.mermaid.hideSource') : t('editor.mermaid.showSource')}
          onClick={() => setShowSource((previous) => !previous)}
        >
          <Code2 className="size-3" />
        </Button>
      </div>

      {state.status === 'loading' ? (
        <p className="mermaid-block__note">{t('editor.mermaid.rendering')}</p>
      ) : null}

      {state.status === 'error' ? (
        <p className="mermaid-block__error">
          <TriangleAlert className="size-3 shrink-0" />
          <span>
            {t('editor.mermaid.error')}
            {state.error.length > 0 ? `: ${state.error}` : ''}
          </span>
        </p>
      ) : null}

      {state.status === 'ok' ? (
        <div
          className="mermaid-block__canvas"
          // Ver la nota del componente: SVG generado por Mermaid, con las
          // etiquetas saneadas por `securityLevel: 'strict'`.
          dangerouslySetInnerHTML={{ __html: state.svg }}
        />
      ) : null}

      {sourceVisible ? (
        <pre className="mermaid-block__source">
          <code>{code}</code>
        </pre>
      ) : null}
    </div>
  )
}
