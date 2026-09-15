/**
 * Espejo en TypeScript de `domain.Slug` del core
 * (backend/internal/domain/slug.go).
 *
 * Se duplica a propósito, y solo para *previsualizar* el destino en la UI
 * (`SaveMe App` → `saveme-app`) antes de crear un proyecto. La autoridad sigue
 * siendo el core: si los dos algoritmos divergen, gana el slug que devuelva la
 * API.
 */

const DIACRITICS: Record<string, string> = {
  á: 'a', à: 'a', ä: 'a', â: 'a', ã: 'a', å: 'a',
  é: 'e', è: 'e', ë: 'e', ê: 'e',
  í: 'i', ì: 'i', ï: 'i', î: 'i',
  ó: 'o', ò: 'o', ö: 'o', ô: 'o', õ: 'o',
  ú: 'u', ù: 'u', ü: 'u', û: 'u',
  ñ: 'n', ç: 'c', ý: 'y',
}

export function slugify(value: string): string {
  let out = ''
  for (const char of value.toLowerCase().trim()) {
    const replacement = DIACRITICS[char]
    if (replacement !== undefined) {
      out += replacement
      continue
    }
    out += /[a-z0-9]/.test(char) ? char : '-'
  }
  return out.replace(/-+/g, '-').replace(/^-|-$/g, '')
}
