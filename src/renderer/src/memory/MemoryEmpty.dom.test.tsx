// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Company } from '../../../shared/company'
import { emptyCounts, type MemoryCounts } from '../../../shared/memory/company-memory'
import { ContentHeader } from '../chrome'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

/**
 * The Memory screen of a Company that has written nothing (frame `SlxSy`), which is what every
 * real Company shows until its first ticket closes.
 *
 * The harness fixtures have 42 pages, so the screen the boss actually opened — an empty list beside
 * "Pick a page to read it." — passed its audit and shipped anyway (T181). This drives the whole
 * view over a stub with nothing in it.
 */

const FOLDER = '/work/tiny/memory/company'

let MemoryView: typeof import('./MemoryView').MemoryView
let reveal: ReturnType<typeof vi.fn>
let counts: MemoryCounts

const company: Company = {
  id: 'c1',
  name: 'Tiny Corp',
  key: 'TC',
  boss: { name: 'Yuri Miguel', initials: 'YM', handle: 'yuri', sprite: 1, status: 'available' },
  folder: '/work/tiny',
  createdAt: '2026-03-04T10:00:00.000Z',
}

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value })
const never = () => () => {}

beforeAll(async () => {
  reveal = vi.fn(async () => ({ ok: true, value: null }))
  counts = emptyCounts()
  window.tinyCorp = {
    companyMemory: {
      folder: () => ok(FOLDER),
      list: () => ok([]),
      counts: () => ok(counts),
      get: () => ok(null),
      history: () => ok([]),
      filePath: () => ok(null),
      onChanged: never,
    },
    repos: { list: () => ok([]), onChanged: never },
    paths: { reveal },
  } as unknown as typeof window.tinyCorp
  ;({ MemoryView } = await import('./MemoryView'))
})

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  counts = emptyCounts()
  reveal.mockClear()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

/** The shell's header is where `ViewHeader` portals its actions, so the view is opened inside one. */
async function open(): Promise<void> {
  await act(async () => {
    root.render(
      <ContentHeader title="Memory">
        <MemoryView company={company} onNavigate={() => {}} />
      </ContentHeader>,
    )
  })
}

const text = () => host.textContent ?? ''
const button = (label: string) => {
  const found = [...host.querySelectorAll('button')].find((one) => (one.textContent ?? '').includes(label))
  if (!found) throw new Error(`No button says "${label}"`)
  return found
}

describe('Memory, with no page at all', () => {
  it('explains how memory fills instead of asking the boss to pick a page', async () => {
    await open()

    expect(host.querySelector('[data-ui="How memory fills"]')).not.toBeNull()
    expect(text()).toContain('What Tiny Corp will remember')
    expect(text()).not.toContain('Pick a page to read it.')
  })

  it('names every kind a page can be, and where one comes from', async () => {
    await open()

    for (const kind of ['Decision', 'Convention', 'Gotcha', 'Architecture', 'Glossary', 'Handoff']) {
      expect(text()).toContain(kind)
    }
    expect(text()).toContain('from a plan or a review thread')
    expect(text()).toContain('when an Employee switches provider')
  })

  it('says where the markdown is, and counts it as an empty git repo', async () => {
    await open()

    expect(text()).toContain(FOLDER)
    expect(text()).toContain('no pages yet, kept in git.')
    expect(text()).toContain('0 pages · memory/company is an empty git repo')
  })

  /** There is no file to open, so the action shows the folder rather than doing nothing at all. */
  it('opens the memory folder from the pane and from the header', async () => {
    await open()

    await act(async () => button('Open in Files').click())
    expect(reveal).toHaveBeenCalledWith(FOLDER)

    const header = [...host.querySelectorAll('button')].filter((one) =>
      (one.textContent ?? '').includes('Open in Files'),
    )
    expect(header).toHaveLength(2)
    for (const one of header) expect(one.hasAttribute('disabled')).toBe(false)
  })

  /** With pages and none picked the pane says its one quiet line — the frame's, not a blank. */
  it('goes back to "Pick a page to read it." once the Company has one', async () => {
    counts = { ...emptyCounts(), pages: 1 }
    await open()

    expect(host.querySelector('[data-ui="How memory fills"]')).toBeNull()
    expect(text()).toContain('Pick a page to read it.')
  })
})
