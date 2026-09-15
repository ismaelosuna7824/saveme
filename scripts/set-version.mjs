#!/usr/bin/env bun
/**
 * La versión del proyecto, en un solo sitio.
 *
 * Vive en tres ficheros y los tres tienen que decir lo mismo:
 *
 *   - `src-tauri/tauri.conf.json`  → lo que se ve en el .dmg/.msi/.deb
 *   - `src-tauri/Cargo.toml`       → lo que compila Cargo
 *   - `frontend/package.json`      → lo que ve el ecosistema de Node
 *
 * El core de Go **no** está en la lista a propósito: no lleva la versión dentro
 * del código, se la inyecta el enlazador al compilar (`-X main.version=`), y ese
 * valor sale del tag. Así el binario suelto y la app siempre cuentan lo mismo.
 *
 * Uso:
 *   bun scripts/set-version.mjs --print          # muestra la version actual
 *   bun scripts/set-version.mjs 0.2.0            # la fija (acepta tambien v0.2.0)
 *   bun scripts/set-version.mjs --check          # los tres coinciden entre si
 *   bun scripts/set-version.mjs --check 0.2.0    # y ademas valen 0.2.0
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

const FICHEROS = [
  { ruta: 'src-tauri/tauri.conf.json', tipo: 'json' },
  { ruta: 'frontend/package.json', tipo: 'json' },
  { ruta: 'src-tauri/Cargo.toml', tipo: 'cargo' },
]

/** Quita el `v` de un tag y valida que lo que queda es una versión. */
export function normalizar(entrada) {
  const limpio = String(entrada).trim().replace(/^v/, '')
  if (!SEMVER.test(limpio)) {
    throw new Error(`«${entrada}» no es una versión válida (se espera algo como 1.2.3 o v1.2.3-beta.1)`)
  }
  return limpio
}

/** Lee la versión de un fichero, sin reescribirlo. */
export function leerVersion({ ruta, tipo }) {
  const texto = readFileSync(join(ROOT, ruta), 'utf8')
  if (tipo === 'json') return JSON.parse(texto).version
  const match = texto.match(/^version = "([^"]+)"$/m)
  if (!match) throw new Error(`no encuentro la version en ${ruta}`)
  return match[1]
}

/**
 * Escribe la versión sustituyendo **solo** el valor, no el fichero entero.
 *
 * Reescribir el JSON con `JSON.stringify` reformatearía todo el archivo y
 * llenaría el diff de ruido. Se busca la cadena exacta `"version": "x"` y se
 * cambia nada más que eso.
 */
function escribirVersion({ ruta, tipo }, siguiente) {
  const destino = join(ROOT, ruta)
  const texto = readFileSync(destino, 'utf8')
  const actual = leerVersion({ ruta, tipo })

  if (actual === siguiente) return false

  let antes
  let despues
  if (tipo === 'json') {
    antes = `"version": ${JSON.stringify(actual)}`
    despues = `"version": ${JSON.stringify(siguiente)}`
  } else {
    antes = `version = ${JSON.stringify(actual)}`
    despues = `version = ${JSON.stringify(siguiente)}`
  }

  const pos = texto.indexOf(antes)
  if (pos < 0) throw new Error(`no encuentro ${antes} en ${ruta}`)

  // Si el patrón aparece más de una vez no se toca: sustituir el equivocado
  // cambiaría la versión de una dependencia.
  if (texto.indexOf(antes, pos + 1) >= 0) {
    throw new Error(`«${antes}» aparece más de una vez en ${ruta}; no sé cuál cambiar`)
  }

  writeFileSync(destino, texto.slice(0, pos) + despues + texto.slice(pos + antes.length))
  return true
}

function versionActual() {
  return leerVersion(FICHEROS[0])
}

function fijar(siguiente) {
  for (const fichero of FICHEROS) {
    const cambiado = escribirVersion(fichero, siguiente)
    console.log(`  ${cambiado ? '\x1b[33mactualizado\x1b[0m' : '  \x1b[2msin cambios\x1b[0m'}  ${fichero.ruta}`)
  }
  console.log(`\n\x1b[32mversión ${siguiente}\x1b[0m`)
}

/** Devuelve la lista de problemas: los ficheros que no dicen lo que deben. */
function revisar(esperada) {
  const problemas = []
  for (const fichero of FICHEROS) {
    const vista = leerVersion(fichero)
    if (esperada && vista !== esperada) {
      problemas.push(`${fichero.ruta} dice ${vista}, se esperaba ${esperada}`)
    }
  }
  if (!esperada) {
    const valores = new Set(FICHEROS.map((f) => leerVersion(f)))
    if (valores.size > 1) {
      problemas.push(`los ficheros no coinciden entre sí: ${[...valores].join(', ')}`)
    }
  }
  return problemas
}

function main() {
  const args = process.argv.slice(2)

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log('uso: bun scripts/set-version.mjs [--print | <version> | --check [version]]')
    process.exit(args.length === 0 ? 1 : 0)
  }

  if (args[0] === '--print') {
    console.log(versionActual())
    return
  }

  if (args[0] === '--check') {
    const esperada = args[1] === undefined ? null : normalizar(args[1])
    const problemas = revisar(esperada)
    for (const fichero of FICHEROS) {
      console.log(`  ${fichero.ruta}: ${leerVersion(fichero)}`)
    }
    if (problemas.length > 0) {
      for (const p of problemas) console.error(`\x1b[31m✗ ${p}\x1b[0m`)
      process.exit(1)
    }
    console.log(`\n\x1b[32mla versión cuadra${esperada ? ` con ${esperada}` : ''}\x1b[0m`)
    return
  }

  if (args[0].startsWith('-')) {
    console.error(`opción desconocida: ${args[0]}`)
    process.exit(1)
  }

  fijar(normalizar(args[0]))
}

main()
