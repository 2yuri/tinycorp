// The values the Review screen is measured on, read out of what the screen actually compiles to.
// Every expectation here quotes `design/html/review.html`, the export of frame `ZCYGy`: a screen
// that drifts from the frame fails here rather than waiting for the next capture to be compared
// by eye.
//
// Until T210d the screen was a stylesheet and these read its text. It is Tailwind now, so they
// compile the class lists the components hand to the DOM and read the declarations back — the
// same measurements, against what the browser is actually given.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { compile } from 'tailwindcss'
import { describe, expect, it } from 'vitest'
import { COMMENT_ROLE, COMPOSER, COMPOSER_INPUT } from './ReviewComments'
import { CHECK_NAME } from './ReviewParts'
import { REVIEW_BADGE } from './ReviewScreen'

const UI = resolve(import.meta.dirname, '../ui')
const require = createRequire(join(UI, 'tailwind.css'))
const loadStylesheet = async (id: string, base: string) => {
  const path = id.startsWith('.') ? resolve(base, id) : require.resolve(id, { paths: [UI] })
  return { path, base: dirname(path), content: readFileSync(path, 'utf8') }
}
const tokens = readFileSync(join(UI, 'tokens.css'), 'utf8')

/** What one token resolves to, so a measurement can be quoted as the frame's own value. */
function token(name: string): string {
  return new RegExp(`^\\s*${name}:\\s*([^;]+);`, 'm').exec(tokens)?.[1]?.trim() ?? ''
}

/** The `@layer utilities` block of a built sheet, and nothing else in it. */
function onlyUtilities(css: string): string {
  const at = css.indexOf('@layer utilities {')
  if (at < 0) return ''
  let depth = 0
  for (let i = css.indexOf('{', at); i < css.length; i++) {
    if (css[i] === '{') depth += 1
    else if (css[i] === '}' && --depth === 0) return css.slice(css.indexOf('{', at) + 1, i)
  }
  return ''
}

/** Every declaration a class list compiles to, longhands and all, keyed by property. */
async function declarations(classes: string): Promise<Map<string, string>> {
  const compiler = await compile(readFileSync(join(UI, 'tailwind.css'), 'utf8'), { base: UI, loadStylesheet })
  // The utilities alone: since T216 the built sheet also carries this app's reset and its tokens,
  // and `.error { color: var(--destructive) }` in the base layer would answer for every class list
  // asked about here.
  const css = onlyUtilities(compiler.build(classes.split(/\s+/).filter(Boolean)))
  const out = new Map<string, string>()
  for (const [, body] of css.matchAll(/\{([^{}]*)\}/g)) {
    for (const declaration of (body ?? '').split(';')) {
      const at = declaration.indexOf(':')
      if (at < 0) continue
      const property = declaration.slice(0, at).trim()
      if (property.startsWith('--tw-')) continue
      out.set(property, declaration.slice(at + 1).trim())
    }
  }
  return out
}

/** A `calc(1px * n)` length, as the pixels it is. */
const px = (value: string | undefined) => value?.replace(/calc\(1px\s*\*\s*(-?[\d.]+)\)/, '$1px')

describe('the Review screen against frame ZCYGy', () => {
  it('draws the header badge at the frame’s size, weight and ink (review.html:2246-2280)', async () => {
    const badge = await declarations(REVIEW_BADGE)

    expect(px(badge.get('padding-block'))).toBe('5px')
    expect(px(badge.get('padding-inline'))).toBe('11px')
    expect(badge.get('font-size')).toBe('var(--type-12)')
    expect(badge.get('color')).toBe('var(--soft-ink)')
  })

  it('declares the frame’s soft ink, for everything that is neither foreground nor muted', () => {
    // A token since T210d; the frame reaches for it the way every other screen's sheet did.
    expect(token('--soft-ink')).toBe('#cbd5e1')
  })

  it('leaves the check icons muted and names them soft (review.html:4842-4855)', async () => {
    // The frame fills all three check glyphs #94A3B8; only a failure takes a colour of its own,
    // and it takes it on the row, so the name itself never carries a passing colour.
    const name = await declarations(CHECK_NAME)

    expect(name.get('color')).toBe('var(--soft-ink)')
    expect(name.get('font-weight')).toBe('400')
    expect(CHECK_NAME).not.toMatch(/text-(brand-success|status-success)/)
  })

  it('fills the composer like the panel behind it, not like a well (review.html:5652-5664)', async () => {
    const composer = await declarations(COMPOSER)

    expect(composer.get('background-color')).toBe('var(--card)')
    expect(px(composer.get('padding-block'))).toBe('10px')
    expect(px(composer.get('padding-inline'))).toBe('12px')
    expect((await declarations(COMPOSER_INPUT)).get('font-size')).toBe('var(--type-13)')
  })

  it('gives every role chip its author’s own accent, never one purple for all of them', async () => {
    const role = await declarations(COMMENT_ROLE)

    // Both rules compile into the one list: the muted default, and the accent under `data-accent`.
    expect(role.get('color')).toBe('var(--accent-soft)')
    expect(COMMENT_ROLE).toContain('text-muted-foreground')
    expect(COMMENT_ROLE).toContain('[&[data-accent]]:text-accent-soft')
  })
})
