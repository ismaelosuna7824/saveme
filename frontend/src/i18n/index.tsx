/**
 * Internacionalización.
 *
 * Sin dependencias a propósito. Para dos idiomas y una interfaz de este tamaño, un
 * diccionario tipado resuelve lo que hace falta —claves con autocompletado,
 * interpolación y plurales— y a cambio da algo que las bibliotecas no dan: **si
 * falta una traducción, no compila**. Un `i18next` mal tipado deja pasar la clave
 * que falta y el usuario ve la interfaz a medias.
 *
 * Lo que no cubre, y conviene saberlo: formatos de fecha y número por idioma, y
 * plurales con más de dos formas (ruso, árabe). Cuando haga falta, se añade aquí.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react'

import { en } from './locales/en'
import { es, type TranslationShape } from './locales/es'
import { isLocale, type AnyPath, type Locale, type Vars } from './types'

export { LOCALES, LOCALE_HINT, LOCALE_LABEL, isLocale } from './types'
export type { Locale } from './types'

/** Clave válida de traducción: `'shell.nav.inbox'`. */
export type TranslationKey = AnyPath<TranslationShape>

const BUNDLES: Record<Locale, unknown> = { es, en }

/** Idioma del sistema, para cuando el usuario no ha elegido ninguno. */
export function detectLocale(): Locale {
  if (typeof navigator === 'undefined') return 'es'
  const candidates = [navigator.language, ...(navigator.languages ?? [])]
  for (const candidate of candidates) {
    const tag = (candidate ?? '').toLowerCase()
    // Cualquier variante regional del español cuenta como español: es-ES, es-MX…
    if (tag.startsWith('es')) return 'es'
    if (tag.startsWith('en')) return 'en'
  }
  // Si no reconocemos el idioma, el español: es el idioma en el que está escrito
  // el producto y el que entienden sus usuarios actuales.
  return 'es'
}

/** Resuelve el valor guardado: vacío significa "el del sistema". */
export function resolveLocale(configured: string | undefined): Locale {
  if (configured !== undefined && configured !== '' && isLocale(configured)) {
    return configured
  }
  return detectLocale()
}

function lookup(bundle: unknown, key: string): string | undefined {
  let node: unknown = bundle
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined
    node = (node as Record<string, unknown>)[part]
  }
  return typeof node === 'string' ? node : undefined
}

function interpolate(template: string, vars: Vars | undefined): string {
  if (vars === undefined) return template
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = vars[name]
    return value === undefined ? whole : String(value)
  })
}

/**
 * Busca el texto, resolviendo el plural si procede.
 *
 * Convención recomendada: `clave_one` / `clave_other`, aunque también se acepta
 * `clave: { one, other }`. Con `count` en las variables se usa la forma que
 * corresponda. Cubre español e inglés; para idiomas con más formas (ruso, árabe)
 * habría que ampliar esto.
 */
function translate_impl(locale: Locale, key: string, vars: Vars | undefined): string {
  const bundle = BUNDLES[locale]
  const count = vars?.['count']

  let template: string | undefined
  if (typeof count === 'number') {
    const form = count === 1 ? 'one' : 'other'
    // Se admiten las dos formas de escribir un plural: claves hermanas
    // (`clave_one`) o un objeto anidado (`clave: { one, other }`).
    template =
      lookup(bundle, `${key}_${form}`) ??
      lookup(bundle, `${key}.${form}`) ??
      lookup(bundle, key)
  } else {
    template = lookup(bundle, key)
  }

  if (template === undefined) {
    // Caer al español evita el texto vacío en pantalla; y en desarrollo se avisa
    // por consola para que la clave que falta se arregle, no se olvide.
    const fallback = lookup(BUNDLES.es, key)
    if (fallback !== undefined) {
      if (import.meta.env.DEV) {
        console.warn(`[i18n] falta "${key}" en ${locale}; uso el español`)
      }
      return interpolate(fallback, vars)
    }
    if (import.meta.env.DEV) {
      console.warn(`[i18n] la clave "${key}" no existe`)
    }
    return key
  }
  return interpolate(template, vars)
}

export type Translate = (key: TranslationKey, vars?: Vars) => string

/**
 * Idioma activo, para el código que no es un componente.
 *
 * Las utilidades de formato —fechas relativas, tamaños— no son componentes y no
 * pueden llamar a un hook, pero sí necesitan saber el idioma. El proveedor deja
 * aquí el activo y ellas lo leen. Es el único estado global de la i18n, y existe
 * porque la alternativa era pasar `t` por media docena de firmas.
 */
let activeLocale: Locale = 'es'

/** Traduce fuera de React. Dentro de un componente, usa `useT()`. */
export function translate(key: TranslationKey, vars?: Vars): string {
  return translate_impl(activeLocale, key, vars)
}

/** Para lo que necesite formatear según el idioma (números, fechas). */
export function activeLocaleTag(): Locale {
  return activeLocale
}

/**
 * Traduce un error del core a partir de su código.
 *
 * El sobre de error trae `{code, message}` y el mensaje viene en español. Solo
 * los códigos con mensaje fijo están en el diccionario; para el resto —los que
 * llevan pegado el detalle de la validación— se devuelve `fallback` tal cual,
 * porque traducir el envoltorio y dejar el detalle en español se lee peor.
 *
 * Se resuelve por código y no por texto para que el idioma de la interfaz no
 * dependa de en qué idioma esté escrito el backend.
 */
export function translateError(
  code: string,
  fallback: string,
  vars?: Vars,
): string {
  const key = `errors.${code}`
  const template = lookup(BUNDLES[activeLocale], key) ?? lookup(BUNDLES.es, key)
  return template === undefined ? fallback : interpolate(template, vars)
}

interface I18nValue {
  locale: Locale
  t: Translate
}

const I18nContext = createContext<I18nValue | null>(null)

export function I18nProvider({
  locale,
  children,
}: {
  /** Idioma ya resuelto. `resolveLocale(config.language)` suele ser el origen. */
  locale: Locale
  children: ReactNode
}) {
  const t = useCallback<Translate>(
    (key, vars) => translate_impl(locale, key, vars),
    [locale],
  )

  // Se asigna durante el render, no en un efecto: `useT()` ya devuelve el idioma
  // nuevo en este mismo render, y si `translate()` siguiera con el viejo, esa
  // pasada mezclaría los dos idiomas —textos en uno, fechas y tamaños en otro—.
  // La asignación es idempotente y no dispara renders.
  activeLocale = locale

  // Mantener `<html lang>` sincronizado no es cosmético: de ahí salen la
  // hyphenation, el corrector ortográfico y la pronunciación para lectores de
  // pantalla.
  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const value = useMemo<I18nValue>(() => ({ locale, t }), [locale, t])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

/**
 * Traductor.
 *
 * Si se usa fuera del proveedor devuelve un traductor al español en vez de lanzar:
 * así una pantalla aislada —o una prueba— no revienta por no estar envuelta.
 */
export function useT(): Translate {
  const value = useContext(I18nContext)
  const fallback = useCallback<Translate>((key, vars) => translate_impl('es', key, vars), [])
  return value?.t ?? fallback
}

/** Idioma activo, para lo que necesite saberlo (fechas, ordenación…). */
export function useLocale(): Locale {
  return useContext(I18nContext)?.locale ?? 'es'
}
