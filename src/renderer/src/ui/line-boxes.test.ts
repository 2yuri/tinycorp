import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Every rule that sizes type on an audited screen says how tall its line is.
 *
 * `line-height: normal` is the one cause that keeps coming back. Chromium rounds a line box up
 * and Pen does not, so a chip declared `font-size: 11px` and nothing else is 19.31px in the
 * frame's numbers and 20px on screen — and every band under it moves a pixel. One of those is
 * inside `pnpm design:compare`'s tolerance; two of them stack into drift the sheet charges for, and
 * finding it again costs an afternoon of measuring bands (T196, T200, T203a).
 *
 * So the rules whose boxes a frame was measured against are pinned here. This is not a rule about
 * all CSS — plenty of type in this app is free to sit where the font puts it. It is about the
 * elements an audited pair stacks, where the frame's own box is a number somebody read off a
 * PNG and it must stay written down.
 */

const HERE = import.meta.dirname

/**
 * Each stylesheet, and the selectors in it whose line box a frame settled.
 *
 * Empty since T210e: `profile.css` went with T210f and `memory.css` with this ticket, so every screen
 * this once named is a class list below. It stays because the next screen to be measured before it is
 * migrated belongs here, and because an empty list says that plainly where deleting the half would not.
 */
const PINNED: { file: string; selectors: string[] }[] = []

/**
 * The same claim about a screen that has moved to Tailwind (T210f): the class lists whose line box
 * a frame settled, by the name each is declared under.
 *
 * A size is a step of the scale, and the scale carries a line for it — `text-11-5` is 11.5px on
 * 17px, from `--type-11-5-leading` — so a step is already a number of pixels written down. What is
 * not is `/normal`, which is the one thing the frames disagree with, and that is what this checks.
 */
const PINNED_LISTS: { file: string; lists: string[] }[] = [
  {
    file: join(HERE, '..', 'profile', 'ProvidersCard.tsx'),
    lists: [
      'PROVIDER_NAME',
      'PROVIDER_DETAIL',
      'BADGE',
      'RUNTIME_CHIP',
      'ACCOUNT_LABEL',
      'ACCOUNT_EMAIL',
      'ACCOUNT_VALUE',
      'ACCOUNT_DEFAULT',
    ],
  },
  {
    file: join(HERE, '..', 'profile', 'YourProfile.tsx'),
    lists: ['COMPANY_NAME', 'COMPANY_META'],
  },
  // The thirteen `memory.css` pinned as selectors until T210e, by the name each list is declared
  // under. `FRONT_CHIP` and `FRONT_CHIP_MONO` are the pair that proved the rule: the mono one drew
  // on a 13px line instead of the frame's 14 while it was an override rather than a list.
  {
    file: join(HERE, '..', 'memory', 'MemoryPageView.tsx'),
    lists: ['FRONT_CHIP', 'FRONT_CHIP_MONO', 'USES', 'LINK_TITLE', 'LINK_KIND', 'FOOTER'],
  },
  {
    file: join(HERE, '..', 'memory', 'MemoryEditor.tsx'),
    // `EDITOR_AREA` is not here since T225: the body is a TipTap document drawn in the reading
    // pane's own list, so its boxes are `MemoryPageView`'s `BODY` and are pinned with it. What is
    // added to that list only lays a task item out.
    lists: ['EDITOR_TITLE', 'FRONT', 'KIND', 'MODE', 'MODE_ON', 'HINT', 'HELP'],
  },
]

/** The type scale's own leadings, so a step is only pinned when the scale really carries one. */
const tokensCss = readFileSync(join(HERE, 'tokens.css'), 'utf8')

/** The declarations of one rule, by its exact selector line. */
function blockOf(css: string, selector: string): string {
  // The sheet sits inside its cascade layer, so a rule is one indent in (T208).
  const at = css.indexOf(`\n  ${selector} {`)
  if (at === -1) throw new Error(`no rule for ${selector}`)
  return css.slice(at, css.indexOf('}', at))
}

describe.skipIf(PINNED.length === 0)('the line boxes an audited frame was measured against', () => {
  for (const { file, selectors } of PINNED) {
    const css = readFileSync(file, 'utf8')
    for (const selector of selectors) {
      it(`${selector} says how tall its line is`, () => {
        const block = blockOf(css, selector)
        expect(block).toContain('font-size:')
        // `normal` is what the frames disagree with; a number of pixels is what they were read as.
        expect(block).toMatch(/line-height:\s*\d/)
      })
    }
  }
})

/**
 * The one `text-*` class in a list, split into its step and whatever line it names after the `/`.
 *
 * Behind a variant too: `[&_dt]:text-12/16` is where `.memory-editor__front dt`'s box went when the
 * Memory editor moved to utilities (T210e), and a box on a descendant is still a box a frame settled.
 */
function typeOf(list: string): { step: string; line?: string } {
  const found = list.split(/\s+/).find((one) => /(?:^|:)text-\d/.test(one))
  if (!found) throw new Error(`no type in ${list}`)
  const [step, line] = found.replace(/^.*(?:^|:)text-/, '').split('/')
  return { step: step ?? '', ...(line !== undefined && { line }) }
}

describe('the line boxes a Tailwind screen was measured against', () => {
  for (const { file, lists } of PINNED_LISTS) {
    const source = readFileSync(file, 'utf8')
    for (const name of lists) {
      it(`${name} says how tall its line is`, () => {
        const list = new RegExp(`^(?:export )?const ${name} =\\s*\\n?\\s*'([^']*)'`, 'm').exec(source)?.[1]
        expect(list, name).toBeTypeOf('string')
        const { step, line } = typeOf(list ?? '')
        // `normal` is what the frames disagree with; a number of pixels is what they were read as.
        if (line !== undefined) expect(line, name).toMatch(/^\d/)
        else expect(tokensCss, name).toContain(`--type-${step}-leading:`)
      })
    }
  }
})
