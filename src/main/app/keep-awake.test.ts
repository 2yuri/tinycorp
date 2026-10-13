import { describe, expect, it } from 'vitest'
import { KEEP_AWAKE_DEFAULT, type KeepAwakeMode, type KeepAwakeState } from '../../shared/app/keep-awake'
import type { WakeAssertion } from '../platform/wake-lock'
import { createKeepAwake, QUIET_MS } from './keep-awake'

/** A spawner that counts instead of starting a process, and a clock the test moves by hand. */
function setup(options: { mode?: KeepAwakeMode; supported?: boolean } = {}) {
  const started: { released: boolean }[] = []
  const start = (): WakeAssertion => {
    const held = { released: false }
    started.push(held)
    return { release: () => (held.released = true) }
  }
  let stored: KeepAwakeMode | null = options.mode ?? null
  const timers = new Map<number, { at: number; run: () => void }>()
  let now = 0
  let nextTimer = 1
  const states: KeepAwakeState[] = []

  const keepAwake = createKeepAwake({
    start,
    supported: options.supported ?? true,
    store: { read: () => stored, write: (mode) => (stored = mode) },
    setTimer: (run, ms) => {
      const id = nextTimer++
      timers.set(id, { at: now + ms, run })
      return id
    },
    clearTimer: (id) => timers.delete(id as number),
    onChanged: (state) => states.push(state),
  })

  return {
    keepAwake,
    states,
    stored: () => stored,
    started: () => started.length,
    live: () => started.filter((held) => !held.released).length,
    pending: () => timers.size,
    tick(ms: number) {
      now += ms
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now) {
          timers.delete(id)
          timer.run()
        }
      }
    },
  }
}

describe('keeping the Mac awake', () => {
  it('starts in While anyone is working, the mode the design makes the default', () => {
    const { keepAwake } = setup()
    expect(keepAwake.state()).toEqual({ mode: KEEP_AWAKE_DEFAULT, holding: false, supported: true })
    expect(KEEP_AWAKE_DEFAULT).toBe('working')
  })

  it('On holds from the moment it is chosen, with the floor quiet', () => {
    const awake = setup()
    awake.keepAwake.setMode('on')

    expect(awake.started()).toBe(1)
    expect(awake.keepAwake.state()).toMatchObject({ mode: 'on', holding: true })
    // The mode is the boss's and outlives the app.
    expect(awake.stored()).toBe('on')
    expect(awake.states.at(-1)).toMatchObject({ mode: 'on', holding: true })
  })

  it('Off never holds, whoever is working', () => {
    const awake = setup({ mode: 'off' })
    awake.keepAwake.setWorking(true)

    expect(awake.started()).toBe(0)
    expect(awake.keepAwake.state()).toMatchObject({ mode: 'off', holding: false })
  })

  it('While anyone is working follows the Sessions, and lets go a moment after the last stops', () => {
    const awake = setup()
    awake.keepAwake.setWorking(true)
    expect(awake.started()).toBe(1)

    awake.keepAwake.setWorking(false)
    // Not at once: a burst of starts and stops must not thrash the assertion.
    expect(awake.live()).toBe(1)
    expect(awake.keepAwake.state().holding).toBe(true)

    awake.tick(QUIET_MS)
    expect(awake.live()).toBe(0)
    expect(awake.keepAwake.state().holding).toBe(false)
  })

  it('keeps holding when a Session starts again inside the quiet wait', () => {
    const awake = setup()
    awake.keepAwake.setWorking(true)
    awake.keepAwake.setWorking(false)
    awake.keepAwake.setWorking(true)
    awake.tick(QUIET_MS * 2)

    expect(awake.started()).toBe(1)
    expect(awake.live()).toBe(1)
    expect(awake.pending()).toBe(0)
  })

  it('does not start a second assertion while one is live', () => {
    const awake = setup()
    awake.keepAwake.setWorking(true)
    awake.keepAwake.setWorking(true)
    awake.keepAwake.setMode('on')
    awake.keepAwake.setMode('on')
    awake.keepAwake.setWorking(false)

    expect(awake.started()).toBe(1)
    expect(awake.live()).toBe(1)
  })

  it('lets go the moment Off is chosen, waiting for nothing', () => {
    const awake = setup({ mode: 'on' })
    expect(awake.live()).toBe(1)

    awake.keepAwake.setMode('off')

    expect(awake.live()).toBe(0)
    expect(awake.pending()).toBe(0)
  })

  it('releases when the app quits', () => {
    const awake = setup({ mode: 'on' })
    awake.keepAwake.close()

    expect(awake.live()).toBe(0)
    expect(awake.pending()).toBe(0)
  })

  /**
   * The cup was a Mac affordance while the assertion was `caffeinate`: a Windows or Linux boss saw
   * no cup and lost a night of work to a screen lock. `powerSaveBlocker` is all three, so the mug
   * holds wherever the app runs (T177) — and a machine that really cannot be held awake still
   * says so, which is what takes the cup off the map.
   */
  it('holds on every platform now, because the assertion is one all three have', () => {
    const awake = setup({ mode: 'on' })
    awake.keepAwake.setWorking(true)

    expect(awake.started()).toBe(1)
    expect(awake.keepAwake.state()).toEqual({ mode: 'on', holding: true, supported: true })
  })

  it('takes nothing, and says so, on a machine that cannot be held awake at all', () => {
    const awake = setup({ mode: 'on', supported: false })
    awake.keepAwake.setWorking(true)
    awake.keepAwake.setMode('on')

    expect(awake.started()).toBe(0)
    expect(awake.keepAwake.state()).toEqual({ mode: 'on', holding: false, supported: false })
  })
})
