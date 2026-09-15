#!/usr/bin/env bun
/**
 * Escribe el `latest.json` de una release a partir de los ficheros `.sig` que
 * dejó el empaquetado.
 *
 * Tauri no genera este fichero: genera los artefactos y sus firmas, y quien
 * publica tiene que montar el JSON. Lo monta `scripts/lib/latest-json.mjs`, que
 * es donde está la lógica y donde se prueba; esto solo lee el disco.
 *
 * Uso:
 *   bun scripts/make-latest-json.mjs \
 *     --version 0.2.0 \
 *     --base-url https://github.com/usuario/repo/releases/download/v0.2.0 \
 *     --dir instalables
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { buildLatestJson } from './lib/latest-json.mjs'

function usage() {
  console.error(
    'uso: bun scripts/make-latest-json.mjs --version X.Y.Z --base-url URL --dir CARPETA [--notes "…"] [--macos universal|aarch64|x86_64]',
  )
  process.exit(2)
}

function parseArgs(argv) {
  const out = { notes: '', macos: 'universal' }
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    const value = argv[i + 1]
    switch (flag) {
      case '--version':
      case '--base-url':
      case '--dir':
      case '--notes':
      case '--macos':
        if (value === undefined) usage()
        out[flag.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value
        i += 1
        break
      default:
        console.error(`opción desconocida: ${flag}`)
        usage()
    }
  }
  if (!out.version || !out.baseUrl || !out.dir) usage()
  return out
}

function main() {
  const { version, baseUrl, dir, notes, macos } = parseArgs(process.argv.slice(2))

  // Cada `.sig` es la firma del fichero que tiene al lado, sin el sufijo.
  const artifacts = readdirSync(dir)
    .filter((name) => name.endsWith('.sig'))
    .map((name) => ({
      name: name.slice(0, -'.sig'.length),
      signature: readFileSync(join(dir, name), 'utf8'),
    }))

  if (artifacts.length === 0) {
    console.error(
      `no hay ningún .sig en ${dir}: el empaquetado no generó artefactos de actualización. ` +
        'Casi siempre significa que faltó TAURI_SIGNING_PRIVATE_KEY.',
    )
    process.exit(1)
  }

  const latest = buildLatestJson({ version, notes, baseUrl, artifacts, macos })
  const destino = join(dir, 'latest.json')
  writeFileSync(destino, `${JSON.stringify(latest, null, 2)}\n`)

  console.log(`latest.json para ${version} escrito en ${destino}`)
  for (const [target, entry] of Object.entries(latest.platforms)) {
    console.log(`  ${target} → ${entry.url.split('/').pop()}`)
  }
}

main()
