/**
 * Normalizadores de campos de la API.
 *
 * En Go un `map[string]int` o un `[]string` nulos se serializan como `null`,
 * no como `{}` / `[]`. El contrato los declara como colecciones, así que en el
 * borde de la app se normalizan una sola vez para que ningún componente tenga
 * que defenderse (ni reviente con `Object.entries(null)`).
 *
 * Los parámetros son `unknown` a propósito: el tipo del contrato dice lo que
 * *debería* llegar, y estas funciones asumen lo que *puede* llegar.
 */

export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

export function asArray<T>(value: unknown): T[] {
  // `Array.isArray` estrecha `unknown` a `any[]`, que ya es asignable a `T[]`.
  return Array.isArray(value) ? value : []
}

export function asCounts(value: unknown): Record<string, number> {
  if (typeof value !== 'object' || value === null) return {}
  const out: Record<string, number> = {}
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === 'number') out[key] = raw
  }
  return out
}
