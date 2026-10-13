// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { ResumeAll } from '../../../shared/session'

/**
 * The office header's `Pause all` / `Resume all` (decision 38, T217).
 *
 * The button used to read the paused state off the answer and nothing else, so a `Resume all` that
 * brought nobody back left the boss with a header that had flipped and a floor that had not moved —
 * the report this ticket came from. The outcome the engine answers with is what the header shows.
 */
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value })
const never = () => () => {}

let paused = false
let outcome: ResumeAll = { paused: false, resumed: ['ada'], failed: [], from: 'held' }
const calls: string[] = []

beforeAll(async () => {
  ;(window as unknown as { tinyCorp: unknown }).tinyCorp = {
    sessions: {
      paused: () => ok(paused),
      pauseAll: () => {
        calls.push('pause')
        paused = true
        return ok(true)
      },
      resumeAll: () => {
        calls.push('resume')
        paused = outcome.paused
        return ok(outcome)
      },
      onChanged: never,
    },
  }
  usePaused = (await import('./use-paused')).usePaused
})

let usePaused: typeof import('./use-paused').usePaused

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  calls.length = 0
  paused = false
})

/** Mounts the hook and hands back whatever it last returned. */
async function mount(): Promise<{ read: () => ReturnType<typeof usePaused> }> {
  let last: ReturnType<typeof usePaused> | null = null
  function Probe() {
    last = usePaused()
    return null
  }
  const host = document.createElement('div')
  document.body.append(host)
  await act(async () => {
    root = createRoot(host)
    root.render(<Probe />)
  })
  return { read: () => last! }
}

describe('the office header’s Pause all and Resume all', () => {
  it('flips to Pause all once a resume has brought its Sessions back', async () => {
    const header = await mount()
    await act(async () => header.read().pauseAll())
    expect(header.read().paused).toBe(true)

    await act(async () => header.read().resumeAll())

    expect(header.read().paused).toBe(false)
    expect(header.read().error).toBeNull()
    expect(calls).toEqual(['pause', 'resume'])
  })

  // T217: the boss pressed Resume all, the button flipped, and nothing else happened or was said.
  it('says so when the resume brought nobody back', async () => {
    outcome = { paused: false, resumed: [], failed: [], from: 'nobody' }
    const header = await mount()
    await act(async () => header.read().pauseAll())

    await act(async () => header.read().resumeAll())

    expect(header.read().paused).toBe(false)
    expect(header.read().error).toMatch(/Nothing to resume/)
  })

  it('names an Employee the resume could not start', async () => {
    outcome = {
      paused: false,
      resumed: ['grace'],
      failed: [{ employeeId: 'ada', name: 'Ada', reason: 'claude is not on this machine' }],
      from: 'held',
    }
    const header = await mount()

    await act(async () => header.read().resumeAll())

    expect(header.read().error).toBe('Resuming 1 Session. Ada could not start: claude is not on this machine.')
  })
})
