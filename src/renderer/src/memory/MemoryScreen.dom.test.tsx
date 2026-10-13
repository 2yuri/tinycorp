// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  emptyCounts,
  type MemoryCounts,
  type MemoryPage,
  type MemoryPageSummary,
} from '../../../shared/memory/company-memory'
import { MemoryList } from './MemoryList'
import { MemoryPageView } from './MemoryPageView'

/**
 * The Memory screen's two halves, driven the way the boss drives them. What each row and each
 * banner says is `memory-view.test.ts`; here it is the screen: a click opens a page, a filter is
 * pressed, the empty state offers the first page, and the contradiction banner says a term found
 * it and not a model.
 */

const NOW = Date.parse('2026-09-23T12:00:00.000Z')

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function render(node: Parameters<Root['render']>[0]): void {
  act(() => root.render(node))
}

const text = () => host.textContent ?? ''
const buttons = () => [...host.querySelectorAll('button')]
const click = (label: string) => {
  const button = buttons().find((one) => (one.textContent ?? '').includes(label))
  if (!button)
    throw new Error(
      `No button says "${label}" — found: ${buttons()
        .map((b) => b.textContent)
        .join(' | ')}`,
    )
  act(() => button.click())
}

function counts(over: Partial<MemoryCounts> = {}): MemoryCounts {
  return { ...emptyCounts(), ...over }
}

function summary(over: Partial<MemoryPageSummary> = {}): MemoryPageSummary {
  return {
    slug: 'locale-handling-in-billing',
    kind: 'decision',
    title: 'Locale handling in billing',
    repos: ['billing-api'],
    sources: [
      { kind: 'ticket', ref: 'TC-142' },
      { kind: 'review', ref: 'TC-142 thread 7' },
    ],
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

function page(over: Partial<MemoryPage> = {}): MemoryPage {
  const { lastUsedAt: _u, usesThisWeek: _w, cold: _c, contradiction: _x, ...rest } = summary()
  return { ...rest, body: 'Money is stored in minor units.\n\n## Decision\n\n- Formatted at the edge.', ...over }
}

function list(props: Partial<Parameters<typeof MemoryList>[0]> = {}) {
  const onOpen = vi.fn()
  const onKind = vi.fn()
  const onSort = vi.fn()
  const onWriteFirst = vi.fn()
  render(
    <MemoryList
      rows={[summary()]}
      counts={counts({ pages: 42, cold: 2, contradictions: 2, byKind: { ...emptyCounts().byKind, decision: 11 } })}
      search=""
      onSearch={() => {}}
      kind={null}
      onKind={onKind}
      sort="used"
      onSort={onSort}
      openSlug={null}
      onOpen={onOpen}
      onWriteFirst={onWriteFirst}
      now={NOW}
      {...props}
    />,
  )
  return { onOpen, onKind, onSort, onWriteFirst }
}

describe('the list', () => {
  it('draws a row with its kind, where it came from and when it was last used', () => {
    list()
    expect(text()).toContain('Locale handling in billing')
    expect(text()).toContain('Decision')
    expect(text()).toContain('from TC-142 review')
    expect(text()).toContain('12m ago')
    expect(text()).toContain('42 pages · 2 cold · 2 possible contradictions')
  })

  it('marks a page that nothing has read, and one the terms disagree with', () => {
    list({
      rows: [
        summary({ slug: 'cold-one', title: 'Legacy invoice PDF renderer', cold: true }),
        summary({
          slug: 'clashing',
          title: 'Currency defaults',
          contradiction: { slug: 'other', title: 'Other', term: 'CURRENCY', values: ['EUR', 'USD'] },
        }),
      ],
    })
    expect(text()).toContain('cold')
    expect(text()).toContain('contradiction?')
  })

  it('draws every kind on the frame\u2019s neutral badge, whatever the kind is', () => {
    list({ rows: [summary({ kind: 'gotcha', slug: 'a' }), summary({ kind: 'decision', slug: 'b' })] })
    const badges = [...host.querySelectorAll('.memory-row__kind')]
    expect(badges).toHaveLength(2)
    expect(badges.every((badge) => badge.getAttribute('data-variant') === 'neutral')).toBe(true)
  })

  it('leaves claimed-ness to the Handoffs filter: the All list draws no state pill', () => {
    const handoff = summary({
      slug: 'vega-codex-tc-146',
      title: 'Vega \u2192 Codex \u00b7 TC-146',
      kind: 'handoff',
      handoff: { state: 'claimed', claimedBy: 'Vega', claimedAt: null },
    })
    list({ rows: [handoff] })
    expect(text()).toContain('claimed by Vega')
    expect(host.querySelectorAll('[data-slot=badge][data-variant=success]')).toHaveLength(0)

    list({ rows: [handoff], kind: 'handoff' })
    expect(host.querySelectorAll('[data-slot=badge][data-variant=success]')).toHaveLength(1)
  })

  it('offers the three sorts as one segmented control, the chosen one pressed', () => {
    list({ sort: 'cold' })
    const options = [...host.querySelectorAll('.memory-seg .memory-seg__option')]
    expect(options.map((one) => one.textContent)).toEqual(['Recently used', 'New', 'Cold'])
    expect(options.map((one) => one.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true'])
    // Each option carries its mark, as the frame draws them.
    expect(options.every((one) => one.querySelector('svg') !== null)).toBe(true)
  })

  it('opens the page a row names, and hands the filters back rather than deciding itself', () => {
    const { onOpen, onKind, onSort } = list()
    click('Locale handling in billing')
    expect(onOpen).toHaveBeenCalledWith('locale-handling-in-billing')

    click('Handoffs')
    expect(onKind).toHaveBeenCalledWith('handoff')
    click('Cold')
    expect(onSort).toHaveBeenCalledWith('cold')
  })

  it('offers the first page only to a Company that has written none', () => {
    const { onWriteFirst } = list({ rows: [], counts: counts() })
    expect(text()).toContain('Nothing remembered yet')
    click('Write the first page')
    expect(onWriteFirst).toHaveBeenCalled()

    list({ rows: [], counts: counts({ pages: 42 }) })
    expect(text()).toContain('Nothing here')
    expect(buttons().some((one) => (one.textContent ?? '').includes('Write the first page'))).toBe(false)
  })
})

function open(props: Partial<Parameters<typeof MemoryPageView>[0]> = {}) {
  const onOpen = vi.fn()
  const onPin = vi.fn()
  const onArchive = vi.fn()
  const onRestore = vi.fn()
  render(
    <MemoryPageView
      page={page()}
      row={summary()}
      titles={{ 'currency-defaults': { title: 'Currency defaults', kind: 'convention' } }}
      revisions={[
        { commit: '9f2c1ab0000', author: 'Vega', at: '2026-09-21T09:00:00.000Z', subject: 'Update decision' },
      ]}
      onOpen={onOpen}
      onEdit={() => {}}
      onPin={onPin}
      onArchive={onArchive}
      onRestore={onRestore}
      now={NOW}
      {...props}
    />,
  )
  return { onOpen, onPin, onArchive, onRestore }
}

describe('the open page', () => {
  it('draws the path, the front matter, the uses chip and the body', () => {
    open()
    expect(text()).toContain('memory / decisions / locale-handling-in-billing.md')
    expect(text()).toContain('billing-api')
    expect(text()).toContain('TC-142')
    expect(text()).toContain('review thread')
    expect(text()).toContain('Vega · 2d ago')
    expect(text()).toContain('used 14 times this week')
    expect(text()).toContain('Money is stored in minor units.')
    expect(text()).toContain('Every edit is a commit')
  })

  it('gives every front-matter value its own mark, and the uses chip its flame', () => {
    open()
    const chips = [...host.querySelectorAll('.memory-front__chip')]
    // the kind, one repo, a ticket and a review thread.
    expect(chips).toHaveLength(4)
    expect(chips.every((chip) => chip.querySelector('svg') !== null)).toBe(true)
    expect(host.querySelector('.memory-front dd [data-slot=avatar]')?.textContent).toBe('VE')
    expect(host.querySelector('.memory-uses svg')).not.toBeNull()
  })

  it('says a term found the contradiction, not a model, and Review opens the other page', () => {
    const { onOpen } = open({
      row: summary({
        contradiction: {
          slug: 'currency-defaults',
          title: 'Currency defaults',
          term: 'CURRENCY',
          values: ['USD', 'EUR'],
        },
      }),
    })
    expect(text()).toContain('Possible contradiction with ‘Currency defaults’')
    expect(text()).toContain('Found by overlapping terms, not by a model')
    click('Review')
    expect(onOpen).toHaveBeenCalledWith('currency-defaults')
  })

  it('pins, archives, and restores a commit from History', () => {
    const { onPin, onArchive, onRestore } = open()
    click('Pin')
    expect(onPin).toHaveBeenCalledWith(true)
    click('Archive')
    expect(onArchive).toHaveBeenCalled()

    expect(text()).not.toContain('Update decision')
    click('History · 1')
    expect(text()).toContain('Update decision')
    click('Restore')
    expect(onRestore).toHaveBeenCalledWith('9f2c1ab0000')
  })

  it('links to a page it names, and says so when that page is not written yet', () => {
    const { onOpen } = open({ page: page({ links: ['currency-defaults', 'never-written'] }) })
    expect(text()).toContain('Linked pages')
    expect(text()).toContain('Currency defaults')
    expect(text()).toContain('not written yet')
    click('Currency defaults')
    expect(onOpen).toHaveBeenCalledWith('currency-defaults')
  })

  it('shows a Handoff’s state and who claimed it', () => {
    open({
      page: page({
        kind: 'handoff',
        title: 'Vega → Codex · TC-146',
        handoff: { state: 'claimed', claimedBy: 'Vega', claimedAt: null },
      }),
      row: summary({ kind: 'handoff', handoff: { state: 'claimed', claimedBy: 'Vega', claimedAt: null } }),
    })
    expect(text()).toContain('claimed')
    expect(text()).toContain('claimed by Vega')
  })
})
