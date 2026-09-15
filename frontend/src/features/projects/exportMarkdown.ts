/**
 * Compone el documento de un proyecto exportado.
 *
 * Vive aquí y no en el núcleo a propósito: los títulos de sección los lee una
 * persona y el idioma solo se conoce en la interfaz. El backend manda los datos
 * —categoría, título, fecha, cuerpo— y esto los pone en orden.
 *
 * El resultado es markdown plano, sin frontmatter: el documento es para leerlo o
 * para pegarlo en otro sitio, no para volver a indexarlo. Los archivos originales
 * siguen siendo la fuente de verdad.
 */
import type { ProjectExport } from '@/api/types'
import type { Translate } from '@/i18n'

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
 * Monta el documento completo.
 *
 * `t` se pasa en vez de importarse para poder probar esto sin React: la guardia
 * le da un traductor de mentira y comprueba la estructura.
 */
export function buildProjectMarkdown(data: ProjectExport, t: Translate): string {
  const partes: string[] = []

  partes.push(`# ${comoTitulo(data.project)}`)
  partes.push('')
  partes.push(
    `_${t('projects.export.docLine', {
      count: data.count,
      date: dia(data.generated_at),
    })}_`,
  )

  // Si algo no se pudo leer, el documento lo dice en lugar de parecer completo.
  // Es la diferencia entre un documento incompleto y un documento que miente.
  if (data.skipped > 0) {
    partes.push('')
    partes.push(`> ${t('projects.export.skippedLine', { count: data.skipped })}`)
  }

  for (const seccion of data.sections) {
    partes.push('')
    partes.push(`## ${t('projects.export.categoryHeading', { category: seccion.category })}`)

    for (const resumen of seccion.summaries) {
      partes.push('')
      partes.push(`### ${comoTitulo(resumen.title)}`)

      const pie: string[] = [dia(resumen.created_at)]
      if (resumen.commit_sha !== undefined && resumen.commit_sha !== '') {
        pie.push(`${t('projects.export.commit')} \`${resumen.commit_sha.slice(0, 10)}\``)
      }
      if (resumen.files_touched.length > 0) {
        pie.push(
          `${t('projects.export.files')} ${resumen.files_touched.map((f) => `\`${f}\``).join(', ')}`,
        )
      }
      if (resumen.tags.length > 0) {
        pie.push(resumen.tags.map((tag) => `#${tag}`).join(' '))
      }
      partes.push('')
      partes.push(`_${pie.join(' · ')}_`)

      partes.push('')
      partes.push(resumen.body.trimEnd())
    }
  }

  // Un solo salto final: los ficheros de texto terminan en salto de línea, y
  // algunos editores se quejan si no.
  return `${partes.join('\n').trimEnd()}\n`
}

/** El nombre del fichero que se descarga. */
export function exportFileName(project: string, generatedAt: string): string {
  // El slug ya viene saneado por el núcleo, pero se limpia igual: un nombre de
  // fichero lo interpreta el navegador y el sistema de archivos, no el proyecto.
  //
  //  - `..` se colapsa: dentro de un nombre no significa nada, pero un fichero
  //    llamado así invita a pensar que sí.
  //  - Los puntos y guiones de los extremos se quitan porque Windows no admite
  //    nombres terminados en punto, y porque un nombre que empieza por punto es
  //    un fichero oculto en cualquier sistema de Unix.
  const limpio = project
    .replace(/\.{2,}/g, '-')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')

  return `saveme-${limpio || 'proyecto'}-${dia(generatedAt)}.md`
}
