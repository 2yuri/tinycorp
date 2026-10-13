import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createWakeLock, type WakeAssertion } from './wake-lock'

/** A starter that counts instead of asking the OS: the suite never holds a real machine awake. */
function fakeAssertions() {
  const started: { released: boolean }[] = []
  const start = (): WakeAssertion => {
    const held = { released: false }
    started.push(held)
    return { release: () => (held.released = true) }
  }
  return {
    start,
    count: () => started.length,
    live: () => started.filter((held) => !held.released).length,
  }
}

function setup() {
  const assertions = fakeAssertions()
  const awake: boolean[] = []
  const lock = createWakeLock({ start: assertions.start, onChanged: (on) => awake.push(on) })
  return { lock, assertions, awake }
}

describe('the wake lock', () => {
  it('holds one assertion while a window is full screen and lets it go on the way out', () => {
    const { lock, assertions, awake } = setup()
    lock.hold('window-1')
    expect(assertions.count()).toBe(1)
    expect(lock.awake()).toBe(true)
    lock.release('window-1')
    expect(assertions.live()).toBe(0)
    expect(lock.awake()).toBe(false)
    expect(awake).toEqual([true, false])
  })

  it('starts nothing more while one is held, however many windows ask', () => {
    const { lock, assertions, awake } = setup()
    lock.hold('window-1')
    lock.hold('window-1')
    lock.hold('window-2')
    expect(assertions.count()).toBe(1)
    // The second window leaving full screen does not wake the first window's room.
    lock.release('window-2')
    expect(assertions.live()).toBe(1)
    lock.release('window-1')
    expect(assertions.live()).toBe(0)
    expect(awake).toEqual([true, false])
  })

  it('lets go when the app quits, whoever was holding', () => {
    const { lock, assertions } = setup()
    lock.hold('window-1')
    lock.hold('window-2')
    lock.releaseAll()
    expect(assertions.live()).toBe(0)
    expect(lock.awake()).toBe(false)
    // A quit after everything was already released stays quiet.
    lock.releaseAll()
    expect(assertions.count()).toBe(1)
  })

  /**
   * It used to spawn `caffeinate`, which is a Mac command, so the lock did nothing at all on the
   * other two and a Windows or Linux boss lost a night of work to a screen lock. The assertion is
   * Electron's `powerSaveBlocker` now and the lock knows no platform: it holds whatever it is
   * given, wherever it runs (T177).
   */
  it('knows no platform: it holds whatever assertion it was handed', () => {
    const { lock, assertions, awake } = setup()
    lock.hold('window-1')
    expect(assertions.count()).toBe(1)
    expect(lock.awake()).toBe(true)
    lock.releaseAll()
    expect(awake).toEqual([true, false])
  })
})

/*
 * Code that runs in plain Node loads this module too — the capture harnesses' vite configs load the
 * Files feature, which reaches git through the platform barrel (T259). A value import of `electron`
 * anywhere under it is a SyntaxError there at load time, which is how design:compare lost the Files
 * harness; only the composition root may hand Electron's objects in.
 */
describe('the platform module', () => {
  it('imports nothing from electron at load time, only its types', () => {
    const here = fileURLToPath(new URL('.', import.meta.url))
    const offenders = readdirSync(here)
      .filter((name) => name.endsWith('.ts') && !name.includes('.test.'))
      .filter((name) => /^import (?!type )[^;]*from 'electron'/m.test(readFileSync(join(here, name), 'utf8')))
    expect(offenders).toEqual([])
  })
})
