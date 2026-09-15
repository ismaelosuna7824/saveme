#!/usr/bin/env bun
/**
 * Verificación del árbol de notas.
 *
 * Lo que se comprueba aquí es **cuándo un arrastre es legal**, que es donde están
 * los errores que no se ven: mover una carpeta dentro de sí misma deja el árbol en
 * un estado imposible, soltar sobre un nombre ocupado pisa un archivo, y soltar
 * donde ya estaba manda una petición para no hacer nada.
 *
 * El backend también rechaza los dos primeros casos, pero saberlo aquí evita
 * mandar la petición y enseñarle al usuario un error por algo que la interfaz ya
 * podía saber.
 *
 * Uso:  bun run verify:notes
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { buildTree, displayName, dropVerdict, freeName, parentOf } from '../src/features/notes/tree.ts'

const ROOT = new URL('..', import.meta.url).pathname

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

const file = (rel_path) => ({ rel_path, name: rel_path.split('/').pop(), is_dir: false, size: 1, modified_at: '' })
const dir = (rel_path) => ({ rel_path, name: rel_path.split('/').pop(), is_dir: true, size: 0, modified_at: '' })

// --- rutas -------------------------------------------------------------------

section('1. Rutas')
check('el padre de «a/b/c.md» es «a/b»', parentOf('a/b/c.md') === 'a/b')
check('un archivo en la raíz no tiene padre', parentOf('nota.md') === null)
check('una carpeta de primer nivel no tiene padre', parentOf('ideas') === null)

// --- árbol -------------------------------------------------------------------

section('2. Composición del árbol')
{
  const tree = buildTree([
    dir('ideas'),
    dir('ideas/2026'),
    file('ideas/2026/una.md'),
    file('suelta.md'),
  ])
  check('hay dos raíces', tree.length === 2)
  const ideas = tree.find((n) => n.entry.rel_path === 'ideas')
  check('«ideas» cuelga de la raíz', ideas?.depth === 0)
  check('«ideas» tiene un hijo', ideas?.children.length === 1)
  const anio = ideas?.children[0]
  check('el nieto está a profundidad 2', anio?.children[0]?.depth === 2)
}

// Una carpeta vacía es una carpeta de verdad: es donde vas a soltar cosas.
{
  const tree = buildTree([dir('vacia')])
  check('una carpeta vacía aparece en el árbol', tree.length === 1 && tree[0].children.length === 0)
}

// Un dato raro no puede hacer desaparecer una nota.
{
  const tree = buildTree([file('huerfano/nota.md')])
  check('un archivo sin su carpeta se cuelga de la raíz en vez de perderse',
    tree.length === 1 && tree[0].entry.rel_path === 'huerfano/nota.md')
}

section('3. Nombres visibles')
check('a una nota se le quita el .md', displayName(file('ideas/una.md')) === 'una')
check('a una carpeta no', displayName(dir('ideas.md')) === 'ideas.md')
check('una nota con mayúsculas también', displayName(file('UNA.MD')) === 'UNA')

// --- arrastrar y soltar ------------------------------------------------------

section('4. Cuándo se puede soltar')
{
  const entries = [dir('a'), dir('a/b'), file('a/nota.md'), file('suelta.md')]

  const ok = dropVerdict(file('suelta.md'), 'a', entries)
  check('mover una nota a una carpeta es legal', ok.ok && ok.to === 'a/suelta.md')

  const root = dropVerdict(file('a/nota.md'), null, entries)
  check('mover una nota a la raíz es legal', root.ok && root.to === 'nota.md')

  const same = dropVerdict(file('a/nota.md'), 'a', entries)
  check('soltar donde ya estaba no se manda', !same.ok && same.reason === 'same-place')

  const occupied = dropVerdict(file('a/nota.md'), null, [...entries, file('nota.md')])
  check('soltar sobre un nombre ocupado se rechaza', !occupied.ok && occupied.reason === 'occupied')

  const intoItself = dropVerdict(dir('a'), 'a', entries)
  check('una carpeta sobre sí misma se rechaza', !intoItself.ok && intoItself.reason === 'into-itself')

  const intoChild = dropVerdict(dir('a'), 'a/b', entries)
  check('una carpeta dentro de su propia hija se rechaza',
    !intoChild.ok && intoChild.reason === 'into-itself')

  const deeper = dropVerdict(dir('a'), 'a/b/c', entries)
  check('también en un descendiente más profundo',
    !deeper.ok && deeper.reason === 'into-itself')

  // El caso que distingue un prefijo de una carpeta de verdad: mover `a` dentro
  // de `ab` es perfectamente legal, y comparar solo cadenas lo rechazaría.
  const sibling = dropVerdict(dir('a'), 'ab', [dir('a'), dir('ab')])
  check('mover «a» dentro de «ab» SÍ es legal (no es un descendiente)',
    sibling.ok && sibling.to === 'ab/a')
}

// --- nombres libres ----------------------------------------------------------

section('5. Nombres libres')
{
  const entries = [file('nota.md'), file('nota-2.md')]
  check('si está libre, se usa tal cual', freeName(null, 'otra', '.md', entries) === 'otra.md')
  check('si está ocupado, se busca el siguiente',
    freeName(null, 'nota', '.md', entries) === 'nota-3.md')
  check('dentro de una carpeta respeta la ruta',
    freeName('ideas', 'nota', '.md', entries) === 'ideas/nota.md')
  check('una carpeta se propone sin extensión', freeName(null, 'carpeta', '', []) === 'carpeta')
}

section('6. El control de modos no cicla al elegir')
{
  // `cyclePreviewMode` AVANZA desde el modo que le pasas; el control segmentado
  // espera un fijador. Pasárselo hacía que pulsar «source» acabara en «split» y
  // «preview» diera la vuelta hasta «live».
  //
  // **Esto no lo caza el compilador**: `(mode) => PreviewMode` es asignable donde
  // se espera `(mode) => void`, así que TypeScript lo acepta tan contento. De ahí
  // que se compruebe aquí, leyendo el código.
  //
  // El control se alcanza por dos caminos, y los dos eligen función:
  //   NoteEditor  -> <ModeSwitch onChange={...}>
  //   EditorPage  -> EditorToolbar -> <ModeSwitch onChange={onModeChange}>
  // Así que se revisan los dos sitios donde se decide, no solo el JSX del control.
  const puntos = [
    ['src/features/notes/NoteEditor.tsx', /<ModeSwitch[^>]*onChange=\{([^}]+)\}/g],
    ['src/features/editor/EditorToolbar.tsx', /<ModeSwitch[^>]*onChange=\{([^}]+)\}/g],
    ['src/features/editor/EditorPage.tsx', /onModeChange=\{([^}]+)\}/g],
  ]
  for (const [rel, patron] of puntos) {
    const source = readFileSync(join(ROOT, rel), 'utf8')
    const manejadores = [...source.matchAll(patron)].map((m) => m[1])

    // Si el patrón dejara de encontrar el enganche, la comprobación de abajo
    // pasaría por vacía y daríamos por bueno un editor que ya no miramos.
    // Renombrar el control o la prop tiene que doler aquí, no apagar la guardia.
    check(`${rel}: engancha el control de modos`, manejadores.length > 0)

    const ciclan = manejadores.filter((h) => h.includes('cyclePreviewMode'))
    check(`${rel}: fija el modo en vez de avanzarlo`, ciclan.length === 0)
    for (const h of ciclan) console.log(`      \x1b[31m→ ${h} avanza desde el modo actual\x1b[0m`)
  }
}

console.log('')
if (failures > 0) {
  console.log(`\x1b[31m${failures} problema(s) en el árbol de notas\x1b[0m`)
  process.exit(1)
}
console.log('\x1b[32mÁrbol de notas verificado.\x1b[0m')
