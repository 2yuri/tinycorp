import { describe, expect, it, vi } from 'vitest'
import { PROVIDERS, type Provider } from '../../shared/domain/providers'
import type { ProviderCheck, ProviderPreflight } from '../../shared/providers/preflight'
import { createPreflight } from './preflight'

/** A Provider's answer, as its adapter would write it. The words are not this file's business. */
const answer = (state: ProviderCheck['state'], name: string): ProviderCheck => ({
  state,
  title: `${name} is ${state}`,
  body: `${name} said so.`,
  lead: '',
  commands: [],
  note: '',
  account: state === 'ready' ? `boss@${name}.test` : null,
  plan: null,
})

function setup(states: Partial<Record<Provider, ProviderCheck['state']>>, hired: Provider[]) {
  const asked: Provider[] = []
  const check = vi.fn(async (provider: Provider) => {
    asked.push(provider)
    return answer(states[provider] ?? 'ready', provider)
  })
  const changes: ProviderPreflight[][] = []
  const inUse = vi.fn(() => hired)
  return {
    asked,
    check,
    changes,
    inUse,
    preflight: createPreflight({ check, inUse, onChanged: (next) => changes.push(next) }),
  }
}

describe('The preflight', () => {
  it('asks every Provider the Company is hired on', async () => {
    const { preflight, asked } = setup({ codex: 'signed-out' }, ['claude', 'codex'])

    const status = await preflight.status()

    expect(asked.sort()).toEqual(['claude', 'codex'])
    expect(status.map((entry) => [entry.provider, entry.state])).toEqual([
      ['claude', 'ready'],
      ['codex', 'signed-out'],
    ])
  })

  it('never asks about a Provider nobody is hired on', async () => {
    const { preflight, asked } = setup({}, ['claude'])

    const status = await preflight.status()

    expect(asked, 'a Company with no Codex Employee must not be told about Codex').toEqual(['claude'])
    expect(status.map((entry) => entry.provider)).toEqual(['claude'])
  })

  it('asks the same Provider once however many Employees are hired on it', async () => {
    const { preflight, asked } = setup({}, ['claude', 'claude', 'claude'])

    await preflight.status()

    expect(asked).toEqual(['claude'])
  })

  it('still has a first run to get right: with no Company open it asks every Provider', async () => {
    const { preflight, asked } = setup({}, [])

    const status = await preflight.status()

    // Not the catalogue's first, which is what stopped a Codex-only boss with a card about a
    // product they never asked for (T169).
    expect(asked.sort()).toEqual([...PROVIDERS].sort())
    expect(status.map((entry) => entry.provider)).toEqual([...PROVIDERS])
  })

  it('says of each answer whether anyone is hired on it, so the screen knows how hard it bites', async () => {
    const { preflight } = setup({}, ['codex'])

    expect((await preflight.status()).map((entry) => [entry.provider, entry.hired])).toEqual([['codex', true]])
    expect((await preflight.all()).map((entry) => entry.hired)).toEqual(PROVIDERS.map((p) => p === 'codex'))
  })

  it('stamps every answer as unhired before the first Employee, whichever call asked', async () => {
    const { preflight } = setup({}, [])

    expect((await preflight.status()).every((entry) => !entry.hired)).toBe(true)
    expect(preflight.cached('claude')?.hired).toBe(false)
  })

  it('re-stamps a cached answer when the Employee that was hired on it arrives', async () => {
    const hired: Provider[] = []
    const check = vi.fn(async (provider: Provider) => answer('ready', provider))
    const flight = createPreflight({ check, inUse: () => hired })

    expect((await flight.all()).find((entry) => entry.provider === 'codex')?.hired).toBe(false)
    hired.push('codex')

    // The CLI is not asked again — what changed is who is hired, not what it said.
    expect((await flight.all()).find((entry) => entry.provider === 'codex')?.hired).toBe(true)
    expect(check).toHaveBeenCalledTimes(PROVIDERS.length)
  })

  it('asks once for the session and reuses the answers', async () => {
    const { preflight, check } = setup({}, ['claude', 'codex'])

    await preflight.status()
    await preflight.status()

    expect(check).toHaveBeenCalledTimes(2)
  })

  it('shares one subprocess between callers that ask before the first answer lands', async () => {
    const { preflight, check } = setup({}, ['claude'])

    await Promise.all([preflight.status(), preflight.status(), preflight.status()])

    expect(check).toHaveBeenCalledTimes(1)
  })

  it('asks the Provider that just joined the Company, and nothing it already knows', async () => {
    const hired: Provider[] = ['claude']
    const asked: Provider[] = []
    const check = vi.fn(async (provider: Provider) => {
      asked.push(provider)
      return answer('ready', provider)
    })
    const flight = createPreflight({ check, inUse: () => hired })

    await flight.status()
    hired.push('codex')
    await flight.status()

    expect(asked).toEqual(['claude', 'codex'])
  })

  it('has no answer at all until the first check lands', async () => {
    const { preflight } = setup({ claude: 'missing' }, ['claude'])

    expect(preflight.cached('claude')).toBeNull()
    await preflight.status()
    expect(preflight.cached('claude')?.state).toBe('missing')
  })

  it('knows nothing about a Provider it was never asked about', async () => {
    const { preflight } = setup({}, ['claude'])

    await preflight.status()

    expect(preflight.cached('codex')).toBeNull()
  })

  it('asks again on Check again, and tells every window what came back', async () => {
    const states: Partial<Record<Provider, ProviderCheck['state']>> = { codex: 'signed-out' }
    const check = vi.fn(async (provider: Provider) => answer(states[provider] ?? 'ready', provider))
    const changes: ProviderPreflight[][] = []
    const flight = createPreflight({
      check,
      inUse: () => ['codex'],
      onChanged: (next) => changes.push(next),
    })

    expect((await flight.status())[0]!.state).toBe('signed-out')
    states.codex = 'ready'
    expect((await flight.recheck())[0]!.state).toBe('ready')
    expect(flight.cached('codex')?.state).toBe('ready')
    expect(check).toHaveBeenCalledTimes(2)
    expect(changes.map((next) => next.map((entry) => entry.state))).toEqual([['ready']])
  })

  it('stamps every answer with when it was asked', async () => {
    const check = vi.fn(async (provider: Provider) => answer('ready', provider))
    const flight = createPreflight({ check, inUse: () => ['claude'], now: () => new Date('2026-09-21T09:00:00Z') })

    expect((await flight.status())[0]!.checkedAt).toBe('2026-09-21T09:00:00.000Z')
  })
})

/**
 * Which CLI is on this Mac is a fact about the machine, not about a Company (T141): Your profile's
 * card asks about all of them. What blocks the Launcher is still `status`, and still only the ones
 * in use — these two answers must not become one.
 */
describe('every Provider on this Mac', () => {
  it('is asked about, whether or not this Company is hired on it', async () => {
    const { preflight, asked } = setup({ codex: 'missing' }, ['claude'])

    const all = await preflight.all()

    expect(all.map((entry) => entry.provider)).toEqual([...PROVIDERS])
    expect(asked.sort()).toEqual([...PROVIDERS].sort())
    expect(all.find((entry) => entry.provider === 'codex')?.state).toBe('missing')
  })

  it('leaves the Launcher scoped to the Providers in use', async () => {
    const { preflight } = setup({ codex: 'missing' }, ['claude'])

    await preflight.all()
    const status = await preflight.status()

    // A Company with no Codex Employee is still not blocked by a Codex that is not installed.
    expect(status.map((entry) => entry.provider)).toEqual(['claude'])
  })

  it('shares the one cache, so nothing is asked twice', async () => {
    const { preflight, check } = setup({}, ['claude'])

    await preflight.status()
    await preflight.all()
    await preflight.all()

    expect(check).toHaveBeenCalledTimes(PROVIDERS.length)
  })

  it('shares one subprocess with a caller that asked first', async () => {
    const { preflight, check } = setup({}, ['claude'])

    await Promise.all([preflight.status(), preflight.all()])

    expect(check.mock.calls.filter(([provider]) => provider === 'claude')).toHaveLength(1)
  })
})
