// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import type { SessionStatus } from '../../../shared/session'
import type { SubagentInfo } from '../../../shared/subagents'
import { SubagentStrip } from './SubagentStrip'
import { subagentElapsed, subagentNow } from './subagents-model'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const NOW = Date.parse('2026-09-22T10:00:00Z')
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString()

/** The frame's own strip (`CuLyV`): Nova, then tests and migration running, docs done. */
function subagent(fields: Partial<SubagentInfo> & Pick<SubagentInfo, 'id' | 'name'>): SubagentInfo {
  return {
    task: `${fields.name} task`,
    state: 'running',
    startedAt: minutesAgo(6),
    endedAt: null,
    now: null,
    filesChanged: 0,
    ...fields,
  }
}
const tests = subagent({
  id: 'toolu_tests',
  name: 'tests',
  task: 'Write tests for the usage chart’s range picker',
  now: 'pnpm vitest run usage-chart',
  filesChanged: 3,
})
const migration = subagent({ id: 'toolu_migration', name: 'migration', startedAt: minutesAgo(2) })
const docs = subagent({
  id: 'toolu_docs',
  name: 'docs',
  state: 'done',
  startedAt: minutesAgo(12),
  endedAt: minutesAgo(9),
})
const FRAME = [tests, migration, docs]

let root: Root | null = null
let host: HTMLElement
afterEach(() => {
  act(() => root?.unmount())
  root = null
  host?.remove()
})

function Harness({ subagents, status }: { subagents: SubagentInfo[]; status: SessionStatus }) {
  const [picked, setPicked] = useState<string | null>(null)
  return (
    <SubagentStrip
      employeeName="Nova"
      status={status}
      subagents={subagents}
      picked={picked}
      onPick={setPicked}
      now={NOW}
    />
  )
}

function mount(subagents: SubagentInfo[], status: SessionStatus = 'busy') {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root!.render(<Harness subagents={subagents} status={status} />))
}

const chips = () => [...host.querySelectorAll<HTMLButtonElement>('.subagent-chip')]
const chip = (label: string) => chips().find((button) => button.textContent === label)!
const card = () => host.querySelector('[data-testid="subagent-card"]')

describe('The Terminal tab’s subagent strip', () => {
  it('draws the Employee first and one chip per subagent, each with its state dot', () => {
    mount(FRAME)

    expect(chips().map((button) => button.textContent)).toEqual(['Nova', 'tests', 'migration', 'docs'])
    const dots = chips().map((button) => button.querySelector('.subagent-chip__dot')!.className.split('--')[1])
    expect(dots).toEqual(['live', 'live', 'live', 'quiet'])
    expect(chip('Nova').getAttribute('aria-pressed')).toBe('true')
  })

  it('opens on the Employee, with no card: the terminal is the Employee’s', () => {
    mount(FRAME)

    expect(card()).toBeNull()
  })

  it('shows the picked subagent’s task, how long it has run and what it runs now', () => {
    mount(FRAME)

    act(() => chip('tests').click())

    expect(chip('tests').getAttribute('aria-pressed')).toBe('true')
    expect(card()!.textContent).toBe(
      'Write tests for the usage chart’s range picker6mRunning  pnpm vitest run usage-chart  ·  3 files changed',
    )
  })

  it('never draws the frame’s worktree line or seats caption: these subagents have neither', () => {
    mount(FRAME)
    act(() => chip('tests').click())

    expect(host.textContent).not.toMatch(/worktree|Session seats|branch/i)
  })

  it('goes back to the Employee when the picked subagent leaves the strip', () => {
    mount(FRAME)
    act(() => chip('docs').click())

    act(() => root!.render(<Harness subagents={[tests, migration]} status="busy" />))

    expect(card()).toBeNull()
  })

  it('draws nothing at all for a Session that runs no subagents', () => {
    mount([])

    expect(host.innerHTML).toBe('')
  })
})

describe('A subagent’s card line', () => {
  it('reads Done, with how long it ran, once it stops', () => {
    expect(subagentNow(docs)).toEqual({ text: 'Done', tone: 'quiet' })
    expect(subagentElapsed(docs, NOW)).toBe('3m')
  })

  it('reads Starting before the agent reports in, and <1m for a fresh one', () => {
    const fresh = subagent({ id: 'x', name: 'x', state: 'started', startedAt: minutesAgo(0.5) })

    expect(subagentNow(fresh)).toEqual({ text: 'Starting', tone: 'wait' })
    expect(subagentElapsed(fresh, NOW)).toBe('<1m')
  })

  it('says one file, not one files', () => {
    expect(subagentNow({ ...tests, filesChanged: 1 }).text).toBe(
      'Running  pnpm vitest run usage-chart  ·  1 file changed',
    )
  })
})
