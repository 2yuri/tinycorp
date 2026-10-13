import { describe, expect, it } from 'vitest'
import type { PreflightState, ProviderPreflight } from '../providers/preflight'
import {
  FALLBACK_PROVIDER,
  invokeSkill,
  PROVIDER_CATALOGUE,
  PROVIDER_MODELS,
  PROVIDERS,
  type Provider,
  pickDefaultProvider,
  providerDefaultModel,
} from './providers'

/**
 * Any one Provider is enough (T169), so nothing in this file names one. The catalogue's own order
 * is the whole rule: first, second, last. A machine with only the last product installed must get
 * the last product, and reordering the catalogue must not need an edit here.
 */
const [first, second] = PROVIDERS as [Provider, Provider, ...Provider[]]
const last = PROVIDERS.at(-1)!

/** One Provider's answer with only the field this helper reads filled in truthfully. */
function answer(provider: Provider, state: PreflightState): ProviderPreflight {
  return {
    provider,
    state,
    title: '',
    body: '',
    lead: '',
    commands: [],
    note: '',
    account: null,
    plan: null,
    checkedAt: '2026-09-22T09:00:00.000Z',
    hired: false,
  }
}

/** The machine as the preflight found it: every Provider not named here is missing. */
function machine(states: Partial<Record<Provider, PreflightState>>): ProviderPreflight[] {
  return PROVIDERS.map((provider) => answer(provider, states[provider] ?? 'missing'))
}

describe('The Provider a new Employee starts on', () => {
  it('is the first in catalogue order that can run one', () => {
    expect(pickDefaultProvider(machine({ [first]: 'ready', [second]: 'ready' }))).toBe(first)
    expect(pickDefaultProvider(machine({ [second]: 'ready', [last]: 'ready' }))).toBe(second)
  })

  it('is the only ready one on a machine that holds one product — whichever it is', () => {
    for (const provider of PROVIDERS) {
      expect(pickDefaultProvider(machine({ [provider]: 'ready' }))).toBe(provider)
    }
  })

  it('counts a Provider with a warning as ready: a warning stops no Session', () => {
    expect(pickDefaultProvider(machine({ [first]: 'signed-out', [second]: 'warning' }))).toBe(second)
  })

  it('falls to the first one that is at least installed: a login is nearer than an install', () => {
    expect(pickDefaultProvider(machine({ [second]: 'signed-out', [last]: 'signed-out' }))).toBe(second)
    expect(pickDefaultProvider(machine({ [last]: 'signed-out' }))).toBe(last)
  })

  it('prefers a ready Provider to an installed one, whatever the catalogue order', () => {
    expect(pickDefaultProvider(machine({ [first]: 'signed-out', [last]: 'ready' }))).toBe(last)
  })

  it('is the fallback when nothing is installed, and before anyone has asked', () => {
    expect(pickDefaultProvider(machine({}))).toBe(FALLBACK_PROVIDER)
    expect(pickDefaultProvider(null)).toBe(FALLBACK_PROVIDER)
    expect(pickDefaultProvider([])).toBe(FALLBACK_PROVIDER)
  })

  it('ignores a Provider nobody has asked about yet rather than guessing for it', () => {
    // Only the last one has an answer, so it wins over the unasked ones ahead of it.
    expect(pickDefaultProvider([answer(last, 'ready')])).toBe(last)
  })
})

describe('The model that follows the Provider', () => {
  it('is that Provider’s own first catalogue entry, for every Provider there is', () => {
    for (const provider of PROVIDERS) {
      expect(providerDefaultModel(provider)).toBe(PROVIDER_MODELS[provider][0]!.id)
    }
  })
})

describe('how a message invokes a skill (T264)', () => {
  it('opens with the skill the way each Provider reads one', () => {
    const invoked = Object.fromEntries(
      PROVIDER_CATALOGUE.map((entry) => [entry.id, invokeSkill(entry, 'review-checklist', '[company] DM')]),
    )

    expect(invoked).toEqual({
      claude: '/review-checklist [company] DM',
      codex: '$review-checklist [company] DM',
      opencode: '/review-checklist [company] DM',
    })
  })

  it('asks in one plain sentence on a Provider that declares no way of its own', () => {
    expect(invokeSkill({}, 'review-checklist', '[company] DM')).toBe(
      'Use your `review-checklist` skill for this. [company] DM',
    )
  })
})
