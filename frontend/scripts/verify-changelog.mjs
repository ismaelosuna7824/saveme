#!/usr/bin/env bun
/**
 * Verificación de las notas de versión.
 *
 * Esto produce un fichero que sale de la aplicación y se lee fuera de ella —en un
 * `CHANGELOG.md`, en una release de GitHub—, así que un fallo no se ve hasta que
 * alguien lo abre. Y los dos fallos que importan son silenciosos: perder entradas
 * por el camino, y que la línea de resumen se pegue al punto anterior y deje el
 * markdown roto sin que nada avise.
 *
 * Uso:  bun run verify:changelog
 */
import { buildChangelogMarkdown, changelogFileName } from '../src/features/projects/changelogMarkdown.ts'

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
 * Las secciones del documento, en orden.
 *
 * El traductor de mentira devuelve la clave de traducción, así que el título real
 * lo pone la interfaz. Se comprueba que la clave lleva dentro la categoría que
 * mandó el núcleo, que es lo que tiene que sobrevivir hasta aquí.
 */
function seccionesDe(md) {
  return [...md.matchAll(/^## (.+)$/gm)].map((m) => m[1])
}

const entrada = (over) => ({
  id: 'sm_1',
  category: 'fix',
  title: 'Arreglo del watcher',
  summary_line: 'El watcher reindexaba notas que no tocaban.',
  rel_path: 'alfa/fixes/watcher.md',
  created_at: '2026-03-04T10:00:00Z',
  author: 'humano',
  files_touched: [],
  tags: [],
  ...over,
})

const changelog = {
  project: 'alfa',
  from: '2026-03-01T00:00:00Z',
  to: '2026-03-10T23:59:59Z',
  count: 3,
  sections: [
    {
      category: 'feature',
      entries: [
        entrada({
          id: 'sm_a',
          category: 'feature',
          title: 'Añado el pulso',
          summary_line: 'Una pantalla con el mapa de actividad.',
          rel_path: 'alfa/features/pulso.md',
        }),
      ],
    },
    {
      category: 'fix',
      entries: [
        entrada({}),
        entrada({
          id: 'sm_2',
          title: 'Otra cosa',
          summary_line: '',
          rel_path: 'alfa/fixes/otra.md',
          commit_sha: 'abcdef1234567890',
        }),
      ],
    },
  ],
}

// --- 1. Estructura del documento ---------------------------------------------

section('1. El documento lleva todo')
{
  const md = buildChangelogMarkdown(changelog, t)

  check('empieza por un título de primer nivel', md.startsWith('# projects.changelog.docHeading'))
  check(
    'la cabecera lleva el rango y el recuento',
    md.includes('projects.changelog.docLine{"from":"2026-03-01","to":"2026-03-10","count":3}'),
  )
  check('las dos categorías salen, en el orden que manda el núcleo', seccionesDe(md).length === 2)
  check('y llevan dentro la categoría del núcleo', seccionesDe(md)[0].includes('feature'))
  check('las tres entradas están', (md.match(/^- \*\*/gm) ?? []).length === 3)
  check('cada una lleva su ruta', md.includes('`alfa/fixes/watcher.md`'))
  check('y su día', md.includes('2026-03-04'))
  check('el commit sale corto', md.includes('abcdef1234'))
  check('y no entero', !md.includes('abcdef1234567890'))
  check('termina en un solo salto de línea', md.endsWith('\n') && !md.endsWith('\n\n'))
}

// --- 2. El markdown no puede quedar roto --------------------------------------
//
// La línea de resumen va indentada debajo del punto, como continuación. Si se
// emitiera sin la indentación, el markdown la leería como un párrafo suelto y la
// entrada perdería su explicación: se vería, pero al leer el fichero la frase
// aparecería descolgada, fuera de la lista.

section('2. La línea de resumen es continuación del punto')
{
  const md = buildChangelogMarkdown(changelog, t)
  const lineas = md.split('\n')
  const indice = lineas.findIndex((l) => l.includes('El watcher reindexaba notas'))
  check('la línea de resumen existe', indice > 0)
  check('va indentada con dos espacios', lineas[indice].startsWith('  '))
  check('y justo debajo de su punto', lineas[indice - 1].startsWith('- **'))

  // Una entrada sin resumen no puede dejar una línea en blanco indentada, que es
  // basura invisible pero que ensucia cualquier diff.
  check('sin resumen no queda una línea suelta', !md.includes('\n  \n'))
}

// --- 3. El orden no puede bailar ---------------------------------------------

section('3. Dos changelogs iguales salen iguales')
{
  const a = buildChangelogMarkdown(changelog, t)
  const b = buildChangelogMarkdown(changelog, t)
  check('el resultado es determinista', a === b)
  check('las secciones conservan el orden que manda el núcleo', seccionesDe(a).length === 2)
}

// --- 4. Un rango vacío lo dice ------------------------------------------------

section('4. Un rango sin nada lo dice')
{
  const vacio = buildChangelogMarkdown({ ...changelog, count: 0, sections: [] }, t)
  check('aparece la frase que lo explica', vacio.includes('projects.changelog.docEmpty'))
  check('y no hay ninguna sección', seccionesDe(vacio).length === 0)
  check('termina en salto de línea', vacio.endsWith('\n') && !vacio.endsWith('\n\n'))

  // Y el documento dice el rango aunque no haya nada: son las notas de *ese*
  // tramo, no unas notas sin fechas.
  check('el rango sigue saliendo', vacio.includes('2026-03-01') && vacio.includes('2026-03-10'))
}

// --- 5. El nombre del fichero -------------------------------------------------

section('5. El nombre del fichero se puede guardar')
{
  check(
    'lleva el proyecto, la palabra changelog y la fecha',
    changelogFileName('alfa', '2026-03-10T23:59:59Z') === 'saveme-alfa-changelog-2026-03-10.md',
  )
  check('sin fecha legible, no revienta', changelogFileName('alfa', '').startsWith('saveme-alfa-'))
  // Un nombre con `/` o `..` no es un problema del proyecto: es del navegador, que
  // puede acabar escribiendo fuera de la carpeta de descargas.
  check('una barra no llega al nombre', !changelogFileName('a/b', 'x').includes('/'))
  check('ni un ..', !changelogFileName('../etc/passwd', 'x').includes('..'))
  check(
    'un proyecto vacío tiene nombre igual',
    changelogFileName('', '2026-03-10T23:59:59Z') === 'saveme-proyecto-changelog-2026-03-10.md',
  )
}

// --- 6. Casos límite ---------------------------------------------------------

section('6. Casos límite')
{
  const tituloRaro = buildChangelogMarkdown(
    {
      ...changelog,
      count: 1,
      sections: [
        { category: 'fix', entries: [entrada({ title: '  Un   título\nraro  ' })] },
      ],
    },
    t,
  )
  check('un título con saltos de línea no rompe el markdown', tituloRaro.includes('**Un título raro**'))
  check('y no deja un guion suelto en la lista', !tituloRaro.includes('- **\n'))

  // Una categoría que la taxonomía no conoce no puede desaparecer del documento:
  // se pinta con su clave cruda, que es lo que hace `categoryLabel` sin traducción.
  const desconocida = buildChangelogMarkdown(
    { ...changelog, count: 1, sections: [{ category: 'inventada', entries: [entrada({ category: 'inventada' })] }] },
    t,
  )
  check('una categoría desconocida no se pierde', desconocida.includes('## inventada'))
}

console.log('')
if (failures > 0) {
  console.log(`\x1b[31m${failures} problema(s) en las notas de versión\x1b[0m`)
  process.exit(1)
}
console.log('\x1b[32mNotas de versión verificadas.\x1b[0m')
