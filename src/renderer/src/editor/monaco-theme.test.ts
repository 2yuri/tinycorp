import { describe, expect, it } from 'vitest'
import { codeTheme, withAlpha } from './monaco-theme'

/**
 * The editor's colours are this app's tokens (T222). Monaco parses hex and nothing else — no
 * `var()`, no `color-mix()` — so the one thing that can go silently wrong is a token arriving as
 * either and being handed on anyway, which is a widget drawn in VS Code's default blue.
 */

const TOKENS: Record<string, string> = {
  '--code': '#0b1220',
  '--syntax-plain': '#c9d3e4',
  '--syntax-keyword': '#c4b5fd',
  '--syntax-comment': '#64748b',
  '--code-gutter': '#475569',
  '--primary': '#6366f1',
}

const read = (name: string) => TOKENS[name] ?? ''

describe('An alpha on a token', () => {
  it('is a hex pair on the end, because that is all Monaco reads', () => {
    expect(withAlpha('#6366f1', 0.45)).toBe('#6366f173')
  })

  it('takes a three-digit colour the long way round', () => {
    expect(withAlpha('#abc', 1)).toBe('#aabbccff')
  })

  it('leaves anything that is not plain hex alone rather than mangling it', () => {
    expect(withAlpha('color-mix(in srgb, red 50%, transparent)', 0.5)).toBe('color-mix(in srgb, red 50%, transparent)')
  })
})

describe('The theme, from the tokens', () => {
  const theme = codeTheme(read, 'dark')

  it('draws the file on the code surface, in the ink the viewer always used', () => {
    expect(theme.colors['editor.background']).toBe('#0b1220')
    expect(theme.colors['editor.foreground']).toBe('#c9d3e4')
  })

  it('writes a token rule without the hash, which is the one place Monaco wants it off', () => {
    expect(theme.rules).toContainEqual({ token: 'keyword', foreground: 'c4b5fd' })
    expect(theme.rules).toContainEqual({ token: 'comment', foreground: '64748b', fontStyle: 'italic' })
  })

  it('inherits nothing, so no colour nobody named is VS Code’s own', () => {
    expect(theme.inherit).toBe(false)
  })

  it('states every colour as hex, so none of them is a var() Monaco would drop', () => {
    for (const [name, colour] of Object.entries(theme.colors)) {
      expect(`${name}: ${colour}`).toMatch(/: #[0-9a-f]{6,8}$/i)
    }
  })

  it('falls back to the designed value for a token the sheet does not declare', () => {
    // A theme built before `tokens.css` is in the document must still be the app's colours.
    expect(codeTheme(() => '', 'dark').colors['editor.background']).toBe('#0b1220')
  })

  it('takes Monaco’s own base per appearance, so what it does draw for itself is the right end', () => {
    expect(codeTheme(read, 'light').base).toBe('vs')
    expect(theme.base).toBe('vs-dark')
  })
})
