import { describe, expect, it, vi } from 'vitest'
import { PROVIDERS } from '../../../shared/domain/providers'
import {
  noUsageEndpoint,
  PROVIDER_NAME,
  USAGE_PROVIDERS,
  type UsageSnapshot,
} from '../../../shared/usage/provider-usage'
import { onDisk } from '../../core/testing'
import type { LoginAccount } from './provider-logins'
import {
  CLAUDE_USAGE_URL,
  type ClaudeCredential,
  CODEX_USAGE_URL,
  type CodexCredential,
  claudeCredentialIn,
  claudePlan,
  codexCredentialIn,
  createProviderUsage,
  NO_CLAUDE_LOGIN,
  NO_CODEX_LOGIN,
  parseClaudeWindows,
  parseCodexWindows,
  USAGE_TTL_MS,
  type UsageAccountRef,
  type UsageHttp,
} from './provider-usage'

/** What `https://api.anthropic.com/api/oauth/usage` answers, trimmed to the fields TinyCorp reads. */
const ANSWER = JSON.stringify({
  five_hour: { utilization: 23, resets_at: '2026-09-18T12:50:00.757838+00:00' },
  seven_day: { utilization: 17, resets_at: '2026-09-20T22:00:00.757855+00:00' },
  seven_day_opus: { utilization: 6, resets_at: '2026-09-20T21:59:59.000000+00:00' },
  seven_day_sonnet: null,
  extra_usage: { is_enabled: false },
})

/**
 * What `https://chatgpt.com/backend-api/wham/usage` answered a real ChatGPT Plus login on
 * 2026-09-24, trimmed to the fields TinyCorp reads. Recorded, so no test leaves the process.
 */
const CODEX_ANSWER = JSON.stringify({
  plan_type: 'plus',
  rate_limit: {
    allowed: true,
    limit_reached: false,
    primary_window: {
      used_percent: 0,
      limit_window_seconds: 18000,
      reset_after_seconds: 18000,
      reset_at: 1_790_311_819,
    },
    secondary_window: {
      used_percent: 55,
      limit_window_seconds: 604_800,
      reset_after_seconds: 42_331,
      reset_at: 1_790_336_150,
    },
  },
  rate_limit_reset_credits: { available_count: 3 },
})

const LIVE: ClaudeCredential = { accessToken: 'oauth-token', expiresAt: Date.parse('2099-01-01T00:00:00Z') }

const CODEX_LIVE: CodexCredential = { accessToken: 'chatgpt-token', accountId: 'workspace-1' }

/**
 * A reader whose two endpoints are recorded answers. `answers` is Claude's, one per call, and
 * `codexAnswers` is Codex's; `calls` counts Claude's alone, so the cache assertions stay about one
 * read rather than about how many Providers answer.
 */
function setup(
  options: {
    credential?: ClaudeCredential | null
    codexCredential?: CodexCredential | null
    /** Where the reader looked, as the row says it when there was no login (T257). */
    lookedIn?: readonly string[]
    /** The boss's sign-ins of every Provider, and the login each config folder holds (T173, T257). */
    accounts?: readonly UsageAccountRef[]
    loginOf?: (account: LoginAccount | null) => ClaudeCredential | null
    answers?: { status: number; body: string }[]
    codexAnswers?: { status: number; body: string }[]
    now?: () => number
  } = {},
) {
  const answers = options.answers ?? [{ status: 200, body: ANSWER }]
  const codexAnswers = options.codexAnswers ?? [{ status: 200, body: CODEX_ANSWER }]
  const requests: { url: string; headers: Record<string, string> }[] = []
  let call = 0
  let codexCall = 0
  const http: UsageHttp = async (request) => {
    requests.push(request)
    if (request.url === CODEX_USAGE_URL) return codexAnswers[Math.min(codexCall++, codexAnswers.length - 1)]!
    return answers[Math.min(call++, answers.length - 1)]!
  }
  const lookedIn = options.lookedIn ?? []
  const usage = createProviderUsage({
    claudeCredential: async (account) => ({
      login: options.loginOf ? options.loginOf(account) : 'credential' in options ? options.credential! : LIVE,
      lookedIn,
    }),
    codexCredential: async () => ({
      login: 'codexCredential' in options ? options.codexCredential! : CODEX_LIVE,
      lookedIn,
    }),
    accountsOf: (provider) => (options.accounts ?? []).filter(() => provider === 'claude'),
    http,
    now: options.now ?? (() => Date.parse('2026-09-18T08:40:00Z')),
    log: () => {},
  })
  return { usage, requests, calls: () => call, codexCalls: () => codexCall }
}

const claudeOf = (snapshot: UsageSnapshot) => snapshot.providers.find((p) => p.id === 'claude')!
const codexOf = (snapshot: UsageSnapshot) => snapshot.providers.find((p) => p.id === 'codex')!

describe('parseClaudeWindows', () => {
  it('reads the 5h, week and Opus windows as percentages with their reset times', () => {
    expect(parseClaudeWindows(ANSWER)).toEqual([
      { key: 'five_hour', label: '5h', percent: 23, resetsAt: '2026-09-18T12:50:00.757Z' },
      { key: 'seven_day', label: 'wk', percent: 17, resetsAt: '2026-09-20T22:00:00.757Z' },
      { key: 'seven_day_opus', label: 'Opus', percent: 6, resetsAt: '2026-09-20T21:59:59.000Z' },
    ])
  })

  it('leaves out a window the plan does not track rather than drawing it at zero', () => {
    const body = JSON.stringify({ five_hour: { utilization: 4, resets_at: null }, seven_day_opus: null })

    expect(parseClaudeWindows(body)).toEqual([{ key: 'five_hour', label: '5h', percent: 4, resetsAt: null }])
  })

  it('accepts the windows under a rate_limits wrapper as well as at the top level', () => {
    const body = JSON.stringify({ rate_limits: { seven_day: { utilization: 50, resets_at: null } } })

    expect(parseClaudeWindows(body)).toEqual([{ key: 'seven_day', label: 'wk', percent: 50, resetsAt: null }])
  })

  it('clamps and rounds what it is handed, so no meter runs off its track', () => {
    const body = JSON.stringify({
      five_hour: { utilization: 99.6, resets_at: null },
      seven_day: { utilization: 140, resets_at: null },
      seven_day_opus: { utilization: -3, resets_at: null },
    })

    expect(parseClaudeWindows(body).map((w) => w.percent)).toEqual([100, 100, 0])
  })

  it('refuses a body that carries no window at all', () => {
    expect(() => parseClaudeWindows(JSON.stringify({ extra_usage: {} }))).toThrow(/no rate limits/i)
    expect(() => parseClaudeWindows('not json')).toThrow()
  })
})

describe('parseCodexWindows', () => {
  it('reads the 5h and weekly windows as percentages, with their reset times', () => {
    expect(parseCodexWindows(CODEX_ANSWER)).toEqual([
      { key: 'primary_window', label: '5h', percent: 0, resetsAt: '2026-09-25T04:50:19.000Z' },
      { key: 'secondary_window', label: 'wk', percent: 55, resetsAt: '2026-09-25T11:35:50.000Z' },
    ])
  })

  it('leaves out a window the plan does not report rather than drawing it at zero', () => {
    const body = JSON.stringify({ rate_limit: { primary_window: { used_percent: 4 }, secondary_window: null } })

    expect(parseCodexWindows(body)).toEqual([{ key: 'primary_window', label: '5h', percent: 4, resetsAt: null }])
  })

  it('clamps and rounds what it is handed, so no meter runs off its track', () => {
    const body = JSON.stringify({
      rate_limit: { primary_window: { used_percent: 99.6 }, secondary_window: { used_percent: 140 } },
    })

    expect(parseCodexWindows(body).map((w) => w.percent)).toEqual([100, 100])
  })

  it('refuses a body that carries no window at all', () => {
    expect(() => parseCodexWindows(JSON.stringify({ plan_type: 'plus' }))).toThrow(/no rate limits/i)
    expect(() => parseCodexWindows(JSON.stringify({ rate_limit: { allowed: true } }))).toThrow(/no rate limits/i)
    expect(() => parseCodexWindows('not json')).toThrow()
  })
})

describe('reading Codex usage', () => {
  it('asks the ChatGPT usage endpoint with the CLI’s own login and no API key', async () => {
    const { usage, requests } = setup()

    await usage.read()

    const asked = requests.find((request) => request.url === CODEX_USAGE_URL)!
    expect(asked.headers).toEqual({ Authorization: 'Bearer chatgpt-token', 'ChatGPT-Account-Id': 'workspace-1' })
    expect(Object.keys(asked.headers)).not.toContain('OpenAI-Organization')
  })

  it('leaves the workspace header out for a login that names no account', async () => {
    const { usage, requests } = setup({ codexCredential: { accessToken: 'chatgpt-token', accountId: null } })

    await usage.read()

    expect(requests.find((request) => request.url === CODEX_USAGE_URL)!.headers).toEqual({
      Authorization: 'Bearer chatgpt-token',
    })
  })

  it('reports the 5h and weekly percentages the CLI draws itself', async () => {
    const snapshot = await setup().usage.read()

    expect(codexOf(snapshot)).toEqual({
      id: 'codex',
      name: 'Codex',
      problem: null,
      reason: null,
      accounts: [],
      windows: [
        { key: 'primary_window', label: '5h', percent: 0, resetsAt: '2026-09-25T04:50:19.000Z' },
        { key: 'secondary_window', label: 'wk', percent: 55, resetsAt: '2026-09-25T11:35:50.000Z' },
      ],
    })
  })

  it('says there is no login rather than reporting nothing used', async () => {
    const { usage, codexCalls } = setup({ codexCredential: null })

    expect(codexOf(await usage.read())).toMatchObject({
      problem: 'unavailable',
      windows: [],
      reason: NO_CODEX_LOGIN,
    })
    expect(codexCalls()).toBe(0)
  })

  it('names the status when ChatGPT turns the login down, and says how to refresh it', async () => {
    const { usage } = setup({ codexAnswers: [{ status: 401, body: '{"detail":"invalid token"}' }] })

    const codex = codexOf(await usage.read())

    expect(codex).toMatchObject({ problem: 'unavailable', windows: [] })
    expect(codex.reason).toMatch(/401/)
    expect(codex.reason).toMatch(/codex/)
  })

  it('names the status when the call fails outright', async () => {
    const { usage } = setup({ codexAnswers: [{ status: 502, body: 'bad gateway' }] })

    expect(codexOf(await usage.read()).reason).toMatch(/502/)
  })

  it('reports a body it cannot read instead of guessing at it', async () => {
    const { usage } = setup({ codexAnswers: [{ status: 200, body: '<html>nope</html>' }] })

    expect(codexOf(await usage.read())).toMatchObject({ problem: 'unavailable', windows: [] })
  })

  it('keeps one Provider’s failure out of the other’s row', async () => {
    const { usage } = setup({ answers: [{ status: 500, body: 'boom' }] })

    const snapshot = await usage.read()

    expect(claudeOf(snapshot).problem).toBe('unavailable')
    expect(codexOf(snapshot).windows).toHaveLength(2)
  })
})

describe('reading Claude usage', () => {
  it('asks the OAuth usage endpoint with the subscription login and no API key', async () => {
    const { usage, requests } = setup()

    await usage.read()

    const asked = requests.find((request) => request.url === CLAUDE_USAGE_URL)!
    expect(asked.headers).toEqual(expect.objectContaining({ Authorization: 'Bearer oauth-token' }))
    expect(Object.keys(asked.headers)).not.toContain('x-api-key')
  })

  it('reports the parsed percentages and reset times, and stamps the read', async () => {
    const { usage } = setup()

    const snapshot = await usage.read()

    expect(snapshot.readAt).toBe('2026-09-18T08:40:00.000Z')
    expect(claudeOf(snapshot)).toEqual({
      id: 'claude',
      name: 'Claude',
      problem: null,
      reason: null,
      accounts: [],
      windows: [
        { key: 'five_hour', label: '5h', percent: 23, resetsAt: '2026-09-18T12:50:00.757Z' },
        { key: 'seven_day', label: 'wk', percent: 17, resetsAt: '2026-09-20T22:00:00.757Z' },
        { key: 'seven_day_opus', label: 'Opus', percent: 6, resetsAt: '2026-09-20T21:59:59.000Z' },
      ],
    })
  })

  it('lists the Providers TinyCorp is configured for, and says plainly when one is not', async () => {
    const snapshot = await setup().usage.read()

    expect(snapshot.providers.map((p) => p.id)).toEqual([...USAGE_PROVIDERS])
    // OpenCode is configured (T132), and holds no subscription of its own to read: whatever
    // account the boss signed it in with reports its limit in the Session.
    const opencode = snapshot.providers.find((p) => p.id === 'opencode')!
    expect(opencode).toMatchObject({ problem: 'not-connected', windows: [], name: 'OpenCode' })
    expect(opencode.reason).toBe(noUsageEndpoint('opencode'))
    // Never a zero standing in for an answer nobody has: a Provider that could not be read carries
    // no window at all. A window that really is at 0% is a different thing and stays — Codex's
    // 5-hour window in `CODEX_ANSWER` is one, read from a subscription with the window just reset.
    for (const provider of snapshot.providers) {
      if (provider.problem !== null) expect(provider.windows).toEqual([])
    }
  })

  it('names every Provider in the catalogue, in catalogue order, before the ones it cannot run', async () => {
    const snapshot = await setup().usage.read()

    expect(snapshot.providers.slice(0, PROVIDERS.length).map((p) => p.id)).toEqual([...PROVIDERS])
    expect(snapshot.providers.map((p) => p.name)).toEqual(USAGE_PROVIDERS.map((id) => PROVIDER_NAME[id]))
  })
})

describe('degrading honestly', () => {
  it('says there is no login rather than reporting nothing used', async () => {
    const { usage, calls } = setup({ credential: null })

    const claude = claudeOf(await usage.read())

    expect(claude).toMatchObject({ problem: 'unavailable', windows: [], reason: NO_CLAUDE_LOGIN })
    expect(calls()).toBe(0)
  })

  it('says the login expired before spending a call on it', async () => {
    const { usage, calls } = setup({
      credential: { accessToken: 'stale', expiresAt: Date.parse('2026-09-18T08:00:00Z') },
    })

    expect(claudeOf(await usage.read()).reason).toMatch(/expired/i)
    expect(calls()).toBe(0)
  })

  it('names the status when Claude turns the login down', async () => {
    const { usage } = setup({ answers: [{ status: 401, body: '{"error":"unauthorized"}' }] })

    const claude = claudeOf(await usage.read())

    expect(claude).toMatchObject({ problem: 'unavailable', windows: [] })
    expect(claude.reason).toMatch(/401/)
  })

  it('names the status when the call fails outright', async () => {
    const { usage } = setup({ answers: [{ status: 503, body: 'upstream down' }] })

    expect(claudeOf(await usage.read()).reason).toMatch(/503/)
  })

  it('reports a body it cannot read instead of guessing at it', async () => {
    const { usage } = setup({ answers: [{ status: 200, body: '<html>nope</html>' }] })

    const claude = claudeOf(await usage.read())

    expect(claude.problem).toBe('unavailable')
    expect(claude.windows).toEqual([])
  })

  it('reports a network failure as the reason', async () => {
    const usage = createProviderUsage({
      claudeCredential: async () => ({ login: LIVE, lookedIn: [] }),
      codexCredential: async () => ({ login: CODEX_LIVE, lookedIn: [] }),
      http: () => Promise.reject(new Error('getaddrinfo ENOTFOUND api.anthropic.com')),
      log: () => {},
    })

    expect(claudeOf(await usage.read()).reason).toMatch(/ENOTFOUND/)
  })
})

describe('the cache', () => {
  it('reuses one read for the whole TTL and asks again after it', async () => {
    let clock = Date.parse('2026-09-18T08:40:00Z')
    const { usage, calls } = setup({ now: () => clock })

    await usage.read()
    await usage.read()
    expect(calls()).toBe(1)

    clock += USAGE_TTL_MS - 1
    await usage.read()
    expect(calls()).toBe(1)

    clock += 1
    await usage.read()
    expect(calls()).toBe(2)
  })

  it('shares one call between reads that overlap', async () => {
    const { usage, calls } = setup()

    await Promise.all([usage.read(), usage.read(), usage.read()])

    expect(calls()).toBe(1)
  })

  it('asks again on refresh, however young the cache is', async () => {
    const { usage, calls } = setup()

    await usage.read()
    await usage.refresh()

    expect(calls()).toBe(2)
  })

  it('asks again after a Session reports the limit', async () => {
    const { usage, calls } = setup()

    await usage.read()
    usage.invalidate()
    await usage.read()

    expect(calls()).toBe(2)
  })

  it('tells its listeners each time fresh numbers land', async () => {
    const changed = vi.fn()
    const { usage } = setup()
    const stop = usage.onChange(changed)

    await usage.read()
    await usage.read()
    await usage.refresh()
    stop()
    await usage.refresh()

    expect(changed).toHaveBeenCalledTimes(2)
  })
})

describe('the credential', () => {
  it('reads the OAuth token the boss’s Claude Code login stored, never an API key', async () => {
    const stored = JSON.stringify({
      claudeAiOauth: { accessToken: 'oauth-token', expiresAt: 1789000000000, subscriptionType: 'max' },
    })

    expect(await claudeCredentialIn(async () => stored)).toEqual({
      accessToken: 'oauth-token',
      expiresAt: 1789000000000,
      plan: 'Max',
    })
  })

  it('is absent when the keychain holds nothing, or holds no OAuth token', async () => {
    expect(
      await claudeCredentialIn(() => Promise.reject(new Error('The specified item could not be found'))),
    ).toBeNull()
    expect(await claudeCredentialIn(async () => '')).toBeNull()
    expect(await claudeCredentialIn(async () => JSON.stringify({ apiKey: 'sk-ant-api03-secret' }))).toBeNull()
  })
})

describe('the Codex credential', () => {
  it('reads the token `codex login` stored, with the workspace it is for', async () => {
    const stored = JSON.stringify({
      auth_mode: 'chatgpt',
      OPENAI_API_KEY: null,
      tokens: { id_token: 'jwt', access_token: 'chatgpt-token', refresh_token: 'refresh', account_id: 'workspace-1' },
      last_refresh: '2026-09-19T12:56:00.000Z',
    })

    expect(await codexCredentialIn(async () => stored)).toEqual({
      accessToken: 'chatgpt-token',
      accountId: 'workspace-1',
    })
  })

  it('never takes the API key that sits in the same file', async () => {
    const stored = JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-secret', tokens: null })

    expect(await codexCredentialIn(async () => stored)).toBeNull()
  })

  it('is absent when there is no file, an unreadable one, or no token in it', async () => {
    expect(await codexCredentialIn(() => Promise.reject(new Error('ENOENT: no such file')))).toBeNull()
    expect(await codexCredentialIn(async () => '')).toBeNull()
    expect(await codexCredentialIn(async () => 'not json')).toBeNull()
    expect(await codexCredentialIn(async () => JSON.stringify({ tokens: { access_token: '' } }))).toBeNull()
  })
})

/** The boss's two sign-ins of Claude Code, each its own config folder (T173, T257). */
const PERSONAL: UsageAccountRef = { id: 'primary:claude', configDir: null, primary: true }
const WORK: UsageAccountRef = { id: 'work', configDir: onDisk('/data/accounts/claude/work'), primary: false }

/** The same body with the week at another percentage, so the two accounts cannot be confused. */
const WORK_ANSWER = JSON.stringify({
  five_hour: { utilization: 41, resets_at: '2026-09-18T09:42:00.000000+00:00' },
  seven_day: { utilization: 22, resets_at: '2026-09-20T22:00:00.000000+00:00' },
})

describe('a Provider the boss has signed into more than once', () => {
  it('reads every account from its own config folder, and keeps the default folder’s as its own', async () => {
    const { usage, requests } = setup({
      accounts: [PERSONAL, WORK],
      loginOf: (account) => ({ accessToken: account?.configDir ? 'work-token' : 'personal-token', expiresAt: null }),
      answers: [
        { status: 200, body: ANSWER },
        { status: 200, body: WORK_ANSWER },
      ],
    })

    const claude = claudeOf(await usage.read())

    expect(claude.accounts.map((account) => account.id)).toEqual(['primary:claude', 'work'])
    expect(claude.accounts[0]!.windows.map((window) => window.percent)).toEqual([23, 17, 6])
    expect(claude.accounts[1]!.windows.map((window) => window.percent)).toEqual([41, 22])
    // The Provider's own numbers — what the drawer's meter reads — stay the default folder's.
    expect(claude.windows.map((window) => window.percent)).toEqual([23, 17, 6])
    expect(
      requests.filter((request) => request.url === CLAUDE_USAGE_URL).map((request) => request.headers['Authorization']),
    ).toEqual(['Bearer personal-token', 'Bearer work-token'])
  })

  it('says which sign-in could not be read, and where TinyCorp looked, without blanking the others', async () => {
    const { usage } = setup({
      accounts: [PERSONAL, WORK],
      lookedIn: ['C:\\Users\\b\\.claude\\.credentials.json'],
      loginOf: (account) => (account?.configDir ? null : LIVE),
    })

    const claude = claudeOf(await usage.read())

    expect(claude.accounts[0]).toMatchObject({ problem: null })
    expect(claude.accounts[1]).toMatchObject({
      problem: 'unavailable',
      windows: [],
      reason: `${NO_CLAUDE_LOGIN}. Looked in: C:\\Users\\b\\.claude\\.credentials.json`,
    })
  })

  it('reads one login, and reports no accounts at all, where the boss has one sign-in', async () => {
    const { usage, calls } = setup({ accounts: [PERSONAL] })

    const claude = claudeOf(await usage.read())

    expect(claude.accounts).toEqual([])
    expect(calls()).toBe(1)
  })
})

describe('saying where it looked', () => {
  it('names the place behind the sentence, the way the preflight’s own line does', async () => {
    const { usage } = setup({ credential: null, lookedIn: ['/home/b/.claude/.credentials.json'] })

    expect(claudeOf(await usage.read()).reason).toBe(`${NO_CLAUDE_LOGIN}. Looked in: /home/b/.claude/.credentials.json`)
  })

  it('names every home it looked in inside a distro', async () => {
    const { usage } = setup({
      credential: null,
      lookedIn: [
        '\\\\wsl.localhost\\Ubuntu\\home\\b\\.claude\\.credentials.json',
        '\\\\wsl.localhost\\Ubuntu\\home\\c\\.claude\\.credentials.json',
      ],
    })

    expect(claudeOf(await usage.read()).reason).toContain(' · ')
  })

  it('says only the sentence where there was nowhere to name', async () => {
    const { usage } = setup({ credential: null })

    expect(claudeOf(await usage.read()).reason).toBe(NO_CLAUDE_LOGIN)
  })
})

describe('the plan a Claude login names (T263)', () => {
  it('reads the tier’s multiple beside the plan, and the plan alone where there is none', () => {
    expect(claudePlan('max', 'default_claude_max_20x')).toBe('Max 20×')
    expect(claudePlan('pro', 'default_claude_pro')).toBe('Pro')
    expect(claudePlan(undefined, 'default_claude_max_5x')).toBeNull()
  })
})
