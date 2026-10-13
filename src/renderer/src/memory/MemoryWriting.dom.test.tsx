// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Company } from '../../../shared/company'
import { emptyCounts, type MemoryPageSummary } from '../../../shared/memory/company-memory'
import { ContentHeader } from '../chrome'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

/**
 * New page, from the screen rather than from the component (frame `V2v4hd`).
 *
 * The frame draws no row as open while the boss writes: the pane is the page being written, so a
 * row marked open there points at something nobody is reading. The view had kept the last-read
 * page marked, which is the one thing about this state that only the whole screen can be asked.
 */

let MemoryView: typeof import('./MemoryView').MemoryView
let write: ReturnType<typeof vi.fn>

const company: Company = {
  id: 'c1',
  name: 'Tiny Corp',
  key: 'TC',
  boss: { name: 'Yuri Miguel', initials: 'YM', handle: 'yuri', sprite: 1, status: 'available' },
  folder: '/work/tiny',
  createdAt: '2026-03-04T10:00:00.000Z',
}

const row: MemoryPageSummary = {
  slug: 'locale-handling-in-billing',
  kind: 'decision',
  title: 'Locale handling in billing',
  repos: ['billing-api'],
  sources: [],
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
}

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value })
const never = () => () => {}

beforeAll(async () => {
  write = vi.fn(() => ok({ slug: 'a-new-page' }))
  window.tinyCorp = {
    companyMemory: {
      folder: () => ok('/work/tiny/memory/company'),
      list: () => ok([row]),
      counts: () => ok({ ...emptyCounts(), pages: 1 }),
      get: () => ok({ ...row, body: 'Money is stored in minor units.' }),
      history: () => ok([]),
      filePath: () => ok(null),
      write,
      onChanged: never,
    },
    repos: { list: () => ok([{ id: 'web-app', name: 'web-app' }]), onChanged: never },
    paths: { reveal: () => ok(null) },
  } as unknown as typeof window.tinyCorp
  ;({ MemoryView } = await import('./MemoryView'))
})

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  write.mockClear()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

/** The shell's header is where `ViewHeader` portals its actions, so the view is opened inside one. */
async function open(slug?: string): Promise<void> {
  await act(async () => {
    root.render(
      <ContentHeader title="Memory">
        <MemoryView company={company} {...(slug && { slug })} onNavigate={() => {}} />
      </ContentHeader>,
    )
  })
}

const click = async (label: string) => {
  const found = [...host.querySelectorAll('button')].find((one) => (one.textContent ?? '').trim() === label)
  if (!found) throw new Error(`No button says "${label}"`)
  await act(async () => found.click())
}

const openRows = () => [...host.querySelectorAll('.memory-row[aria-current="true"]')]

describe('Memory, while a new page is being written', () => {
  it('marks no row as open, and marks the page being read again once the writing stops', async () => {
    await open(row.slug)
    expect(openRows().map((one) => one.textContent)).toHaveLength(1)

    await click('New page')
    expect(host.querySelector('[data-ui="Memory editor"]')).not.toBeNull()
    expect(openRows()).toEqual([])

    await click('Cancel')
    expect(openRows()).toHaveLength(1)
  })

  /** Editing is reading the same page, so its row stays marked while the boss rewrites it. */
  it('keeps the row marked while that page is the one being edited', async () => {
    await open(row.slug)
    await click('Edit')

    expect(host.querySelector('[data-ui="Memory editor"]')).not.toBeNull()
    expect(openRows()).toHaveLength(1)
  })

  it('writes through the engine, with the kind the chips chose', async () => {
    await open()
    await click('New page')

    const type = (selector: string, value: string) => {
      const node = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!
      const setter = Object.getOwnPropertyDescriptor(node.constructor.prototype, 'value')?.set
      act(() => {
        setter?.call(node, value)
        node.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }
    type('.memory-editor__title', 'web-app vitest needs --pool=threads')
    // The body is a TipTap document (T225): the text goes into the contenteditable the way a
    // browser writes one, and ProseMirror's own observer reads it back.
    const document_ = host.querySelector<HTMLElement>('.memory-editor__area .ProseMirror')
    if (!document_) throw new Error('No page editor in the document')
    await act(async () => {
      ;(document_.firstElementChild ?? document_).textContent = 'It hangs on the default pool.'
      await Promise.resolve()
    })
    await act(async () => host.querySelectorAll<HTMLButtonElement>('.memory-editor__kind')[2]!.click())
    await click('Save page')

    expect(write).toHaveBeenCalledWith({
      kind: 'gotcha',
      title: 'web-app vitest needs --pool=threads',
      body: 'It hangs on the default pool.',
      mode: 'replace',
    })
  })
})
