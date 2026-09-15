import { useMemo } from 'react'

import { highlightCode } from '@/lib/highlighter'

interface CodeBlockProps {
  code: string
  lang: string
  /** Línea del markdown fuente, para la sincronización de scroll. */
  dataLine?: number
}

/**
 * Bloque de código con resaltado.
 *
 * Shiki devuelve HTML con las clases de color ya resueltas; se inyecta tal cual
 * (el texto va escapado por shiki). Si el lenguaje no está cargado se degrada a
 * `<pre><code>` plano en vez de romper la preview.
 */
export function CodeBlock({ code, lang, dataLine }: CodeBlockProps) {
  const html = useMemo(() => highlightCode(code, lang), [code, lang])

  return (
    <div className="code-block" data-line={dataLine}>
      <div className="code-block__bar">{lang.length > 0 ? lang : 'texto'}</div>
      {html ? (
        <div dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre>
          <code>{code}</code>
        </pre>
      )}
    </div>
  )
}
