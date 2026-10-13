// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { type BuildStyle, LEAN_LADDER, LEAN_MEASURED, LEAN_NEVER_CUT } from '../../../shared/build-style'
import { CAVEMAN_CARD_RULES, CAVEMAN_EXAMPLE, CAVEMAN_UNMEASURED, type CavemanLevel } from '../../../shared/caveman'
import type { SandboxCommand, SandboxStatus } from '../../../shared/sandbox'

/**
 * The Add-ons tab (T194 frame `ttODp`, T261 frame `U8MYE`). One bridge for the whole file: the view
 * module reads `window.tinyCorp` when it is imported, so the object stays put and only its answers
 * move.
 */
let saved: BuildStyle = 'standard'
let level: CavemanLevel = 'off'
let calls: BuildStyle[] = []
let cavemanCalls: CavemanLevel[] = []

/** Where ai-jail stands, for the second card. Found by default, which is the card's on-state. */
const sandboxStatus: SandboxStatus = {
  state: 'found',
  version: '2.2.0',
  path: '/opt/homebrew/bin/ai-jail',
  lookedIn: ['PATH'],
}
let sandboxOn = false
const sandboxCalls: boolean[] = []
const install: SandboxCommand[] = []

const sandboxView = () => ({
  ok: true as const,
  value: { status: sandboxStatus, settings: { enabled: sandboxOn }, install },
})

Object.assign(window, {
  tinyCorp: {
    buildStyle: {
      get: () => Promise.resolve({ ok: true as const, value: saved }),
      set: (style: BuildStyle) => {
        calls.push(style)
        saved = style
        return Promise.resolve({ ok: true as const, value: style })
      },
    },
    caveman: {
      get: () => Promise.resolve({ ok: true as const, value: level }),
      set: (next: CavemanLevel) => {
        cavemanCalls.push(next)
        level = next
        return Promise.resolve({ ok: true as const, value: next })
      },
    },
    sandbox: {
      read: () => Promise.resolve(sandboxView()),
      recheck: () => Promise.resolve(sandboxView()),
      setEnabled: (enabled: boolean) => {
        sandboxCalls.push(enabled)
        sandboxOn = enabled
        return Promise.resolve({ ok: true as const, value: { enabled } })
      },
      onChanged: () => () => {},
    },
    // The strip under each card reads this; no Employee is behind in these tests.
    spawnSettings: {
      stale: () => Promise.resolve({ ok: true as const, value: [] }),
      applyNow: () => Promise.resolve({ ok: true as const, value: { restarted: [], waiting: [] } }),
      onChanged: () => () => {},
    },
  },
})
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let host: HTMLElement | null = null
afterEach(() => {
  host?.remove()
  host = null
})

async function mount(style: BuildStyle, caveman: CavemanLevel = 'off') {
  saved = style
  level = caveman
  calls = []
  cavemanCalls = []
  const { AddonsTab } = await import('./AddonsTab')
  host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(<AddonsTab />)
  })
  return host
}

/** The switch of one card, found by the `aria-label` the card gives it: the add-on's own name. */
const toggle = (name: string) => host!.querySelector<HTMLInputElement>(`input[role="switch"][aria-label="${name}"]`)!
const search = () => host!.querySelector<HTMLInputElement>('input[type="search"], input[placeholder="Search add-ons"]')!
const cards = () => host!.querySelectorAll('section')
const intensity = (label: string) =>
  [...host!.querySelectorAll<HTMLInputElement>('input[type="radio"][name^="caveman-intensity"]')].find(
    (one) => one.closest('label')?.textContent?.trim() === label,
  )!

/** A React-controlled field only sees a value set through its own setter, then told about it. */
async function type(text: string) {
  const field = search()
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value')?.set?.call(field, text)
  await act(async () => {
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('Add-ons', () => {
  it('lists Lean builder with its ladder, its numbers and where it came from', async () => {
    await mount('standard')

    const text = host!.textContent ?? ''
    expect(text).toContain('Lean builder')
    expect(text).toContain('ponytail · MIT')
    for (const rung of LEAN_LADDER) expect(text).toContain(rung)
    for (const tile of LEAN_MEASURED) expect(text).toContain(tile.change)
    expect(text).toContain(`Never cuts ${LEAN_NEVER_CUT}`)
  })

  it('counts what there is and how much of it is on', async () => {
    await mount('standard')
    expect(host!.textContent).toContain('3 add-ons · 0 on')

    await act(async () => toggle('Lean builder').click())

    expect(host!.textContent).toContain('3 add-ons · 1 on')
  })

  it('is off until the boss turns it on, and saves the moment they do', async () => {
    await mount('standard')
    expect(toggle('Lean builder').checked).toBe(false)

    await act(async () => toggle('Lean builder').click())

    expect(calls).toEqual(['lean'])
    expect(toggle('Lean builder').checked).toBe(true)
  })

  it('turns it off again, which is what the boss undoes with rather than a Discard changes', async () => {
    await mount('lean')

    await act(async () => toggle('Lean builder').click())

    expect(calls).toEqual(['standard'])
    expect(toggle('Lean builder').checked).toBe(false)
  })

  it('filters by name and by what the add-on says it does', async () => {
    await mount('standard')

    await type('ladder')
    expect(cards()).toHaveLength(1)

    await type('LEAN')
    expect(cards()).toHaveLength(1)

    await type('caveman')
    expect(cards()).toHaveLength(1)

    await type('wenyan')
    expect(cards()).toHaveLength(0)
    // The count is what there is, not what the search left: the boss is filtering, not deleting.
    expect(host!.textContent).toContain('3 add-ons · 0 on')
  })
})

describe('Caveman', () => {
  it('shows the same answer twice, the three limits, and where the idea came from', async () => {
    await mount('standard')

    const text = host!.textContent ?? ''
    expect(text).toContain('Caveman')
    expect(text).toContain('caveman · MIT')
    expect(text).toContain(CAVEMAN_EXAMPLE.before)
    expect(text).toContain(CAVEMAN_EXAMPLE.answer.full)
    for (const rule of CAVEMAN_CARD_RULES) expect(text).toContain(rule)
  })

  /**
   * The rule that no token claim ships unmeasured, as the boss meets it: `CAVEMAN_MEASURED` is
   * null until a results file exists, so the switch does not move and the foot says what would
   * move it. Without this the add-on could be turned on with three dashes where its numbers go.
   */
  it('cannot be turned on while nothing has been measured, and says why', async () => {
    await mount('standard')

    expect(toggle('Caveman').disabled).toBe(true)
    expect(host!.textContent).toContain(CAVEMAN_UNMEASURED)
    expect(host!.textContent).toContain('output tokens')
    expect(host!.textContent).toContain('answers right')
  })

  /**
   * The intensity is a choice about later while the add-on is off. Writing it would turn Caveman
   * on — the setting is one value — which is the one thing the boss did not ask for by moving a
   * control on a disabled card.
   */
  it('moves the intensity without turning it on, and writes it once it is on', async () => {
    await mount('standard')

    await act(async () => intensity('Ultra').click())

    expect(cavemanCalls).toEqual([])
    expect(host!.textContent).toContain(CAVEMAN_EXAMPLE.answer.ultra)
  })

  it('writes the intensity as the setting for a Company that already has it on', async () => {
    await mount('standard', 'full')
    expect(toggle('Caveman').checked).toBe(true)

    await act(async () => intensity('Lite').click())

    expect(cavemanCalls).toEqual(['lite'])
    expect(host!.textContent).toContain(CAVEMAN_EXAMPLE.answer.lite)
  })
})
