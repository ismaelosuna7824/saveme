#!/usr/bin/env bun
/**
 * Verificación de lo que sale al guardar o compartir un resumen.
 *
 * Los fallos que importan son silenciosos: que el frontmatter se cuele en el
 * documento, que un post de X se pase del límite, que el texto plano se coma
 * parte del contenido, o que una dirección de compartir no case con las que
 * admite el permiso del shell (entonces el botón simplemente no hace nada).
 *
 * Uso:  bun run verify:share
 */
import { readFileSync } from 'node:fs'

import {
  markdownToPlainText,
  shareDocument,
  shareFileName,
  shareText,
  shareUrl,
  truncate,
} from '../src/features/editor/shareMarkdown.ts'

let failures = 0

function check(label, condition) {
  if (condition) console.log(`  \x1b[32m✓\x1b[0m ${label}`)
  else {
    console.log(`  \x1b[31m✗\x1b[0m ${label}`)
    failures++
  }
}

function section(title) {
  console.log(`\n\x1b[1m${title}\x1b[0m`)
}

const resumen = [
  '---',
  'id: sm_01',
  'title: Arquitectura de design runs',
  'tags: [pen-dev]',
  '---',
  '',
  '## Qué es',
  '',
  'Mapa de cómo funcionan los **design runs** con `DESIGN_RUNS_DIRECT=true` y el',
  '[worker](https://example.com/worker).',
  '',
  '| Término | Qué es |',
  '|---|---|',
  '| Run | Una petición de diseño |',
  '',
  '```py',
  'def snake_case(a_b): return a_b * 2',
  '```',
  '',
  '- [x] hecho',
  '- pendiente',
  '',
].join('\n')

section('Documento')
{
  const doc = shareDocument('  Arquitectura de\ndesign runs ', resumen)
  check('el frontmatter no sale', !doc.markdown.includes('id: sm_01') && !doc.markdown.includes('---\n'))
  check('el título pasa a ser el # de arriba', doc.markdown.startsWith('# Arquitectura de design runs\n\n## Qué es'))
  check('termina en un solo salto de línea', doc.markdown.endsWith('\n') && !doc.markdown.endsWith('\n\n'))

  const conH1 = shareDocument('Otro título', '---\ntitle: x\n---\n# Ya tiene título\n\nTexto.\n')
  check('si el cuerpo ya abre con #, no se duplica', conH1.markdown === '# Ya tiene título\n\nTexto.\n')

  const sinFrontmatter = shareDocument('T', 'Solo cuerpo.')
  check('un fichero sin frontmatter también vale', sinFrontmatter.markdown === '# T\n\nSolo cuerpo.\n')

  check('el extracto salta los títulos y empieza en la prosa',
    doc.excerpt.startsWith('Mapa de cómo funcionan los design runs con DESIGN_RUNS_DIRECT=true'))
  check('el extracto es una sola línea', !doc.excerpt.includes('\n'))
}

section('Texto plano')
{
  const plano = markdownToPlainText(shareDocument('Arquitectura', resumen).markdown)
  check('sin marcas de título', !/^#/m.test(plano) && plano.startsWith('Arquitectura\n\nQué es'))
  check('sin negritas', plano.includes('los design runs con') && !plano.includes('**'))
  check('el código en línea conserva sus guiones bajos', plano.includes('DESIGN_RUNS_DIRECT=true'))
  check('los enlaces dejan texto y dirección', plano.includes('worker (https://example.com/worker)'))
  check('la tabla queda en filas legibles', plano.includes('Run · Una petición de diseño') && !plano.includes('|'))
  check('el bloque de código queda literal y sin vallas',
    plano.includes('def snake_case(a_b): return a_b * 2') && !plano.includes('```'))
  check('las listas y tareas usan viñeta', plano.includes('• hecho') && plano.includes('• pendiente'))
  check('no quedan tres saltos seguidos', !plano.includes('\n\n\n'))
  check('el énfasis con _ no rompe palabras con guion bajo',
    markdownToPlainText('usa _esto_ y no_toques_esto') === 'usa esto y no_toques_esto')
}

section('Recortes')
{
  check('un texto corto no se toca', truncate('hola', 10) === 'hola')
  const recortado = truncate('una frase bastante larga para recortar', 20)
  check('se recorta sin partir palabras', recortado === 'una frase bastante…')
  check('y no pasa del límite', Array.from(recortado).length <= 20)
  const emojis = truncate('😀'.repeat(30), 10)
  check('no parte un emoji por la mitad', Array.from(emojis).every((c) => c === '😀' || c === '…'))

  const largo = shareDocument('Título', `Arranque. ${'palabra '.repeat(200)}\n\n${'más '.repeat(2000)}`)
  check('el post de X cabe en el límite', Array.from(shareText('x', largo)).length <= 280)
  check('el post de X lleva el título y el arranque', shareText('x', largo).startsWith('Título\n\nArranque.'))
  check('LinkedIn cabe en su límite', Array.from(shareText('linkedin', largo)).length <= 3000)
  check('el correo va completo', shareText('email', largo) === largo.text)
}

section('Direcciones de compartir')
{
  // Las direcciones tienen que pasar el permiso del shell, o el clic no hace nada.
  const capabilities = JSON.parse(
    readFileSync(new URL('../../src-tauri/capabilities/default.json', import.meta.url), 'utf8'),
  )
  const opener = capabilities.permissions.find(
    (p) => typeof p === 'object' && p.identifier === 'opener:allow-open-url',
  )
  // Mismo glob que el plugin: `*` cualquier cosa (barras incluidas), `?` un carácter.
  const permitidas = (opener?.allow ?? []).map(({ url }) => {
    const re = url.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')
    return new RegExp(`^${re}$`)
  })
  const admitida = (url) => permitidas.some((re) => re.test(url))

  const doc = shareDocument('Título & más?', resumen)
  for (const destino of ['x', 'linkedin', 'email']) {
    check(`${destino}: el permiso del shell la admite`, admitida(shareUrl(destino, doc)))
  }
  check('facebook: el permiso del shell la admite', admitida('https://www.facebook.com/'))
  check('cualquier otra dirección no', !admitida('https://example.com/') && !admitida('file:///etc/passwd'))

  const x = new URL(shareUrl('x', doc))
  check('X recibe el texto entero, con & y ? escapados', x.searchParams.get('text') === shareText('x', doc))
  const correo = shareUrl('email', doc)
  check('el correo lleva el título de asunto', correo.startsWith(`mailto:?subject=${encodeURIComponent('Título & más?')}&body=`))
}

section('Nombre del fichero')
{
  check('es el del propio resumen', shareFileName('alfa/design/2026-10-05-arquitectura.md', 'sm_1') === '2026-10-05-arquitectura.md')
  check('sin ruta válida, cae al id', shareFileName('', 'sm_1') === 'sm_1.md')
}

console.log('')
if (failures > 0) {
  console.log(`\x1b[31m${failures} problema(s) al compartir\x1b[0m`)
  process.exit(1)
}
console.log('\x1b[32mCompartir verificado.\x1b[0m')
