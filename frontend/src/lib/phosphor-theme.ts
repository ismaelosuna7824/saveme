/**
 * Tema TextMate para shiki, alineado con la paleta terminal de SaveMe.
 *
 * Se define en código (y no importando un tema de shiki) para que el resaltado
 * use exactamente los mismos colores que el resto de la app.
 *
 * Los colores son **variables CSS, no literales**. Shiki las escribe tal cual en
 * el `style` de cada token y el navegador las resuelve con el tema que esté
 * activo, así que cambiar de tema recolorea el código sin volver a resaltarlo.
 * Con colores fijos, el tema claro `paper` habría pintado texto claro sobre su
 * fondo claro: ilegible. El fondo y el color base salen de los tokens del tema
 * (`--color-sunken` los sobreescribe `.code-block pre` de todas formas).
 */
import type { ThemeRegistrationRaw } from 'shiki'

export const phosphorTheme: ThemeRegistrationRaw = {
  name: 'saveme-phosphor',
  type: 'dark',
  colors: {
    'editor.background': 'var(--color-sunken)',
    'editor.foreground': 'var(--color-foreground)',
  },
  settings: [
    {
      settings: {
        background: 'var(--color-sunken)',
        foreground: 'var(--color-foreground)',
      },
    },
    {
      scope: ['comment', 'punctuation.definition.comment', 'string.comment'],
      settings: { foreground: 'var(--color-syntax-comment)', fontStyle: 'italic' },
    },
    {
      scope: ['string', 'constant.other.symbol', 'constant.other.key'],
      settings: { foreground: 'var(--color-syntax-string)' },
    },
    {
      scope: ['constant.numeric', 'constant.language', 'constant.character.escape'],
      settings: { foreground: 'var(--color-syntax-number)' },
    },
    {
      scope: ['keyword', 'storage', 'storage.type', 'storage.modifier', 'keyword.operator.new'],
      settings: { foreground: 'var(--color-syntax-keyword)' },
    },
    {
      scope: ['keyword.operator', 'punctuation.separator', 'punctuation.terminator'],
      settings: { foreground: 'var(--color-syntax-operator)' },
    },
    {
      scope: ['entity.name.function', 'support.function', 'meta.function-call'],
      settings: { foreground: 'var(--color-syntax-function)' },
    },
    {
      scope: ['entity.name.type', 'entity.name.class', 'support.class', 'support.type'],
      settings: { foreground: 'var(--color-syntax-type)' },
    },
    {
      scope: ['variable', 'variable.parameter', 'meta.definition.variable'],
      settings: { foreground: 'var(--color-foreground)' },
    },
    {
      scope: ['variable.other.property', 'meta.object-literal.key', 'support.type.property-name'],
      settings: { foreground: 'var(--color-syntax-property)' },
    },
    {
      scope: ['punctuation.definition.tag', 'entity.name.tag'],
      settings: { foreground: 'var(--color-syntax-keyword)' },
    },
    {
      scope: ['entity.other.attribute-name'],
      settings: { foreground: 'var(--color-syntax-type)' },
    },
    {
      scope: ['markup.heading', 'entity.name.section'],
      settings: { foreground: 'var(--color-syntax-keyword)', fontStyle: 'bold' },
    },
    {
      scope: ['markup.bold'],
      settings: { foreground: 'var(--color-syntax-type)', fontStyle: 'bold' },
    },
    {
      scope: ['markup.italic'],
      settings: { foreground: 'var(--color-syntax-string)', fontStyle: 'italic' },
    },
    {
      scope: ['markup.inline.raw', 'markup.raw', 'string.other.link'],
      settings: { foreground: 'var(--color-syntax-string)' },
    },
    {
      scope: ['markup.quote'],
      settings: { foreground: 'var(--color-muted-foreground)', fontStyle: 'italic' },
    },
    {
      scope: ['markup.list', 'punctuation.definition.list'],
      settings: { foreground: 'var(--color-syntax-keyword)' },
    },
    {
      scope: ['markup.inserted', 'meta.diff.header.to-file'],
      settings: { foreground: 'var(--color-syntax-string)' },
    },
    {
      scope: ['markup.deleted', 'meta.diff.header.from-file'],
      settings: { foreground: 'var(--color-destructive)' },
    },
    {
      scope: ['invalid', 'invalid.illegal'],
      settings: { foreground: 'var(--color-destructive)', fontStyle: 'underline' },
    },
  ],
}
