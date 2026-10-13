/**
 * The Codex usage read, against the real ChatGPT login on this machine (T220).
 *
 * It is not part of `pnpm test`, because it leaves the process; run it with `pnpm test:claude`.
 * Unlike the loop itests beside it, it spends **no** usage at all — it is one GET of the same
 * endpoint the Codex CLI asks, which is why it is cheap enough to keep. Skipped without a login.
 *
 * What only the real endpoint can answer is whether it still reports the two windows the popover
 * draws under the names TinyCorp reads them by: a recorded answer cannot notice the day
 * `used_percent` becomes `usedPercent`, or `rate_limit` gains a wrapper. That day this goes red and
 * the popover's `Usage unavailable` has a reason behind it rather than a blank row.
 */
import { describe, expect, it } from 'vitest'
import { codexLogin } from './provider-logins'
import { createProviderUsage } from './provider-usage'

const readCodexLogin = codexLogin()
const { login } = await readCodexLogin()

describe.skipIf(!login)('Reading real Codex usage', () => {
  it('reports the 5-hour and weekly percentages the CLI draws itself', async () => {
    const usage = createProviderUsage({
      // Claude is not what this is about, and a machine may hold one login and not the other.
      claudeCredential: () => Promise.resolve({ login: null, lookedIn: [] }),
      codexCredential: () => readCodexLogin(),
      log: () => {},
    })

    const codex = (await usage.read()).providers.find((provider) => provider.id === 'codex')!

    expect(codex.reason, 'the endpoint the Codex CLI itself asks did not answer').toBe(null)
    expect(codex.problem).toBe(null)
    expect(codex.windows.map((window) => window.label)).toEqual(['5h', 'wk'])
    for (const window of codex.windows) {
      expect(window.percent).toBeGreaterThanOrEqual(0)
      expect(window.percent).toBeLessThanOrEqual(100)
      // A window that names no reset time is allowed; one that names an unreadable one is not.
      if (window.resetsAt !== null) expect(Number.isNaN(Date.parse(window.resetsAt))).toBe(false)
    }
  })
})
