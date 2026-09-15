/**
 * Lectura y reescritura del frontmatter YAML.
 *
 * El contrato dice que el archivo `.md` es la fuente de verdad y que SaveMe
 * nunca reformatea el cuerpo. Por eso aquí solo se toca la línea concreta que
 * se quiere cambiar: el resto del bloque se conserva byte a byte.
 *
 * No se usa un parser YAML: el frontmatter de SaveMe son pares
 * `clave: valor` planos y una dependencia de YAML en el bundle no compensa
 * para reescribir un título.
 */

export interface FrontmatterSplit {
  /** Contenido entre los `---`, sin incluirlos. */
  raw: string
  /** Cuerpo del documento, ya sin frontmatter. */
  body: string
  /** Offset donde termina el bloque completo (incluido su salto de línea). */
  end: number
  /** Líneas ocupadas por el frontmatter: se suman a las líneas del cuerpo. */
  lineOffset: number
}

function countNewlines(text: string): number {
  let count = 0
  for (const char of text) if (char === '\n') count += 1
  return count
}

/** Separa el frontmatter del cuerpo. `null` si el archivo no empieza por `---`. */
export function splitFrontmatter(content: string): FrontmatterSplit | null {
  if (!content.startsWith('---')) return null

  const firstBreak = content.indexOf('\n')
  if (firstBreak === -1) return null
  if (content.slice(0, firstBreak).trim() !== '---') return null

  const closing = content.indexOf('\n---', firstBreak)
  if (closing === -1) return null

  const afterClosing = content.indexOf('\n', closing + 1)
  const end = afterClosing === -1 ? content.length : afterClosing + 1

  return {
    raw: content.slice(firstBreak + 1, closing + 1),
    body: content.slice(end),
    end,
    lineOffset: countNewlines(content.slice(0, end)),
  }
}

/** Valor de un campo de primer nivel. `null` si no está. */
export function readFrontmatterField(content: string, field: string): string | null {
  const block = splitFrontmatter(content)
  if (!block) return null

  const pattern = new RegExp(`^${field}:[ \\t]?(.*)$`)
  for (const line of block.raw.split('\n')) {
    const match = pattern.exec(line)
    if (!match) continue
    return unquote(match[1].trim())
  }
  return null
}

function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'")
  }
  return value
}

/** Escapa un escalar YAML solo cuando hace falta. */
function yamlScalar(value: string): string {
  if (value.length === 0) return '""'
  const plainSafe = /^[A-Za-z0-9][A-Za-z0-9 _\-.,;()/']*$/.test(value) && !value.endsWith(' ')
  if (plainSafe) return value
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * Devuelve el contenido con `field` reemplazado (o agregado al final del
 * frontmatter). Si el archivo no tiene frontmatter se devuelve tal cual: un
 * archivo `unmanaged` no se toca, porque SaveMe nunca lo sobrescribe.
 */
export function setFrontmatterField(content: string, field: string, value: string): string {
  const block = splitFrontmatter(content)
  if (!block) return content

  const lines = block.raw.split('\n')
  const pattern = new RegExp(`^${field}:[ \\t]?`)
  const index = lines.findIndex((line) => pattern.test(line))
  const serialized = `${field}: ${yamlScalar(value)}`

  if (index >= 0) lines[index] = serialized
  else lines.push(serialized)

  const raw = lines.join('\n')
  const head = content.slice(0, content.indexOf('\n') + 1)
  const tail = content.slice(block.end)
  return `${head}${raw}\n---\n${tail}`
}
