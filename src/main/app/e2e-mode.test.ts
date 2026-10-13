import { describe, expect, it } from 'vitest'
import { PROVIDERS } from '../../shared/domain/providers'
import { fakeProviderAdapters } from '../providers/testing'
import { E2E_ENV, endToEndRun } from './e2e-mode'

describe('endToEndRun', () => {
  it('is on for an unpackaged build that was asked', () => {
    expect(endToEndRun({ packaged: false, env: { [E2E_ENV]: '1' } })).toBe(true)
  })

  /**
   * The promise the switch makes: a build a boss downloaded ignores the variable, so there is
   * nothing in a shipped app to flip (T189).
   */
  it('is off in a packaged build, whatever the environment says', () => {
    expect(endToEndRun({ packaged: true, env: { [E2E_ENV]: '1' } })).toBe(false)
  })

  it('is off without the variable, and off when it is blank', () => {
    expect(endToEndRun({ packaged: false, env: {} })).toBe(false)
    expect(endToEndRun({ packaged: false, env: { [E2E_ENV]: '  ' } })).toBe(false)
  })
})

describe('the Providers an end-to-end run gets', () => {
  it('are one fake per Provider in the catalogue', () => {
    expect(Object.keys(fakeProviderAdapters()).sort()).toEqual([...PROVIDERS].sort())
  })

  it('are ready, so the preflight never takes the window from the screen under test', async () => {
    const adapters = fakeProviderAdapters()
    for (const provider of PROVIDERS) {
      expect((await adapters[provider]?.checkCli())?.state).toBe('ready')
    }
  })
})
