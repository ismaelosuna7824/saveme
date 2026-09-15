/**
 * Mermaid: carga diferida y colores del tema activo.
 *
 * Dos decisiones que conviene entender antes de tocar esto:
 *
 *  1. **Se carga en diferido.** Mermaid pesa más que el resto del editor junto.
 *     Importarlo arriba lo metería en el bundle inicial y lo pagaría todo el
 *     mundo, incluido quien no escribe un solo diagrama. Con `import()` dentro de
 *     la función, Vite lo parte en su propio trozo y solo se descarga la primera
 *     vez que aparece un bloque ```mermaid`.
 *
 *  2. **Los colores salen de los tokens del tema, no de Mermaid.** Mermaid trae
 *     sus propias paletas (`default`, `dark`, `forest`…) que no tienen nada que
 *     ver con las siete de esta app. Se usa `theme: 'base'` y se le pasan los
 *     tokens por `themeVariables`, así que un diagrama se ve como parte del
 *     documento y no como un injerto. Al cambiar de tema hay que **volver a
 *     renderizar**: el SVG se genera con los colores incrustados.
 *
 * Nota sobre `type-fest`: Mermaid 12 publica sus `.d.ts` importando de `type-fest`
 * sin declararlo como dependencia, así que `tsc` falla con «Cannot find module
 * 'type-fest'» en cuanto se importa un tipo suyo. Está en `devDependencies` solo
 * por eso: es un paquete de tipos, no pesa en el bundle. El día que Mermaid lo
 * declare, se puede quitar.
 */
import type { MermaidConfig } from 'mermaid'

type Mermaid = (typeof import('mermaid'))['default']

/** El cargador se guarda para no pedir el módulo dos veces. */
let loading: Promise<Mermaid> | null = null

export function loadMermaid(): Promise<Mermaid> {
  loading ??= import('mermaid').then((module) => module.default)
  return loading
}

/**
 * Traduce los tokens de la app a las variables de Mermaid.
 *
 * Es una función pura a propósito —recibe un lector de variables en vez de leer
 * el DOM— para poder comprobarla sin navegador. El mapeo importa: si un token
 * cambia de nombre en `styles.css`, el diagrama se queda con el color de Mermaid
 * por defecto y se nota mucho.
 */
export function mermaidThemeVariables(read: (name: string) => string): Record<string, string> {
  return {
    background: read('--color-background'),
    // Nodos: el mismo relleno que un panel, con el borde fuerte.
    primaryColor: read('--color-panel'),
    primaryTextColor: read('--color-foreground'),
    primaryBorderColor: read('--color-border-strong'),
    mainBkg: read('--color-panel'),
    nodeBorder: read('--color-border-strong'),
    nodeTextColor: read('--color-foreground'),
    // Aristas y sus etiquetas.
    lineColor: read('--color-muted-foreground'),
    textColor: read('--color-foreground'),
    edgeLabelBackground: read('--color-background'),
    // Subgrafos: un tono por debajo del panel para que se distingan.
    clusterBkg: read('--color-sunken'),
    clusterBorder: read('--color-border'),
    // Notas y subtemas.
    secondaryColor: read('--color-panel-raised'),
    tertiaryColor: read('--color-sunken'),
    titleColor: read('--color-foreground'),
    // La app es monoespaciada en el chrome y los diagramas son código: en mono
    // los identificadores se leen mejor y encaja con el resto.
    fontFamily: read('--font-mono'),
  }
}

/** Lee una variable CSS del documento, con recorte. Cadena vacía si no está. */
export function readCssVariable(name: string): string {
  if (typeof window === 'undefined') return ''
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

export function currentMermaidConfig(): MermaidConfig {
  return {
    startOnLoad: false,
    // `strict` sanea el HTML de las etiquetas. Los diagramas vienen de un
    // archivo que puede haber escrito un agente: no es HTML de confianza.
    securityLevel: 'strict',
    theme: 'base',
    themeVariables: mermaidThemeVariables(readCssVariable),
    fontFamily: readCssVariable('--font-mono'),
  }
}

/**
 * ¿Este lenguaje es un diagrama?
 *
 * Se acepta `mermaid` y el alias `mmd`, que usa bastante gente. Se compara en
 * minúsculas porque el fence de markdown llega tal cual lo escribió el autor.
 */
export function isDiagramLanguage(lang: string): boolean {
  const normalized = lang.trim().toLowerCase()
  return normalized === 'mermaid' || normalized === 'mmd'
}

let counter = 0

export interface RenderResult {
  svg?: string
  error?: string
}

/**
 * Renderiza un diagrama y devuelve el SVG, o el error de sintaxis.
 *
 * Nunca lanza: un diagrama mal escrito no puede romper la preview entera. El que
 * llama decide qué enseñar, pero siempre tiene las dos ramas cubiertas.
 */
export async function renderDiagram(code: string): Promise<RenderResult> {
  const mermaid = await loadMermaid()
  mermaid.initialize(currentMermaidConfig())

  // El id tiene que ser único: Mermaid lo usa para el elemento temporal donde
  // monta el SVG, y dos diagramas con el mismo id se pisan.
  counter += 1
  const id = `saveme-mermaid-${counter}`

  try {
    const { svg } = await mermaid.render(id, code)
    return { svg }
  } catch (cause) {
    // Mermaid deja el elemento temporal en el DOM cuando falla. Si no se limpia,
    // se acumulan cajas invisibles con el texto del error dentro.
    document.getElementById(id)?.remove()
    document.querySelector(`#d${id}`)?.remove()
    return { error: cause instanceof Error ? cause.message : String(cause) }
  }
}
