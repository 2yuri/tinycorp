import { PROVIDER_SHORT_NAME, PROVIDERS, type Provider, type ProviderTables } from '../domain/providers'

/**
 * What each Provider reports of the boss's subscription, for the drawer's Usage button and its
 * popover (design/html/usage-popover.html, frames `AAI0w` and `z2AWfM`).
 *
 * The numbers are read in the main process from the Provider's own credential, never in the
 * renderer, and never invented: a Provider TinyCorp cannot read reports why, not a zero.
 */

/**
 * Products the popover lists that TinyCorp has no adapter for yet. Their row says so plainly.
 * Landing one is a matter of moving its line into `PROVIDER_CATALOGUE` with an adapter behind it,
 * which is what happened to OpenCode (T132) and left this list empty — it stays because the next
 * product TinyCorp names before it can run is one line, and the popover already draws the row.
 */
export const UNSUPPORTED_PROVIDERS: readonly UnsupportedProvider[] = []

/** A product the popover names before TinyCorp can run it. */
export interface UnsupportedProvider {
  id: string
  name: string
}

/**
 * The Providers the popover lists, in the order it lists them: the catalogue, then the rest.
 * Every product TinyCorp names now has an adapter, so this is the catalogue — and it goes back to
 * a union the moment {@link UNSUPPORTED_PROVIDERS} names something again.
 */
export type ProviderId = Provider

/**
 * The popover's list for one catalogue: its Providers in catalogue order, then the products
 * TinyCorp has no adapter for. Takes the tables rather than reading them so the registry test can
 * ask what the page would draw with one more Provider in the catalogue.
 */
export function usageList(tables: Pick<ProviderTables, 'providers' | 'shortName'>): {
  ids: readonly string[]
  names: Record<string, string>
} {
  return {
    ids: [...tables.providers, ...UNSUPPORTED_PROVIDERS.map((entry) => entry.id)],
    names: {
      ...tables.shortName,
      ...Object.fromEntries(UNSUPPORTED_PROVIDERS.map((entry) => [entry.id, entry.name])),
    },
  }
}

const USAGE = usageList({ providers: PROVIDERS, shortName: PROVIDER_SHORT_NAME })

export const USAGE_PROVIDERS: readonly ProviderId[] = USAGE.ids as readonly ProviderId[]

export const PROVIDER_NAME: Record<ProviderId, string> = USAGE.names as Record<ProviderId, string>

/** Whether TinyCorp has an adapter for this product at all — a catalogue id, or any other. */
export function isConfigured(id: string): id is Provider {
  return (PROVIDERS as readonly string[]).includes(id)
}

/** What a Provider TinyCorp cannot run at all says on the Usage page. */
export function noAdapterYet(id: ProviderId): string {
  return `TinyCorp has no adapter for ${PROVIDER_NAME[id]} yet`
}

/** What a Provider TinyCorp runs, but whose limit it can only learn from a Session, says. */
export function noUsageEndpoint(id: ProviderId): string {
  return `${PROVIDER_NAME[id]} reports its limit in the Session, not on an endpoint TinyCorp can read`
}

/** One rate-limit window of a Provider: the 5-hour session, the week, or the week's Opus share. */
export interface UsageWindow {
  /** The Provider's own name for it, e.g. `five_hour`. */
  key: string
  /** How the popover labels its meter: `5h`, `wk`, `Opus`. */
  label: string
  /** How much of the window is spent, 0-100, as the Provider reports it. */
  percent: number
  /** When the window rolls over, ISO, or null when the Provider names no time. */
  resetsAt: string | null
}

/**
 * Why a Provider has no numbers. `not-connected` is a Provider TinyCorp has no source for yet and
 * draws with an inert `Connect`; `unavailable` is one it should have read and could not.
 */
export type UsageProblem = 'not-connected' | 'unavailable'

export interface ProviderUsage {
  id: ProviderId
  name: string
  /** The windows the Provider reported, in meter order. Empty whenever {@link problem} is set. */
  windows: UsageWindow[]
  problem: UsageProblem | null
  /** The sentence behind {@link problem} — a missing credential, an HTTP status, a parse failure. */
  reason: string | null
  /** Set when what is missing is a login — none, expired, or refused — so the row offers `Sign in` (T263). */
  signedOut?: true
  /**
   * One entry per sign-in, where the boss has more than one (T257). Empty where they have one, and
   * the Provider's own {@link windows} are that one sign-in's numbers.
   *
   * The Provider's own numbers stay what they have always been — the login in its **default**
   * config folder, which is the sign-in every Session takes unless something pins another — so the
   * drawer's meter reads the same with two accounts as with one.
   */
  accounts: AccountUsage[]
}

/**
 * What one sign-in reports, read with the login inside that account's own config folder (T257).
 *
 * Every account is read the same way the default one is — its own file, or its own keychain item —
 * and an account TinyCorp cannot read says why, never a zero.
 */
export interface AccountUsage {
  /** The account this was read for: `ProviderAccount.id`. */
  id: string
  windows: UsageWindow[]
  problem: UsageProblem | null
  reason: string | null
  /** As {@link ProviderUsage.signedOut}: this sign-in has no login TinyCorp could use. */
  signedOut?: true
}

/** Every Provider's usage as of one read. */
export interface UsageSnapshot {
  providers: ProviderUsage[]
  /** When these numbers were read, ISO; null before the first read lands. */
  readAt: string | null
}

/** A Provider TinyCorp has no source for yet: the popover draws it with an inert `Connect`. */
export function notConnected(id: ProviderId, reason: string): ProviderUsage {
  return { id, name: PROVIDER_NAME[id], windows: [], problem: 'not-connected', reason, accounts: [] }
}

/** Before the first read lands, every Provider is blank rather than zero. */
export const EMPTY_USAGE_SNAPSHOT: UsageSnapshot = { providers: [], readAt: null }

/** How full a window reads. The bar warms as it fills, and every meter in the app reads it here. */
export type UsageLevel = 'low' | 'high' | 'full'

/**
 * The level a percentage draws at: amber from half a window, red from four fifths of one. The
 * thresholds are the frames' — `bB6VX` draws 68% in `--brand-warning` — and one definition is why
 * the daily digest's meters and the Accounts card's cannot drift apart.
 */
export function usageLevel(percent: number): UsageLevel {
  if (percent >= 80) return 'full'
  if (percent >= 50) return 'high'
  return 'low'
}
