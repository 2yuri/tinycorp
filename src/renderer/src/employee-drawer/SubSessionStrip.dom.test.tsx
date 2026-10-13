// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import type { SessionStatus } from '../../../shared/session'
import type { SubSessionInfo } from '../../../shared/sub-sessions'
import { type MountedCapture, mountCapture } from '../capture/mount'
import { attachedTerminals, drawerCapture } from './capture/DrawerCapture'
import * as fixture from './capture/fixture'
import { SubagentStrip } from './SubagentStrip'
import { seatLine, subSessionNow, subSessionWhere, terminalOf } from './subagents-model'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

/**
 * The strip of `design/screens/CuLyV.png` as the frame draws it (T163): Nova, then Sessions she
 * started of her own, each saying where it works, and the seat line under the picked one's card.
 */

const NOW = Date.parse('2026-09-22T10:00:00Z')
const FRAME = fixture.subSessions(NOW)
const [tests, migration, docs] = FRAME as [SubSessionInfo, SubSessionInfo, SubSessionInfo]

let root: Root | null = null
let host: HTMLElement
let mounted: MountedCapture | undefined
afterEach(() => {
  act(() => root?.unmount())
  root = null
  host?.remove()
  mounted?.unmount()
  mounted = undefined
})

function Harness({ subSessions, status }: { subSessions: SubSessionInfo[]; status: SessionStatus }) {
  const [picked, setPicked] = useState<string | null>(null)
  return (
    <SubagentStrip
      employeeName="Nova"
      status={status}
      subagents={[]}
      subSessions={subSessions}
      concurrencyCap={5}
      picked={picked}
      onPick={setPicked}
      now={NOW}
    />
  )
}

function mount(subSessions: SubSessionInfo[], status: SessionStatus = 'busy') {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root!.render(<Harness subSessions={subSessions} status={status} />))
}

const chips = () => [...host.querySelectorAll<HTMLButtonElement>('.subagent-chip')]
const chip = (label: string) => chips().find((button) => button.textContent === label)!
const card = () => host.querySelector('[data-testid="sub-session-card"]')

describe('The strip, with Sessions the Employee started', () => {
  it('draws each one’s chip with where it works: a branch for its own worktree, a link for the parent’s', () => {
    mount(FRAME)

    expect(chips().map((button) => button.textContent)).toEqual(['Nova', 'tests', 'migration', 'docs'])
    const icons = chips().map(
      (button) => button.querySelector('.subagent-chip__workspace')?.getAttribute('aria-label') ?? null,
    )
    expect(icons).toEqual([null, 'own worktree', 'own worktree', 'shares Nova’s worktree'])
    expect(chip('docs').title).toContain('shares Nova’s worktree')
  })

  it('shows the picked one’s card as the frame does: task, time, where it works and what it runs', () => {
    mount(FRAME)

    act(() => chip('tests').click())

    expect(chip('tests').getAttribute('aria-pressed')).toBe('true')
    expect(card()!.textContent).toBe(
      "Write tests for the usage chart's range picker" +
        '6m' +
        'own worktree · ticket-tc-142-usage-chart+tests · off Nova’s branch' +
        'Running  pnpm vitest run usage-chart  ·  3 files changed',
    )
  })

  it('says how many of the Company’s seats the Employee holds, and that none of them can start more', () => {
    mount(FRAME)

    // Nova’s own Session, tests and migration; docs is done and holds none.
    expect(host.querySelector('.subagent-seats')!.textContent).toBe(
      'Nova is using 3 of the Company’s 5 Session seats. Started by Nova, one level deep — none of these can start more.',
    )
  })

  it('reads a shared Session’s card as sharing the parent’s worktree', () => {
    expect(subSessionWhere(docs, 'Nova')).toBe('shares Nova’s worktree')
    expect(subSessionNow(docs)).toEqual({ text: 'Reported', tone: 'quiet' })
  })

  it('says a Session waiting for a seat is waiting, and holds none yet', () => {
    const waiting: SubSessionInfo = { ...migration, state: 'waiting', now: null }

    expect(subSessionNow(waiting)).toEqual({ text: 'Waiting for a Session seat', tone: 'wait' })
    expect(seatLine('Nova', 'busy', [tests, waiting], 5)).toMatch(/^Nova is using 2 of/)
  })

  it('names the branch left to merge once an own worktree is gone', () => {
    const removed: SubSessionInfo = { ...tests, state: 'stopped', worktreeKept: false, branchKept: true }

    expect(subSessionWhere(removed, 'Nova')).toBe(
      'worktree removed · ticket-tc-142-usage-chart+tests · to merge into Nova’s branch',
    )
  })

  it('shows the Employee’s own terminal unless a Session’s chip is picked', () => {
    expect(terminalOf('nova', FRAME, null)).toBe('nova')
    expect(terminalOf('nova', FRAME, 'sub-tests')).toBe('sub-tests')
    // A subagent has no terminal of its own, and a Session that left the strip has none to show.
    expect(terminalOf('nova', FRAME, 'toolu_1')).toBe('nova')
  })
})

describe('The drawer, when a Session’s chip is picked', () => {
  it('swaps the terminal to that Session’s own, and back to the Employee’s', async () => {
    mounted = await mountCapture(() => drawerCapture('sessions'))
    const pick = (label: string) =>
      [...mounted!.host.querySelectorAll<HTMLButtonElement>('.subagent-chip')].find((c) => c.textContent === label)!
    expect(attachedTerminals.at(-1)).toBe(fixture.nova.id)

    await act(async () => pick('tests').click())
    expect(attachedTerminals.at(-1)).toBe('sub-tests')

    await act(async () => pick('Nova').click())
    expect(attachedTerminals.at(-1)).toBe(fixture.nova.id)
  })
})
