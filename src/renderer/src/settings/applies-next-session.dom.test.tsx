// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { APPLIES_NEXT_SESSION, type StaleSession } from '../../../shared/spawn-settings'

/**
 * The note beside a setting a Session bakes in (T237, frames `Cg3a8` and `ttODp`).
 *
 * What it has to keep true: the note is drawn only after a change that has not reached everybody,
 * each card names the Employees its own setting left behind and nobody else's, and `Apply now`
 * asks the engine and reads the answer again — the boss pressing it and seeing the same names is
 * the failure this test is here for.
 */

let stale: StaleSession[] = []
let applied = 0

Object.assign(window, {
  tinyCorp: {
    spawnSettings: {
      stale: () => Promise.resolve({ ok: true as const, value: stale }),
      applyNow: () => {
        applied += 1
        stale = []
        return Promise.resolve({ ok: true as const, value: { restarted: [], waiting: [] } })
      },
      onChanged: () => () => {},
    },
  },
})
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let host: HTMLElement | null = null
let root: Root | null = null
afterEach(async () => {
  await act(async () => root?.unmount())
  host?.remove()
  host = null
  root = null
})

const behind = (name: string, settings: StaleSession['settings'], busy = false): StaleSession => ({
  employeeId: name.toLowerCase(),
  name,
  busy,
  settings,
})

async function mount(setting: 'colleagueVoice' | 'notesBudget' | 'buildStyle', who: StaleSession[]) {
  stale = who
  applied = 0
  const { AppliesNextSession } = await import('./AppliesNextSession')
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(<AppliesNextSession setting={setting} />)
  })
  return host
}

const applyNow = () => [...host!.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Apply now')

describe('Applies from each Employee’s next Session', () => {
  it('draws nothing while every Session already carries the setting', async () => {
    await mount('colleagueVoice', [])

    expect(host!.textContent).toBe('')
  })

  it('says it applies at the next Session, and names who is still on the old one', async () => {
    await mount('colleagueVoice', [behind('Ada', ['colleagueVoice']), behind('Vega', ['colleagueVoice'], true)])

    expect(host!.textContent).toContain(APPLIES_NEXT_SESSION)
    expect(host!.textContent).toContain('Still on the old setting: Ada.')
    expect(host!.textContent).toContain('Vega gets it when its turn ends.')
    expect(applyNow()).toBeDefined()
  })

  it('names nobody who is only behind on another card’s setting', async () => {
    await mount('buildStyle', [behind('Ada', ['notesBudget'])])

    expect(host!.textContent).toBe('')
  })

  it('applies now and reads who is left again, so the note goes with the last Employee', async () => {
    await mount('notesBudget', [behind('Ada', ['notesBudget'])])

    await act(async () => applyNow()!.click())

    expect(applied).toBe(1)
    expect(host!.textContent).toBe('')
  })
})
