import { describe, expect, it } from 'vitest'
import { holdSingleInstance, type SingleInstanceApp } from './single-instance'

function fakeApp(granted: boolean) {
  const listeners: (() => void)[] = []
  let quits = 0
  const app: SingleInstanceApp = {
    requestSingleInstanceLock: () => granted,
    on: (_event, listener) => listeners.push(listener),
    quit: () => quits++,
  }
  const started = () => {
    for (const listener of listeners) listener()
  }
  return { app, started, quits: () => quits }
}

describe('One copy of the app', () => {
  it('carries on when it has the lock, and brings its window forward when the boss starts it again', () => {
    const { app, started, quits } = fakeApp(true)
    let shown = 0

    expect(holdSingleInstance({ app, showWindow: () => shown++ })).toBe(true)
    expect(shown).toBe(0)

    // The installer opened the app, then the boss clicked the shortcut: the click asked for a
    // window, so the copy that is already running shows one instead of a second app starting.
    started()

    expect(shown).toBe(1)
    expect(quits()).toBe(0)
  })

  it('quits at once when another copy has it, before anything opens a Company', () => {
    const { app, quits } = fakeApp(false)
    let shown = 0

    expect(holdSingleInstance({ app, showWindow: () => shown++ })).toBe(false)

    expect(quits()).toBe(1)
    // Nothing of this process reaches a window or a database: the false is the caller's cue to stop.
    expect(shown).toBe(0)
  })
})
