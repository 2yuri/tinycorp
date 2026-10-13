import { describe, expect, it } from 'vitest'
import type { ProviderAccount } from '../../../shared/usage/provider-accounts'
import { notConnected, type ProviderUsage, type UsageSnapshot } from '../../../shared/usage/provider-usage'
import { NOT_READ } from '../settings'
import { PLACE_MAX, providerRow, resetsIn, shortReason, USAGE_UNAVAILABLE, usageView } from './usage-model'

const NOW = new Date('2026-09-18T08:40:00Z')

const claude: ProviderUsage = {
  id: 'claude',
  name: 'Claude',
  problem: null,
  reason: null,
  accounts: [],
  windows: [
    { key: 'five_hour', label: '5h', percent: 6, resetsAt: '2026-09-18T12:50:00Z' },
    { key: 'seven_day', label: 'wk', percent: 15, resetsAt: '2026-09-20T22:00:00Z' },
    { key: 'seven_day_opus', label: 'Opus', percent: 6, resetsAt: '2026-09-20T22:00:00Z' },
  ],
}

const snapshot = (providers: ProviderUsage[]): UsageSnapshot => ({ providers, readAt: NOW.toISOString() })

describe('resetsIn', () => {
  it('counts down to the window that rolls over soonest', () => {
    expect(resetsIn(claude.windows, NOW)).toBe('Resets in 4h 10m')
  })

  it('ignores a window that has already rolled over, and names no time when none is left', () => {
    const past = { key: 'five_hour', label: '5h', percent: 0, resetsAt: '2026-09-18T08:00:00Z' }

    expect(resetsIn([past, claude.windows[1]!], NOW)).toBe('Resets in 2d 13h')
    expect(resetsIn([past], NOW)).toBe('')
    expect(resetsIn([{ ...past, resetsAt: null }], NOW)).toBe('')
  })
})

describe('a Provider’s row', () => {
  it('carries its meters and the countdown to its next reset', () => {
    expect(providerRow(claude, NOW)).toEqual({
      id: 'claude',
      name: 'Claude',
      kind: 'ready',
      note: 'Resets in 4h 10m',
      reason: null,
      accounts: [],
      meters: [
        { label: '5h', percent: 6, value: '6%' },
        { label: 'wk', percent: 15, value: '15%' },
        { label: 'Opus', percent: 6, value: '6%' },
      ],
    })
  })

  it('reads `Not connected` for a Provider TinyCorp has no source for', () => {
    expect(providerRow(notConnected('opencode', 'no source yet'), NOW)).toMatchObject({
      name: 'OpenCode',
      kind: 'not-connected',
      note: 'Not connected',
      reason: 'no source yet',
      meters: [],
    })
  })

  it('carries the reason a Provider could not be read, and never a zero meter', () => {
    const failed: ProviderUsage = {
      ...claude,
      windows: [],
      problem: 'unavailable',
      reason: 'Claude answered HTTP 500',
    }

    expect(providerRow(failed, NOW)).toMatchObject({
      kind: 'unavailable',
      note: 'Claude answered HTTP 500',
      meters: [],
    })
  })

  it('falls back to the plain sentence when a failure named no reason', () => {
    const failed: ProviderUsage = { ...claude, windows: [], problem: 'unavailable', reason: null }

    expect(providerRow(failed, NOW).note).toBe(USAGE_UNAVAILABLE)
  })
})

describe('what the drawer button shows', () => {
  it('carries the highest meter any Provider reported — the one closest to parking Employees', () => {
    const view = usageView(snapshot([claude, notConnected('codex', 'none')]), NOW)

    expect(view).toMatchObject({ percent: 15, value: '15%', known: true })
    expect(view.label).toBe('Usage — 15% used')
  })

  it('shows a dash, not a zero, while no Provider has numbers', () => {
    const view = usageView(snapshot([notConnected('codex', 'none')]), NOW)

    expect(view).toMatchObject({ percent: null, value: '—', known: false })
    expect(view.label).toMatch(/unavailable/i)
  })

  it('is blank before the first read lands', () => {
    expect(usageView({ providers: [], readAt: null }, NOW)).toMatchObject({ percent: null, rows: [] })
  })
})

/** Two sign-ins of one Provider, as the boss's profile keeps them (T173, frame `nV8jR`). */
const account = (over: Partial<ProviderAccount>): ProviderAccount => ({
  id: 'primary:claude',
  provider: 'claude',
  label: 'Personal',
  plan: 'Max 20×',
  email: null,
  configDir: '/home/boss/.claude',
  isDefault: true,
  primary: true,
  ...over,
})

const PERSONAL = account({})
const WORK = account({ id: 'work', label: 'Work', plan: 'Team', isDefault: false, primary: false })

const WORK_WINDOWS = [
  { key: 'five_hour', label: '5h', percent: 41, resetsAt: '2026-09-18T09:42:00Z' },
  { key: 'seven_day', label: 'wk', percent: 22, resetsAt: '2026-09-20T22:00:00Z' },
]

const twoAccounts: ProviderUsage = {
  ...claude,
  accounts: [
    { id: PERSONAL.id, windows: claude.windows, problem: null, reason: null },
    { id: WORK.id, windows: WORK_WINDOWS, problem: null, reason: null },
  ],
}

describe('a Provider the boss has signed into more than once', () => {
  it('draws a row per sign-in, each with its own numbers and its own reset', () => {
    const row = providerRow(twoAccounts, NOW, [PERSONAL, WORK])

    expect(row.note).toBe('2 accounts')
    expect(row.accounts).toEqual([
      {
        id: PERSONAL.id,
        label: 'Personal · Max 20×',
        isDefault: true,
        note: 'Resets in 4h 10m',
        reason: null,
        meters: [
          { label: '5h', percent: 6, value: '6%' },
          { label: 'wk', percent: 15, value: '15%' },
          { label: 'Opus', percent: 6, value: '6%' },
        ],
      },
      {
        id: WORK.id,
        label: 'Work · Team',
        isDefault: false,
        note: 'Resets in 1h 2m',
        reason: null,
        meters: [
          { label: '5h', percent: 41, value: '41%' },
          { label: 'wk', percent: 22, value: '22%' },
        ],
      },
    ])
  })

  it('says a sign-in was not read, and where TinyCorp looked, rather than drawing it at zero', () => {
    const unread =
      'No Claude Code login found — sign in by running `claude`. Looked in: /home/boss/.claude/.credentials.json'
    const row = providerRow(
      {
        ...twoAccounts,
        accounts: [twoAccounts.accounts[0]!, { id: WORK.id, windows: [], problem: 'unavailable', reason: unread }],
      },
      NOW,
      [PERSONAL, WORK],
    )

    expect(row.kind).toBe('ready')
    expect(row.accounts[1]).toMatchObject({ note: NOT_READ, reason: unread, meters: [] })
  })

  it('keeps today’s single row for a Provider with one sign-in', () => {
    expect(providerRow(claude, NOW, [PERSONAL])).toMatchObject({ note: 'Resets in 4h 10m', accounts: [] })
  })

  it('leaves the drawer’s meter on the Provider’s own default sign-in', () => {
    const view = usageView(snapshot([twoAccounts]), NOW, [PERSONAL, WORK])

    // 41% is the Work account's; the button reads what a Session nothing pins would spend.
    expect(view).toMatchObject({ percent: 15, value: '15%' })
  })
})

describe('the reason line', () => {
  const sentence = 'No Claude Code login found — sign in by running `claude`'

  it('names a login in a distro by its folder and the distro it is in', () => {
    const unc = `${sentence}. Looked in: \\\\wsl.localhost\\archlinux\\home\\boss\\.claude\\.credentials.json`
    expect(shortReason(unc)).toBe(`${sentence}. Looked in: ~/.claude in WSL · archlinux`)
  })

  it('names a Windows or a POSIX login by its folder', () => {
    expect(shortReason(`${sentence}. Looked in: C:\\Users\\you\\.claude\\.credentials.json`)).toBe(
      `${sentence}. Looked in: C:\\Users\\you\\.claude`,
    )
    expect(shortReason(`${sentence}. Looked in: /home/boss/.claude/.credentials.json`)).toBe(
      `${sentence}. Looked in: ~/.claude`,
    )
  })

  it('shortens every place it looked, and leaves a keychain as it is', () => {
    const two = `${sentence}. Looked in: the login keychain (Claude Code-credentials) · /Users/b/.claude/.credentials.json`
    expect(shortReason(two)).toBe(`${sentence}. Looked in: the login keychain (Claude Code-credentials) · ~/.claude`)
  })

  it('cuts a place that is still too long in the middle, keeping both ends', () => {
    const deep = `D:\\${'very-long-folder\\'.repeat(6)}claude-config\\.credentials.json`
    const place = shortReason(`${sentence}. Looked in: ${deep}`).split('Looked in: ')[1] ?? ''
    expect(place).toHaveLength(PLACE_MAX)
    expect(place).toMatch(/^D:\\very-long.*….*claude-config$/)
  })

  it('leaves a reason that names no place alone', () => {
    expect(shortReason('The Claude Code login has expired')).toBe('The Claude Code login has expired')
  })
})
