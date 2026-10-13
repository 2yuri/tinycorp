import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { cx, SCALES } from './cx'

/**
 * `cx` is the thing that lets a screen adjust a kit component (T216), so this is where the
 * adjustments are pinned.
 *
 * Every case below is a real pair: a class the kit writes on its own element and the class a
 * screen writes on the same element. The caller's goes last, because `cx(kit…, className)` puts
 * it last, and the caller is the one who meant it.
 *
 * The first block is the one that fails **silently** without the configuration in `cx.ts`:
 * `tailwind-merge` knows Tailwind's type scale, not ours, so it reads `text-13` as a colour and
 * drops it beside `text-foreground` — or drops the colour instead, depending which came first.
 */

const tailwindCss = readFileSync(fileURLToPath(new URL('../tailwind.css', import.meta.url)), 'utf8')
/**
 * The keys `ui/tailwind.css` declares in one Tailwind namespace: `--text-13` → `13`.
 *
 * A line height rides along with its size rather than being a key of its own, and `--font-weight-*`
 * is its own namespace that happens to start with `--font-`; neither is a value `font-…` or
 * `text-…` can name.
 */
const keysOf = (namespace: string) =>
  [...tailwindCss.matchAll(new RegExp(`^\\s*--${namespace}-([\\w-]+):`, 'gm'))]
    .map(([, name]) => name ?? '')
    .filter((name) => !name.endsWith('--line-height') && !name.startsWith('weight-'))

describe('the scales cx is configured with', () => {
  it.each(Object.entries(SCALES))('is every %s key `ui/tailwind.css` declares', (namespace, scale) => {
    // A size or an elevation added to the theme and not here is one `cx` reads as a colour.
    expect([...keysOf(namespace)].sort()).toEqual([...scale].sort())
  })
})

describe('a size against a colour', () => {
  it('keeps both, whichever order they arrive in', () => {
    expect(cx('text-foreground text-13')).toBe('text-foreground text-13')
    expect(cx('text-13', 'text-foreground')).toBe('text-13 text-foreground')
    expect(cx('text-11-5 text-muted-foreground')).toBe('text-11-5 text-muted-foreground')
  })

  it('still lets a size replace a size, and a colour a colour', () => {
    expect(cx('text-13', 'text-12')).toBe('text-12')
    expect(cx('text-13/16', 'text-12/[inherit]')).toBe('text-12/[inherit]')
    expect(cx('text-muted-foreground', 'text-foreground')).toBe('text-foreground')
  })
})

describe('the properties a screen really adjusts', () => {
  it.each([
    ['gap-8', 'gap-6', 'gap-6'],
    ['h-40', 'h-36', 'h-36'],
    ['px-18', 'px-12', 'px-12'],
    ['p-11', 'p-8', 'p-8'],
    ['rounded-sm', 'rounded-md', 'rounded-md'],
    ['size-16', 'size-13', 'size-13'],
    ['font-semibold', 'font-bold', 'font-bold'],
    ['bg-primary', 'bg-secondary', 'bg-secondary'],
    ['shadow-button-primary', 'shadow-none', 'shadow-none'],
    ['shadow-raised', 'shadow-focus', 'shadow-focus'],
    ['animate-spin', 'animate-check-spin', 'animate-check-spin'],
    ['font-sans', 'font-code', 'font-code'],
  ])('lets %s become %s', (kit, screen, won) => {
    expect(cx(kit, screen)).toBe(won)
  })

  it('leaves alone the pairs that are not the same property', () => {
    expect(cx('border-border', 'border-2')).toBe('border-border border-2')
    expect(cx('font-code', 'font-semibold')).toBe('font-code font-semibold')
    expect(cx('px-12', 'py-8')).toBe('px-12 py-8')
    // `font-[inherit]` is a **family**, whatever `tailwind-merge` assumes of a bare `font-[…]`.
    expect(cx('font-[inherit]', 'font-semibold')).toBe('font-[inherit] font-semibold')
    // A variant is its own property: a screen that adjusts the focused state leaves the rest.
    expect(cx('px-10', 'focus-within:px-9')).toBe('px-10 focus-within:px-9')
  })
})

describe('cx', () => {
  it('skips the falsy names, so a condition reads as one', () => {
    expect(cx('a', false, null, undefined, 'b')).toBe('a b')
  })

  it('passes a class it does not know straight through', () => {
    expect(cx('choice-input', 'shell-btn')).toBe('choice-input shell-btn')
  })
})
