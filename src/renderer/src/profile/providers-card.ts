import { PROVIDER_COMMAND, PROVIDER_LABEL, PROVIDERS, type Provider } from '../../../shared/domain/providers'
import type { RoutingSettings } from '../../../shared/ipc'
import {
  hasRuntimeChoice,
  notInstalledThereNote,
  PROVIDER_RUNTIME_HELP,
  type ProviderPlacement,
  RUNS_IN_BOTH_HELP,
  runtimeChoices,
  runtimeKey,
  runtimeLabel,
  sameRuntime,
  stoppedDistroNote,
  WSL_BLOCKED_NOTE,
} from '../../../shared/platform/wsl'
import type { PreflightState, ProviderPreflight } from '../../../shared/providers/preflight'
import type { AccountRow } from '../../../shared/usage/provider-accounts'
import type { UsageSnapshot } from '../../../shared/usage/provider-usage'
import { accountRows, shortestWindow } from '../settings'

/**
 * The Providers card of Your profile (frames `Oykzs` and `A2lOk0`, T203a).
 *
 * Which CLI is installed and which logins it holds is a fact about this machine and this person:
 * every Company on it gets the same answer, and nothing about it can be set per Company. So the
 * card lists **every Provider the catalogue knows**, hired here or not, and reads each one's state
 * off the preflight the main process already asked for — never off a subprocess of its own.
 *
 * A Provider whose CLI can hold more than one sign-in draws a box of its accounts, each with its
 * own bar; one that keeps a single sign-in draws the address, and whatever it reports of the
 * subscription, on the line under its name. Nothing in this file names a product: the names come
 * from the catalogue, the account and the plan from the Provider's own CLI by way of its adapter,
 * and the numbers from the usage query.
 */

/** The card's title and the line under it. */
export const PROVIDERS_CARD_TITLE = 'Providers'
export const PROVIDERS_CARD_SUB = 'Every Employee runs on your own login — never an API key.'

/** What a Provider nobody has asked about yet says, until the first answers land. */
export const CHECKING_BADGE = 'Checking…'

/** How loud a row is: signed in, signed in on something that will be billed, or not running. */
export type ProviderTone = 'ok' | 'warn' | 'off'

/** The badge each state carries, and the tone it is drawn in. */
const BADGES: Record<PreflightState, { badge: string; tone: ProviderTone }> = {
  ready: { badge: 'Connected', tone: 'ok' },
  // Signed in, and on something that is billed per token rather than on the subscription.
  warning: { badge: 'API key', tone: 'warn' },
  'signed-out': { badge: 'Signed out', tone: 'off' },
  missing: { badge: 'Not installed', tone: 'off' },
}

/** `2 accounts · each its own sign-in`, the line over a Provider's list of sign-ins (`Oykzs`). */
export function accountsLine(count: number): string {
  return `${count} accounts · each its own sign-in`
}

/** `· 22% used`, what a Provider with one sign-in adds to its address (`A2lOk0`). */
export function usedSuffix(percent: number): string {
  return `${percent}% used`
}

export interface ProviderRowView {
  id: Provider
  /**
   * The product, and the plan its CLI named after a middot. A Provider whose sign-ins are listed
   * under it carries the product alone: there the plan belongs to an account, not to the CLI.
   */
  title: string
  /**
   * The line under the product: how many sign-ins it holds, or the address the CLI named with
   * whatever it reports of the subscription. Empty when there is neither, so nothing draws an
   * empty line.
   */
  detail: string
  /** Whether `detail` came out of a CLI, which is set in the machine's own font. */
  detailIsAddress: boolean
  /** Why this Provider reports no numbers, for the line's title; empty when it reports some. */
  detailNote: string
  badge: string
  tone: ProviderTone
  /** Whether nothing on this Provider can run: the row is drawn quieter. */
  idle: boolean
  /**
   * The boss's sign-ins of this Provider, each with its own bar — or null for a CLI that keeps one
   * sign-in and has no config directory to point a second at.
   */
  accounts: AccountRow[] | null
  /**
   * Where this Provider runs on this machine, when that is a thing worth saying (T167): the chip
   * names the place, and offers the others behind it when the machine really has more than one.
   * Null on a Mac, where there is one place and a row about it would be noise.
   */
  runsIn: RunsInView | null
}

/** One place the chip names, or one the menu behind it offers. */
export interface RuntimeOption {
  /** What the pick is stored as: `windows`, `wsl:Ubuntu`. */
  key: string
  label: string
  selected: boolean
}

/**
 * The row's `Runs in` state (frames `Oykzs`, `I1i1Uo`, `N1yAKa`, `nsfGb`, `GacEW`).
 *
 * `options` is always every place this CLI was found, the chosen one first to be drawn as the
 * chip; `choosable` says whether picking another is a thing the boss can do at all.
 */
export interface RunsInView {
  options: RuntimeOption[]
  /** Whether the boss can change it: two places or more. */
  choosable: boolean
  /** What the chip explains when it can be opened; empty when there is nothing to pick. */
  help: string
  /**
   * What else the row has to say: the distro is asleep and the first Session wakes it, or a
   * Session in there cannot reach TinyCorp. Empty when there is nothing.
   */
  note: string
}

/**
 * One row per Provider in the catalogue, in catalogue order.
 *
 * `preflight` is null until the first answers cross the bridge, and may be missing a Provider that
 * has not answered yet; either way the row is drawn with its name and says it is still asking,
 * rather than claiming a state nobody has checked. `routing` is null until the sign-ins land, and
 * until they do no Provider lists any.
 */
export function providerRows(
  preflight: readonly ProviderPreflight[] | null,
  usage: UsageSnapshot | null,
  routing: RoutingSettings | null = null,
  providers: readonly Provider[] = PROVIDERS,
): ProviderRowView[] {
  return providers.map((id) => {
    const check = preflight?.find((entry) => entry.provider === id) ?? null
    const state = check?.state ?? null
    const badge = state ? BADGES[state] : { badge: CHECKING_BADGE, tone: 'off' as const }
    const accounts = signIns(id, routing, usage)
    return {
      id,
      title: check?.plan && accounts === null ? `${PROVIDER_LABEL[id]} · ${check.plan}` : PROVIDER_LABEL[id],
      badge: badge.badge,
      tone: badge.tone,
      idle: state === null || state === 'missing' || state === 'signed-out',
      accounts,
      runsIn: runsInView(check?.placement ?? null),
      ...detail(id, check, accounts, usage),
    }
  })
}

/**
 * The sign-ins this Provider's CLI holds, or null when it holds one.
 *
 * A CLI that reads no config directory of its own cannot be pointed at a second sign-in, so there
 * is no list to draw — its one address is on the line under its name instead (decision 3).
 */
function signIns(id: Provider, routing: RoutingSettings | null, usage: UsageSnapshot | null): AccountRow[] | null {
  if (!routing || routing.oneAccountProviders.includes(id)) return null
  return accountRows(
    routing.accounts.filter((account) => account.provider === id),
    usage,
    [],
  )
}

/**
 * The line under the product.
 *
 * A Provider with sign-ins of its own says how many, because each of them carries its own address
 * and its own bar below. One with a single sign-in says the address the CLI named, and adds what
 * the subscription has spent when the Provider answers with a number at all — never a zero
 * standing in for an answer nobody has (`provider-usage.ts`).
 */
function detail(
  id: Provider,
  check: ProviderPreflight | null,
  accounts: AccountRow[] | null,
  usage: UsageSnapshot | null,
): Pick<ProviderRowView, 'detail' | 'detailIsAddress' | 'detailNote'> {
  if (accounts !== null && accounts.length > 1) {
    return { detail: accountsLine(accounts.length), detailIsAddress: false, detailNote: '' }
  }
  const address = addressLine(check, PROVIDER_COMMAND[id])
  if (accounts !== null) return { detail: address, detailIsAddress: address !== '', detailNote: '' }
  const read = usage?.providers.find((entry) => entry.id === id) ?? null
  const window = read && read.problem === null ? shortestWindow(read.windows) : null
  return {
    detail: [address, window ? usedSuffix(window.percent) : ''].filter(Boolean).join(' · '),
    detailIsAddress: address !== '',
    detailNote: window ? '' : (read?.reason ?? ''),
  }
}

/**
 * The address a CLI named, or — when it will not name one — the state in the fewest words that are
 * not the badge's own: the command that is not on this machine, or the one that would sign it in.
 * A Provider that is signed in and says nothing about the account gets no line: the badge already
 * said the only thing anybody knows.
 */
function addressLine(check: ProviderPreflight | null, command: string): string {
  if (!check) return ''
  if (check.account) return check.account
  if (check.state === 'missing') return `${command} is not installed`
  if (check.state === 'signed-out') return check.commands[0] ?? ''
  return ''
}

/**
 * Where this Provider runs, as the row draws it (T167).
 *
 * Null on a machine with one place — every Mac, every Linux desktop, and a Windows with no WSL —
 * because a chip saying `Windows` on a machine where nothing else is possible is a chip that tells
 * the boss nothing. It appears the moment the machine really has two answers.
 */
export function runsInView(placement: ProviderPlacement | null): RunsInView | null {
  // A place the boss chose that has no CLI in it draws the row too, with nothing selected (T258):
  // this is the row their card was just sent to, and pressing a place here is the whole fix.
  if (!placement || (placement.chosen === null && placement.missingAt === null)) return null
  const choices = runtimeChoices(placement)
  if (choices.length === 0) return null
  const choosable = hasRuntimeChoice(placement) || placement.missingAt !== null
  if (!choosable && placement.windows && placement.distros.length === 0 && placement.lookedIn.length === 0) {
    return null
  }
  const options = choices.map((runtime) => ({
    key: runtimeKey(runtime),
    label: runtimeLabel(runtime),
    selected: sameRuntime(runtime, placement.chosen),
  }))
  return {
    // The chosen place first: it is the one the chip is drawn from.
    options: [...options].sort((a, b) => Number(b.selected) - Number(a.selected)),
    choosable,
    // Both halves of T249's promise: which place this CLI is in, and that picking one here is
    // this Provider's business alone — On this PC is where the rest of the team is moved.
    help: choosable ? [RUNS_IN_BOTH_HELP, PROVIDER_RUNTIME_HELP].join(' ') : '',
    note: runtimeNote(placement),
  }
}

/**
 * The one extra line a row may carry, worst first: a place the boss chose that has no CLI in it is a
 * Provider that cannot start at all, a Session that cannot reach TinyCorp is broken, and a distro
 * that has to wake up first is only slow.
 */
function runtimeNote(placement: ProviderPlacement): string {
  // First of all, because it is the only one of the three that stops every Session on this Provider.
  if (placement.missingAt) return notInstalledThereNote(placement.missingAt)
  const chosen = placement.chosen
  if (chosen?.kind !== 'wsl') return ''
  if (placement.reach === 'blocked') return WSL_BLOCKED_NOTE
  return placement.stopped.includes(chosen.distro) ? stoppedDistroNote(chosen) : ''
}
