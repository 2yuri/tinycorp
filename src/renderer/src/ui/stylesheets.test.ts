import { describe, expect, it } from 'vitest'
import tailwindCss from './tailwind.css?raw'
import tokensCss from './tokens.css?raw'

/**
 * **There is one stylesheet, and this is the test that says so (T216).**
 *
 * `ui/tailwind.css` is Tailwind's utilities, this app's reset and this app's theme; `ui/tokens.css`
 * is the custom properties the theme reads, and the Dark values each of them takes. Everything else
 * a screen or a kit component draws is a class on the element.
 *
 * A third sheet is how the renderer got back to 25k lines of CSS the first time. It fails here.
 */
const everySheet = Object.entries(
  import.meta.glob<string>('../**/*.css', { query: '?raw', import: 'default', eager: true }),
)

// A declaration starts a line or follows `{` / `;` (so a selector like `.x--primary:hover` doesn't count).
const declared = (css: string) => new Set([...css.matchAll(/(?:^|[{;])\s*(--[\w-]+)\s*:/gm)].map(([, name]) => name!))
// A property read with a fallback (set at runtime from script) may be one the sheet never declares.
const used = (css: string) => new Set([...css.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)].map(([, name]) => name!))
const tokens = declared(tokensCss)

describe('the renderer stylesheets', () => {
  it('are two: the setup and the tokens it reads', () => {
    expect(everySheet.map(([file]) => file).sort()).toEqual(['./tailwind.css', './tokens.css'])
  })

  it('never redefine a design token (the old ad hoc palette is gone)', () => {
    // The theme block reads `--card` and declares `--color-card`; a sheet that declared `--card`
    // again would take the token out from under every screen that reads it.
    const clashes = [...declared(tailwindCss)].filter((name) => tokens.has(name))
    expect(clashes).toEqual([])
  })

  it('only read custom properties that the tokens or the sheet itself declare', () => {
    const own = declared(tailwindCss)
    const unknown = [...used(tailwindCss)].filter((name) => !tokens.has(name) && !own.has(name))
    expect(unknown).toEqual([])
  })
})

describe('The app window policy', () => {
  it('lets the pixel portraits draw: character looks are data URLs cut at runtime', async () => {
    const html = (await import('../../index.html?raw')).default
    const policy = /http-equiv="Content-Security-Policy"\s+content="([^"]*)"/.exec(html)?.[1] ?? ''
    expect(policy).toMatch(/img-src[^;]*data:/)
  })
})

/** The sheet with its comments and its at-rules taken off: what is left is its rules. */
function body(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@import[^;]*;/g, '')
    .replace(/@source[^;]*;/g, '')
    .replace(/@layer [a-z, ]+;/, '')
    .trim()
}

describe('the cascade layers', () => {
  const canonical = '@layer theme, base, utilities;'

  it('are declared in one statement, before anything opens one', () => {
    // A layer's place is fixed by where its **name** first appears, so the order has to be stated
    // before the first `@layer x {` or `layer(x)` in the file.
    const order = tailwindCss.indexOf(canonical)
    expect(order).toBeGreaterThan(-1)
    expect(order).toBeLessThan(tailwindCss.search(/@layer [a-z]+ \{|layer\(/))
  })

  it('hold every rule this app writes: nothing sits outside a layer', () => {
    // A rule outside every layer beats each of them, whatever the order says.
    expect(body(tailwindCss)).toMatch(/^@layer base \{[\s\S]*\}$/)
  })

  it('leave `tokens.css` out, because no rule competes with a declaration', () => {
    expect(body(tokensCss)).not.toContain('@layer')
  })
})

/**
 * Every selector the sheet writes, with `@keyframes` left out — `from` and `to` are steps, not
 * elements.
 */
function selectors(css: string): string[] {
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@keyframes[^{]*\{(?:[^{}]|\{[^{}]*\})*\}/g, '')
  return [...rules.matchAll(/(?:^|[{}])\s*([^{}@;]+?)\s*\{/g)].flatMap(([, list]) =>
    (list ?? '').split(',').map((one) => one.trim()),
  )
}

describe('the base layer', () => {
  /**
   * **It declares no class.** That is the whole of the rule this ticket leaves behind: a class rule
   * in a stylesheet is styling that lives somewhere other than the thing it styles, and every one of
   * them is now either a utility on the component or an exported class list — `SHELL_BUTTON` and
   * `CHOICE_INPUT` in `ui/kit/resets.ts`, which `cx` lets a caller out-write rather than out-weigh.
   *
   * What is left is about elements: the box model, the document's own font and colour, and the
   * inherited font of a control. Nothing here knows the name of a component.
   */
  it('declares no class, so no component\u2019s styling lives in a stylesheet', () => {
    const classes = selectors(tailwindCss).flatMap((one) =>
      [...one.matchAll(/\.([a-z][\w-]*)/g)].map(([, name]) => name!),
    )
    expect(classes).toEqual([])
  })

  it('is elements and the two at-rules a class cannot be', () => {
    // A registered custom property is document-scoped by definition and a `@keyframes` name is
    // global, so the drawer's scroll-driven fade cannot be a utility however much of it is one.
    expect(new Set(selectors(tailwindCss))).toEqual(
      new Set([
        '*',
        '::before',
        '::after',
        'html',
        'body',
        'button',
        'input',
        'select',
        'textarea',
        'code',
        'kbd',
        'pre',
        'samp',
        'fieldset',
        "label:has(> input[type='radio'])",
        "label:has(> input[type='checkbox'])",
        // The scrollbar, on every element, and none inside a modal (T262).
        '*::-webkit-scrollbar',
        '*::-webkit-scrollbar-track',
        '*::-webkit-scrollbar-corner',
        '*::-webkit-scrollbar-thumb',
        '*::-webkit-scrollbar-thumb:hover',
        '*::-webkit-scrollbar-button',
        "[aria-modal='true']",
        "[aria-modal='true'] *",
        "[aria-modal='true']::-webkit-scrollbar",
        "[aria-modal='true'] *::-webkit-scrollbar",
      ]),
    )
    expect(tailwindCss).toContain('@property --shell-nav-fade-above')
    expect(tailwindCss).toContain('@keyframes shell-nav-more-below')
  })
})

describe('the scrollbar (T262)', () => {
  const rules = body(tailwindCss)
  const rule = (selector: string) =>
    new RegExp(`${selector.replace(/[[\]().*:'-]/g, '\\$&')}[^{]*\\{([^}]*)\\}`).exec(rules)?.[1] ?? ''

  it('is one thin thumb everywhere, on a transparent track with no arrow buttons', () => {
    expect(rule('*::-webkit-scrollbar ')).toMatch(/width: 6px;[\s\S]*height: 6px;/)
    expect(rule('*::-webkit-scrollbar-thumb ')).toMatch(/border-radius: 9999px;[\s\S]*background: var\(--border\);/)
    expect(rule('*::-webkit-scrollbar-thumb:hover')).toContain('background: var(--muted-foreground);')
    expect(rule('*::-webkit-scrollbar-corner')).toContain('background: transparent;')
    expect(rule('*::-webkit-scrollbar-button')).toContain('display: none;')
  })

  it('sets no standard scrollbar property outside a modal, which would switch the thin one off', () => {
    const standard = [...rules.matchAll(/([^{}]+)\{[^}]*scrollbar-(?:width|color)/g)].map(([, selector]) =>
      (selector ?? '').trim(),
    )
    expect(standard).toEqual(["[aria-modal='true'],\n  [aria-modal='true'] *"])
  })

  it('is hidden in a modal and in every list inside one, which still scrolls', () => {
    expect(rule("[aria-modal='true'] *")).toContain('scrollbar-width: none;')
    expect(rule("[aria-modal='true'] *::-webkit-scrollbar")).toContain('display: none;')
  })
})
