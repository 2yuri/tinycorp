// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Result } from '../../../shared/domain/result'
import type { NewRemote, RemoteOffer, RepoInspection, RepoStartPlan } from '../../../shared/repos/repo'
import { AddRepoModal, type RepoSource } from './AddRepoModal'
import { InitialiseRepoAlert } from './InitialiseRepo'

/**
 * The New repository source of Add repository (T144), driven the way the boss drives it: choose
 * it, give a location and a name, read what starting there does, create it, go on to step 2.
 */

let host: HTMLDivElement
let root: Root

const inspection = (path: string, remote: string | null = null): RepoInspection => ({
  path,
  isGitRepo: true,
  remote,
  defaultBranch: 'main',
  commitCount: 1,
  lastCommitAt: null,
  detected: {},
})

interface Api {
  plan: (path: string) => RepoStartPlan
  offers: RemoteOffer[]
  initialise: ReturnType<typeof vi.fn<(path: string) => Promise<Result<RepoInspection>>>>
  createRemote: ReturnType<typeof vi.fn<(path: string, remote: NewRemote) => Promise<Result<RepoInspection>>>>
}

let api: Api

beforeEach(() => {
  vi.useFakeTimers()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  api = {
    plan: (path) => ({ kind: 'new-folder', path }),
    offers: [],
    initialise: vi.fn((path: string) => Promise.resolve({ ok: true as const, value: inspection(path) })),
    createRemote: vi.fn((path: string) =>
      Promise.resolve({ ok: true as const, value: inspection(path, 'forge.example/ada/app') }),
    ),
  }
  ;(window as unknown as { tinyCorp: unknown }).tinyCorp = {
    repos: {
      inspect: (path: string) => Promise.resolve({ ...inspection(path), isGitRepo: false }),
      planStart: (path: string) => Promise.resolve(api.plan(path)),
      remoteOffers: () => Promise.resolve({ ok: true, value: api.offers }),
      initialise: (path: string) => api.initialise(path),
      createRemote: (path: string, remote: NewRemote) => api.createRemote(path, remote),
      pickFolder: () => Promise.resolve(null),
    },
  }
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})

async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(250)
  })
}

async function open(): Promise<RepoSource[]> {
  const continued: RepoSource[] = []
  act(() => {
    root.render(
      <AddRepoModal companyName="Acme" initial={null} onCancel={() => {}} onContinue={(s) => continued.push(s)} />,
    )
  })
  const newSource = [...document.querySelectorAll('[data-source]')].find((el) =>
    el.textContent?.includes('New repository'),
  )
  act(() => newSource!.querySelector<HTMLInputElement>('input')!.click())
  await settle()
  return continued
}

function type(label: string, value: string) {
  const field = [...document.querySelectorAll('label[data-field]')].find((el) => el.textContent?.startsWith(label))
  const input = field!.querySelector('input')!
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const submit = () => document.querySelector<HTMLButtonElement>('button[type="submit"]')!
const planRow = () => document.querySelector('[data-testid="new-repo-plan"]')

describe('Add repository › New repository', () => {
  it('creates the folder and the repo, then goes on to step 2 with it, and no remote', async () => {
    const continued = await open()
    type('LOCATION', '/Users/ada/code')
    type('REPOSITORY NAME', 'payments-web')
    await settle()

    expect(planRow()?.textContent).toContain('/Users/ada/code/payments-web')
    expect(planRow()?.textContent).toContain('A new, empty folder')
    expect(submit().textContent).toBe('Create repository')
    expect(document.body.textContent).not.toContain('Also create it on')

    await act(async () => submit().click())
    await settle()

    expect(api.initialise).toHaveBeenCalledWith('/Users/ada/code/payments-web')
    expect(api.createRemote).not.toHaveBeenCalled()
    expect(continued).toEqual([
      {
        path: '/Users/ada/code/payments-web',
        name: 'payments-web',
        inspection: inspection('/Users/ada/code/payments-web'),
        detect: true,
      },
    ])
  })

  it('says it starts in place in a folder that holds files', async () => {
    api.plan = (path) => ({ kind: 'in-place', path, files: 12 })
    await open()
    type('LOCATION', '/Users/ada')
    type('REPOSITORY NAME', 'notes')
    await settle()

    expect(planRow()?.textContent).toContain('Starts the repo in place · 12 files kept as they are and committed')
    expect(submit().disabled).toBe(false)
  })

  it('refuses a folder inside another repo, with the reason, and cannot be submitted', async () => {
    api.plan = (path) => ({ kind: 'refused', path, reason: `${path} is inside the repository at /Users/ada/web` })
    await open()
    type('LOCATION', '/Users/ada/web/packages')
    type('REPOSITORY NAME', 'new')
    await settle()

    expect(planRow()?.textContent).toContain('is inside the repository at /Users/ada/web')
    expect(submit().disabled).toBe(true)
  })

  it('creates the remote only when asked, on the forge on offer, private', async () => {
    api.offers = [{ forge: 'forge', name: 'Forge', ready: true, account: 'ada', fix: null }]
    const continued = await open()
    type('LOCATION', '/Users/ada/code')
    type('REPOSITORY NAME', 'app')
    await settle()

    expect(document.body.textContent).toContain('Also create it on Forge')
    const toggle = document.querySelector<HTMLInputElement>('input[aria-label="Also create it on Forge"]')!
    act(() => toggle.click())
    await act(async () => submit().click())
    await settle()

    expect(api.createRemote).toHaveBeenCalledWith('/Users/ada/code/app', {
      forge: 'forge',
      name: 'app',
      visibility: 'private',
    })
    expect(continued[0]?.inspection.remote).toBe('forge.example/ada/app')
  })

  it('keeps the started repo when the remote fails, and goes on without one once it is turned off', async () => {
    api.offers = [{ forge: 'forge', name: 'Forge', ready: true, account: 'ada', fix: null }]
    api.createRemote.mockResolvedValueOnce({ ok: false, error: 'Name already exists on this account' })
    const continued = await open()
    type('LOCATION', '/Users/ada/code')
    type('REPOSITORY NAME', 'app')
    await settle()
    const toggle = () => document.querySelector<HTMLInputElement>('input[aria-label="Also create it on Forge"]')!
    act(() => toggle().click())

    await act(async () => submit().click())
    await settle()

    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Name already exists on this account')
    expect(continued).toEqual([])
    expect(submit().textContent).toBe('Continue')

    act(() => toggle().click())
    await act(async () => submit().click())
    await settle()

    expect(api.initialise).toHaveBeenCalledTimes(1)
    expect(continued).toHaveLength(1)
    expect(continued[0]?.inspection.remote).toBeNull()
  })

  it('does not offer a remote whose CLI is not ready, and says how to fix it', async () => {
    api.offers = [{ forge: 'forge', name: 'Forge', ready: false, account: null, fix: 'forge auth login' }]
    await open()

    expect(document.body.textContent).toContain('Run forge auth login')
    expect(document.querySelector<HTMLInputElement>('input[aria-label="Also create it on Forge"]')!.disabled).toBe(true)
  })
})

describe('Not a git repository yet, on every attach surface', () => {
  it('says it starts in place, keeping the files, where the folder holds some', async () => {
    api.plan = (path) => ({ kind: 'in-place', path, files: 3 })
    act(() => root.render(<InitialiseRepoAlert path="/Users/ada/notes" onInitialised={() => {}} />))
    await settle()

    expect(host.textContent).toContain('Starts the repo in place: the 3 files here are kept as they are and committed')
    expect(host.textContent).toContain('Initialise repository')
  })

  it('refuses a folder inside another repo with the reason, and offers nothing to press', async () => {
    api.plan = (path) => ({ kind: 'refused', path, reason: `${path} is inside the repository at /Users/ada/web` })
    act(() => root.render(<InitialiseRepoAlert path="/Users/ada/web/docs" onInitialised={() => {}} />))
    await settle()

    expect(host.textContent).toContain('A repository cannot start here')
    expect(host.textContent).toContain('is inside the repository at /Users/ada/web')
    expect(host.querySelector('button')).toBeNull()
  })
})
