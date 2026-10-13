import { describe, expect, it } from 'vitest'
import {
  countsLine,
  emptyCounts,
  MEMORY_KINDS,
  type MemoryCounts,
  type MemoryPageSummary,
  memoryKindFolder,
  pagePath,
  rowSource,
  slugify,
  usesChip,
  whenLabel,
} from '../../../shared/memory/company-memory'
import { emptyList, filterRows, HOW_IT_FILLS, historyLabel, kindChips, memorySubtitle } from './memory-view'

const NOW = Date.parse('2026-09-23T12:00:00.000Z')

function counts(over: Partial<MemoryCounts> = {}): MemoryCounts {
  return { ...emptyCounts(), ...over }
}

function row(over: Partial<MemoryPageSummary> = {}): MemoryPageSummary {
  return {
    slug: 'locale-handling-in-billing',
    kind: 'decision',
    title: 'Locale handling in billing',
    repos: ['billing-api'],
    sources: [{ kind: 'ticket', ref: 'TC-142' }],
    links: [],
    updatedBy: 'Vega',
    createdAt: '2026-09-20T09:00:00.000Z',
    updatedAt: '2026-09-21T09:00:00.000Z',
    pinned: false,
    archived: false,
    handoff: null,
    lastUsedAt: '2026-09-23T11:48:00.000Z',
    usesThisWeek: 14,
    cold: false,
    contradiction: null,
    ...over,
  }
}

describe('the chips over the list', () => {
  it('leads with All and then every kind, in the frame’s order', () => {
    const chips = kindChips(counts({ pages: 42, byKind: { ...emptyCounts().byKind, decision: 11, convention: 9 } }))
    expect(chips.map((chip) => `${chip.label} ${chip.count}`)).toEqual([
      'All 42',
      'Decisions 11',
      'Conventions 9',
      'Gotchas 0',
      'Architecture 0',
      'Glossary 0',
      'Handoffs 0',
    ])
    expect(chips[0]!.kind).toBeNull()
  })
})

describe('what the screen says about itself', () => {
  it('names the Company, the count and where the pages live', () => {
    expect(memorySubtitle('Tiny Corp', counts({ pages: 42 }))).toBe(
      'What Tiny Corp knows. Every Employee reads and writes it through MCP, on any provider · 42 pages, kept in git.',
    )
    expect(memorySubtitle('Tiny Corp', counts({ pages: 1 }))).toContain('1 page, kept in git')
  })

  it('counts pages, cold ones and contradictions, leaving out what is zero', () => {
    expect(countsLine(counts({ pages: 42, cold: 2, contradictions: 2 }))).toBe(
      '42 pages · 2 cold · 2 possible contradictions',
    )
    expect(countsLine(counts({ pages: 1 }))).toBe('1 page')
    expect(countsLine(counts({ pages: 3, contradictions: 1 }))).toBe('3 pages · 1 possible contradiction')
  })

  it('numbers History only once git has said something', () => {
    expect(historyLabel(6)).toBe('History · 6')
    expect(historyLabel(0)).toBe('History')
  })
})

describe('a row', () => {
  it('says where the page came from, in the words the frame uses', () => {
    expect(rowSource(row())).toBe('from TC-142 plan')
    expect(
      rowSource(
        row({
          sources: [
            { kind: 'ticket', ref: 'TC-142' },
            { kind: 'review', ref: 'x' },
          ],
        }),
      ),
    ).toBe('from TC-142 review')
    expect(
      rowSource(
        row({
          sources: [
            { kind: 'ticket', ref: 'TC-118' },
            { kind: 'commit', ref: 'abc' },
          ],
        }),
      ),
    ).toBe('from TC-118 test failure')
    expect(rowSource(row({ sources: [], updatedBy: 'Orion' }))).toBe('by Orion')
  })

  it('says where a Handoff stands, not where it came from', () => {
    const handoff = (state: 'open' | 'claimed' | 'done', claimedBy: string | null) =>
      rowSource(row({ kind: 'handoff', handoff: { state, claimedBy, claimedAt: null } }))
    expect(handoff('claimed', 'Vega')).toBe('claimed by Vega')
    expect(handoff('open', null)).toBe('waiting for a desk')
    expect(handoff('done', null)).toBe('closed with the ticket')
    // A Handoff that closed with its ticket says so, whoever had claimed it.
    expect(handoff('done', 'Iris')).toBe('closed with the ticket')
  })

  it('reads its age the way the frame writes it', () => {
    expect(whenLabel('2026-09-23T11:48:00.000Z', NOW)).toBe('12m ago')
    expect(whenLabel('2026-09-23T09:00:00.000Z', NOW)).toBe('3h ago')
    expect(whenLabel('2026-09-22T09:00:00.000Z', NOW)).toBe('yesterday')
    expect(whenLabel('2026-09-21T09:00:00.000Z', NOW)).toBe('2d ago')
    expect(whenLabel(null, NOW)).toBe('never used')
  })

  it('shows the uses chip only when something read it this week', () => {
    expect(usesChip({ usesThisWeek: 14 })).toBe('used 14 times this week')
    expect(usesChip({ usesThisWeek: 1 })).toBe('used 1 time this week')
    expect(usesChip({ usesThisWeek: 0 })).toBeNull()
  })

  it('narrows on a title, a slug, a repo or a source without asking the engine again', () => {
    const rows = [
      row(),
      row({ slug: 'currency-defaults', title: 'Currency defaults', repos: ['web-app'], sources: [] }),
    ]
    expect(filterRows(rows, 'locale').map((r) => r.slug)).toEqual(['locale-handling-in-billing'])
    expect(filterRows(rows, 'web-app').map((r) => r.slug)).toEqual(['currency-defaults'])
    expect(filterRows(rows, 'TC-142').map((r) => r.slug)).toEqual(['locale-handling-in-billing'])
    expect(filterRows(rows, '  ')).toHaveLength(2)
  })
})

describe('the empty list', () => {
  it('invites the first page only when the Company has none at all', () => {
    expect(emptyList(counts(), false).title).toBe('Nothing remembered yet')
    expect(emptyList(counts(), false).body).toContain('Pages appear on their own when tickets close')
    expect(emptyList(counts(), true).title).toBe('Nothing here')
    expect(emptyList(counts({ pages: 42 }), false).title).toBe('Nothing here')
  })
})

describe('the path bar', () => {
  it('writes the file the page is, and says archive when it is archived', () => {
    expect(pagePath({ kind: 'decision', slug: 'locale-handling-in-billing', archived: false })).toBe(
      'memory / decisions / locale-handling-in-billing.md',
    )
    expect(pagePath({ kind: 'gotcha', slug: 'vitest-hangs', archived: true })).toBe(
      'memory / archive / vitest-hangs.md',
    )
  })

  /** The store writes `architecture/` and `glossary/`; an `s` on the kind named neither of them. */
  it('names the folder the store really writes, for every kind', () => {
    expect(MEMORY_KINDS.map(memoryKindFolder)).toEqual([
      'decisions',
      'conventions',
      'gotchas',
      'architecture',
      'glossary',
      'handoffs',
    ])
    expect(pagePath({ kind: 'architecture', slug: 'billing-service-boundaries', archived: false })).toBe(
      'memory / architecture / billing-service-boundaries.md',
    )
  })

  it('makes a file name out of a title, whatever the title holds', () => {
    expect(slugify('“Seat” vs “member”')).toBe('seat-vs-member')
    expect(slugify('web-app vitest needs --pool=threads')).toBe('web-app-vitest-needs-pool-threads')
    expect(slugify('Café déjà vu')).toBe('cafe-deja-vu')
    expect(slugify('***')).toBe('')
  })
})

/**
 * Frame `SlxSy` lays the six kinds out three rows of two, pairing each with the one it is most
 * easily mistaken for. The grid took its order from `MEMORY_KINDS` instead — the filter chips'
 * order — and drew Handoff last where the frame draws it fourth (T196).
 */
describe('how a Company memory fills', () => {
  it('lays the kinds out in the frame’s order, not the chips’', () => {
    expect(HOW_IT_FILLS.map((entry) => entry.kind)).toEqual([
      'decision',
      'convention',
      'gotcha',
      'handoff',
      'architecture',
      'glossary',
    ])
  })

  it('explains every kind the catalogue knows, and invents none', () => {
    expect([...HOW_IT_FILLS.map((entry) => entry.kind)].sort()).toEqual([...MEMORY_KINDS].sort())
  })
})
