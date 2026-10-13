import { describe, expect, it } from 'vitest'
import { PROVIDER_COMMAND, PROVIDER_LABEL, PROVIDERS, type Provider } from '../../../shared/domain/providers'
import type { RoutingSettings } from '../../../shared/ipc'
import type { ProviderPlacement } from '../../../shared/platform/wsl'
import type { PreflightState, ProviderPreflight } from '../../../shared/providers/preflight'
import type { ProviderAccount } from '../../../shared/usage/provider-accounts'
import type { UsageSnapshot } from '../../../shared/usage/provider-usage'
import { accountsLine, CHECKING_BADGE, providerRows, usedSuffix } from './providers-card'

const NOW = new Date('2026-09-22T12:00:00.000Z')

/** The catalogue's Providers, so nothing here names a product. */
const [first, second] = PROVIDERS
const last = PROVIDERS.at(-1)!

/** One Provider's answer, as its own adapter writes it. */
function check(provider: Provider, state: PreflightState, over: Partial<ProviderPreflight> = {}): ProviderPreflight {
  return {
    provider,
    state,
    title: '',
    body: '',
    lead: '',
    commands: [`${PROVIDER_COMMAND[provider]} login`, `${PROVIDER_COMMAND[provider]} status`],
    note: '',
    account: null,
    plan: null,
    checkedAt: NOW.toISOString(),
    hired: false,
    ...over,
  }
}

/** What the Providers reported of the subscription, as the usage query answers it. */
function usage(over: Partial<Record<Provider, UsageSnapshot['providers'][number]>> = {}): UsageSnapshot {
  return { providers: PROVIDERS.flatMap((id) => (over[id] ? [over[id]!] : [])), readAt: NOW.toISOString() }
}

/** One Provider's window, at a percentage, as its own endpoint answers. */
function reported(id: Provider, percent: number): UsageSnapshot['providers'][number] {
  return {
    id,
    name: PROVIDER_LABEL[id],
    windows: [{ key: 'five_hour', label: '5h', percent, resetsAt: new Date(NOW.getTime() + 7_200_000).toISOString() }],
    problem: null,
    reason: null,
    accounts: [],
  }
}

const NOTHING = usage()

/** One sign-in of one Provider, as the engine stores it. */
function account(provider: Provider, over: Partial<ProviderAccount> = {}): ProviderAccount {
  return {
    id: `acc-${over.label ?? 'personal'}`,
    provider,
    label: 'Personal',
    plan: null,
    email: 'boss@example.com',
    configDir: '/config',
    isDefault: true,
    primary: true,
    ...over,
  }
}

/** The boss's sign-ins, with every Provider but the first keeping one of its own. */
function signIns(accounts: ProviderAccount[]): RoutingSettings {
  return {
    routing: { rules: {}, moveBack: {}, resumeAtReset: true, rotateAccounts: false, pinnedAccount: {} },
    overrides: [],
    accounts,
    oneAccountProviders: PROVIDERS.slice(1),
  }
}

describe('the Providers card', () => {
  it('draws a box for every Provider in the catalogue, hired here or not', () => {
    // The card is about this machine: a Provider nobody in this Company runs on is still a fact of it.
    const rows = providerRows([check(first!, 'ready')], NOTHING)

    expect(rows.map((row) => row.id)).toEqual([...PROVIDERS])
    for (const row of rows) expect(row.title).toContain(PROVIDER_LABEL[row.id])
  })

  it('gives each state its own badge', () => {
    const rows = providerRows([check(first!, 'ready'), check(second!, 'signed-out'), check(last, 'missing')], NOTHING)

    expect(rows.map((row) => [row.badge, row.tone])).toEqual([
      ['Connected', 'ok'],
      ['Signed out', 'off'],
      ['Not installed', 'off'],
    ])
    expect(rows.map((row) => row.idle)).toEqual([false, true, true])
  })

  it('says it is still asking rather than claiming a state nobody checked', () => {
    const rows = providerRows(null, NOTHING)

    expect(rows.map((row) => row.badge)).toEqual(PROVIDERS.map(() => CHECKING_BADGE))
    expect(rows.every((row) => row.detail === '' && row.accounts === null)).toBe(true)
  })

  it('names the account and the plan the CLI reported', () => {
    const signedIn = check(first!, 'ready', { account: 'boss@example.com', plan: 'Max' })

    const [row] = providerRows([signedIn], NOTHING)

    expect(row!.title).toBe(`${PROVIDER_LABEL[first!]} · Max`)
    expect(row!.detail).toBe('boss@example.com')
    expect(row!.detailIsAddress).toBe(true)
  })

  it('shows the state alone where the CLI will not name an account, never an empty line', () => {
    const rows = providerRows([check(first!, 'ready'), check(second!, 'signed-out'), check(last, 'missing')], NOTHING)

    // Signed in and saying nothing about who: the badge is the whole answer.
    expect(rows[0]!.detail).toBe('')
    expect(rows[0]!.title).toBe(PROVIDER_LABEL[first!])
    // Not signed in, and not installed: the CLI's own words for what to do about it.
    expect(rows[1]!.detail).toBe(`${PROVIDER_COMMAND[second!]} login`)
    expect(rows[2]!.detail).toBe(`${PROVIDER_COMMAND[last]} is not installed`)
  })

  it('adds what a Provider with one sign-in has spent to the address under its name', () => {
    const rows = providerRows(
      [check(second!, 'ready', { account: 'boss@example.com' })],
      usage({ [second!]: reported(second!, 22) }),
      signIns([]),
    )

    expect(rows[1]!.detail).toBe(`boss@example.com · ${usedSuffix(22)}`)
    expect(rows[1]!.detailNote).toBe('')
  })

  it('says why a connected Provider has no numbers rather than drawing a percentage nobody read', () => {
    const rows = providerRows(
      [check(second!, 'ready', { account: 'boss@example.com' })],
      usage({
        [second!]: {
          id: second!,
          name: PROVIDER_LABEL[second!],
          windows: [],
          problem: 'not-connected',
          reason: 'it reports its limit in the Session',
        },
      }),
      signIns([]),
    )

    expect(rows[1]!.detail).toBe('boss@example.com')
    expect(rows[1]!.detailNote).toBe('it reports its limit in the Session')
  })
})

/**
 * The sign-ins a CLI holds (frames `Oykzs`, `A2lOk0`). A CLI with a config directory of its own
 * can hold several, and each one is a row with its own bar; one without holds the one it has.
 */
describe("a Provider's sign-ins", () => {
  it('lists them under the Provider whose CLI can hold more than one', () => {
    const rows = providerRows(
      [check(first!, 'ready', { plan: 'Max' })],
      usage({ [first!]: reported(first!, 15) }),
      signIns([
        account(first!, { label: 'Personal', plan: 'Max 20×' }),
        account(first!, { label: 'Work', plan: 'Team', isDefault: false, primary: false }),
      ]),
    )

    // The plan belongs to a sign-in here, so the head carries the product alone.
    expect(rows[0]!.title).toBe(PROVIDER_LABEL[first!])
    expect(rows[0]!.detail).toBe(accountsLine(2))
    expect(rows[0]!.detailIsAddress).toBe(false)
    expect(rows[0]!.accounts?.map((row) => [row.label, row.window?.percent ?? null])).toEqual([
      // The numbers TinyCorp can read are the ones its own sign-in reports; the other's would mean
      // reading that account's credential, which never happens.
      ['Personal', 15],
      ['Work', null],
    ])
  })

  it('lists none for a CLI that keeps one sign-in and has no directory to point another at', () => {
    const rows = providerRows([check(second!, 'ready')], NOTHING, signIns([]))

    expect(rows[1]!.accounts).toBeNull()
  })

  it('lists none at all until the sign-ins have crossed the bridge', () => {
    expect(providerRows([check(first!, 'ready')], NOTHING)[0]!.accounts).toBeNull()
  })
})

/**
 * Where a Provider runs (T167). The chip says it only on a machine that really has two answers: on
 * a Mac, and on a Windows with no WSL, `Windows` would tell the boss nothing at all.
 */
describe('where a Provider runs', () => {
  function placed(over: Partial<ProviderPlacement>): ProviderPreflight {
    return check(first!, 'ready', {
      placement: {
        windows: false,
        distros: [],
        stopped: [],
        chosen: null,
        missingAt: null,
        lookedIn: ['Windows PATH', 'WSL: Ubuntu'],
        reach: 'untested',
        ...over,
      },
    })
  }

  it('says nothing on a machine with one place', () => {
    expect(providerRows([check(first!, 'ready')], NOTHING)[0]!.runsIn).toBeNull()
    const windowsOnly = check(first!, 'ready', {
      placement: {
        windows: true,
        distros: [],
        stopped: [],
        chosen: { kind: 'windows' },
        missingAt: null,
        lookedIn: [],
        reach: 'untested',
      },
    })
    expect(providerRows([windowsOnly], NOTHING)[0]!.runsIn).toBeNull()
  })

  it('draws the chosen place first and offers the other when the CLI is in both', () => {
    const row = providerRows(
      [placed({ windows: true, distros: ['Ubuntu'], chosen: { kind: 'wsl', distro: 'Ubuntu' } })],
      NOTHING,
    )[0]!
    expect(row.runsIn).toMatchObject({
      choosable: true,
      options: [
        { key: 'wsl:Ubuntu', label: 'WSL · Ubuntu', selected: true },
        { key: 'windows', label: 'Windows', selected: false },
      ],
    })
    expect(row.runsIn!.help).toContain('a running one keeps its place')
  })

  it('is a chip, not a choice, when the CLI is in one place of two', () => {
    const row = providerRows([placed({ distros: ['Ubuntu'], chosen: { kind: 'wsl', distro: 'Ubuntu' } })], NOTHING)[0]!
    expect(row.runsIn).toMatchObject({ choosable: false, help: '', options: [{ label: 'WSL · Ubuntu' }] })
  })

  /**
   * The row the preflight card sends the boss to (T258). Their own answer names a place the CLI is
   * not in: nothing is selected, the note says which place is empty, and the places the CLI really is
   * are pressable — which is the whole fix, and the reason the row has to be drawn at all.
   */
  it('draws the places the CLI is in, with none selected, when the chosen one is empty', () => {
    const row = providerRows(
      [placed({ windows: true, distros: [], chosen: null, missingAt: { kind: 'wsl', distro: 'Arch' } })],
      NOTHING,
    )[0]!
    expect(row.runsIn).toMatchObject({
      choosable: true,
      options: [{ key: 'windows', label: 'Windows', selected: false }],
    })
    expect(row.runsIn!.note).toBe('Not installed in WSL · Arch — pick a place below, or install it there.')
  })

  it('says nothing at all when the CLI is in no place either', () => {
    const row = providerRows([placed({ chosen: null, missingAt: { kind: 'wsl', distro: 'Arch' } })], NOTHING)[0]!
    expect(row.runsIn, 'there is nothing to pick; the card says to install it').toBeNull()
  })

  it('says a distro that is asleep will be woken by the first Session', () => {
    const row = providerRows(
      [placed({ distros: ['Ubuntu'], stopped: ['Ubuntu'], chosen: { kind: 'wsl', distro: 'Ubuntu' } })],
      NOTHING,
    )[0]!
    expect(row.runsIn!.note).toBe('WSL · Ubuntu is stopped — it starts when a Session does.')
  })

  it('says the firewall first, because a Session that cannot reach TinyCorp is broken and not slow', () => {
    const row = providerRows(
      [
        placed({
          distros: ['Ubuntu'],
          stopped: ['Ubuntu'],
          chosen: { kind: 'wsl', distro: 'Ubuntu' },
          missingAt: null,
          reach: 'blocked',
        }),
      ],
      NOTHING,
    )[0]!
    expect(row.runsIn!.note).toContain('Windows Firewall')
  })

  it('says nothing extra about a Provider that runs on Windows', () => {
    const row = providerRows([placed({ windows: true, distros: ['Ubuntu'], chosen: { kind: 'windows' } })], NOTHING)[0]!
    expect(row.runsIn!.note).toBe('')
  })
})
