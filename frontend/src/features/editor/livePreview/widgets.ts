/**
 * Widgets interactivos del Live Preview.
 *
 * Un widget es un trozo de DOM que sustituye a un rango del documento. La clave
 * para que sean interactivos: por defecto CodeMirror ignora los eventos que
 * ocurren dentro de un widget, así que los `addEventListener` que ponemos aquí
 * son los que reciben el click, y desde ahí despachamos el cambio al documento.
 * El markdown sigue siendo la fuente de verdad: no hay estado propio del widget.
 */
import { EditorView, WidgetType } from '@codemirror/view'

import { renderDiagram } from '@/lib/mermaid'

/**
 * Casilla de tarea clicable.
 *
 * `from`/`to` son el rango del marcador `[ ]` / `[x]` en el documento, que es lo
 * único que se reescribe al marcar. No se toca el resto de la línea, así que el
 * texto de la tarea y el historial de deshacer quedan intactos.
 */
export class TaskCheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly from: number,
    readonly to: number,
  ) {
    super()
  }

  /** Reutiliza el DOM cuando nada relevante cambió, para no parpadear. */
  override eq(other: TaskCheckboxWidget): boolean {
    return other.checked === this.checked && other.from === this.from && other.to === this.to
  }

  override toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.className = 'cm-lp-task'
    box.checked = this.checked
    box.setAttribute('aria-label', this.checked ? 'Marcar como pendiente' : 'Marcar como hecha')

    // Sin esto, el mousedown mueve el cursor y la línea deja de estar "activa",
    // lo que reconstruye las decoraciones justo antes del click y se lo come.
    box.addEventListener('mousedown', (event) => {
      event.preventDefault()
    })
    box.addEventListener('click', (event) => {
      event.preventDefault()
      const insert = this.checked ? '[ ]' : '[x]'
      view.dispatch({
        changes: { from: this.from, to: this.to, insert },
        // Mantener el foco en el editor tras marcar, como hace Obsidian.
        selection: { anchor: Math.min(this.to + 1, view.state.doc.length) },
      })
    })
    return box
  }

  /** El widget gestiona sus propios eventos: CodeMirror no debe interceptarlos. */
  override ignoreEvent(): boolean {
    return true
  }
}

/**
 * Viñeta de lista. Se dibuja como carácter y no como `-` para que una lista se
 * lea como una lista sin dejar de ser markdown por debajo.
 */
export class BulletWidget extends WidgetType {
  constructor(readonly glyph: string) {
    super()
  }

  override eq(other: BulletWidget): boolean {
    return other.glyph === this.glyph
  }

  override toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'cm-lp-bullet'
    span.textContent = this.glyph
    return span
  }
}

/**
 * Diagrama Mermaid dibujado en el propio editor.
 *
 * Es el widget más delicado de los tres, por dos motivos:
 *
 *  - **Renderiza en diferido.** Mermaid es asíncrono y pesa: el widget aparece
 *    al instante con un hueco y se rellena cuando el SVG está listo. Después hay
 *    que pedirle a CodeMirror que vuelva a medir, porque el alto cambió y si no
 *    el scroll queda descuadrado.
 *  - **Se redibuja al cambiar de tema.** El SVG lleva los colores incrustados,
 *    así que no basta con CSS: hay que volver a generar. Lo vigila el propio
 *    widget, que para eso es el único que sabe cuándo está montado.
 *
 * Un diagrama con error no se sustituye: se deja el código a la vista, que es lo
 * que permite arreglarlo.
 */
export class MermaidWidget extends WidgetType {
  constructor(readonly code: string) {
    super()
  }

  override eq(other: MermaidWidget): boolean {
    return other.code === this.code
  }

  override toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement('div')
    wrapper.className = 'cm-lp-mermaid'
    wrapper.setAttribute('data-diagram', 'mermaid')

    let observer: MutationObserver | null = null
    let cancelled = false

    const draw = () => {
      void renderDiagram(this.code).then((result) => {
        if (cancelled) return
        // Si falla, el código se queda a la vista: sustituirlo por el error
        // dejaría al usuario sin lo que tiene que corregir.
        if (result.svg === undefined) {
          wrapper.textContent = this.code
          wrapper.classList.add('cm-lp-mermaid--error')
        } else {
          wrapper.innerHTML = result.svg
          wrapper.classList.remove('cm-lp-mermaid--error')
        }
        // El alto cambió: sin esto CodeMirror sigue midiendo el hueco anterior.
        view.requestMeasure()
      })
    }

    draw()

    // Al cambiar de tema hay que redibujar. Se observa el atributo del `<html>`,
    // que es donde `useThemeSync` deja el tema activo.
    observer = new MutationObserver(() => {
      draw()
    })
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })

    // CodeMirror no ofrece un gancho de destrucción en el widget, así que se
    // guarda el observer en el propio nodo y se corta cuando el nodo sale del
    // documento: sin esto, cada diagrama que se desplaza fuera de pantalla deja
    // un observador vivo para siempre.
    const originalRemove = wrapper.remove.bind(wrapper)
    wrapper.remove = () => {
      cancelled = true
      observer?.disconnect()
      observer = null
      originalRemove()
    }

    return wrapper
  }

  /** El diagrama no captura eventos: dentro solo hay un SVG, sin nada que pulsar. */
  override ignoreEvent(): boolean {
    return false
  }

  /** Alto de reserva mientras Mermaid dibuja, para que el scroll no dé un salto. */
  override get estimatedHeight(): number {
    return 180
  }
}
