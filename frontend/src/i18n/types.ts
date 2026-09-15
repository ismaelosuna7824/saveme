/**
 * Tipos de la internacionalización.
 *
 * La decisión de fondo: el español es la fuente de verdad de las claves, y el
 * inglés se declara con `satisfies` contra su forma. Eso convierte un olvido en un
 * error de compilación en vez de en un texto sin traducir que aparece en
 * producción, que es la forma habitual en que se degradan las traducciones.
 */

/** Idiomas soportados. Añadir uno es añadir una carpeta en `locales/`. */
export type Locale = 'es' | 'en'

export const LOCALES: readonly Locale[] = ['es', 'en']

/** Cómo se llama cada idioma en el propio idioma, como se hace en los menús. */
export const LOCALE_LABEL: Record<Locale, string> = {
  es: 'Español',
  en: 'English',
}

export const LOCALE_HINT: Record<Locale, string> = {
  es: 'La interfaz en español.',
  en: 'The interface in English.',
}

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value)
}

/**
 * Convierte los literales de la traducción en `string`.
 *
 * Hace falta porque `as const` da a cada texto su tipo literal, y entonces
 * `satisfies` exigiría que el inglés dijera exactamente las mismas palabras que el
 * español. Lo que debe coincidir son las **claves**, no los valores.
 */
export type DeepString<T> = {
  [K in keyof T]: T[K] extends string ? string : DeepString<T[K]>
}

/**
 * Rutas con puntos hasta cada texto: `'shell.nav.inbox'`.
 *
 * Es lo que hace que `t('shell.nav.inbox')` tenga autocompletado y que una clave
 * mal escrita no compile.
 */
export type DotPaths<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string
    ? `${Prefix}${K}`
    : T[K] extends Record<string, unknown>
      ? DotPaths<T[K], `${Prefix}${K}.`>
      : never
}[keyof T & string]

/**
 * Claves base de un plural escrito como hermanos: `clave_one` / `clave_other`.
 *
 * Hace falta porque la clave que se pasa a `t()` es la base (`'editor.count'`),
 * que no es un texto hoja y por tanto no sale de `DotPaths`. Se admite la base
 * cuando el objeto que la contiene tiene una hermana `_one`.
 */
type StripOneSuffix<K extends string> = K extends `${infer Base}_one` ? Base : never

type SiblingPluralPaths<T, Prefix extends string = ''> = {
  [K in keyof T & string]: K extends `${string}_one`
    ? `${Prefix}${StripOneSuffix<K>}`
    : T[K] extends Record<string, unknown>
      ? SiblingPluralPaths<T[K], `${Prefix}${K}.`>
      : never
}[keyof T & string]

/**
 * Claves base de un plural escrito como objeto anidado: `clave: { one, other }`.
 *
 * Se admiten las dos formas a propósito. La recomendada es la de hermanos, pero
 * la anidada es igual de razonable y rechazarla solo habría producido un error de
 * tipos desconcertante en quien la usara.
 */
type NestedPluralPaths<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends { one: string; other: string }
    ? `${Prefix}${K}`
    : T[K] extends Record<string, unknown>
      ? NestedPluralPaths<T[K], `${Prefix}${K}.`>
      : never
}[keyof T & string]

/** Cualquier clave válida: un texto, o la base de un plural en sus dos formas. */
export type AnyPath<T> = DotPaths<T> | SiblingPluralPaths<T> | NestedPluralPaths<T>

/** Valores admitidos en la interpolación de una plantilla. */
export type Vars = Record<string, string | number>
