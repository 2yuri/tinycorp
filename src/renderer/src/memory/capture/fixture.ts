// The design's own Memory fixture (Pen frames `E40vSb` and `I44S1a`), as the engine would hand it
// over. Nothing here ships: it stands in for a Company so the screen can be compared with the frame.
import type { Company } from '../../../../shared/company'
import type { BoardSnapshot, Ticket } from '../../../../shared/domain/board'
import type { Employee } from '../../../../shared/domain/staff'
import {
  emptyCounts,
  type MemoryCounts,
  type MemoryPage,
  type MemoryPageSummary,
  type MemoryRevision,
} from '../../../../shared/memory/company-memory'
import { EMPTY_STACK, type Repo } from '../../../../shared/repos/repo'
import { EMPTY_SHELL_DATA, type ShellData } from '../../shell/nav-model'

export const NOW = Date.parse('2026-09-23T12:00:00.000Z')

const AGO = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString()

function row(over: Partial<MemoryPageSummary> & Pick<MemoryPageSummary, 'slug' | 'title' | 'kind'>): MemoryPageSummary {
  return {
    repos: ['billing-api'],
    sources: [],
    links: [],
    updatedBy: 'Vega',
    createdAt: AGO(60 * 24 * 10),
    updatedAt: AGO(60 * 24 * 2),
    pinned: false,
    archived: false,
    handoff: null,
    lastUsedAt: AGO(12),
    usesThisWeek: 0,
    cold: false,
    contradiction: null,
    ...over,
  }
}

/** The nine rows the frame lists, in Recently used order. */
export const rows: MemoryPageSummary[] = [
  row({
    slug: 'locale-handling-in-billing',
    title: 'Locale handling in billing',
    kind: 'decision',
    repos: ['billing-api', 'web-app'],
    sources: [
      { kind: 'ticket', ref: 'TC-142' },
      { kind: 'pr', ref: '#88' },
      { kind: 'review', ref: 'TC-142 thread 7' },
    ],
    links: ['currency-defaults', 'prices-use-formatprice', 'billing-service-boundaries'],
    lastUsedAt: AGO(12),
    usesThisWeek: 14,
    contradiction: {
      slug: 'currency-defaults',
      title: 'Currency defaults',
      term: 'DEFAULT_CURRENCY',
      values: ['the account’s locale', 'EUR'],
    },
  }),
  row({
    slug: 'currency-defaults',
    title: 'Currency defaults',
    kind: 'convention',
    updatedBy: 'Orion',
    lastUsedAt: AGO(60),
    usesThisWeek: 6,
    contradiction: {
      slug: 'locale-handling-in-billing',
      title: 'Locale handling in billing',
      term: 'DEFAULT_CURRENCY',
      values: ['EUR', 'the account’s locale'],
    },
  }),
  row({
    slug: 'web-app-vitest-needs-pool-threads',
    title: 'web-app vitest needs --pool=threads',
    kind: 'gotcha',
    repos: ['web-app'],
    sources: [
      { kind: 'ticket', ref: 'TC-118' },
      { kind: 'commit', ref: '9f2c1ab' },
    ],
    updatedBy: 'Nova',
    lastUsedAt: AGO(60 * 3),
    usesThisWeek: 3,
  }),
  row({
    slug: 'vega-codex-tc-146',
    title: 'Vega → Codex · TC-146',
    kind: 'handoff',
    sources: [{ kind: 'ticket', ref: 'TC-146' }],
    handoff: { state: 'claimed', claimedBy: 'Vega', claimedAt: AGO(60 * 5) },
    lastUsedAt: AGO(60 * 5),
  }),
  row({
    slug: 'billing-service-boundaries',
    title: 'Billing service boundaries',
    kind: 'architecture',
    sources: [{ kind: 'ticket', ref: 'TC-131' }],
    lastUsedAt: AGO(60 * 26),
  }),
  row({
    slug: 'seat-vs-member',
    title: '“Seat” vs “member”',
    kind: 'glossary',
    sources: [],
    updatedBy: 'Nova',
    lastUsedAt: AGO(60 * 48),
  }),
  row({
    slug: 'prices-use-formatprice',
    title: 'Every price goes through formatPrice',
    kind: 'convention',
    repos: ['web-app'],
    sources: [
      { kind: 'ticket', ref: 'TC-96' },
      { kind: 'review', ref: 'TC-96 thread 2' },
    ],
    updatedBy: 'Orion',
    lastUsedAt: AGO(60 * 72),
  }),
  row({
    slug: 'webhook-retries-with-backoff',
    title: 'Webhook retries with backoff',
    kind: 'decision',
    sources: [{ kind: 'ticket', ref: 'TC-311' }],
    lastUsedAt: AGO(60 * 24 * 24),
    cold: true,
  }),
  row({
    slug: 'legacy-invoice-pdf-renderer',
    title: 'Legacy invoice PDF renderer',
    kind: 'architecture',
    sources: [],
    updatedBy: 'Orion',
    lastUsedAt: AGO(60 * 24 * 41),
    cold: true,
  }),
]

/** The three Handoffs of `I44S1a`a. */
export const handoffs: MemoryPageSummary[] = [
  rows[3]!,
  row({
    slug: 'orion-claude-tc-139',
    title: 'Orion → Claude · TC-139',
    kind: 'handoff',
    sources: [{ kind: 'ticket', ref: 'TC-139' }],
    handoff: { state: 'open', claimedBy: null, claimedAt: null },
    lastUsedAt: AGO(60 * 4),
  }),
  row({
    slug: 'iris-codex-tc-131',
    title: 'Iris → Codex · TC-131',
    kind: 'handoff',
    sources: [{ kind: 'ticket', ref: 'TC-131' }],
    handoff: { state: 'done', claimedBy: 'Iris', claimedAt: AGO(60 * 30) },
    lastUsedAt: AGO(60 * 28),
  }),
]

export const counts: MemoryCounts = {
  ...emptyCounts(),
  pages: 42,
  byKind: { decision: 11, convention: 9, gotcha: 8, architecture: 6, glossary: 5, handoff: 3 },
  cold: 2,
  contradictions: 2,
  archived: 0,
}

/** The page the frame has open. */
export const open: MemoryPage = {
  slug: 'locale-handling-in-billing',
  kind: 'decision',
  title: 'Locale handling in billing',
  repos: ['billing-api', 'web-app'],
  sources: rows[0]!.sources,
  links: ['currency-defaults', 'prices-use-formatprice', 'billing-service-boundaries'],
  updatedBy: 'Vega',
  createdAt: AGO(60 * 24 * 3),
  updatedAt: AGO(60 * 48),
  pinned: false,
  archived: false,
  handoff: null,
  body: [
    'Money is stored in minor units and formatted once, at the edge. The locale comes from the account,',
    'never from the browser, so an invoice reads the same for everyone who opens it.',
    '',
    '## Decision',
    '',
    '- billing-api returns amounts as integers plus a currency code — no formatted strings.',
    '- web-app formats with formatPrice(amount, account.locale) and nothing else.',
    '- A missing locale falls back to en-US, logged once per account.',
    '',
    '```ts',
    'const label = formatPrice(invoice.total, account.locale)',
    '// never: invoice.total.toLocaleString()',
    '```',
    '',
    '## Why',
    '',
    'TC-142’s review found three places formatting with the browser locale; the 90d chart and the',
    'invoice list disagreed for a German account. Iris’s test run caught the same mismatch.',
  ].join('\n'),
}

export const revisions: MemoryRevision[] = [
  { commit: '9f2c1ab00000', author: 'Vega', at: AGO(60 * 48), subject: 'Update decision locale-handling-in-billing' },
  {
    commit: '3b71c4d00000',
    author: 'Yuri',
    at: AGO(60 * 60),
    subject: 'Link locale-handling-in-billing to currency-defaults',
  },
  { commit: '77ae09900000', author: 'Iris', at: AGO(60 * 70), subject: 'Update decision locale-handling-in-billing' },
  { commit: 'c41b88200000', author: 'Orion', at: AGO(60 * 71), subject: 'Update decision locale-handling-in-billing' },
  { commit: '5d0f31a00000', author: 'Vega', at: AGO(60 * 72), subject: 'Update decision locale-handling-in-billing' },
  { commit: 'aa10e5600000', author: 'Tiny Corp', at: AGO(60 * 73), subject: 'Add decision locale-handling-in-billing' },
]

/** Every page's title, so Linked pages read as names. */
export const titles = Object.fromEntries(rows.map((one) => [one.slug, { title: one.title, kind: one.kind }]))

/**
 * The shell around the screen. The frame draws Memory inside the whole window — the Company rail,
 * the drawer, its counts and the boss — and a harness that drew a grey block there passed its own
 * audit while a fifth of the window went unchecked (T192).
 */
export const company: Company = {
  id: 'c-tiny',
  name: 'Tiny Corp',
  key: 'TC',
  boss: { name: 'Yuri Miguel', initials: 'YM' },
  folder: '/work/tiny',
  createdAt: '2026-09-17T08:00:00',
}

/** The three the rail shows beside Tiny Corp in the frame. */
export const companies: Company[] = [
  company,
  { ...company, id: 'c-atlas', name: 'Atlas Studio', key: 'AS', folder: '/work/atlas' },
  { ...company, id: 'c-lumen', name: 'Lumen Retail', key: 'LR', folder: '/work/lumen' },
  { ...company, id: 'c-north', name: 'North Vane', key: 'NV', folder: '/work/north' },
]

/**
 * A row the drawer only counts. The casts are the point: nothing reads a field of these, so
 * writing a whole Employee or Ticket here would say the fixture means something it does not.
 */
function countOf<T>(many: number, one: T): T[] {
  return Array.from({ length: many }, () => one)
}

/** What the drawer reads: the frame's own 8 Employees, 12 unread, 31 tickets, 3 repos, 42 pages. */
export function shellData(pages: number): ShellData {
  return {
    ...EMPTY_SHELL_DATA,
    employees: countOf(8, { id: 'e', name: 'Nova' } as Employee),
    unread: { general: 12 },
    board: { columns: [], targets: [], epics: [], tickets: countOf(31, { id: 1 } as Ticket) } as BoardSnapshot,
    repos: ['web-app', 'billing-api', 'infra'].map((name) => ({ id: name, name, stack: EMPTY_STACK }) as Repo),
    memoryPages: pages,
  }
}
