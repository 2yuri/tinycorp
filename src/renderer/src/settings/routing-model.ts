import type { ProviderOutage } from '../../../shared/capacity'
import { PROVIDER_LABEL, PROVIDER_SHORT_NAME, type Provider } from '../../../shared/domain/providers'
import type { RoutingSettings } from '../../../shared/ipc'
import { type AccountRow, accountPercent, type ProviderAccount } from '../../../shared/usage/provider-accounts'
import type { UsageSnapshot, UsageWindow } from '../../../shared/usage/provider-usage'
import { type OutOfProviderRule, overrideSummary, ruleFor } from '../../../shared/usage/usage-routing'

/** The Provider a row is about, in the short name the frame uses. */
export function shortName(provider: string): string {
  return PROVIDER_SHORT_NAME[provider as Provider] ?? provider
}

/**
 * The heading over one Provider's sign-ins. Frame `bB6VX` writes it as the product's own full name
 * in capitals, not the short one — {@link whenOutLabel} keeps the short name, because a rule reads
 * as a sentence and a heading does not.
 */
export function accountsLabel(provider: string): string {
  return (PROVIDER_LABEL[provider as Provider] ?? provider).toUpperCase()
}

/**
 * The Accounts card's line, which names the Company rather than saying `this Company` — the one
 * thing a boss with four of them cannot read off the page (frame `bB6VX`).
 */
export function accountsSub(companyName: string): string {
  return (
    'Each account is its own sign-in, added in Your profile. Employees take the first one with ' +
    `room left — pin one to keep ${companyName} on it.`
  )
}

/**
 * An account in the words every line on this tab names it: the label, and the plan that tells two
 * sign-ins of one product apart when both are called `Work` (T196).
 */
export function accountName(account: { label: string; plan: string | null }): string {
  return account.plan ? `${account.label} · ${account.plan}` : account.label
}

/** What a Provider with no pin does, beside its sign-ins (frame `bB6VX`). */
export const FIRST_WITH_ROOM = 'First with room left'

/**
 * What a Provider's head says is in force on its right (frame `bB6VX`): the account the whole
 * Company runs on, or — with no pin — that its Employees take whichever one still has room.
 */
export function ruleInForce(pinned: { label: string; plan: string | null } | null): string {
  return pinned ? `Pinned · ${accountName(pinned)}` : FIRST_WITH_ROOM
}

/** What the pin at the end of an account row promises, and what it says once it is the one in force. */
export function pinTitle(companyName: string, pinned: boolean): string {
  return pinned
    ? `Pinned — every Employee in ${companyName} takes this sign-in. Click to unpin.`
    : `Pin ${companyName} to this sign-in.`
}

/** `WHEN <PROVIDER> IS OUT`, the heading of one Provider's block (frame `bB6VX`). */
export function whenOutLabel(provider: string): string {
  return `WHEN ${shortName(provider).toUpperCase()} IS OUT`
}

/** `Move back when <Provider> resets`. */
export function moveBackLabel(provider: string): string {
  return `Move back when ${shortName(provider)} resets`
}

/** The rule a Provider's block draws, with the Company's default of Wait for reset. */
export function ruleOf(settings: RoutingSettings, provider: string): OutOfProviderRule {
  return ruleFor(settings.routing, null, provider)
}

/** One Provider's accounts with their numbers, as the Accounts card and the popover draw them. */
export function accountRows(
  accounts: ProviderAccount[],
  usage: UsageSnapshot | null,
  outages: readonly ProviderOutage[],
): AccountRow[] {
  return accounts.map((account) => {
    const read = usage?.providers.find((entry) => entry.id === account.provider) ?? null
    const outage = outages.find((entry) => entry.provider === account.provider) ?? null
    const outOfBudget = outage !== null && (outage.accountId === null || outage.accountId === account.id)
    // Every sign-in is read from its own config folder (T257), so every one of them has numbers of
    // its own. A Provider with a single sign-in reports no account rows at all, and that one row is
    // the Provider's own read — which is the same login.
    const own = read?.accounts.find((entry) => entry.id === account.id) ?? null
    const mine = own ?? (read && read.accounts.length === 0 && account.primary ? read : null)
    return {
      ...account,
      window: shortestWindow(mine?.windows ?? []),
      outOfBudget,
      reason: mine ? mine.reason : accountNotRead(account.provider),
    }
  })
}

/** Why an account has no bar at all: nothing was read for it, not even a reason. */
export function accountNotRead(provider: string): string {
  return `${shortName(provider)} reported nothing for this account`
}

/** The window a row's bar draws: the shortest one the Provider reported, or null. */
export function shortestWindow(windows: UsageWindow[]): UsageWindow | null {
  return windows[0] ?? null
}

/**
 * `68% · resets 21:00` (frames `bB6VX` and `A2lOk0`), or {@link NOT_READ} under an empty track.
 * Never a zero: a number nobody measured would read as an account with all of its week left.
 */
export function accountMeter(row: AccountRow, clock: (at: Date) => string): string {
  const percent = accountPercent(row)
  if (percent === null) return NOT_READ
  const resets = row.window?.resetsAt ? ` · resets ${clock(new Date(row.window.resetsAt))}` : ''
  return `${percent}%${resets}`
}

/** What a meter says in place of a percentage; the row's title says which sign-in it is about. */
export const NOT_READ = 'usage not read'

/** The Overrides list, in the words frame `bB6VX` writes them. */
export function overrideLines(settings: RoutingSettings): { employeeId: string; name: string; summary: string }[] {
  return settings.overrides.map((override) => ({
    employeeId: override.employeeId,
    name: override.name,
    summary: overrideSummary(override.routing, {
      provider: shortName,
      // `Pinned to Work · Team`, as the frame writes it: the label alone is ambiguous the moment
      // two sign-ins of the same product are called the same thing.
      account: (id) => {
        const account = settings.accounts.find((entry) => entry.id === id)
        return account ? accountName(account) : null
      },
    }),
  }))
}

/**
 * `Applies to every Employee in Tiny Corp.` — the frame names the Company rather than saying
 * `this Company`, which is the one thing a boss with four of them cannot read off the page.
 */
export function runsOutSub(companyName: string): string {
  return `Applies to every Employee in ${companyName}. An Employee can override it from its drawer.`
}

/**
 * What rotation would do, in the accounts it would do it between: the frame writes
 * `When Personal runs out, move to Work instead of waiting or switching provider.`
 *
 * Two named accounts of one Provider is the only case the setting has anything to rotate through,
 * so it is the only case that names them; with fewer, the line stays the general one.
 */
export function rotationSub(accounts: readonly ProviderAccount[]): string {
  const tail = 'instead of waiting or switching provider.'
  const pair = firstPair(accounts)
  if (pair === null) return `When one runs out, move to the next ${tail}`
  return `When ${pair[0].label} runs out, move to ${pair[1].label} ${tail}`
}

/** The first Provider with two sign-ins, as its first two accounts — the pair rotation would use. */
function firstPair(accounts: readonly ProviderAccount[]): [ProviderAccount, ProviderAccount] | null {
  for (const account of accounts) {
    const mate = accounts.find((other) => other.provider === account.provider && other.id !== account.id)
    if (mate) return [account, mate]
  }
  return null
}

/** The subtitle of the tab, which says what the page is for. */
export function routingSubtitle(companyName: string): string {
  return `How ${companyName}’s Employees share your subscriptions, and what they do when one runs out.`
}
