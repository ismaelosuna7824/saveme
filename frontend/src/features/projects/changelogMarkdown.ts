/**
 * Compone las notas de versión de un proyecto.
 *
 * Como en la exportación, el documento se monta aquí y no en el núcleo: los
 * títulos de sección los lee una persona y el idioma solo se conoce en la
 * interfaz. El subcomando `saveme changelog` monta el suyo desde **los mismos
 * datos**, porque un programa de línea de órdenes no tiene idioma al que
 * preguntar.
 *
 * Lo que no se duplica es la decisión de qué entra y en qué orden: eso lo resolvió
 * el núcleo, y aquí solo se pone en markdown.
 */
import type { Changelog } from '@/api/types'
import type { Translate } from '@/i18n'
import { categoryLabel } from '@/lib/labels'

/** Fecha corta y neutral (AAAA-MM-DD), sin depender del idioma. */
function dia(iso: string): string {
  const fecha = new Date(iso)
  if (Number.isNaN(fecha.getTime())) return iso
  return fecha.toISOString().slice(0, 10)
}

/** Escapa lo mínimo para que un título no rompa el markdown. */
function comoTitulo(texto: string): string {
  return texto.replace(/\s+/g, ' ').trim()
}

/**
 * Monta el documento.
 *
 * `t` se pasa en vez de importarse para poder probar esto sin React, igual que en
 * la exportación.
 */
export function buildChangelogMarkdown(data: Changelog, t: Translate): string {
  const partes: string[] = []

  partes.push(`# ${t('projects.changelog.docHeading', { project: data.project })}`)
  partes.push('')
  partes.push(
    `_${t('projects.changelog.docLine', {
      from: dia(data.from),
      to: dia(data.to),
      count: data.count,
    })}_`,
  )

  if (data.count === 0) {
    partes.push('')
    partes.push(t('projects.changelog.docEmpty'))
    return `${partes.join('\n').trimEnd()}\n`
  }

  for (const seccion of data.sections) {
    partes.push('')
    partes.push(`## ${categoryLabel(t, seccion.category)}`)

    for (const entrada of seccion.entries) {
      const pie = [`\`${entrada.rel_path}\``, dia(entrada.created_at)]
      if (entrada.commit_sha !== undefined && entrada.commit_sha !== '') {
        pie.push(`\`${entrada.commit_sha.slice(0, 10)}\``)
      }

      partes.push('')
      partes.push(`- **${comoTitulo(entrada.title)}** — ${pie.join(' · ')}`)

      // La línea de resumen va indentada debajo, como continuación del punto: es
      // lo que hace que un changelog se lea de un tirón en vez de ser una lista de
      // títulos que no dicen nada.
      const resumen = entrada.summary_line.trim()
      if (resumen !== '') {
        partes.push(`  ${resumen}`)
      }
    }
  }

  // Un solo salto final: los ficheros de texto terminan en salto de línea.
  return `${partes.join('\n').trimEnd()}\n`
}

/**
 * Nombre del fichero que se descarga.
 *
 * Se sanea igual que el de la exportación y por los mismos motivos: el nombre lo
 * interpreta el sistema de archivos, no el proyecto.
 */
export function changelogFileName(project: string, hasta: string): string {
  const limpio = project
    .replace(/\.{2,}/g, '-')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')

  return `saveme-${limpio || 'proyecto'}-changelog-${dia(hasta)}.md`
}
