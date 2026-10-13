/**
 * The editor's colours, built from this app's own tokens (T222).
 *
 * Monaco takes a theme as plain hex, so nothing here can be a utility: the tokens are read off the
 * live document — the way `LiveTerminal` reads `--terminal` for xterm — and turned into the two
 * tables Monaco wants, the token rules and the widget colours. `--code` and the seven `--syntax-*`
 * are the same values the hand-written highlighter painted with, so the file the boss reads is the
 * colour it has always been; everything else about it is VS Code's.
 *
 * A theme is built per appearance, Dark and Light, because `monaco.editor.defineTheme` is global
 * and a capture harness draws the Light document beside the app's own Dark one. Neither `--code`
 * nor the `--syntax-*` set has a Light value today — the code surface is dark in both — so the two
 * come out alike, and will part on their own the day `tokens.css` says they should.
 */

/** One Monarch token kind and the colour it takes. Monaco writes rule colours without the `#`. */
export interface CodeThemeRule {
  token: string
  foreground: string
  fontStyle?: string
}

/** A theme as `monaco.editor.defineTheme` takes one. */
export interface CodeTheme {
  base: 'vs' | 'vs-dark'
  inherit: boolean
  rules: CodeThemeRule[]
  colors: Record<string, string>
}

/** The names the two themes are registered under. */
export const CODE_THEMES = { dark: 'tinycorp-dark', light: 'tinycorp-light' } as const

export type Appearance = keyof typeof CODE_THEMES

/** Reads one custom property off the document; `''` for one the sheet does not declare. */
export type ReadToken = (name: string) => string

/**
 * A colour with an alpha on it, as `#rrggbbaa`. Monaco parses hex and nothing else — no
 * `color-mix()`, no `var()` — so every wash the design states as a percentage is mixed here.
 * A value that is not a plain `#rgb` or `#rrggbb` is handed back untouched rather than mangled.
 */
export function withAlpha(colour: string, alpha: number): string {
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(colour)
  const full = short === null ? /^#[0-9a-f]{6}$/i.test(colour) : false
  if (short === null && !full) return colour
  const hex = short === null ? colour : `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`
  const level = Math.round(Math.min(Math.max(alpha, 0), 1) * 255)
    .toString(16)
    .padStart(2, '0')
  return `${hex}${level}`
}

/** Monaco's token rules carry the hex without its `#`; its colours carry it. */
function bare(colour: string): string {
  return colour.replace(/^#/, '')
}

/**
 * The theme, from whatever the tokens say right now.
 *
 * The token rules map Monarch's kinds onto the seven `--syntax-*` — the same mapping `TOKEN` in
 * `Viewers.tsx` held, widened where Monaco tells things apart the little highlighter could not: a
 * JSON key from a JSON string, an HTML attribute from its tag, a regular expression from either.
 */
export function codeTheme(read: ReadToken, appearance: Appearance): CodeTheme {
  const token = (name: string, fallback: string) => {
    const value = read(name).trim()
    return value === '' ? fallback : value
  }
  const ground = token('--code', '#0b1220')
  const plain = token('--syntax-plain', '#c9d3e4')
  const keyword = token('--syntax-keyword', '#c4b5fd')
  const type = token('--syntax-type', '#7dd3fc')
  const call = token('--syntax-call', '#a5b4fc')
  const string = token('--syntax-string', '#fdba74')
  const number = token('--syntax-number', '#fcd34d')
  const comment = token('--syntax-comment', '#64748b')
  const punctuation = token('--muted-foreground', '#94a3b8')
  const gutter = token('--code-gutter', '#475569')
  const foreground = token('--foreground', '#f8fafc')
  const primary = token('--primary', '#6366f1')
  const border = token('--border', '#334155')
  const popover = token('--popover', '#1e293b')
  const popoverInk = token('--popover-foreground', '#f8fafc')
  const danger = token('--brand-danger', '#ef4444')
  const warning = token('--brand-warning', '#f59e0b')
  const info = token('--color-info-foreground', '#a5b4fc')

  return {
    base: appearance === 'light' ? 'vs' : 'vs-dark',
    // Not inherited: every colour the editor draws is one of ours, or it is the surface showing
    // through. Inheriting would leave VS Code's own blues in the half of the widget nobody named.
    inherit: false,
    rules: [
      { token: '', foreground: bare(plain) },
      { token: 'comment', foreground: bare(comment), fontStyle: 'italic' },
      { token: 'keyword', foreground: bare(keyword) },
      { token: 'operator', foreground: bare(keyword) },
      { token: 'tag', foreground: bare(keyword) },
      { token: 'metatag', foreground: bare(keyword) },
      { token: 'annotation', foreground: bare(keyword) },
      { token: 'type', foreground: bare(type) },
      { token: 'type.identifier', foreground: bare(type) },
      { token: 'namespace', foreground: bare(type) },
      { token: 'constructor', foreground: bare(type) },
      { token: 'attribute.name', foreground: bare(call) },
      { token: 'function', foreground: bare(call) },
      { token: 'identifier', foreground: bare(plain) },
      { token: 'variable', foreground: bare(plain) },
      { token: 'string', foreground: bare(string) },
      { token: 'string.key', foreground: bare(type) },
      { token: 'attribute.value', foreground: bare(string) },
      { token: 'regexp', foreground: bare(string) },
      { token: 'number', foreground: bare(number) },
      { token: 'constant', foreground: bare(number) },
      { token: 'delimiter', foreground: bare(punctuation) },
      { token: 'invalid', foreground: bare(danger) },
    ],
    colors: {
      'editor.background': ground,
      'editor.foreground': plain,
      'editorCursor.foreground': plain,
      'editor.lineHighlightBackground': withAlpha(foreground, 0.04),
      'editor.lineHighlightBorder': '#00000000',
      'editor.selectionBackground': withAlpha(primary, 0.45),
      'editor.inactiveSelectionBackground': withAlpha(primary, 0.22),
      'editor.selectionHighlightBackground': withAlpha(primary, 0.18),
      'editor.wordHighlightBackground': withAlpha(primary, 0.18),
      'editor.wordHighlightStrongBackground': withAlpha(primary, 0.24),
      'editor.findMatchBackground': withAlpha(warning, 0.38),
      'editor.findMatchHighlightBackground': withAlpha(warning, 0.2),
      'editorLineNumber.foreground': gutter,
      'editorLineNumber.activeForeground': foreground,
      'editorGutter.background': ground,
      'editorIndentGuide.background1': withAlpha(gutter, 0.3),
      'editorIndentGuide.activeBackground1': withAlpha(gutter, 0.6),
      'editorWhitespace.foreground': withAlpha(gutter, 0.5),
      'editorBracketMatch.background': withAlpha(primary, 0.24),
      'editorBracketMatch.border': '#00000000',
      'editorOverviewRuler.border': '#00000000',
      'editorError.foreground': danger,
      'editorWarning.foreground': warning,
      'editorInfo.foreground': info,
      'editorGutter.modifiedBackground': warning,
      'editorWidget.background': popover,
      'editorWidget.foreground': popoverInk,
      'editorWidget.border': border,
      'editorHoverWidget.background': popover,
      'editorHoverWidget.foreground': popoverInk,
      'editorHoverWidget.border': border,
      'editorSuggestWidget.background': popover,
      'editorSuggestWidget.foreground': popoverInk,
      'editorSuggestWidget.border': border,
      'editorSuggestWidget.selectedBackground': withAlpha(primary, 0.28),
      'editorMarkerNavigation.background': popover,
      'diffEditor.insertedTextBackground': withAlpha(info, 0.14),
      'diffEditor.removedTextBackground': withAlpha(danger, 0.14),
      'scrollbarSlider.background': withAlpha(gutter, 0.35),
      'scrollbarSlider.hoverBackground': withAlpha(gutter, 0.55),
      'scrollbarSlider.activeBackground': withAlpha(gutter, 0.7),
      focusBorder: '#00000000',
    },
  }
}
