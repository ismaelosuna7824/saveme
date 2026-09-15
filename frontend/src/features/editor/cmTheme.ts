import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'

/**
 * Tema de CodeMirror con la paleta terminal: fondo de panel, ámbar fósforo para
 * la sintaxis, selección en ámbar translúcido, líneas de gutter apagadas y
 * línea activa apenas insinuada.
 */
export function savemeEditorTheme(fontSize: number) {
  return EditorView.theme(
    {
      '&': {
        backgroundColor: '#11171a',
        color: '#cdd9dc',
        fontSize: `${fontSize}px`,
        height: '100%',
      },
      '.cm-content': {
        caretColor: '#ffb454',
        fontFamily: 'inherit',
        padding: '8px 0',
      },
      '.cm-cursor, .cm-dropCursor': {
        borderLeftColor: '#ffb454',
        borderLeftWidth: '2px',
      },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
        backgroundColor: 'rgba(255, 180, 84, 0.18)',
      },
      '.cm-gutters': {
        backgroundColor: '#0e1416',
        color: '#41565b',
        border: 'none',
        borderRight: '1px solid #1e2a2e',
      },
      '.cm-lineNumbers .cm-gutterElement': {
        padding: '0 8px 0 6px',
      },
      '.cm-activeLineGutter': {
        backgroundColor: '#161f22',
        color: '#7fd88f',
      },
      '.cm-activeLine': {
        backgroundColor: 'rgba(255, 255, 255, 0.022)',
      },
      '.cm-selectionMatch': {
        backgroundColor: 'rgba(127, 216, 143, 0.15)',
      },
      '.cm-searchMatch': {
        backgroundColor: 'rgba(255, 180, 84, 0.18)',
        outline: '1px solid rgba(255, 180, 84, 0.4)',
      },
      '.cm-searchMatch.cm-searchMatch-selected': {
        backgroundColor: 'rgba(255, 180, 84, 0.35)',
      },
      '.cm-panels': {
        backgroundColor: '#11171a',
        color: '#cdd9dc',
        borderTop: '1px solid #1e2a2e',
      },
      '.cm-panel input, .cm-panel button': {
        fontFamily: 'inherit',
        fontSize: '11px',
        backgroundColor: '#090c0d',
        color: '#cdd9dc',
        border: '1px solid #1e2a2e',
      },
      '.cm-tooltip': {
        backgroundColor: '#11171a',
        border: '1px solid #1e2a2e',
      },
      '.cm-foldPlaceholder': {
        backgroundColor: '#1e2a2e',
        border: 'none',
        color: '#6b7f85',
        padding: '0 3px',
      },
      '.cm-matchingBracket, .cm-nonmatchingBracket': {
        backgroundColor: 'rgba(255, 180, 84, 0.15)',
        outline: 'none',
      },
    },
    { dark: true },
  )
}

/** Colores de sintaxis del markdown (y de los bloques de código embebidos). */
export const savemeHighlightStyle = HighlightStyle.define([
  { tag: t.heading, color: '#ffb454', fontWeight: '600' },
  { tag: t.strong, color: '#ffd479', fontWeight: '600' },
  { tag: t.emphasis, color: '#7fd88f', fontStyle: 'italic' },
  { tag: t.strikethrough, color: '#6b7f85', textDecoration: 'line-through' },
  { tag: t.link, color: '#8fd3ff', textDecoration: 'underline' },
  { tag: t.url, color: '#8fd3ff' },
  { tag: t.monospace, color: '#7fd88f' },
  { tag: t.quote, color: '#6b7f85', fontStyle: 'italic' },
  { tag: t.list, color: '#ffb454' },
  { tag: t.contentSeparator, color: '#41565b' },
  { tag: t.comment, color: '#4b6165', fontStyle: 'italic' },
  { tag: [t.keyword, t.operatorKeyword, t.controlKeyword], color: '#ffb454' },
  { tag: [t.string, t.special(t.string)], color: '#7fd88f' },
  { tag: [t.number, t.bool, t.null, t.atom], color: '#e5a3ff' },
  { tag: [t.typeName, t.className], color: '#ffd479' },
  { tag: t.function(t.variableName), color: '#8fd3ff' },
  { tag: [t.propertyName, t.attributeName], color: '#9fd2c4' },
  { tag: t.tagName, color: '#ffb454' },
  { tag: t.operator, color: '#93a7ab' },
  { tag: t.punctuation, color: '#7b8f94' },
  { tag: t.invalid, color: '#ff6b6b' },
])

export const savemeHighlighting = syntaxHighlighting(savemeHighlightStyle)
