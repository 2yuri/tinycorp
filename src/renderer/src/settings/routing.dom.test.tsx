// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PROVIDER_SHORT_NAME, PROVIDERS, type Provider } from '../../../shared/domain/providers'
import type { RoutingSettings } from '../../../shared/ipc'
import { ROTATION_WARNING } from '../../../shared/usage/usage-routing'
import { fallbackOffer } from '../office-view'
import { backNowBlocked, backNowLabel, routingChipLabel } from '../routing'
import { accountsLabel, FIRST_WITH_ROOM, overrideLines, rotationSub, runsOutSub, whenOutLabel } from './routing-model'

const [first, second] = PROVIDERS as [Provider, Provider]
const FIRST = PROVIDER_SHORT_NAME[first as keyof typeof PROVIDER_SHORT_NAME]
const SECOND = PROVIDER_SHORT_NAME[second as keyof typeof PROVIDER_SHORT_NAME]

const settings = (over: Partial<RoutingSettings> = {}): RoutingSettings => ({
  routing: { rules: {}, moveBack: {}, resumeAtReset: true, rotateAccounts: false, pinnedAccount: {} },
  overrides: [],
  accounts: [],
  oneAccountProviders: [],
  ...over,
})

/**
 * One bridge for the whole file, with what it should answer and what it was asked kept in boxes.
 *
 * The view module reads `window.tinyCorp` once, when it is imported: a bridge swapped in per test
 * would only ever reach the first of them, and every later write would land in the first test's
 * list. So the object stays and its answers move.
 */
let answer: RoutingSettings
let calls: { name: string; args: unknown[] }[] = []

function bridge() {
  const write =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push({ name, args })
      return Promise.resolve({ ok: true as const, value: answer })
    }
  const routing = {
    get: () => Promise.resolve({ ok: true as const, value: answer }),
    setRule: write('setRule'),
    setMoveBack: write('setMoveBack'),
    setResumeAtReset: write('setResumeAtReset'),
    setRotateAccounts: write('setRotateAccounts'),
    setPinnedAccount: write('setPinnedAccount'),
    setEmployeeRule: write('setEmployeeRule'),
    setEmployeePin: write('setEmployeePin'),
    addAccount: write('addAccount'),
    renameAccount: write('renameAccount'),
    setDefaultAccount: write('setDefaultAccount'),
    removeAccount: write('removeAccount'),
    login: write('login'),
    continueNow: write('continueNow'),
    moveBackNow: write('moveBackNow'),
    onChanged: () => () => {},
  }
  Object.assign(window, {
    tinyCorp: {
      routing,
      usage: {
        read: () => Promise.resolve({ ok: true, value: { providers: [], readAt: null } }),
        onChanged: () => () => {},
      },
      preflight: { all: () => Promise.resolve([]), onChanged: () => () => {} },
    },
  })
}

bridge()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let host: HTMLElement | null = null
afterEach(() => {
  host?.remove()
  host = null
  vi.restoreAllMocks()
})

/** Mounts the tab against `value` and hands back the DOM and the writes it made. */
async function mount(value: RoutingSettings) {
  answer = value
  calls = []
  const { UsageRoutingTab } = await import('./UsageRoutingTab')
  host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(<UsageRoutingTab outages={[]} companyName="Tiny Corp" />)
  })
  return { calls, host: host! }
}

const clicking = (host: HTMLElement, label: string) =>
  [...host.querySelectorAll('button')].find((button) => button.textContent?.includes(label))

/** The pin at the end of one account's row, by the account it would pin the Company to. */
const pinOf = (host: HTMLElement, label: string) =>
  host.querySelector<HTMLButtonElement>(`button[aria-label="Pin ${label}"]`) ?? undefined

/** One sign-in of the first Provider, as the tab is handed it. */
const account = (id: string, label: string) => ({
  id,
  provider: first,
  label,
  plan: null,
  email: null,
  configDir: `/tmp/${id}`,
  isDefault: false,
  primary: false,
})

/** The tab as the boss left it: these sign-ins of the first Provider, with one of them pinned. */
const pinnedTo = (id: string, accounts: ReturnType<typeof account>[]) => {
  const value = settings({ accounts })
  return settings({ ...value, routing: { ...value.routing, pinnedAccount: { [first]: id } } })
}

describe('Usage & routing', () => {
  it('starts on Wait for reset and switches the whole Company with one press', async () => {
    const { calls, host } = await mount(settings())

    expect(host.textContent).toContain(whenOutLabel(first))
    expect(clicking(host, 'Wait for reset')?.getAttribute('aria-pressed')).toBe('true')

    await act(async () => clicking(host, 'Continue on another provider')?.click())

    expect(calls).toEqual([{ name: 'setRule', args: [first, { kind: 'continue', provider: second, model: null }] }])
  })

  it('shows the fallback picker, the move-back toggle and what a switch keeps', async () => {
    const { host } = await mount(
      settings({
        routing: {
          rules: { [first]: { kind: 'continue', provider: second, model: null } },
          moveBack: {},
          resumeAtReset: true,
          rotateAccounts: false,
          pinnedAccount: {},
        },
      }),
    )

    expect(host.textContent).toContain('CONTINUE ON')
    expect(host.textContent).toContain(`Move back when ${FIRST} resets`)
    expect(host.textContent).toContain('keeps its ticket, worktree and branch')
  })

  it('lists the Employees that do not follow the Company, and puts them back', async () => {
    const { calls, host } = await mount(
      settings({
        overrides: [{ employeeId: 'e-iris', name: 'Iris', routing: { rule: { kind: 'wait' }, pinnedAccount: {} } }],
      }),
    )

    expect(host.textContent).toContain('Iris')
    expect(host.textContent).toContain('Waits for reset')

    await act(async () => clicking(host, 'Use Company rule')?.click())

    expect(calls).toEqual([{ name: 'setEmployeeRule', args: ['e-iris', null] }])
  })

  it('draws rotation off, with the warning the boss reads before turning it on', async () => {
    const { host } = await mount(settings())
    const toggle = host.querySelector<HTMLInputElement>('[aria-label="Rotate between accounts of one provider"]')

    expect(toggle?.checked).toBe(false)
    expect(host.textContent).toContain(ROTATION_WARNING.title)
    expect(host.textContent).toContain(ROTATION_WARNING.body)
  })

  it('pins the whole Company from the account’s own row', async () => {
    const { calls, host } = await mount(
      settings({ accounts: [account('acc-personal', 'Personal'), account('acc-work', 'Work')] }),
    )

    expect(host.textContent).toContain(FIRST_WITH_ROOM)

    await act(async () => pinOf(host, 'Work')?.click())

    expect(calls).toEqual([{ name: 'setPinnedAccount', args: [first, 'acc-work'] }])
  })

  it('says which account is in force, and unpins the row that carries it', async () => {
    const { calls, host } = await mount(
      pinnedTo('acc-work', [account('acc-personal', 'Personal'), account('acc-work', 'Work')]),
    )

    expect(host.textContent).toContain('Pinned · Work')
    expect(host.textContent).not.toContain(FIRST_WITH_ROOM)
    expect(pinOf(host, 'Work')?.getAttribute('aria-pressed')).toBe('true')

    await act(async () => pinOf(host, 'Work')?.click())

    expect(calls).toEqual([{ name: 'setPinnedAccount', args: [first, null] }])
  })

  /**
   * One sign-in is not a choice, so the frame draws the row no button and the Provider no rule —
   * and the row still spends the column, which is what keeps every meter on the card in one line.
   */
  it('draws no pin, and no rule, for a Provider with a single sign-in', async () => {
    const { host } = await mount(settings({ accounts: [account('acc-personal', 'Personal')] }))

    expect(host.textContent).toContain(accountsLabel(first))
    expect(pinOf(host, 'Personal')).toBeUndefined()
    expect(host.textContent).not.toContain(FIRST_WITH_ROOM)
  })

  /**
   * Removing the other sign-ins leaves the pin behind on the Provider — without the button the
   * boss would be reading a rule in force with nothing on the page to undo it.
   */
  it('keeps the pin of a Provider whose other sign-ins are gone, so it can still be undone', async () => {
    const { host } = await mount(pinnedTo('acc-work', [account('acc-work', 'Work')]))

    expect(host.textContent).toContain('Pinned · Work')
    expect(pinOf(host, 'Work')).toBeDefined()
  })
})

describe('the words around a routed Employee', () => {
  const routed = {
    provider: second,
    model: null,
    from: first,
    resetsAt: new Date(2026, 8, 17, 21, 0).toISOString(),
    movesBack: true,
  }

  it('says where it is and until when, and what the button does', () => {
    expect(routingChipLabel(routed, new Date(2026, 8, 17, 18, 47))).toBe(`On ${SECOND} until ${FIRST} resets 21:00`)
    expect(backNowLabel(routed)).toBe(`Back to ${FIRST} now`)
  })

  it('will not take it back while the Provider it came from is still out', () => {
    expect(backNowBlocked(routed, true)).toBe(`${FIRST} has not reset yet`)
    expect(backNowBlocked(routed, false)).toBeNull()
  })

  it('reads an override in the words the Overrides list uses', () => {
    const lines = overrideLines(
      settings({
        overrides: [
          { employeeId: 'e-ada', name: 'Ada', routing: { rule: null, pinnedAccount: { [first]: 'acc-work' } } },
        ],
        accounts: [
          {
            id: 'acc-work',
            provider: first,
            label: 'Work',
            plan: null,
            email: null,
            configDir: '/tmp/work',
            isDefault: false,
            primary: false,
          },
        ],
      }),
    )

    expect(lines).toEqual([{ employeeId: 'e-ada', name: 'Ada', summary: 'Pinned to Work' }])
  })

  /**
   * Two sign-ins of one product are told apart by their plan everywhere else on the tab, and the
   * Overrides row dropped it — `Pinned to Work` says nothing when both are called Work (T196,
   * frame `bB6VX` writes `Pinned to Work · Team`).
   */
  it('names the plan of the account an Employee is pinned to', () => {
    const account = (id: string, label: string, plan: string | null) => ({
      id,
      provider: first,
      label,
      plan,
      email: null,
      configDir: `/tmp/${id}`,
      isDefault: false,
      primary: false,
    })
    const lines = overrideLines(
      settings({
        overrides: [
          { employeeId: 'e-ada', name: 'Ada', routing: { rule: null, pinnedAccount: { [first]: 'acc-work' } } },
        ],
        accounts: [account('acc-work', 'Work', 'Team'), account('acc-other', 'Work', 'Pro')],
      }),
    )

    expect(lines[0]?.summary).toBe('Pinned to Work · Team')
  })
})

/**
 * Two lines the frames write with the Company's own words in them. `this Company` and `one
 * account` are what a boss with four of them cannot read off the page, and the second one also
 * wrapped to a line the frame does not have (T196).
 */
describe('the words the routing cards put the Company in', () => {
  it('names the Company the rule applies to', () => {
    expect(runsOutSub('Tiny Corp')).toBe(
      'Applies to every Employee in Tiny Corp. An Employee can override it from its drawer.',
    )
  })

  it('names the two accounts rotation would move between', () => {
    const account = (id: string, label: string, provider: Provider) => ({
      id,
      provider,
      label,
      plan: null,
      email: null,
      configDir: `/tmp/${id}`,
      isDefault: false,
      primary: false,
    })

    expect(rotationSub([account('a', 'Personal', first), account('b', 'Work', first)])).toBe(
      'When Personal runs out, move to Work instead of waiting or switching provider.',
    )
  })

  it('stays general when there is no second sign-in of one product to name', () => {
    const account = (id: string, label: string, provider: Provider) => ({
      id,
      provider,
      label,
      plan: null,
      email: null,
      configDir: `/tmp/${id}`,
      isDefault: false,
      primary: false,
    })

    expect(rotationSub([])).toBe('When one runs out, move to the next instead of waiting or switching provider.')
    expect(rotationSub([account('a', 'Personal', first), account('b', 'Personal', second)])).toContain('When one runs')
  })
})

describe('the out-of-budget card’s offer', () => {
  it('offers nothing while the Company’s rule is to wait', () => {
    expect(fallbackOffer(settings(), { 'e-iris': 'out_of_budget' })).toBeNull()
  })

  it('offers nothing when nobody is actually waiting', () => {
    const rules = { [first]: { kind: 'continue' as const, provider: second, model: null } }
    expect(fallbackOffer(settings({ routing: { ...settings().routing, rules } }), { 'e-iris': 'busy' })).toBeNull()
  })

  it('names the Provider the Company would continue on', () => {
    const rules = { [first]: { kind: 'continue' as const, provider: second, model: null } }
    const offer = fallbackOffer(settings({ routing: { ...settings().routing, rules } }), {
      'e-iris': 'out_of_budget',
    })

    expect(offer?.name).toBe(SECOND)
  })
})
