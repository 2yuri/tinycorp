// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  type EnvironmentSettings,
  type ImportPreview,
  MASKED_VALUE,
  NOT_A_SANDBOX,
  REVEAL_FOOTER,
  UNPROTECTED_REVEAL,
} from '../../../shared/environments'
import type { RevealedValue } from '../../../shared/ipc'

/**
 * The Environments tab (T176, frame `zpvHQ`).
 *
 * The test that matters is the negative one: the screen draws dots, and the only way a value
 * reaches it is a Reveal the boss asked for and the OS allowed.
 */

const DATABASE_URL = 'postgres://app:h7fs8@db.internal:5432/billing'

const settings = (over: Partial<EnvironmentSettings> = {}): EnvironmentSettings => ({
  environments: [
    { id: 'dev', askEveryUse: false, availableToChecks: true, variableCount: 1 },
    { id: 'staging', askEveryUse: false, availableToChecks: true, variableCount: 0 },
    { id: 'prod', askEveryUse: true, availableToChecks: true, variableCount: 1 },
  ],
  variables: [
    {
      id: 'v-db',
      environment: 'prod',
      name: 'DATABASE_URL',
      repoIds: ['r-api'],
      lastUsed: { employeeId: 'e-orion', at: new Date().toISOString() },
    },
    { id: 'v-redis', environment: 'dev', name: 'REDIS_URL', repoIds: [], lastUsed: null },
  ],
  repos: [
    { id: 'r-api', name: 'billing-api', defaultEnvironment: 'prod' },
    { id: 'r-web', name: 'web-app', defaultEnvironment: 'staging' },
  ],
  storedAt: 'Stored in this Mac’s keychain. Never in a repo, the database or a log.',
  revealFooter: REVEAL_FOOTER,
  storageProblem: null,
  ...over,
})

/** One bridge for the file: the view module reads `window.tinyCorp` when it is imported. */
let answer: EnvironmentSettings
let revealed: { ok: true; value: RevealedValue } | { ok: false; error: string }
let preview: ImportPreview | null
let calls: { name: string; args: unknown[] }[] = []

function bridge() {
  const write =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push({ name, args })
      return Promise.resolve({ ok: true as const, value: answer })
    }
  Object.assign(window, {
    tinyCorp: {
      environments: {
        get: () => Promise.resolve({ ok: true as const, value: answer }),
        setAskEveryUse: write('setAskEveryUse'),
        setAvailableToChecks: write('setAvailableToChecks'),
        add: write('add'),
        update: write('update'),
        remove: write('remove'),
        setRepoDefault: write('setRepoDefault'),
        reveal: (...args: unknown[]) => {
          calls.push({ name: 'reveal', args })
          return Promise.resolve(revealed)
        },
        copy: (...args: unknown[]) => {
          calls.push({ name: 'copy', args })
          return Promise.resolve({ ok: true as const, value: { protection: 'touch-id' as const } })
        },
        pickEnvFile: (...args: unknown[]) => {
          calls.push({ name: 'pickEnvFile', args })
          return Promise.resolve({ ok: true as const, value: preview })
        },
        importKeys: write('importKeys'),
        onChanged: () => () => {},
      },
      staff: {
        employees: () => Promise.resolve({ ok: true as const, value: [{ id: 'e-orion', name: 'Orion' }] }),
        onChanged: () => () => {},
      },
    },
  })
}

bridge()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let host: HTMLElement | null = null
let mounted: Root | null = null
afterEach(() => {
  // Unmounted, not just detached: a dialog is a portal onto `document.body` (T218), and a root
  // left mounted would leave its modal on the next test's screen.
  act(() => mounted?.unmount())
  mounted = null
  host?.remove()
  host = null
  vi.restoreAllMocks()
})

async function mount(value: EnvironmentSettings = settings()) {
  answer = value
  calls = []
  revealed = { ok: true, value: { name: 'DATABASE_URL', value: DATABASE_URL, protection: 'touch-id' } }
  preview = null
  const { EnvironmentsTab } = await import('./EnvironmentsTab')
  host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted = root
  await act(async () => {
    root.render(<EnvironmentsTab now={() => new Date()} />)
  })
  return { calls, host: host! }
}

/**
 * Every button on the page, not only the ones under the tab's own root: a modal is a portal onto
 * `document.body` (T218), because a dialog written inside Company settings' `<form>` is a form
 * inside a form and Chromium never lets React cancel its submit.
 */
const button = (host: HTMLElement, label: string) =>
  [...document.body.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.includes(label) || candidate.getAttribute('aria-label') === label,
  ) ?? [...host.querySelectorAll('button')].find((candidate) => candidate.textContent?.includes(label))

/** What is on the screen: the tab, and whatever dialog is open over it. */
const screenText = () => document.body.textContent ?? ''

/** Types into a React-controlled input the way a boss does. */
function setValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('The Environments tab', () => {
  it('draws the chosen environment’s variables masked, and no value anywhere', async () => {
    const { host } = await mount()

    expect(host.textContent).toContain('DATABASE_URL')
    expect(host.textContent).toContain(MASKED_VALUE)
    expect(host.textContent).not.toContain('postgres://')
    expect(host.textContent).toContain('billing-api')
    expect(host.textContent).toContain('Orion')
  })

  it('keeps the honesty line and the footer on the screen', async () => {
    const { host } = await mount()

    expect(host.textContent).toContain(NOT_A_SANDBOX.title)
    expect(host.textContent).toContain(NOT_A_SANDBOX.body)
    expect(host.textContent).toContain(REVEAL_FOOTER)
    expect(host.textContent).toContain('env_run')
  })

  it('says prod asks before every use, and switches to an environment that does not', async () => {
    const { host } = await mount()
    expect(host.textContent).toContain('asks before every use')

    await act(async () => button(host, 'dev')?.click())

    expect(host.textContent).toContain('REDIS_URL')
    expect(host.textContent).not.toContain('DATABASE_URL')
    expect(host.textContent).not.toContain('asks before every use')
  })

  it('shows a value only after Reveal, and asks the main process for it each time', async () => {
    const { host, calls } = await mount()

    await act(async () => button(host, 'Reveal')?.click())

    expect(calls).toEqual([{ name: 'reveal', args: ['v-db'] }])
    expect(host.textContent).toContain(DATABASE_URL)

    await act(async () => button(host, 'Hide')?.click())
    expect(host.textContent).not.toContain('postgres://')
  })

  it('says so out loud when the machine had nothing better than a confirmation', async () => {
    const { host } = await mount()
    revealed = { ok: true, value: { name: 'DATABASE_URL', value: DATABASE_URL, protection: 'confirmation' } }

    await act(async () => button(host, 'Reveal')?.click())

    expect(host.textContent).toContain(UNPROTECTED_REVEAL)
  })

  it('says nothing but the error when the boss cancels the prompt', async () => {
    const { host } = await mount()
    revealed = { ok: false, error: 'Cancelled.' }

    await act(async () => button(host, 'Reveal')?.click())

    expect(host.textContent).toContain('Cancelled.')
    expect(host.textContent).not.toContain('postgres://')
  })

  it('copies through the main process, and says the clipboard clears itself', async () => {
    const { host, calls } = await mount()

    await act(async () => button(host, 'Copy DATABASE_URL')?.click())

    expect(calls).toEqual([{ name: 'copy', args: ['v-db'] }])
    expect(host.textContent).toContain('clears in 30 seconds')
  })

  it('turns the two switches of the chosen environment', async () => {
    const { host, calls } = await mount()

    const toggle = (label: string) => host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)

    await act(async () => toggle('Ask me before every use')!.click())
    await act(async () => toggle('Available to Testing and checks')!.click())

    expect(calls).toEqual([
      { name: 'setAskEveryUse', args: ['prod', false] },
      { name: 'setAvailableToChecks', args: ['prod', false] },
    ])
  })

  it('sets which repos run this environment by default', async () => {
    const { host, calls } = await mount()

    await act(async () =>
      host.querySelector<HTMLInputElement>('input[aria-label="web-app uses prod by default"]')!.click(),
    )

    expect(calls).toEqual([{ name: 'setRepoDefault', args: ['r-web', 'prod'] }])
  })

  it('says a machine with no keyring cannot keep a secret, and refuses to take one', async () => {
    const { host } = await mount(
      settings({
        storageProblem:
          'There is no keyring running on this desktop, so Electron would "encrypt" these values with a ' +
          'key that is in its own source.',
      }),
    )

    expect(host.textContent).toContain('This machine cannot keep a secret')
    expect(host.textContent).toContain('no keyring running')
    expect(button(host, 'Add variable')?.disabled).toBe(true)
    expect(button(host, 'Import .env')?.disabled).toBe(true)
  })

  it('opens Add variable on every repo, and asks for a list only when the boss narrows it (T218)', async () => {
    const { host, calls } = await mount()

    await act(async () => button(host, 'Add variable')?.click())
    expect(screenText()).toContain('Every repo of this Company may use it')
    expect(document.body.querySelector('input[aria-label="billing-api may use it"]')).toBeNull()

    const onlyThese = [...document.body.querySelectorAll('label')].find((row) => row.textContent === 'Only these')!
    await act(async () => onlyThese.querySelector('input')!.click())
    await act(async () =>
      document.body.querySelector<HTMLInputElement>('input[aria-label="billing-api may use it"]')!.click(),
    )
    await act(async () => {
      const name = [...document.body.querySelectorAll('input')].find(
        (input) => input.getAttribute('placeholder') === 'DATABASE_URL',
      )!
      const value = [...document.body.querySelectorAll('input')].find(
        (input) => input.getAttribute('placeholder') === 'postgres://…',
      )!
      setValue(name, 'NEW_KEY')
      setValue(value, 'a-long-enough-value')
    })
    const dialog = document.body.querySelector('[role="dialog"]')!
    const submit = [...dialog.querySelectorAll('button')].find((row) => row.textContent === 'Add variable')!
    await act(async () => submit.click())

    expect(calls.at(-1)).toEqual({
      name: 'add',
      args: [{ environment: 'prod', name: 'NEW_KEY', value: 'a-long-enough-value', repoIds: ['r-api'] }],
    })
  })

  it('previews an imported .env by its keys, ticks the secrets and imports only those', async () => {
    const { host, calls } = await mount()
    preview = {
      file: 'web-app/.env.local',
      environment: 'prod',
      keys: [
        { name: 'DATABASE_URL', chosen: true, skipReason: null, note: 'replaces prod’s', problem: null },
        { name: 'NEXT_PUBLIC_APP_URL', chosen: false, skipReason: 'public — skipped', note: 'new', problem: null },
      ],
    }

    await act(async () => button(host, 'Import .env')?.click())

    expect(screenText()).toContain('web-app/.env.local')
    expect(screenText()).toContain('public — skipped')
    expect(screenText()).toContain('Values go straight to the keychain')

    await act(async () => button(host, 'Import 1 key')?.click())

    expect(calls.at(-1)).toEqual({ name: 'importKeys', args: ['prod', ['DATABASE_URL']] })
  })
})
