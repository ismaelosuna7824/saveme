/**
 * Overrides de react-markdown.
 *
 * El objetivo funcional es inyectar `data-line` (la línea del markdown fuente)
 * en cada bloque renderizado: de ahí sale la sincronización de scroll del
 * editor. El objetivo estético es darle al markdown la misma piel terminal que
 * el resto de la app.
 */
import type { Components } from 'react-markdown'

import { CodeBlock } from '@/components/common/CodeBlock'
import { MermaidBlock } from '@/components/common/MermaidBlock'
import { isDiagramLanguage } from '@/lib/mermaid'

type PositionedNode = { position?: { start?: { line?: number } } }

/** Línea 1-based del nodo en el markdown original, si hast la conservó. */
function lineOf(node: PositionedNode | undefined): number | undefined {
  return node?.position?.start?.line
}

/** Nodo hast laxo: solo lo que necesitamos para extraer texto y clases. */
interface LooseHastNode {
  type: string
  value?: unknown
  tagName?: unknown
  properties?: unknown
  children?: readonly LooseHastNode[]
}

function textOf(node: LooseHastNode): string {
  if (node.type === 'text' && typeof node.value === 'string') return node.value
  if (node.children) return node.children.map(textOf).join('')
  return ''
}

function readClassNames(properties: unknown): string {
  if (typeof properties !== 'object' || properties === null) return ''
  const value: unknown = (properties as Record<string, unknown>)['className']
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string').join(' ')
  }
  return ''
}

function languageFromClass(className: string): string {
  const match = /language-([\w+#-]+)/.exec(className)
  return match ? match[1] : ''
}

/**
 * Construye los componentes con un desplazamiento de líneas.
 *
 * La preview renderiza solo el cuerpo (sin frontmatter), así que sus líneas son
 * relativas: `lineOffset` las devuelve al espacio de líneas del archivo
 * completo, que es el que usa CodeMirror.
 */
export function buildMarkdownComponents(lineOffset: number): Components {
  const line = (node: PositionedNode | undefined): number | undefined => {
    const value = lineOf(node)
    return value === undefined ? undefined : value + lineOffset
  }

  return {
    h1: ({ node, ...props }) => <h1 data-line={line(node)} {...props} />,
    h2: ({ node, ...props }) => <h2 data-line={line(node)} {...props} />,
    h3: ({ node, ...props }) => <h3 data-line={line(node)} {...props} />,
    h4: ({ node, ...props }) => <h4 data-line={line(node)} {...props} />,
    h5: ({ node, ...props }) => <h5 data-line={line(node)} {...props} />,
    h6: ({ node, ...props }) => <h6 data-line={line(node)} {...props} />,
    p: ({ node, ...props }) => <p data-line={line(node)} {...props} />,
    ul: ({ node, ...props }) => <ul data-line={line(node)} {...props} />,
    ol: ({ node, ...props }) => <ol data-line={line(node)} {...props} />,
    li: ({ node, ...props }) => <li data-line={line(node)} {...props} />,
    blockquote: ({ node, ...props }) => <blockquote data-line={line(node)} {...props} />,
    table: ({ node, ...props }) => (
      <div className="overflow-x-auto">
        <table data-line={line(node)} {...props} />
      </div>
    ),
    hr: ({ node, ...props }) => <hr data-line={line(node)} {...props} />,
    a: ({ node, ...props }) => (
      // Los enlaces salen del documento: se abren fuera de la ventana de la app.
      <a data-line={line(node)} target="_blank" rel="noreferrer noopener" {...props} />
    ),
    pre: ({ node, children, ...props }) => {
      const first = node?.children.find((child) => child.type === 'element')
      if (first && first.type === 'element' && first.tagName === 'code') {
        const code = textOf(first).replace(/\n$/, '')
        const lang = languageFromClass(readClassNames(first.properties))
        // Un diagrama no es código: se dibuja. Y si falla, el propio bloque se
        // encarga de enseñar el error y la fuente, sin tumbar la preview.
        if (isDiagramLanguage(lang)) {
          return <MermaidBlock code={code} dataLine={line(node)} />
        }
        return <CodeBlock code={code} lang={lang} dataLine={line(node)} />
      }
      return (
        <pre data-line={line(node)} {...props}>
          {children}
        </pre>
      )
    },
    code: ({ node, className, ...props }) => (
      <code data-line={line(node)} className={className ?? 'md-inline-code'} {...props} />
    ),
    // Las casillas de tarea de GFM llegan con `disabled`. Se quita, porque si no
    // el navegador no dispara ni el click y la tarea no se podría marcar.
    //
    // El clic NO se maneja aquí: se maneja por delegación en el contenedor
    // (`Markdown`), que es el único que puede traducir la línea del bloque a un
    // cambio en el documento. De ahí el `onChange` vacío: hace falta para que
    // React trate la casilla como controlada y su estado lo mande siempre el
    // markdown, nunca el DOM.
    input: ({ node, ...props }) =>
      props.type === 'checkbox' ? (
        <input
          type="checkbox"
          className="md-task"
          data-line={line(node)}
          checked={Boolean(props.checked)}
          onChange={() => {
            /* el cambio real lo produce la delegación de `Markdown` */
          }}
        />
      ) : (
        <input data-line={line(node)} {...props} />
      ),
  }
}
