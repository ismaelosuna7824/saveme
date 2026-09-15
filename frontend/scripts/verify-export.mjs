#!/usr/bin/env bun
/**
 * Verificación del documento exportado.
 *
 * Esto produce un fichero que sale de la aplicación y se lee fuera de ella: si
 * sale mal, nadie lo ve hasta que alguien lo abre. Y los dos fallos que importan
 * son silenciosos: perder resúmenes por el camino, o generar un nombre de fichero
 * que el navegador no pueda guardar.
 *
 * Uso:  bun run verify:export
 */
import { buildProjectMarkdown, exportFileName } from '../src/features/projects/exportMarkdown.ts'

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

/** Traductor de mentira: deja ver la clave y las variables que recibió. */
const t = (key, vars) => (vars === undefined ? key : `${key}${JSON.stringify(vars)}`)

/**
 * Las categorías tal como salieron, en orden.
 *
 * Se leen de las variables que recibió el traductor y no del texto del título,
 * porque el traductor de mentira devuelve la clave: el título real lo pone la
 * interfaz.
 */
function categoriasDe(md) {
  return [...md.matchAll(/^## .*"category":"([^"]+)"/gm)].map((m) => m[1])
}

const entry = (over) => ({
  id: 'sm_1',
  title: 'Arreglo del watcher',
  rel_path: 'alfa/fixes/watcher.md',
  created_at: '2026-03-04T10:00:00Z',
  updated_at: '2026-03-04T10:00:00Z',
  tags: [],
  files_touched: [],
  body: 'El watcher reindexaba notas.\n',
  ...over,
})

const proyecto = {
  project: 'alfa',
  generated_at: '2026-03-10T09:30:00Z',
  count: 2,
  skipped: 0,
  sections: [
    {
      category: 'fix',
      summaries: [
        entry({}),
        entry({
          id: 'sm_2',
          title: 'Otra cosa',
          rel_path: 'alfa/fixes/otra.md',
          commit_sha: 'abcdef1234567890',
          files_touched: ['backend/internal/watch/watch.go'],
          tags: ['watcher'],
          body: 'Segundo cuerpo.',
        }),
      ],
    },
    { category: 'chore', summaries: [entry({ id: 'sm_3', title: 'Subo deps', body: 'Nada.' })] },
  ],
}

// --- 1. Estructura del documento ---------------------------------------------

section('1. El documento lleva todo')
{
  const md = buildProjectMarkdown(proyecto, t)

  check('empieza por el nombre del proyecto', md.startsWith('# alfa\n'))
  check('la cabecera lleva el recuento y la fecha',
    md.includes('projects.export.docLine{"count":2,"date":"2026-03-10"}'))
  check('las dos categorías salen, en el orden que manda el núcleo',
    categoriasDe(md).join(',') === 'fix,chore')
  check('cada resumen es un apartado', (md.match(/^### /gm) ?? []).length === 3)
  check('el cuerpo de cada uno está', md.includes('El watcher reindexaba notas.'))
  check('sin frontmatter', !md.includes('status: active') && !md.includes('---\nid:'))
  check('termina en un solo salto de línea', md.endsWith('\n') && !md.endsWith('\n\n'))
  check('el commit sale si lo hay', md.includes('abcdef1234'))
  check('los archivos y las etiquetas salen',
    md.includes('backend/internal/watch/watch.go') && md.includes('#watcher'))
  check('y un resumen sin commit no deja un hueco raro', !md.includes('commit ``'))
}

// --- 2. El orden no puede bailar entre exportaciones -------------------------

section('2. Dos exportaciones del mismo proyecto salen iguales')
{
  const a = buildProjectMarkdown(proyecto, t)
  const b = buildProjectMarkdown(proyecto, t)
  check('el resultado es determinista', a === b)

  const orden = categoriasDe(a)
  check('las secciones conservan el orden que manda el núcleo',
    orden.join(',') === 'fix,chore')
}

// --- 3. Lo que falta se dice -------------------------------------------------

section('3. Un documento incompleto lo dice')
{
  const md = buildProjectMarkdown({ ...proyecto, skipped: 2 }, t)
  check('avisa de los que no se pudieron leer',
    md.includes('projects.export.skippedLine{"count":2}'))
  check('y el aviso va antes de las secciones',
    md.indexOf('skippedLine') < md.indexOf('\n## '))

  const completo = buildProjectMarkdown(proyecto, t)
  check('sin nada que saltar, no hay aviso', !completo.includes('skippedLine'))
}

// --- 4. El nombre del fichero ------------------------------------------------

section('4. El nombre del fichero se puede guardar')
{
  check('lleva el proyecto y la fecha',
    exportFileName('alfa', '2026-03-10T09:30:00Z') === 'saveme-alfa-2026-03-10.md')
  check('sin fecha legible, no revienta',
    exportFileName('alfa', '').startsWith('saveme-alfa-'))
  // Un nombre con `/` o `..` no es un problema del proyecto: es un problema del
  // navegador, que puede acabar escribiendo fuera de la carpeta de descargas.
  check('una barra no llega al nombre', !exportFileName('a/b', 'x').includes('/'))
  check('ni un ..', !exportFileName('../etc/passwd', 'x').includes('..'))
  check('un proyecto vacío tiene nombre igual',
    exportFileName('', '2026-03-10T09:30:00Z') === 'saveme-proyecto-2026-03-10.md')
}

// --- 5. Casos límite ---------------------------------------------------------

section('5. Casos límite')
{
  const vacio = buildProjectMarkdown(
    { project: 'vacio', generated_at: '2026-01-01T00:00:00Z', count: 0, skipped: 0, sections: [] },
    t,
  )
  check('un proyecto sin nada genera un documento válido igual', vacio.startsWith('# vacio'))
  check('y termina en salto de línea', vacio.endsWith('\n') && !vacio.endsWith('\n\n'))

  const conSaltoFinal = buildProjectMarkdown(
    { ...proyecto, sections: [{ category: 'fix', summaries: [entry({ body: 'Cuerpo.\n\n\n' })] }] },
    t,
  )
  check('los saltos de línea de más del cuerpo no se acumulan',
    !conSaltoFinal.includes('Cuerpo.\n\n\n\n'))

  const tituloRaro = buildProjectMarkdown(
    { ...proyecto, sections: [{ category: 'fix', summaries: [entry({ title: '  Un   título\nraro  ' })] }] },
    t,
  )
  check('un título con saltos de línea no rompe el markdown',
    tituloRaro.includes('### Un título raro'))
}

console.log('')
if (failures > 0) {
  console.log(`\x1b[31m${failures} problema(s) en la exportación\x1b[0m`)
  process.exit(1)
}
console.log('\x1b[32mExportación verificada.\x1b[0m')
