// The design's own Review fixture (Pen frame `ZCYGy`), as engine data: TC-142 in `billing-api`,
// six changed files, the currency hunk the frame shows, and Iris and Vega's thread on line 19.

import type { PullRequestDetails } from '../../../../shared/code'
import type { Company } from '../../../../shared/company'
import type { BoardSnapshot } from '../../../../shared/domain/board'
import type { Employee } from '../../../../shared/domain/staff'
import { EMPTY_STACK, type Repo } from '../../../../shared/repos/repo'
import type { Review } from '../../../../shared/review'
import type { FileSides, RepoDiff, ReviewComment } from '../../../../shared/review/review-diff'
import type { ReviewThread } from '../../../../shared/review/review-threads'

const DAY = '2026-09-17'
const at = (time: string) => `${DAY}T${time}:00`

function person(id: string, name: string, title: string, sprite: number): Employee {
  return {
    id,
    name,
    roleId: title.toLowerCase(),
    title,
    persona: '',
    capabilities: ['code', 'review'],
    repoFilter: ['*'],
    areas: [],
    mcpServers: [],
    skills: [],
    overrides: [],
    provider: 'claude',
    permissionMode: 'skip-permissions',
    model: null,
    desk: 0,
    sprite,
    createdAt: at('08:00'),
  }
}

export const employees: Employee[] = [
  person('e-iris', 'Iris', 'QA', 4),
  person('e-vega', 'Vega', 'Frontend', 1),
  person('e-atlas', 'Atlas', 'PM', 0),
  person('e-nova', 'Nova', 'Tech Lead', 2),
  person('e-orion', 'Orion', 'DevOps', 3),
  person('e-hera', 'Hera', 'HR', 5),
]

export const company: Company = {
  id: 'c-tiny',
  name: 'Tiny Corp',
  key: 'TC',
  boss: { name: 'Yuri Miguel', initials: 'YM' },
  folder: '/work/tiny',
  createdAt: at('08:00'),
}

const stack = { ...EMPTY_STACK, language: 'TypeScript', framework: 'vitest', packageManager: 'pnpm' }

export const repos: Repo[] = [
  { id: 'r-api', name: 'billing-api', path: '/code/api', brief: '', rung: 'merge', stack, addedAt: '' },
]

export const board: BoardSnapshot = {
  columns: [
    { id: 'todo', title: 'Todo', wipLimit: null, count: 0, overLimit: false },
    { id: 'doing', title: 'Doing', wipLimit: null, count: 0, overLimit: false },
    { id: 'review', title: 'Review', wipLimit: null, count: 1, overLimit: false },
    { id: 'done', title: 'Done', wipLimit: null, count: 0, overLimit: false },
  ],
  targets: [],
  epics: [],
  tickets: [
    {
      id: 142,
      epicId: null,
      title: 'Currency + locale formatting helper',
      description: '',
      column: 'review',
      assigneeId: 'e-vega',
      repos: ['r-api'],
      blocked: false,
      blockedReason: '',
      blockedBy: [],
      blocks: [],
      subtasks: [],
      priority: 'normal',
      labels: [],
      baseBranch: null,
    },
  ],
}

const URL = 'https://github.com/tinycorp/billing-api/pull/131'

export const details: PullRequestDetails[] = [
  {
    ticketId: 142,
    repoId: 'r-api',
    url: URL,
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
      { name: 'tests', workflow: 'vitest 142 passed', state: 'passing', durationMs: 64_000 },
      { name: 'lint', workflow: 'biome', state: 'passing', durationMs: 6_000 },
    ],
  },
]

export const review: Review = {
  id: 2,
  round: 2,
  rounds: 2,
  handoff: 'ready',
  roundLimit: 3,
  ticketId: 142,
  reviewerId: 'e-iris',
  status: 'approved',
  decidedBy: 'e-iris',
  comments: 'Ship it. The locale fallback is sound; one note on currency.ts:20 is a follow-up, not a blocker.',
  merge: null,
  approvalId: null,
  mergedRepoIds: [],
  mergeError: null,
  messageId: 9,
  requestedAt: at('09:30'),
  decidedAt: at('09:50'),
}

/**
 * The two sides of the file the frame draws open. Since T243 the diff editor is given whole files
 * and works the change out itself, so the fixture carries the file rather than a patch of it.
 */
const BASE = `import { CURRENCY_BY_LOCALE } from '../shared/locale'

/** A price in cents, as the customer's own currency reads it. */
export function formatPrice(cents: number, locale: string) {
  return \`$\${(cents / 100).toFixed(2)}\`
}

export function formatRange(from: number, to: number, locale: string) {
  return \`\${formatPrice(from, locale)} – \${formatPrice(to, locale)}\`
}
`

const HEAD = `import { CURRENCY_BY_LOCALE } from '../shared/locale'

/** A price in cents, as the customer's own currency reads it. */
export function formatPrice(cents: number, locale: string) {
  const currency = CURRENCY_BY_LOCALE[locale] ?? 'USD'
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100)
}

export function formatRange(from: number, to: number, locale: string) {
  return \`\${formatPrice(from, locale)} – \${formatPrice(to, locale)}\`
}
`

/** Counts the frame shows per file. */
const COUNTS: [string, number, number][] = [
  ['src/format/currency.ts', 64, 4],
  ['src/format/currency.test.ts', 48, 0],
  ['src/ui/PriceTag.tsx', 18, 12],
  ['src/ui/PriceTag.test.tsx', 9, 0],
  ['src/shared/locale.ts', 3, 22],
  ['package.json', 0, 0],
]

/** The file the frame draws open, which is the only one the fixture has two sides for. */
export const OPEN_FILE = 'src/format/currency.ts'

export function diffs(): RepoDiff[] {
  return [
    {
      repoId: 'r-api',
      url: URL,
      refusal: null,
      head: 'feat/locale-format',
      base: 'main',
      files: COUNTS.map(([path, additions, deletions]) => ({
        path,
        previousPath: null,
        status: 'modified' as const,
        additions,
        deletions,
        binary: false,
      })),
    },
  ]
}

/** One file's two sides; every file but the open one is drawn unchanged. */
export function sides(path: string): FileSides {
  if (path !== OPEN_FILE) return { path, original: BASE, modified: BASE, binary: false }
  return { path, original: BASE, modified: HEAD, binary: false }
}

export const comments: ReviewComment[] = [
  {
    id: 1,
    ticketId: 142,
    repoId: 'r-api',
    path: 'src/format/currency.ts',
    line: 19,
    authorId: 'e-iris',
    body: 'Intl throws on an unknown locale. Worth a fallback to `en-US` so a bad profile can’t blank the price.',
    url: null,
    createdAt: at('09:44'),
  },
  {
    id: 2,
    ticketId: 142,
    repoId: 'r-api',
    path: 'src/format/currency.ts',
    line: 19,
    authorId: 'e-vega',
    body: 'Good catch — CURRENCY_BY_LOCALE already falls back, the locale itself doesn’t. Pushing a guard.',
    url: null,
    createdAt: at('09:47'),
  },
]

/**
 * The agents' conversation, as frame `VtAMR` draws it: two settled threads that collapse to a row
 * with the commit that fixed them, and one left open as a non-blocking note — Iris asking, Vega
 * pushing back, Iris accepting it as a follow-up.
 */
export const threads: ReviewThread[] = [
  {
    id: 1,
    ticketId: 142,
    round: 1,
    repoId: 'r-api',
    path: 'src/format/currency.ts',
    line: 18,
    state: 'resolved',
    resolvedBy: 'e-iris',
    resolvedAt: at('10:10'),
    commit: '3f2a1c9',
    url: `${URL}#discussion_r1`,
    createdAt: at('09:44'),
    messages: [
      {
        id: 1,
        threadId: 1,
        round: 1,
        authorId: 'e-iris',
        body: 'Import from shared/, not ui/',
        commit: null,
        url: `${URL}#discussion_r1`,
        createdAt: at('09:44'),
      },
      {
        id: 2,
        threadId: 1,
        round: 1,
        authorId: 'e-vega',
        body: 'Moved it.',
        commit: '3f2a1c9',
        url: null,
        createdAt: at('10:02'),
      },
    ],
  },
  {
    id: 2,
    ticketId: 142,
    round: 1,
    repoId: 'r-api',
    path: 'src/format/currency.ts',
    line: 20,
    state: 'non_blocking',
    resolvedBy: null,
    resolvedAt: null,
    commit: null,
    url: `${URL}#discussion_r2`,
    createdAt: at('09:44'),
    messages: [
      {
        id: 3,
        threadId: 2,
        round: 1,
        authorId: 'e-iris',
        body: 'Intl throws on an unknown locale. Wrap this in a try/catch and fall back to en-US so a bad profile can’t blank the price.',
        commit: null,
        url: `${URL}#discussion_r2`,
        createdAt: at('09:44'),
      },
      {
        id: 4,
        threadId: 2,
        round: 1,
        authorId: 'e-vega',
        body: 'A try/catch here would hide a bad locale from error reporting. I’d rather reject it at the profile boundary — isKnownLocale in shared/locale.ts already does that.',
        commit: null,
        url: null,
        createdAt: at('10:02'),
      },
      {
        id: 5,
        threadId: 2,
        round: 2,
        authorId: 'e-iris',
        body: 'Fair. Approving — but the boundary check has no test yet. Leaving this open as a note for a follow-up.',
        commit: null,
        url: null,
        createdAt: at('10:15'),
      },
    ],
  },
  {
    id: 3,
    ticketId: 142,
    round: 1,
    repoId: 'r-api',
    path: 'src/format/currency.ts',
    line: 21,
    state: 'resolved',
    resolvedBy: 'e-iris',
    resolvedAt: at('10:12'),
    commit: '8be40d2',
    url: `${URL}#discussion_r3`,
    createdAt: at('09:45'),
    messages: [
      {
        id: 6,
        threadId: 3,
        round: 1,
        authorId: 'e-iris',
        body: 'Throw a typed UnknownLocaleError',
        commit: null,
        url: `${URL}#discussion_r3`,
        createdAt: at('09:45'),
      },
      {
        id: 7,
        threadId: 3,
        round: 1,
        authorId: 'e-vega',
        body: 'Added.',
        commit: '8be40d2',
        url: null,
        createdAt: at('10:02'),
      },
    ],
  },
]
