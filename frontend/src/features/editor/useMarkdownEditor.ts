import { useEffect, useRef, useState, type RefObject } from 'react'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
} from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { Compartment, EditorState } from '@codemirror/state'
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view'

import { savemeEditorTheme, savemeHighlighting } from '@/features/editor/cmTheme'
import { livePreview } from '@/features/editor/livePreview/livePreview'

export interface UseMarkdownEditorArgs {
  hostRef: RefObject<HTMLDivElement | null>
  /** `false` mientras no hay documento: el editor se crea cuando pasa a `true`. */
  ready: boolean
  /** Documento inicial. Solo se usa al montar el editor. */
  initialDoc: string
  /** Contenido que el editor debe adoptar cuando cambia `adoptVersion`. */
  docToAdopt: string
  /** Se incrementa cuando el documento debe reemplazarse desde fuera. */
  adoptVersion: number
  wrap: boolean
  fontSize: number
  /** `true` en modo `live`: el editor renderiza el markdown en línea. */
  livePreviewEnabled: boolean
  onDocChange: (doc: string) => void
}

export interface MarkdownEditorHandle {
  view: EditorView | null
  focus: () => void
}

/**
 * CodeMirror 6 configurado para markdown.
 *
 * `@codemirror/language-data` aporta los lenguajes de verdad para los bloques
 * de código con fence, así que un ```go se resalta como Go y no como texto.
 *
 * El editor es la fuente de verdad mientras se escribe: el estado de React solo
 * lo adopta al guardar o al recargar del disco (vía `adoptVersion`), para no
 * pelear con el cursor en cada pulsación.
 *
 * El contenedor del editor nunca se desmonta al cambiar de modo: en `preview`
 * se colapsa a ancho 0 en lugar de usar `display: none`, porque CodeMirror
 * necesita poder medir para no perder el scroll ni la selección.
 */
export function useMarkdownEditor({
  hostRef,
  ready,
  initialDoc,
  docToAdopt,
  adoptVersion,
  wrap,
  fontSize,
  livePreviewEnabled,
  onDocChange,
}: UseMarkdownEditorArgs): MarkdownEditorHandle {
  const viewRef = useRef<EditorView | null>(null)
  const [view, setView] = useState<EditorView | null>(null)

  const wrapCompartment = useRef(new Compartment())
  const themeCompartment = useRef(new Compartment())
  const livePreviewCompartment = useRef(new Compartment())
  const initialDocRef = useRef(initialDoc)
  const adoptedVersionRef = useRef(adoptVersion)

  // El valor más reciente, disponible para el efecto de creación sin volver a
  // dispararlo.
  initialDocRef.current = initialDoc

  const onDocChangeRef = useRef(onDocChange)
  useEffect(() => {
    onDocChangeRef.current = onDocChange
  })

  useEffect(() => {
    if (!ready) return
    const host = hostRef.current
    if (host === null) return

    const instance = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: initialDocRef.current,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          history(),
          foldGutter(),
          drawSelection(),
          dropCursor(),
          EditorState.allowMultipleSelections.of(true),
          indentOnInput(),
          bracketMatching(),
          rectangularSelection(),
          crosshairCursor(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          markdown({
            base: markdownLanguage,
            codeLanguages: languages,
            addKeymap: true,
          }),
          savemeHighlighting,
          // Los adornos del Live Preview se montan por compartment para poder
          // quitarlos al pasar a `source` sin recrear el editor: así no se
          // pierde ni el cursor ni el scroll.
          livePreviewCompartment.current.of(livePreviewEnabled ? livePreview() : []),
          themeCompartment.current.of(savemeEditorTheme(fontSize)),
          wrapCompartment.current.of(wrap ? EditorView.lineWrapping : []),
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, ...foldKeymap, indentWithTab]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onDocChangeRef.current(update.state.doc.toString())
          }),
        ],
      }),
    })

    viewRef.current = instance
    setView(instance)

    return () => {
      instance.destroy()
      viewRef.current = null
      setView(null)
    }
    // El editor se crea una sola vez por documento cargado: los cambios de wrap
    // y tamaño se aplican por compartment y los callbacks viven en un ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostRef, ready])

  useEffect(() => {
    const instance = viewRef.current
    if (instance === null) return
    instance.dispatch({
      effects: wrapCompartment.current.reconfigure(wrap ? EditorView.lineWrapping : []),
    })
  }, [wrap])

  useEffect(() => {
    const instance = viewRef.current
    if (instance === null) return
    instance.dispatch({
      effects: themeCompartment.current.reconfigure(savemeEditorTheme(fontSize)),
    })
  }, [fontSize])

  useEffect(() => {
    const instance = viewRef.current
    if (instance === null) return
    instance.dispatch({
      effects: livePreviewCompartment.current.reconfigure(
        livePreviewEnabled ? livePreview() : [],
      ),
    })
  }, [livePreviewEnabled])

  useEffect(() => {
    const instance = viewRef.current
    if (instance === null) return
    if (adoptedVersionRef.current === adoptVersion) return
    adoptedVersionRef.current = adoptVersion
    if (instance.state.doc.toString() === docToAdopt) return
    instance.dispatch({
      changes: { from: 0, to: instance.state.doc.length, insert: docToAdopt },
    })
  }, [adoptVersion, docToAdopt])

  return {
    view,
    focus: () => viewRef.current?.focus(),
  }
}
