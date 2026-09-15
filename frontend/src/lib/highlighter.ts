/**
 * Resaltador de sintaxis para la preview de markdown.
 *
 * Se usa shiki con bundle fino y motor de regex en JavaScript (`shiki/engine/javascript`)
 * en vez de oniguruma: así no hace falta cargar un `.wasm` en runtime, lo que
 * importa en una app de escritorio que debe arrancar sin red y sin peticiones
 * externas. La carga es síncrona y perezosa: el highlighter se construye en el
 * primer bloque de código que se renderiza.
 *
 * Los lenguajes se importan estáticamente (y no con `import()` dinámico) para
 * que el bundle quede determinista y el arranque no dependa de chunks extra.
 */
import { createHighlighterCoreSync, type HighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'

import { phosphorTheme } from './phosphor-theme'

import bash from 'shiki/langs/bash.mjs'
import css from 'shiki/langs/css.mjs'
import diff from 'shiki/langs/diff.mjs'
import go from 'shiki/langs/go.mjs'
import html from 'shiki/langs/html.mjs'
import javascript from 'shiki/langs/javascript.mjs'
import json from 'shiki/langs/json.mjs'
import jsx from 'shiki/langs/jsx.mjs'
import markdown from 'shiki/langs/markdown.mjs'
import python from 'shiki/langs/python.mjs'
import rust from 'shiki/langs/rust.mjs'
import sql from 'shiki/langs/sql.mjs'
import toml from 'shiki/langs/toml.mjs'
import tsx from 'shiki/langs/tsx.mjs'
import typescript from 'shiki/langs/typescript.mjs'
import yaml from 'shiki/langs/yaml.mjs'

const THEME = phosphorTheme.name ?? 'saveme-phosphor'

/** Alias cortos que aparecen en los fences de markdown (` ```ts `). */
const LANGUAGE_ALIASES: Record<string, string> = {
  ts: 'typescript',
  js: 'javascript',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  py: 'python',
  md: 'markdown',
  rs: 'rust',
  golang: 'go',
  console: 'bash',
  jsonc: 'json',
}

let highlighter: HighlighterCore | null = null
let loadedLanguages = new Set<string>()

function getHighlighter(): HighlighterCore {
  if (highlighter) return highlighter
  highlighter = createHighlighterCoreSync({
    themes: [phosphorTheme],
    langs: [
      tsx,
      typescript,
      jsx,
      javascript,
      json,
      bash,
      go,
      rust,
      python,
      css,
      html,
      yaml,
      markdown,
      sql,
      diff,
      toml,
    ],
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  })
  loadedLanguages = new Set(highlighter.getLoadedLanguages())
  return highlighter
}

/**
 * Devuelve el HTML resaltado del bloque, o `null` si no se pudo resaltar (el
 * llamador cae al `<pre><code>` plano).
 *
 * El HTML sale de shiki, que escapa el texto del código; se inyecta con
 * `dangerouslySetInnerHTML` porque es la única forma de renderizar los spans por
 * token sin reconstruir el árbol a mano.
 */
export function highlightCode(code: string, lang: string): string | null {
  const normalized = lang.trim().toLowerCase()
  if (normalized.length === 0 || normalized === 'text' || normalized === 'plaintext') return null
  const canonical = LANGUAGE_ALIASES[normalized] ?? normalized
  if (!loadedLanguages.has(canonical)) return null
  try {
    return getHighlighter().codeToHtml(code, { lang: canonical, theme: THEME })
  } catch {
    // Un lenguaje problemático no debe romper la preview.
    return null
  }
}
