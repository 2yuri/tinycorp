// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Boss, defaultBoss } from '../../../shared/boss-profile'
import { PROVIDERS, type Provider } from '../../../shared/domain/providers'
import {
  PREFLIGHT_STILL_OPENS,
  type PreflightState,
  type PreflightStep,
  type ProviderPreflight,
} from '../../../shared/providers/preflight'
import { PreflightChooser } from './PreflightChooser'

/**
 * The two things about the chooser that only a document can answer (T250): clicking a closed row
 * opens it, and — on a Windows with WSL — the segments swap which place's commands are on show.
 *
 * Which row starts open, what the badges say and the order of the rows are static, and
 * `PreflightScreen.test.tsx` reads those off the markup without paying for jsdom.
 */

const noop = () => {}

/** What a Windows with one distro writes into a missing CLI's steps (frame `c8knu`). */
const steps: PreflightStep[] = [
  {
    kind: 'install',
    runtime: { kind: 'windows' },
    label: 'Windows',
    hint: 'PowerShell',
    prompt: '>',
    command: 'install-on-windows',
  },
  {
    kind: 'install',
    runtime: { kind: 'wsl', distro: 'Ubuntu' },
    label: 'WSL · Ubuntu',
    hint: 'bash',
    prompt: '$',
    command: 'install-in-wsl',
  },
  {
    kind: 'sign-in',
    runtime: null,
    label: 'Then sign in',
    hint: 'where you installed it',
    prompt: '$',
    command: 'sign-in',
  },
]

/** A boss's profile, of which the chooser reads the two places (T249). */
function boss(over: Partial<Boss> = {}): Boss {
  return { ...defaultBoss('Boss'), ...over }
}

function check(provider: Provider, state: PreflightState, over: Partial<ProviderPreflight> = {}): ProviderPreflight {
  return {
    provider,
    state,
    checkedAt: '2026-09-25T09:00:00.000Z',
    hired: false,
    title: `${provider} is in trouble`,
    body: 'Nothing here can run an Employee.',
    lead: `Install ${provider}, then sign in:`,
    commands: [`install-${provider}`, `sign-in-${provider}`],
    note: PREFLIGHT_STILL_OPENS,
    account: null,
    plan: null,
    ...over,
  }
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function draw(blocked: ProviderPreflight[], profile: Boss | null = null) {
  act(() =>
    root.render(
      <PreflightChooser blocked={blocked} boss={profile} checking={false} onRecheck={noop} onDismiss={noop} />,
    ),
  )
}

/** The row headers, in the order the chooser draws them. */
function headers(): HTMLButtonElement[] {
  return [...host.querySelectorAll<HTMLButtonElement>('[data-ui="Provider Row"] > button')]
}

/** Whose row is open, by the button that says it is expanded. */
function open(): string[] {
  return [...host.querySelectorAll<HTMLElement>('[data-ui="Provider Row"]')]
    .filter((row) => row.querySelector('button')?.getAttribute('aria-expanded') === 'true')
    .map((row) => row.dataset['provider'] ?? '')
}

/** The commands on show, in order. */
function commands(): string[] {
  return [...host.querySelectorAll('code')].map((line) => line.textContent ?? '')
}

const machine = (over: Partial<ProviderPreflight> = {}) => PROVIDERS.map((provider) => check(provider, 'missing', over))

describe('Opening another row', () => {
  it('opens the one that was clicked and closes the one that was open', () => {
    draw(machine())
    const [first, second] = PROVIDERS as [Provider, Provider, ...Provider[]]
    expect(open()).toEqual([first])

    act(() => headers()[1]!.click())

    expect(open()).toEqual([second])
    expect(commands()).toEqual([`install-${second}`, `sign-in-${second}`])
  })

  it('says which row is open where a screen reader can hear it, and names each panel by its row', () => {
    draw(machine())
    const [header] = headers()

    expect(headers().map((one) => one.getAttribute('aria-expanded'))).toEqual(['true', 'false', 'false'])
    const panel = host.querySelector(`#${header!.getAttribute('aria-controls')}`)
    expect(panel?.getAttribute('aria-labelledby')).toBe(header!.id)
  })
})

describe('A Windows with WSL (frame c8knu)', () => {
  it('starts on WSL, because a machine with a distro is a machine whose boss installed one', () => {
    draw(machine({ steps, lookedIn: 'Looked in: Windows PATH · WSL: Ubuntu' }))

    expect(segments().map((one) => one.textContent)).toEqual(['Windows · PowerShell', 'WSL · Ubuntu · bash'])
    expect(picked()).toBe('WSL · Ubuntu · bash')
    expect(commands()).toEqual(['install-in-wsl', 'sign-in'])
    expect(host.textContent).toContain('Looked in: Windows PATH · WSL: Ubuntu')
  })

  it('starts where the boss said the team runs, when they have said (T249)', () => {
    draw(machine({ steps }), boss({ defaultRuntime: 'windows' }))

    expect(picked()).toBe('Windows · PowerShell')
    expect(commands()).toEqual(['install-on-windows', 'sign-in'])
  })

  it('lets this Provider’s own pick beat the team default, as chooseRuntime does', () => {
    const [first] = PROVIDERS as [Provider, ...Provider[]]
    const profile = boss({ defaultRuntime: 'windows', providerRuntimes: { [first]: 'wsl:Ubuntu' } })
    draw(machine({ steps }), profile)

    expect(picked()).toBe('WSL · Ubuntu · bash')
  })

  it('ignores a place this machine does not offer, rather than opening on nothing', () => {
    draw(machine({ steps }), boss({ defaultRuntime: 'wsl:Debian' }))

    // Debian is not one of the segments, so the pick is dropped and the WSL fallback stands.
    expect(picked()).toBe('WSL · Ubuntu · bash')
  })

  it('shows the other place, and only the other place, when the boss picks it', () => {
    draw(machine({ steps }))

    act(() => segments()[0]!.click())

    expect(picked()).toBe('Windows · PowerShell')
    expect(commands()).toEqual(['install-on-windows', 'sign-in'])
  })

  it('draws the commands and no track on a Windows with no WSL, where there is no choice', () => {
    draw(machine({ steps: steps.filter((step) => step.runtime?.kind !== 'wsl') }))

    expect(segments()).toHaveLength(0)
    expect(commands()).toEqual(['install-on-windows', 'sign-in'])
  })

  it('draws no segments at all on a machine with one place to install into', () => {
    draw(machine())

    expect(segments()).toHaveLength(0)
    expect(host.textContent).toContain(`Install ${PROVIDERS[0]}, then sign in:`)
  })
})

function segments(): HTMLButtonElement[] {
  return [...host.querySelectorAll<HTMLButtonElement>('[data-ui="Segmented Control"] button')]
}

function picked(): string {
  return segments().find((one) => one.getAttribute('aria-pressed') === 'true')?.textContent ?? ''
}
