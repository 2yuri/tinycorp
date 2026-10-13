import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'
import type { PullRequestDetails } from '../../../shared/code'
import { BOSS } from '../../../shared/domain/chat'
import type { Employee } from '../../../shared/domain/staff'
import type { Review } from '../../../shared/review'
import type { DiffFile, FileSides, ReviewComment } from '../../../shared/review/review-diff'
import type { DiffControls } from '../editor'

// The office's character sheet is decoded through the DOM; the parts read it when they load.
beforeAll(() => {
  ;(globalThis as { window?: unknown }).window ??= { tinyCorp: {} }
})

const { DiffView, FileList, ReviewPanel } = await import('./ReviewParts')
const { CommentThread } = await import('./ReviewComments')

const iris = { id: 'e-iris', name: 'Iris', title: 'QA', sprite: 4 } as Employee

const currency: DiffFile = {
  path: 'src/format/currency.ts',
  previousPath: null,
  status: 'modified',
  additions: 64,
  deletions: 4,
  binary: false,
}

const sides: FileSides = {
  path: 'src/format/currency.ts',
  original: 'export function formatPrice(cents: number) {\n  return `$${(cents / 100).toFixed(2)}`\n}\n',
  modified: "export function formatPrice(cents: number) {\n  const currency = BY_LOCALE[locale] ?? 'USD'\n}\n",
  binary: false,
}

const locale: DiffFile = {
  path: 'src/shared/locale.ts',
  previousPath: null,
  status: 'added',
  additions: 3,
  deletions: 22,
  binary: false,
}

/** The diff's controls, as a screen holds them; `useDiffControls` is what the app builds. */
const controls: DiffControls = {
  layout: 'split',
  setLayout: () => {},
  changes: { current: 1, total: 4 },
  next: () => {},
  previous: () => {},
  bind: { layout: 'split', goTo: { seq: 0, change: 0 }, onChanges: () => {}, onAt: () => {}, onWidth: () => {} },
}

const comment: ReviewComment = {
  id: 1,
  ticketId: 142,
  repoId: 'r-web',
  path: 'src/format/currency.ts',
  line: 19,
  authorId: 'e-iris',
  body: 'Intl throws on an unknown locale.',
  url: null,
  // Built from a local time so the rendered `09:44` does not move with the test machine's zone.
  createdAt: new Date(2026, 8, 17, 9, 44).toISOString(),
}

const details: PullRequestDetails = {
  ticketId: 142,
  repoId: 'r-web',
  url: 'https://github.com/acme/app/pull/131',
  number: 131,
  title: 'Currency + locale formatting helper',
  state: 'open',
  head: 'feat/locale-format',
  base: 'main',
  additions: 142,
  deletions: 38,
  changedFiles: 6,
  mergeable: 'mergeable',
  checks: [
    { name: 'build', workflow: 'pnpm build', state: 'passing', durationMs: 28_000 },
    { name: 'lint', workflow: 'biome', state: 'failing', durationMs: 6_000 },
  ],
}

const review: Review = {
  id: 2,
  round: 2,
  rounds: 2,
  handoff: 'ready',
  roundLimit: 3,
  ticketId: 142,
  reviewerId: 'e-iris',
  status: 'approved',
  decidedBy: 'e-iris',
  comments: '',
  merge: null,
  approvalId: null,
  mergedRepoIds: [],
  mergeError: null,
  messageId: 9,
  requestedAt: '2026-09-17T09:00:00.000Z',
  decidedAt: '2026-09-17T09:50:00.000Z',
}

/* The two decisions are told apart by their fill: `Approve & merge` is the primary one. */
const APPROVE_DISABLED = /class="[^"]*\bbg-primary\b[^"]*" disabled=""/
const SEND_BACK_DISABLED = /class="[^"]*\bbg-transparent\b[^"]*" disabled=""/

const noop = () => {}
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()

describe('the file list', () => {
  it('captions the files and shows each one’s name, folder and counts', () => {
    const html = renderToStaticMarkup(
      <FileList
        files={[currency, locale]}
        comments={[comment]}
        viewed={new Set()}
        activePath="src/format/currency.ts"
        onPick={noop}
      />,
    )

    expect(text(html)).toBe('2 FILES · +67 −26 currency.ts src/format/ 1 +64 −4 locale.ts src/shared/ +3 −22')
    // The fill is a utility now; `aria-current` is the part a screen reader hears.
    expect(html).toContain('bg-muted')
    expect(html).toContain('aria-current="true"')
  })

  it('ticks a file the boss marked viewed', () => {
    const html = renderToStaticMarkup(
      <FileList
        files={[currency]}
        comments={[]}
        viewed={new Set(['src/format/currency.ts'])}
        activePath={null}
        onPick={noop}
      />,
    )

    // A viewed file dims its name rather than carrying a modifier class.
    expect(html).toContain('text-muted-foreground')
    expect(html).toContain('aria-label="Viewed"')
  })

  it('says so when a ticket changes nothing yet', () => {
    const html = renderToStaticMarkup(
      <FileList files={[]} comments={[]} viewed={new Set()} activePath={null} onPick={noop} />,
    )

    expect(text(html)).toBe('0 FILES · +0 −0 No changes yet')
  })
})

describe('the diff', () => {
  function render(props: Partial<Parameters<typeof DiffView>[0]> = {}) {
    return renderToStaticMarkup(
      <DiffView
        file={currency}
        sides={sides}
        loading={false}
        sidesError={null}
        controls={controls}
        talk={{ comments: [], threads: [], findingThreads: new Set() }}
        employees={[iris]}
        bossName="Yuri Miguel"
        viewed={false}
        url="https://github.com/acme/app/pull/131/files"
        onToggleViewed={noop}
        commentOn={null}
        onCommentOn={noop}
        onComment={noop}
        {...props}
      />,
    )
  }

  it('heads the file with its path and counts, and offers Mark viewed and Open file', () => {
    const html = render()

    expect(text(html)).toContain('src/format/currency.ts +64 −4')
    expect(text(html)).toContain('Mark viewed Open file')
    expect(html).toContain('href="https://github.com/acme/app/pull/131/files"')
  })

  /*
   * T243 put the control bar in this header and it stopped fitting: `Mark viewed` and `Open file`
   * each broke over two lines at the default window, and so did `+64 −4` (T244). Nothing in the
   * bar may wrap — the path gives way by an ellipsis, and each action keeps its label on one line
   * or drops to its icon and a tooltip — and a screen reader is told which button it is either way.
   */
  it('never wraps: the path truncates, the counts and the actions do not', () => {
    const html = render()

    expect(html).toContain('min-w-0 truncate font-code')
    expect(html).toContain('shrink-0 whitespace-nowrap font-code')
    expect(html).toContain('aria-label="Mark viewed"')
    expect(html).toContain('aria-label="Open file"')
    // Both labels live behind the header's own width rather than the window's, so closing the
    // conversation panel spells them out again.
    expect(html.match(/hidden @\[640px\]:inline/g)).toHaveLength(2)
  })

  /*
   * Monaco needs a layout and cannot run here, so what a static render can say about the diff is
   * what the frame says: which file, in which language, laid out which way. It is the same three
   * attributes `FilesView.test.tsx` reads off the file editor (T222), and it is what the whole
   * split between `DiffEditor` and `DiffMonaco` is for.
   */
  it('hands the file and the layout to the diff editor', () => {
    const html = render()

    expect(html).toContain('data-ui="Diff editor"')
    expect(html).toContain('data-path="src/format/currency.ts"')
    expect(html).toContain('data-language="typescript"')
    expect(html).toContain('data-layout="split"')
  })

  it('draws the walk through the changes, and which one the boss is on', () => {
    const html = render()

    expect(html).toContain('aria-label="Next change"')
    expect(html).toContain('aria-label="Previous change"')
    expect(text(html)).toContain('1 / 4')
  })

  it('says Viewed once the file is ticked', () => {
    expect(render({ viewed: true })).toContain('text-status-success-foreground')
    expect(text(render({ viewed: true }))).toContain('Viewed')
  })

  it('asks for a file before there is one', () => {
    expect(text(render({ file: null }))).toBe('Pick a file to read its diff.')
  })

  it('says a binary file has nothing to show, and never asks for its two sides', () => {
    const html = render({ file: { ...locale, binary: true }, sides: null })

    expect(text(html)).toContain('This file is binary; there is nothing to show.')
    expect(html).not.toContain('data-ui="Diff editor"')
  })

  it('says why the two sides could not be read, rather than an empty diff', () => {
    const html = render({ sides: null, sidesError: 'This pull request has no worktree here any more.' })

    expect(text(html)).toContain('This pull request has no worktree here any more.')
    expect(html).not.toContain('data-ui="Diff editor"')
  })

  it('says it is reading while the two sides are on their way', () => {
    expect(text(render({ sides: null, loading: true }))).toContain('Reading the diff…')
  })
})

describe('the comment thread', () => {
  it('shows each comment with its author, role, time and body, and a way to reply', () => {
    const html = renderToStaticMarkup(
      <CommentThread
        comments={[comment, { ...comment, id: 2, authorId: BOSS, body: 'Good catch.' }]}
        employees={[iris]}
        bossName="Yuri Miguel"
        line={19}
        onComment={noop}
      />,
    )

    // Each author carries their own avatar: the Employee's character, the boss's initials.
    expect(html).toContain('aria-label="Iris"')
    expect(html).toContain('aria-label="Yuri Miguel"')
    expect(text(html)).toBe('IR Iris QA 09:44 Intl throws on an unknown locale. YM Yuri Miguel BOSS 09:44 Good catch.')
    // The role reads in the author's own accent, the same one their avatar tile carries.
    expect(html).toMatch(/<span class="[^"]*data-accent[^"]*" data-accent="pink">QA<\/span>/)
    // The boss has no Employee accent, so the chip stays muted and carries no `data-accent`.
    expect(html).toMatch(/<span class="[^"]*">BOSS<\/span>/)
  })

  it('carries a composer naming the line it is for', () => {
    const html = renderToStaticMarkup(
      <CommentThread comments={[]} employees={[]} bossName="You" line={19} onComment={noop} />,
    )

    expect(html).toContain('placeholder="Reply on line 19…"')
  })

  it('links a comment GitHub took a copy of', () => {
    const html = renderToStaticMarkup(
      <CommentThread
        comments={[{ ...comment, url: 'https://github.com/acme/app/pull/131#discussion_r1' }]}
        employees={[iris]}
        bossName="You"
        line={19}
        onComment={noop}
      />,
    )

    expect(html).toContain('href="https://github.com/acme/app/pull/131#discussion_r1"')
    expect(text(html)).toContain('On GitHub')
  })
})

describe('the review panel', () => {
  function render(props: Partial<Parameters<typeof ReviewPanel>[0]> = {}) {
    return renderToStaticMarkup(
      <ReviewPanel
        repoName="billing-api"
        details={details}
        diff={{ head: 'feat/locale-format', base: 'main', files: [currency, locale], refusal: null }}
        review={review}
        round="billing-api · round 2 · approved"
        summary="Iris approved · 1 unresolved comment"
        unresolved={[comment]}
        threads={[]}
        onForge
        onJumpTo={noop}
        employees={[iris]}
        bossName="Yuri Miguel"
        comments=""
        busy={false}
        canDecide
        error={null}
        onComments={noop}
        onApprove={noop}
        onRequestChanges={noop}
        onClose={noop}
        {...props}
      />,
    )
  }

  it('shows the repo, the PR, mergeability, the title, the branch line and the checks', () => {
    const body = text(render({ defaultTab: 'checks' }))

    expect(body).toContain('billing-api #131 Mergeable')
    expect(body).toContain('Currency + locale formatting helper')
    expect(body).toContain('feat/locale-format → main · +142 −38 · 6 files')
    expect(body).toContain('build · pnpm build 28s')
    expect(body).toContain('lint · biome 6s')
    expect(render({ defaultTab: 'checks' })).toContain('text-status-error-foreground')
  })

  it('says where the round stands and lists what is unresolved', () => {
    const body = text(render())

    expect(body).toContain('Iris approved · 1 unresolved comment')
    expect(body).toContain('1 unresolved comment')
    expect(body).toContain('Intl throws on an unknown locale.')
  })

  it('offers both decisions live before the boss has typed anything (frame VtAMR)', () => {
    expect(text(render())).toContain('Approve & merge Send back')
    expect(render()).not.toMatch(APPROVE_DISABLED)
    expect(render()).not.toMatch(SEND_BACK_DISABLED)
  })

  it('offers View beside the verdict only while something is unresolved', () => {
    expect(text(render())).toContain('Iris approved · 1 unresolved comment View')
    expect(text(render({ unresolved: [] }))).not.toContain('View')
  })

  it('offers a retry after a failed merge', () => {
    expect(text(render({ review: { ...review, merge: 'failed' } }))).toContain('Retry merge')
  })

  it('disables both decisions once the boss may not decide', () => {
    const html = render({ canDecide: false })

    expect(html).toMatch(APPROVE_DISABLED)
    expect(html).toMatch(SEND_BACK_DISABLED)
  })

  it('shows what went wrong', () => {
    expect(text(render({ error: 'There is no git service to merge with' }))).toContain(
      'There is no git service to merge with',
    )
  })

  it('reads a repo with no PR as having none', () => {
    expect(text(render({ details: null, defaultTab: 'checks' }))).toContain('billing-api No PR')
    expect(text(render({ details: { ...details, checks: [] }, defaultTab: 'checks' }))).toContain('No checks reported')
  })

  it('says why a branch in a repo that can never open a PR has none, and still offers the merge', () => {
    const local = {
      head: 'ticket-9-currency',
      base: 'main',
      files: [currency],
      refusal: { badge: 'No remote', reason: 'No remote, cannot open a PR' },
    }
    const html = render({ details: null, diff: local, defaultTab: 'checks' })

    expect(text(html)).toContain('billing-api No remote')
    expect(text(html)).not.toContain('No PR')
    expect(text(html)).toContain('ticket-9-currency → main · +64 −4 · 1 file')
    expect(html).not.toMatch(APPROVE_DISABLED)
  })
})
