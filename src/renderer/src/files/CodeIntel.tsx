import { CircleAlert, CircleDot, Info, ListTree, TriangleAlert, Undo2 } from 'lucide-react'
import {
  type Diagnosed,
  diagnosticsSummary,
  type LanguageReading,
  type Outlined,
  type Severity,
} from '../../../shared/files/language'
import { cx } from '../ui'
import { outlineLabel } from './language-model'

/**
 * What the panels around the file draw once a language server has read it (T115): the errors
 * listed under the file, the file's own symbols down its right, the way back from a symbol the
 * boss followed, and the quiet line for a place that has no server at all.
 *
 * The card under the pointer and the mark beside a line went to Monaco with T222: the editor draws
 * its own hover off the same server, and a diagnostic is a marker on the model rather than a span
 * this file paints. Every one of these is still pure — what the boss clicks goes back out as a
 * callback, and none of them writes anything.
 */

/** What the outline and the problems list are called, in the view and to a screen reader. */
export const OUTLINE_LABEL = 'Outline'
export const PROBLEMS_LABEL = 'Problems'
/** The problems list with nothing in it: the server read the file and had nothing to say. */
export const NO_PROBLEMS = 'Nothing to report'

const SEVERITY_ICONS = { error: CircleAlert, warning: TriangleAlert, info: Info } as const

/**
 * What the language server knows (T115), beside the file: the outline down its right and the
 * problems under it. The code surface is the frame's own, so these take their colours from the
 * same set it declares.
 *
 * `files-problems`, `files-problems__row`, `files-outline__row--on` and `files-language-notice`
 * stay in their lists: `CodeIntel.test.tsx` and `FilesView.test.tsx` read every one of them out of
 * the markup.
 */

/* What the server complains about, listed under the file so a break shows without a build. */
const PROBLEMS = 'files-problems max-h-180 shrink-0 overflow-auto border-t border-border bg-card'

const PROBLEMS_HEAD =
  'sticky top-0 flex items-center gap-8 bg-card px-16 py-8 text-11/[normal] tracking-[0.04em] uppercase text-muted-foreground'

const PROBLEM_ROW =
  'files-problems__row flex w-full cursor-pointer items-baseline gap-8 border-0 bg-transparent px-16 py-4 text-left text-12/[normal] text-foreground hover:bg-[color-mix(in_srgb,var(--foreground)_6%,transparent)] [&_svg]:shrink-0 [&_svg]:self-center'

const PROBLEM_TONE = {
  error: '[&_svg]:text-brand-danger',
  warning: '[&_svg]:text-brand-warning',
  info: '',
} satisfies Record<Severity, string>

/* The file's own symbols, to jump inside a long one. */
const OUTLINE = 'sticky top-0 max-h-full w-220 shrink-0 overflow-auto border-l border-border pb-12'

const OUTLINE_HEAD =
  'flex items-center gap-8 px-12 pt-12 pb-8 text-11/[normal] tracking-[0.04em] uppercase text-muted-foreground'

const OUTLINE_ROW =
  'flex min-h-24 w-full cursor-pointer items-center gap-8 border-0 bg-transparent pr-12 text-left font-code text-12/[normal] text-syntax-plain hover:bg-[color-mix(in_srgb,var(--syntax-plain)_8%,transparent)]'

/*
 * The row the boss is on. Its tint is not here: `bg-transparent` on the row itself is emitted after
 * any colour named beside it, so the fill never drew (T216). Turning it on is a change to this
 * panel; the pull request says so.
 */
const OUTLINE_ON = 'files-outline__row--on'

const KIND = 'w-14 shrink-0 text-center text-syntax-call'

/* Why the viewer is only highlighting, for a place with no server to read with. */
const NOTICE = 'files-language-notice m-0 px-16 py-6 text-12/[normal] text-muted-foreground'

/* `text-brand-warning` was here and never drew: `text-muted-foreground` on the line itself is
   emitted after it, so the failed notice has always been the tint alone (T216). */
const NOTICE_FAILED = 'files-language-notice--failed bg-[color-mix(in_srgb,var(--brand-warning)_10%,transparent)]'

/* The way back from a symbol the boss followed. */
const BACK =
  'inline-flex shrink-0 cursor-pointer items-center gap-4 rounded-sm border border-border bg-transparent mr-8 px-8 py-2 text-11/[normal] text-muted-foreground hover:text-foreground'

/**
 * Everything the server complains about, under the file, so the boss sees a build break without
 * running one. Clicking a row takes them to the line it is about.
 */
export function Problems({ diagnostics, onPick }: { diagnostics: readonly Diagnosed[]; onPick(line: number): void }) {
  const summary = diagnosticsSummary(diagnostics)
  return (
    <section className={PROBLEMS} data-ui="Problems" aria-label={PROBLEMS_LABEL}>
      <header className={PROBLEMS_HEAD}>
        <CircleDot size={12} aria-hidden />
        {PROBLEMS_LABEL}
        <span className="normal-case tracking-[normal]">{summary === '' ? NO_PROBLEMS : summary}</span>
      </header>
      {diagnostics.length > 0 && (
        <ul className="m-0 list-none p-0">
          {diagnostics.map((one, index) => {
            const Icon = SEVERITY_ICONS[one.severity]
            return (
              <li key={index}>
                <button
                  type="button"
                  className={cx(PROBLEM_ROW, PROBLEM_TONE[one.severity], `files-problems__row--${one.severity}`)}
                  onClick={() => onPick(one.line)}
                >
                  <Icon size={12} aria-hidden />
                  <span className="min-w-48 shrink-0 font-code text-muted-foreground">{`${one.line}:${one.column}`}</span>
                  <span className="flex-auto">{one.message}</span>
                  {one.code !== null && <span className="shrink-0 font-code text-muted-foreground">{one.code}</span>}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/** The file's own symbols, indented as they nest, to jump inside a long file. */
export function Outline({
  outline,
  on,
  onPick,
}: {
  outline: readonly Outlined[]
  /** The symbol the boss is inside, which the list marks; null when they are above them all. */
  on?: Outlined | null | undefined
  onPick(line: number): void
}) {
  return (
    <aside className={OUTLINE} data-ui="Outline" aria-label={OUTLINE_LABEL}>
      <header className={OUTLINE_HEAD}>
        <ListTree size={12} aria-hidden />
        {OUTLINE_LABEL}
      </header>
      <ul className="m-0 list-none p-0">
        {outline.map((symbol, index) => (
          <li key={index}>
            <button
              type="button"
              className={cx(OUTLINE_ROW, symbol === on && OUTLINE_ON)}
              style={{ paddingLeft: `calc(var(--space-3) + ${Math.min(symbol.depth, 4)} * var(--files-indent))` }}
              title={outlineLabel(symbol)}
              onClick={() => onPick(symbol.line)}
            >
              <span className={KIND} aria-hidden>
                {symbol.kind.slice(0, 1).toUpperCase()}
              </span>
              <span className="overflow-hidden text-ellipsis whitespace-nowrap">{symbol.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  )
}

/**
 * Why the viewer is only highlighting. A place with no language server, or one whose server would
 * not start, says so in one quiet line and goes on drawing the file.
 */
export function LanguageNotice({ reading }: { reading: LanguageReading }) {
  if (reading.reason === null) return null
  return (
    <p className={cx(NOTICE, reading.status === 'failed' && NOTICE_FAILED)} role="status">
      {reading.reason}
    </p>
  )
}

/** The way back from a symbol the boss followed: one click per jump, as deep as they went. */
export function BackToJump({ path, onBack }: { path: string; onBack(): void }) {
  return (
    <button type="button" className={BACK} data-ui="Back" onClick={onBack} title={`Back to ${path}`}>
      <Undo2 size={12} aria-hidden />
      Back
    </button>
  )
}
