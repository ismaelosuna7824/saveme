/**
 * Un resumen preparado para salir de SaveMe: guardarlo como fichero o publicarlo.
 *
 * Funciones puras, sin React ni Tauri, para que la guardia
 * (`scripts/verify-share.mjs`) las pueda probar a palo seco.
 *
 * El markdown que sale **no lleva frontmatter**, igual que la exportación del
 * proyecto: el documento es para leerlo o pegarlo en otro sitio, no para volver a
 * indexarlo. El título, que vive en el frontmatter, pasa a ser el `#` de arriba.
 */
import { splitFrontmatter } from '@/features/editor/frontmatter'

/** Límite de un post de X. Se deja margen: X cuenta algunos caracteres doble. */
const X_LIMIT = 270
/** Límite del texto de una publicación de LinkedIn. */
const LINKEDIN_LIMIT = 3000

/** Destinos que se abren en el navegador con el texto ya puesto. */
export type ShareTarget = 'x' | 'linkedin' | 'email'

export interface ShareDocument {
  title: string
  /** Markdown con el título como `#` y sin frontmatter. */
  markdown: string
  /** El documento entero en texto plano, título incluido: lo que se pega fuera. */
  text: string
  /** El primer párrafo de verdad del cuerpo (no un título ni una tabla), en plano. */
  excerpt: string
}

/** Prepara el documento a partir del contenido del editor (con frontmatter). */
export function shareDocument(title: string, content: string): ShareDocument {
  const split = splitFrontmatter(content)
  const body = (split === null ? content : split.body).trim()
  const cleanTitle = title.replace(/\s+/g, ' ').trim()

  // Si el cuerpo ya abre con un `#`, ese es el título del documento y no se
  // duplica. Si no, el título del resumen ocupa su sitio.
  const hasH1 = /^#\s/.test(body)
  const head = hasH1 || cleanTitle.length === 0 ? '' : `# ${cleanTitle}\n\n`
  const markdown = `${head}${body}`.trimEnd() + '\n'

  // El arranque de un resumen suele ser `## Qué es`: eso no dice nada en un post.
  // Se busca el primer bloque que sea prosa.
  const prose = body
    .split(/\n\s*\n/)
    .find((block) => block.trim().length > 0 && !/^\s*(#|\||`{3}|~{3}|[-*_]{3})/.test(block))

  return {
    title: cleanTitle,
    markdown,
    text: markdownToPlainText(markdown),
    excerpt: prose === undefined ? '' : markdownToPlainText(prose).replace(/\s*\n\s*/g, ' '),
  }
}

/** El nombre del fichero que se propone al guardar: el del propio resumen. */
export function shareFileName(relPath: string, id: string): string {
  const base = relPath.split('/').pop() ?? ''
  return base.toLowerCase().endsWith('.md') && base.length > 3 ? base : `${id}.md`
}

/**
 * Corta un texto en `limit` caracteres sin partir palabras.
 *
 * Cuenta por puntos de código, no por unidades UTF-16, para no partir un emoji
 * por la mitad.
 */
export function truncate(text: string, limit: number): string {
  const chars = Array.from(text)
  if (chars.length <= limit) return text
  const cut = chars.slice(0, limit - 1).join('')
  const lastSpace = cut.search(/\s\S*$/)
  const base = lastSpace > limit / 2 ? cut.slice(0, lastSpace) : cut
  return `${base.trimEnd()}…`
}

/**
 * El texto que se publica en cada destino.
 *
 * X solo da para el título y el arranque. LinkedIn admite una publicación larga
 * y va el documento entero hasta su límite. El correo no tiene límite práctico y
 * va completo.
 */
export function shareText(target: ShareTarget, doc: ShareDocument): string {
  if (target === 'x') {
    const text = [doc.title, doc.excerpt].filter((part) => part.length > 0).join('\n\n')
    return truncate(text, X_LIMIT)
  }
  if (target === 'linkedin') return truncate(doc.text, LINKEDIN_LIMIT)
  return doc.text
}

/**
 * La dirección que abre el destino con el texto ya puesto.
 *
 * Tienen que coincidir con las que admite `opener:allow-open-url` en
 * `src-tauri/capabilities/default.json`: cualquier otra la rechaza el shell.
 */
export function shareUrl(target: ShareTarget, doc: ShareDocument): string {
  const text = encodeURIComponent(shareText(target, doc))
  switch (target) {
    case 'x':
      return `https://x.com/intent/tweet?text=${text}`
    case 'linkedin':
      return `https://www.linkedin.com/feed/?shareActive=true&text=${text}`
    case 'email':
      return `mailto:?subject=${encodeURIComponent(doc.title)}&body=${text}`
  }
}

/**
 * Markdown a texto plano legible.
 *
 * Las redes sociales no pintan markdown: un `## Título` o un `**negrita**` se
 * publican tal cual y ensucian el texto. Esto quita la sintaxis y deja el
 * contenido. No pretende ser un parser completo: cubre lo que escriben los
 * resúmenes (títulos, listas, tablas, código, enlaces, énfasis).
 */
export function markdownToPlainText(markdown: string): string {
  const out: string[] = []
  let fence: string | null = null

  for (const line of markdown.split('\n')) {
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line)
    if (fenceMatch !== null) {
      const marker = fenceMatch[1]
      if (fence === null) fence = marker[0]
      else if (marker[0] === fence) fence = null
      continue
    }
    // Dentro de un bloque de código el texto es literal.
    if (fence !== null) {
      out.push(line)
      continue
    }

    // Separador de tabla y reglas horizontales: sin contenido.
    if (/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line)) continue
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push('')
      continue
    }

    let text = line
    const heading = /^\s{0,3}#{1,6}\s+(.*?)(\s+#+)?\s*$/.exec(text)
    if (heading !== null) text = heading[1]

    const row = /^\s*\|(.*)\|\s*$/.exec(text)
    if (row !== null) {
      text = row[1]
        .split('|')
        .map((cell) => cell.trim())
        .filter((cell) => cell.length > 0)
        .join(' · ')
    }

    text = text.replace(/^(\s*)>\s?/, '$1')
    text = text.replace(/^(\s*)[-*+]\s+\[[ xX]\]\s+/, '$1• ')
    text = text.replace(/^(\s*)[-*+]\s+/, '$1• ')

    out.push(inlinePlain(text))
  }

  return out
    .join('\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Quita la sintaxis de una línea, sin tocar lo que va entre comillas invertidas. */
function inlinePlain(line: string): string {
  // El código en línea se aparta primero: un `snake_case` o un `a*b` dentro de
  // él no es énfasis. `\u0000` no aparece en un markdown escrito por personas.
  const codes: string[] = []
  let text = line.replace(/`+([^`]+?)`+/g, (_, code: string) => {
    codes.push(code)
    return `\u0000${codes.length - 1}\u0000`
  })

  text = text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (_, label: string, url: string) =>
      label === url ? url : `${label} (${url})`,
    )
    .replace(/<((?:https?:|mailto:)[^>]+)>/g, '$1')
    .replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, '$2')
    .replace(/(^|[^\w*])\*(?=\S)(.+?)(?<=\S)\*(?!\w)/g, '$1$2')
    .replace(/(^|[^\w])_(?=\S)(.+?)(?<=\S)_(?!\w)/g, '$1$2')
    .replace(/~~(?=\S)(.+?)(?<=\S)~~/g, '$1')

  return text.replace(/\u0000(\d+)\u0000/g, (_, index: string) => codes[Number(index)])
}
