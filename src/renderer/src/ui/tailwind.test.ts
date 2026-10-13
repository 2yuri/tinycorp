import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compile } from 'tailwindcss'
import { describe, expect, it } from 'vitest'

/**
 * The Tailwind setup (T206, T208), checked against the theme it declares and the screens that use
 * it.
 *
 * Tailwind fails quietly in three ways, and the Add-ons tab was built wrong in two of them before
 * the design audit caught it. The only thing that tells you is a pixel, so each one is compiled
 * here instead:
 *
 * 1. **A theme key that is not there.** `font-bold` with no `--font-weight-bold` compiles to
 *    **nothing**, and a heading that should be 700 renders at 400 with no error anywhere. So every
 *    key the theme declares has to produce a rule.
 * 2. **A theme key that maps to itself.** `--radius-s: var(--radius-s)` is the one `inline` writes
 *    out, to an unlayered `:root, :host` — where the property refers to itself, is invalid at
 *    computed-value time, and takes the token out from under every screen in the app. So the
 *    compiled sheet must emit no `:root` at all.
 * 3. **A class whose source text is not what React writes.** `'\\_\\_'` in a quoted string against
 *    `String.raw`'s `\_\_` compiles to a rule that matches no element. So every class a Tailwind
 *    screen writes has to produce a rule, and no class list that needs a backslash may be quoted.
 *
 * A fourth is at the end of this file and is not about the sheet but about the markup: two classes
 * that fight, joined by a template string rather than by `cx`, so the sheet's order decides which
 * one draws (T226).
 */

const HERE = fileURLToPath(new URL('.', import.meta.url))
const ENTRY = join(HERE, 'tailwind.css')
const entryCss = readFileSync(ENTRY, 'utf8')
/** The sheet with its prose taken out: the comments quote the at-rules they warn about. */
const entryRules = entryCss.replace(/\/\*[\s\S]*?\*\//g, '')

/** Every component under a folder, the way Tailwind walks one. */
function componentsIn(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name)
    if (entry.isDirectory()) return componentsIn(path)
    return entry.name.endsWith('.tsx') && !entry.name.includes('.test.') ? [path] : []
  })
}

/** The paths `tailwind.css` names, each as it is written: a file, or a folder migrated whole. */
function targets(css: string): string[] {
  return [...css.matchAll(/@source\s+'([^']+)'/g)].map(([, path]) => resolve(HERE, path ?? ''))
}

const isFolder = (target: string) => existsSync(target) && statSync(target).isDirectory()

/**
 * The files `tailwind.css` names — the trial's boundary, read from the trial's own source. A line
 * may name a folder, which is how a folder migrated whole opts in without a line per component; it
 * then stands for every component in it, and each is compiled the same way. A folder brings its
 * capture harnesses and its routers along, which is the point: a harness `design:compare` shoots has
 * to be compiled from the same sheet as the screen, and a file that hands the DOM no class of its
 * own is simply one this finds nothing in.
 */
function sources(css: string): string[] {
  return targets(css).flatMap((target) => (isFolder(target) ? componentsIn(target) : [target]))
}

/** A module-level class list, and whether the file writes it raw. */
interface ClassList {
  name: string
  quoted: boolean
  value: string
}

/**
 * The `const NAME = …` class lists: where a long list of utilities is kept readable — and where
 * Biome's class sorter stops looking. `export` too, because the shared vocabulary of a screen with
 * eight tabs lives in a module of its own.
 *
 * **This is a convention an `@source` file has to keep:** a module-level `UPPERCASE` string
 * constant is a class list, and every one of them is compiled below. Prose belongs in a lower-case
 * constant, or in a file Tailwind does not scan.
 */
function listsOf(source: string): ClassList[] {
  // All three quote styles, each read as one whole literal. A list that holds a `'` — an
  // arbitrary variant like `[[data-theme='light']_&]:` — is written in double quotes, and a
  // single-quote-only pattern skipped it: the name then resolved to nothing and the classes it
  // stands for were the ones nothing compiled.
  const declaration = /^(?:export )?const ([A-Z][A-Z0-9_]*) =\s*(?:'([^']*)'|"([^"]*)"|String\.raw`([^`]*)`)/gm
  const single = [...source.matchAll(declaration)].map(([, name, quoted, double, raw]) => ({
    name: name ?? '',
    quoted: raw === undefined,
    value: quoted ?? double ?? raw ?? '',
  }))
  // `const TONE: Record<Tone, string> = { … }` — one class list per state, which is how a screen
  // says what a state does without leaving two utilities on one property to the sheet's order.
  // Each entry is its own list under the record's name, rather than the values joined into one: a
  // record may hold a `String.raw` list beside a quoted one, and only the quoted one has to answer
  // for a backslash.
  const records = [...source.matchAll(/^(?:export )?const ([A-Z][A-Z0-9_]*): Record<[^>]*> = \{([^}]*)\}/gm)].flatMap(
    ([, name, body]) =>
      [...(body ?? '').matchAll(/'([^']*)'|String\.raw`([^`]*)`|`([^`]*)`/g)].map(([, one, raw, tick]) => ({
        name: name ?? '',
        quoted: raw === undefined,
        value: one ?? raw ?? tick ?? '',
      })),
  )
  return [...single, ...records]
}

/**
 * The text of a `className={cx(…)}` call: from the `(` to the parenthesis that closes it, so a
 * ternary or a nested call inside it comes along. Counting rather than matching, because
 * `cx('a', b ? 'c' : 'd')` has two.
 *
 * The call's own prose goes first. A comment inside one says things like `the ticked row's indent`,
 * and that apostrophe opens a string literal that runs to the next `'` — the first real class list
 * after it — so a whole sentence arrives as class names and the list it swallowed arrives as none.
 */
function cxCalls(source: string): string[] {
  const calls: string[] = []
  for (const match of source.matchAll(/className=\{cx\(/g)) {
    let depth = 1
    let at = match.index + match[0].length
    while (at < source.length && depth > 0) {
      if (source[at] === '(') depth += 1
      else if (source[at] === ')') depth -= 1
      at += 1
    }
    calls.push(source.slice(match.index + match[0].length, at - 1).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ''))
  }
  return calls
}

/**
 * The class lists a file can name: its own, and those of the modules it imports from beside it.
 *
 * A screen with eight tabs keeps its shared vocabulary in one module, so the tab that writes
 * `className={CARD}` declares no list of its own at all. Following the import one hop is what
 * keeps that tab covered — the same module a folder's `repo-classes.ts` is.
 */
function listsInScope(file: string): Map<string, string> {
  const source = readFileSync(file, 'utf8')
  const named = new Map<string, string>()
  // A `Record` is read one entry at a time, so a name arrives once per state it has; the name
  // stands for all of them together, because `className={TONE[tone]}` writes whichever one it is.
  const add = (list: ClassList) => named.set(list.name, `${named.get(list.name) ?? ''} ${list.value}`.trim())
  for (const list of listsOf(source)) add(list)
  for (const [, from] of source.matchAll(/^import \{[^}]*\} from '(\.[^']*)'/gm)) {
    for (const extension of ['.ts', '.tsx']) {
      const path = resolve(dirname(file), (from ?? '') + extension)
      if (!existsSync(path)) continue
      for (const list of listsOf(readFileSync(path, 'utf8'))) if (!named.has(list.name)) add(list)
    }
  }
  return named
}

/**
 * Every class one of those files hands to the DOM, from all three of the places a screen puts one.
 *
 * **The `className="…"` literals**, and **every class list a `className={…}` expression names** —
 * `{CARD}`, `{cx(FIELD, FIELD_MONO)}` and `{tight ? CARD_TIGHT : CARD}` alike, resolved against
 * the lists in scope so a tab that only uses its folder's vocabulary is still covered. A class
 * that reaches the DOM only through `cx(NAME, …)` is still a class the browser is handed: until
 * T210d none of them was compiled, and `w-min(440px,100vw)` sat on the ticket drawer producing no
 * rule at all.
 *
 * **And the lists written into a `cx(…)` literally** — `cx('m-0 text-11-5', on && 'text-12')` —
 * which is where a screen states its conditions. Without them the classes only one branch ever
 * writes would be the one part of a migrated screen nothing compiles.
 *
 * Outside a `cx(…)`, only names are followed into an expression and never the quoted strings
 * beside them: `{tab === 'office' ? A : B}` writes no class called `office`. So a class list
 * belongs in a constant, which is also the convention that makes it checkable at all.
 */
function classesOf(source: string, named: Map<string, string>): string[] {
  const attributes = [...source.matchAll(/className=(?:"([^"]*)"|\{((?:[^{}]|\{[^{}]*\})*)\})/g)].flatMap(
    ([, literal, expression]) => {
      if (literal !== undefined) return [literal]
      return [...(expression ?? '').matchAll(/\b([A-Z][A-Z0-9_]*)\b/g)].map(([, name]) => named.get(name ?? '') ?? '')
    },
  )
  const conditional = cxCalls(source).flatMap((call) =>
    // `status === 'handled' ? …` compares against a string that is not a class list, so the
    // operand of a comparison goes before the literals are read. A list holding a `'` is written
    // in double quotes, so all three quote styles are matched, each as one whole literal.
    [...call.replace(/[=!]==?\s*(?:'[^']*'|"[^"]*"|`[^`]*`)/g, '').matchAll(/'([^']*)'|"([^"]*)"|`([^`]*)`/g)].map(
      ([, single, double, raw]) => single ?? double ?? raw ?? '',
    ),
  )
  const written = [...attributes, ...conditional.filter((value) => !value.includes('${'))]
  /*
   * A file that writes no `className` at all is a module of class lists rather than a screen — a
   * folder whose screens share a vocabulary keeps it in one (T210c, T210b) — and there every list
   * counts on its own, because Tailwind reads that file's source text. In a screen the lists count
   * only where a `className` names them, so its other upper-case constants — a label, a message,
   * a `Record` of words — are not read as classes.
   */
  const own = listsOf(source)
  const values = written.length > 0 ? written : own.map((list) => list.value)
  return [...new Set(values.flatMap((value) => value.split(/\s+/)).filter(Boolean))]
}

/**
 * The class names the `base` layer of this sheet still declares: the five in
 * `stylesheets.test.ts`'s list. A screen on utilities may write `choice-input` or `muted`, and only
 * those five excuse a class from compiling — any other class left behind has nothing defining it
 * any more, and still fails.
 */
function primitives(): Set<string> {
  const base = /@layer base \{([\s\S]*)\n\}/.exec(entryRules)?.[1] ?? ''
  return new Set([...base.matchAll(/\.([a-z][\w-]*)/g)].map(([, name]) => name ?? ''))
}

/**
 * Tailwind's two marker classes. Neither produces a rule of its own — they exist so a `group-*` or
 * `peer-*` variant on another element has something to point at — so neither can be compiled.
 */
const MARKERS = /^(group|peer)(\/[\w-]+)?$/

/**
 * Class names that carry **no style at all**, and are in the markup because something reads them.
 *
 * `primitives()` above excuses a class `base.css` or the kit still defines; these are the opposite —
 * a screen's own BEM name with nothing behind it any more. They are here because T210e's six folders
 * are the ones whose suites were written against the markup **as a string**: `RtkChip.dom.test.tsx`
 * finds the chip by `.rtk-chip`, `SubagentStrip.dom.test.tsx` reads a tone out of
 * `.subagent-chip__dot`'s own modifier, `ChatsPanel.test.tsx` orders `drawer-read-along` against
 * `drawer-read-only` with `indexOf`, and `FilesView.test.tsx` counts `files-code__number` and asserts
 * `files-row files-row--on` as one contiguous pair. Keeping the hook was the cheaper half of that
 * trade; rewriting forty-one assertions was the other.
 *
 * So every name here is a **debt with a reason**, and the list is where it can be counted. The sweep
 * that moves those reads to `data-ui` / `data-testid`, the way `addons.dom.test.tsx` already does it,
 * deletes the name from the markup and its line from here. A name is only allowed if a test, a
 * capture harness or a DOM read genuinely uses it — the decorative leftovers were deleted outright.
 *
 * Eleven of the Files names went with the hand-written editor (T222): `files-code__line`,
 * `files-code__number`, `files-code__mark`, `files-editor__area`, `files-editor__stack`,
 * `files-hover` and the `files-token--` pair all named parts of a `<textarea>` over painted spans,
 * and Monaco draws none of them. That is the sweep, for one folder, done by deleting the markup.
 */
const HOOKS = new Set([
  'rtk-chip',
  'path-link',
  'path-link__reveal',
  'open-with__chevron',
  'memory-body',
  'memory-chip',
  'memory-editor__area',
  'memory-editor__kind',
  'memory-editor__modes',
  'memory-editor__preview',
  'memory-editor__repo',
  'memory-editor__source',
  'memory-editor__title',
  'memory-front',
  'memory-front__chip',
  'memory-page__path',
  'memory-row',
  'memory-row__kind',
  'memory-seg',
  'memory-seg__option',
  'memory-uses',
  'drawer-chats__push',
  'drawer-conv',
  'drawer-conv__avatar',
  'drawer-conv__dot',
  'drawer-conv__hash',
  'drawer-conv__head',
  'drawer-conv__last',
  'drawer-conv__role',
  'drawer-conv__spacer',
  'drawer-conv__text',
  'drawer-conv__time',
  'drawer-conv__who',
  'drawer-conv--open',
  'drawer-conv--unread',
  'drawer-notes__meter-count',
  'drawer-notes__node-text',
  'drawer-notes__text',
  'drawer-notes__when',
  'drawer-post',
  'drawer-read-along',
  'drawer-read-along__messages',
  'drawer-read-only',
  'drawer-wakes',
  'drawer-wakes__count',
  'employee-drawer',
  'employee-drawer__handoff',
  'subagent-chip',
  'subagent-chip__dot',
  'subagent-chip__workspace',
  'subagent-seats',
  'files-change__open',
  'files-chip--plain',
  'files-chip--toggle',
  'files-crumbs__crumb',
  'files-crumbs__full',
  'files-edited__dot',
  'files-group__key',
  'files-image__zoom--on',
  'files-language-notice',
  'files-language-notice--failed',
  'files-outline__row--on',
  'files-places__button',
  'files-problems',
  'files-problems__row',
  'files-row',
  'files-row--on',
  'files-row__mark',
  'files-session-warning',
  'files-side-tab',
  'files-tab',
  'files-tab--on',
  'files-tab__dot',
  'files-tree',
  'files-viewer__reveal',
])

/**
 * Classes a stylesheet this repo still has owns, written by a screen on utilities. `primitives()`
 * reads `base.css` and the kit; `.error` and `.muted` are `src/renderer/src/styles.css`'s, which is
 * neither, and `review-diff__hunks` is the review screen's. The lines go when those migrate.
 */
const ELSEWHERE = new Set(['error', 'muted', 'review-diff__hunks'])

const PRIMITIVES = primitives()

/** Tailwind resolving `@import 'tailwindcss/utilities.css'` out of `node_modules`. */
const require = createRequire(import.meta.url)
const loadStylesheet = async (id: string, base: string) => {
  const path = id.startsWith('.') ? resolve(base, id) : require.resolve(id, { paths: [HERE] })
  return { path, base: dirname(path), content: readFileSync(path, 'utf8') }
}

/** Every key the theme declares, in the order it declares them. */
function themeKeys(css: string): string[] {
  const block = /@theme inline \{([\s\S]*)\n\}/.exec(css)?.[1] ?? ''
  return [...block.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map(([, name]) => name ?? '')
}

/**
 * The utility that reads one theme key. Tailwind's namespaces are the first word of the key, and a
 * key in a namespace Tailwind does not have is a key nothing can ever use — which is why this
 * throws rather than skipping.
 */
const NAMESPACES: Record<string, string> = {
  color: 'bg',
  font: 'font',
  'font-weight': 'font',
  text: 'text',
  radius: 'rounded',
  shadow: 'shadow',
  animate: 'animate',
  leading: 'leading',
}

function utilityFor(key: string): string | null {
  if (key === '--spacing') return 'p-1'
  // The line height rides along with its size rather than having a utility of its own.
  if (key.endsWith('--line-height')) return null
  const [, namespace, rest] = /^--([a-z]+(?:-weight)?)-(.+)$/.exec(key) ?? []
  const prefix = NAMESPACES[namespace ?? '']
  if (!prefix) throw new Error(`${key} is in no Tailwind namespace, so no utility can read it`)
  return `${prefix}-${rest}`
}

/** The CSS one class compiles to, with nothing else in the sheet. */
async function ruleFor(candidate: string): Promise<string> {
  const compiler = await compile(entryCss, { base: HERE, loadStylesheet })
  return compiler.build([candidate])
}

describe('the Tailwind setup', () => {
  it('imports the utilities and nothing else, so preflight never reaches another screen', () => {
    expect(entryRules).toContain("@import 'tailwindcss/utilities.css'")
    // The bare package entry is theme + preflight + utilities, and preflight restyles the whole
    // document — every other screen in the app included.
    expect(entryRules).not.toMatch(/@import\s+'tailwindcss'/)
  })

  it('names the screens it compiles, rather than scanning the repo', () => {
    expect(entryRules).toContain('source(none)')
    expect(sources(entryRules).length).toBeGreaterThan(0)
  })
})

/** Every class one file writes, with the primitives and the marker classes taken out. */
function utilitiesIn(file: string): string[] {
  return classesOf(readFileSync(file, 'utf8'), listsInScope(file)).filter(
    (candidate) =>
      !PRIMITIVES.has(candidate) && !MARKERS.test(candidate) && !HOOKS.has(candidate) && !ELSEWHERE.has(candidate),
  )
}

/**
 * That the extraction works at all — that a path named in `@source` is not scanned and silently
 * found to hold no class. One is enough for a file named on its own: a tab that only lays out two
 * columns writes nothing but its folder's shared lists. A folder answers for itself instead of per
 * file, because it brings along the files that really do write none.
 */
describe.each(targets(entryRules).map((target) => [relative(HERE, target), target] as const))(
  'the classes %s is named for',
  (_, target) => {
    it('are found', () => {
      const found = isFolder(target) ? componentsIn(target).flatMap(utilitiesIn) : utilitiesIn(target)
      expect(found.length).toBeGreaterThan(0)
    })
  },
)

describe.each(sources(entryRules).map((file) => [basename(file), file] as const))(
  'every class %s writes',
  (_, file) => {
    const source = readFileSync(file, 'utf8')
    const classes = utilitiesIn(file)

    it.each(classes)('compiles to a rule — %s', async (candidate) => {
      expect(await ruleFor(candidate)).toContain('@layer utilities {')
    })

    it('writes any class list that needs a backslash with ', () => {
      // A JSX attribute is literal, but a quoted JS string is not: `'\\_'` is `\_` at runtime and
      // `\\_` in the file. Tailwind reads the file, React writes the runtime value, and the rule
      // it generates then matches nothing at all.
      // Only the lists a `className` names, by the same rule `classesOf` reads them. Reading every
      // upper-case constant instead made `BODY_PLACEHOLDER` — the Memory editor's placeholder
      // **prose** — a class list with a `\n` in it (T210e).
      const read = new Set(
        [...source.matchAll(/className=\{((?:[^{}]|\{[^{}]*\})*)\}/g)].flatMap(([, expression]) =>
          [...(expression ?? '').matchAll(/\b([A-Z][A-Z0-9_]*)\b/g)].map(([, name]) => name ?? ''),
        ),
      )
      const own = listsOf(source)
      const candidates = read.size > 0 ? own.filter((list) => read.has(list.name)) : own
      const escaped = candidates.filter((list) => list.quoted && list.value.includes('\\'))
      expect(escaped.map((list) => list.name)).toEqual([])
    })
  },
)

describe('the theme', () => {
  const keys = themeKeys(entryRules)
  /** Each key beside the utility that reads it, with the line heights left out. */
  const readable = keys.flatMap((key) => {
    const utility = utilityFor(key)
    return utility === null ? [] : [[key, utility] as const]
  })

  it('declares the tokens, the scale and the weights', () => {
    expect(keys.length).toBeGreaterThan(100)
  })

  it.each(readable)('is readable by a utility — %s', async (_, utility) => {
    expect(await ruleFor(utility)).toContain('@layer utilities {')
  })

  it('maps no token to itself, so nothing lands on an unlayered :root', async () => {
    // A self-reference is the one thing `inline` writes out, and it writes it above every layer.
    const selfMapped = keys.filter((key) => entryRules.includes(`${key}: var(${key});`))
    expect(selfMapped).toEqual([])
    const compiler = await compile(entryCss, { base: HERE, loadStylesheet })
    // `:root, :host` is the selector `inline` writes a self-mapped key out to. `tokens.css`'s own
    // `:root, [data-theme='dark']` is inlined here too — it is the declarations this theme reads —
    // so the pair is what this looks for rather than any `:root` at all.
    expect(compiler.build(readable.map(([, utility]) => utility))).not.toMatch(/(^|\n):root, :host/)
  })
})

// The cascade order, and the five classes the `base` layer still declares, are
// `stylesheets.test.ts`'s (T216): there is one sheet now, so there is one place the order can
// disagree with itself, and it is the file that reads that sheet whole.

describe('the screens it compiles', () => {
  it.each(sources(entryRules))('is a file that is really there — %s', (file) => {
    // A path that resolves to nothing scans nothing, and a screen whose classes are never seen
    // compiles to an empty stylesheet rather than to an error.
    expect(existsSync(file)).toBe(true)
  })
})

/**
 * Every class list goes through `cx`, and none is joined by hand (T226).
 *
 * T224 found the Hire an Employee modal scrolling sideways because one field joined two class
 * lists with a template string — `` `${FIELD} ${LOOK}` `` — which put `w-full` and `w-132` on one
 * element. Both are one class in `@layer utilities` with the same specificity, so neither the
 * source order nor the position in the string decides it: **Tailwind's emission order does**, and
 * it has no idea which of the two the author meant. `cx` is `tailwind-merge` (`ui/kit/cx.ts`) and
 * exists to untie exactly that; a template string walks straight past it.
 *
 * So this reads the renderer's source and fails on a class list built any way but `cx(…)`. It is
 * the shape of the bug that is banned rather than one instance of it: `git grep` found 36 more
 * template strings the day T224 landed, each a latent version of the same modal.
 *
 * What is **not** a join, and passes: one dynamic class name, `` `files-token--${kind}` `` — there
 * is nothing beside it to tie with, which is why a template with no space in its own text is left
 * alone — and prose, which is every other template in the renderer.
 */

/** The renderer's own source, tests aside: a test builds HTML and regexes, not screens. */
function screensIn(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name)
    if (entry.isDirectory()) return screensIn(path)
    return /\.tsx?$/.test(entry.name) && !entry.name.includes('.test.') ? [path] : []
  })
}

/** One template literal: where it starts, the text it writes, and the expressions it interpolates. */
interface Template {
  at: number
  parts: string[]
  holes: string[]
}

/**
 * Every template literal in a file, read by hand rather than by regex: a hole holds arbitrary
 * code — a ternary, an index, a call — and only counting braces finds where it ends.
 */
function templatesOf(source: string): Template[] {
  const found: Template[] = []
  for (let at = 0; at < source.length; at++) {
    if (source[at] !== '`') continue
    const start = at
    const parts: string[] = []
    const holes: string[] = []
    let text = ''
    at += 1
    while (at < source.length && source[at] !== '`') {
      if (source[at] === '\\') {
        text += source.slice(at, at + 2)
        at += 2
        continue
      }
      if (source[at] === '$' && source[at + 1] === '{') {
        parts.push(text)
        text = ''
        let depth = 1
        at += 2
        const from = at
        while (at < source.length && depth > 0) {
          if (source[at] === '{') depth += 1
          else if (source[at] === '}') depth -= 1
          if (depth > 0) at += 1
        }
        holes.push(source.slice(from, at))
        at += 1
        continue
      }
      text += source[at]
      at += 1
    }
    parts.push(text)
    found.push({ at: start, parts, holes })
  }
  return found
}

/** What a `className` is given: the JSX attribute, and the local a screen builds before it. */
function classNameSpans(source: string): Array<{ from: number; to: number; text: string }> {
  return [
    ...source.matchAll(/\bclassName=\{((?:[^{}]|\{[^{}]*\})*)\}/g),
    ...source.matchAll(/\bclassName(?:: string)? = ([^\n]*)/g),
  ].map((match) => ({ from: match.index, to: match.index + match[0].length, text: match[0] }))
}

/**
 * A token only a utility looks like: lower case, and a `-` or a `:` with something after it.
 * `mb-0` and `hover:bg-card` are utilities; `sign-in.` and `Mac.` are the end of a sentence.
 */
const UTILITY = /^[a-z][\w-]*(?:-[\w.[\]()%#,/*+-]+|:\S+)$/
/** A token a class list could hold at all — `flex`, `[&_svg]:shrink-0` — as against a word of prose. */
const CLASS_TOKEN = /^[a-z@[!][\w[\]:./%,()#&>*+~=!'"_-]*[^\s.,;:!?’'"]$/

/** Why this template is a class list joined by hand, or null if it is prose or one dynamic name. */
function joinsClassLists(template: Template, inClassName: boolean): string | null {
  if (template.holes.length === 0) return null
  const tokens = template.parts.join(' ').split(/\s+/).filter(Boolean)
  // A template whose own text holds no space writes one name — `files-token--${kind}` — and there
  // is nothing beside it for the sheet's order to decide between.
  const spaced = template.parts.some((part) => /\s/.test(part)) || template.parts.every((part) => part === '')
  if (template.holes.some((hole) => /\bclassName\b/.test(hole))) return 'it takes a caller’s className'
  if (inClassName) return spaced ? 'it is a className joined by hand' : null
  if (!spaced) return null
  if (tokens.some((token) => !CLASS_TOKEN.test(token))) return null
  if (tokens.some((token) => UTILITY.test(token))) return 'it is a class list joined by hand'
  // Two lists and nothing but a space between them: `${ROW} ${ROW_MISSING}`.
  const lists = template.holes.filter((hole) => /^[A-Z][A-Z0-9_]*\b/.test(hole.trim())).length
  return tokens.length === 0 && lists >= 2 ? 'it is two class lists joined by hand' : null
}

/** Every place a file builds a class list any way but `cx(…)`. */
function handJoins(file: string): string[] {
  const source = readFileSync(file, 'utf8')
  const spans = classNameSpans(source)
  const at = (index: number) => `${relative(HERE, file)}:${source.slice(0, index).split('\n').length}`
  const glued = spans
    .filter((span) => /\.join\(/.test(span.text) || /\+\s*['"`]|['"`]\s*\+/.test(span.text))
    .map((span) => `${at(span.from)} builds a className by joining strings; cx(…) is what resolves them`)
  const written = templatesOf(source).flatMap((template) => {
    const inside = spans.some((span) => template.at > span.from && template.at < span.to)
    const why = joinsClassLists(template, inside)
    return why === null ? [] : [`${at(template.at)} ${why}; write cx(…) instead, the caller's classes last`]
  })
  return [...glued, ...written]
}

/**
 * A file the sheet does not name is not scanned, and a class only it writes is never generated: the
 * screen still mounts, with its padding, its widths and its alignment silently gone, and no test
 * fails because every test reads the markup rather than the pixels. T249's first launch on Windows
 * shipped exactly that way — `windows-setup` had no `@source` line — and the boss found it on a
 * real Windows desktop. So every renderer file that writes a class has to be one the sheet names.
 */
describe('the files the sheet names', () => {
  it('include every file in the renderer that writes a class', () => {
    const renderer = resolve(HERE, '..')
    const named = targets(entryRules)
    // Tailwind reads every file under a folder it is given, whatever its extension.
    const scanned = (file: string) => named.some((target) => file === target || file.startsWith(`${target}${sep}`))
    const writes = (file: string) =>
      file.endsWith('.tsx') ? /className=/.test(readFileSync(file, 'utf8')) && utilitiesIn(file).length > 0 : false
    const unnamed = screensIn(renderer).filter((file) => !scanned(file) && writes(file))
    expect(unnamed.map((file) => relative(renderer, file))).toEqual([])
  })
})

describe('every class list', () => {
  const screens = screensIn(resolve(HERE, '..'))

  it('is read from enough of the renderer to mean anything', () => {
    expect(screens.length).toBeGreaterThan(200)
  })

  it('goes through cx, so the one that wins is the one the author wrote — never the sheet’s order', () => {
    expect(screens.flatMap(handJoins)).toEqual([])
  })

  // The detector itself, against the line T224 found and the shapes that are not a join: a guard
  // that quietly stops recognising the bug is a guard that passes for the wrong reason.
  it.each([
    ['the line T224 found', `className={\`${hole('FIELD')} ${hole('LOOK')}\`}`],
    ['a list and a literal', `className={\`${hole('MODAL')} h-840\`}`],
    ['a caller’s className', `const classes = \`${hole('PORTRAIT')} ${hole('props.className')}\``],
    ['a class list constant', `const LEGEND = \`${hole('FIELD_LABEL')} mb-0 p-0\``],
    ['a joined className', "const className = [INIT_ALERT, props.className].filter(Boolean).join(' ')"],
  ])('is caught when it is joined by hand — %s', (_, source) => {
    expect(handJoinsIn(source)).not.toEqual([])
  })

  it.each([
    ['one dynamic class name', `className={cx(TOKEN[kind], \`files-token--${hole('kind')}\`)}`],
    ['a label', `aria-label={\`${hole('props.employeeName')}’s subagents\`}`],
    ['a sentence', `const note = \`${hole('labels[provider]')} is not installed on this Mac.\``],
    ['a date', `const at = (time: string) => \`${hole('DAY')}T${hole('time')}:00\``],
    ['a path', `const sheet = \`${hole('base')}office-marker-sheet.png\``],
    ['cx itself', "className={cx(CHIP, MONO_BOX, on ? 'text-primary' : CHIP_OFF)}"],
  ])('is left alone when it is not one — %s', (_, source) => {
    expect(handJoinsIn(source)).toEqual([])
  })
})

/**
 * One interpolation, in the samples above. Written rather than quoted so that a sample of the bug
 * is a sample and not another instance of it: a `'${…}'` in this file would be a template hole to
 * Biome and a class list to the paragraph at the top, and neither is what these rows are.
 */
function hole(code: string): string {
  return `${'$'}{${code}}`
}

/** `handJoins` over a fragment rather than a file, which is what the table above reads. */
function handJoinsIn(source: string): string[] {
  const spans = classNameSpans(source)
  return templatesOf(source)
    .map((template) =>
      joinsClassLists(
        template,
        spans.some((span) => template.at > span.from && template.at < span.to),
      ),
    )
    .filter((why): why is string => why !== null)
    .concat(
      spans.filter((span) => /\.join\(/.test(span.text) || /\+\s*['"`]|['"`]\s*\+/.test(span.text)).map(() => 'joined'),
    )
}
