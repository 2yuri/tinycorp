import { describe, expect, it } from 'vitest'
import { PROVIDER_CATALOGUE, type ProviderEntry } from '../../../shared/domain/providers'
import { stepReached } from '../../../shared/usage/sign-in'
import { stepMarks } from './sign-in-model'

/**
 * The steps beside the sign-in's terminal (T263). They come from the catalogue — every Provider
 * brings its own, and this folder names none — and they follow what the product prints.
 */

const CATALOGUE: readonly ProviderEntry[] = PROVIDER_CATALOGUE
const steps = CATALOGUE[0]!.auth.signIn.steps

describe('the steps', () => {
  it('come from each Provider’s catalogue entry, and end with the one TinyCorp completes', () => {
    for (const entry of CATALOGUE) {
      expect(entry.auth.signIn.steps.length, entry.id).toBeGreaterThan(0)
      expect(entry.auth.signIn.steps.at(-1)!.seen, entry.id).toBeUndefined()
    }
  })

  it('highlight the step the product’s own words have reached, and tick the ones before it', () => {
    const seen = steps[1]!.seen!
    const step = stepReached(steps, `Welcome\n${seen.toUpperCase()}:`)

    expect(stepMarks(steps, { phase: 'waiting', step }, 0).slice(0, 3)).toEqual(['done', 'current', 'todo'])
  })

  it('are every one ticked once the login appeared', () => {
    expect(stepMarks(steps, { phase: 'signed-in', who: null }, 1).every((mark) => mark === 'done')).toBe(true)
  })

  it('stay where the terminal stopped when it closed without a login', () => {
    expect(stepMarks(steps, { phase: 'ended', reason: 'closed' }, 1)[1]).toBe('current')
  })
})
