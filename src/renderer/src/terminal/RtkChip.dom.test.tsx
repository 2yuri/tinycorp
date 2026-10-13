// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { RtkView } from '../../../shared/ipc'
import { RTK_NOT_FOUND, type RtkSavings } from '../../../shared/rtk'

/**
 * The chip in an Employee's terminal header (T179, frame `p4np9V`).
 *
 * Two things it must not do, and both of them are why it has a test: draw a number for a Company
 * that is not compressing, and call a Company figure one Session's.
 */

const found: RtkView = {
  status: { state: 'found', version: '0.41.0', path: '/opt/homebrew/bin/rtk', missingIn: [] },
  settings: { enabled: true, ping: false },
  hooks: [],
}

const savings: RtkSavings = { cutPercent: 68, tokensNotRead: 412_000, commandsFiltered: 1204 }

/** What the stub answers with next. The screen binds the preload API when it is imported. */
let answers: { view: RtkView; saved: RtkSavings | null } = { view: found, saved: savings }
const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value })
;(window as unknown as { tinyCorp: unknown }).tinyCorp = {
  rtk: {
    read: () => ok(answers.view),
    savings: () => ok(answers.saved),
    onChanged: () => () => {},
  },
}

let RtkChip: () => React.ReactNode
beforeAll(async () => {
  ;({ RtkChip } = await import('./RtkChip'))
})

let root: Root | null = null
let host: HTMLDivElement | null = null

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
})

async function draw(view: RtkView, saved: RtkSavings | null): Promise<string> {
  answers = { view, saved }
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(<RtkChip />)
  })
  return host.textContent ?? ''
}

describe('the RTK chip', () => {
  it('says what RTK cut, without calling a Company figure this Session’s', async () => {
    const text = await draw(found, savings)

    // RTK keeps its history by day, not by conversation, so *this session* would be a lie.
    expect(text).toBe('RTK · 68% cut')
    expect(host?.querySelector('.rtk-chip')?.getAttribute('title')).toContain('bytes ÷ 4')
  })

  it('draws nothing for a Company that turned compression off', async () => {
    expect(await draw({ ...found, settings: { enabled: false, ping: false } }, savings)).toBe('')
  })

  it('draws nothing where RTK is not on this machine', async () => {
    expect(await draw({ ...found, status: RTK_NOT_FOUND }, savings)).toBe('')
  })

  it('draws nothing while RTK has filtered nothing yet', async () => {
    expect(await draw(found, null)).toBe('')
    expect(await draw(found, { cutPercent: 0, tokensNotRead: 0, commandsFiltered: 0 })).toBe('')
  })
})
