import type { ProviderAccount } from '../../../shared/usage/provider-accounts'
import type {
  AccountUsage,
  ProviderId,
  ProviderUsage,
  UsageSnapshot,
  UsageWindow,
} from '../../../shared/usage/provider-usage'
import { countdown } from '../budget'
import { accountName, NOT_READ } from '../settings'

/** What a Provider's row draws: its meters, an inert `Connect`, or a reason and a retry. */
export type RowKind = 'ready' | 'not-connected' | 'unavailable'

export interface MeterView {
  /** `5h`, `wk`, `Opus`. */
  label: string
  /** 0-100, as the Provider reported it. */
  percent: number
  /** `6%`. */
  value: string
}

export interface ProviderRow {
  id: ProviderId
  name: string
  kind: RowKind
  /** `Resets in 4h 10m`, `2 accounts`, `Not connected`, or why the numbers could not be read. */
  note: string
  /** The Provider's own sentence behind the note, for the row's title; null when it gave none. */
  reason: string | null
  /**
   * The Provider's own meters: the login in its default config folder, which is what the drawer's
   * button reads. The card draws {@link accounts} instead of these wherever there are any.
   */
  meters: MeterView[]
  /** One row per sign-in, where the boss has more than one (frame `nV8jR`); empty where they have one. */
  accounts: AccountMeterRow[]
  /** Set when what is missing is the one sign-in's login, so the row offers the sign-in modal (T263). */
  signIn?: true
}

/** One sign-in as the popover draws it: who it is, whether Employees take it, and its own numbers. */
export interface AccountMeterRow {
  id: string
  /** `Personal · Max 20×`. */
  label: string
  /** The one an Employee takes when nothing pins another: the frame's `Default` badge. */
  isDefault: boolean
  /** `Resets in 4h 10m`, or {@link NOT_READ} when this sign-in's own login could not be read. */
  note: string
  /** Why it could not be read, and where TinyCorp looked; null when it was read. */
  reason: string | null
  meters: MeterView[]
  /** Set when what is missing is this sign-in's login, so it offers the sign-in modal (T263). */
  signIn?: true
}

export interface UsageView {
  rows: ProviderRow[]
  /** The highest meter any Provider reported, or null while none has numbers. */
  percent: number | null
  /** What the drawer button reads: `15%`, or `—` with nothing to show. */
  value: string
  /** The drawer button's accessible name. */
  label: string
  /** Whether at least one Provider answered, so the button draws a real meter. */
  known: boolean
}

/** The copy under the popover's last row, and the link beside it. */
export const USAGE_FOOTER = 'Employees park when a provider runs out.'
export const USAGE_SCOPE = 'all Employees'
/** What a Provider whose numbers could not be read says above its reason. */
export const USAGE_UNAVAILABLE = 'Usage unavailable'

/** `Resets in 4h 10m`, from the window that rolls over soonest; empty when none names a time. */
export function resetsIn(windows: UsageWindow[], now: Date): string {
  const next = windows
    .map((window) => (window.resetsAt ? new Date(window.resetsAt) : null))
    .filter((at): at is Date => at !== null && at.getTime() > now.getTime())
    .sort((a, b) => a.getTime() - b.getTime())[0]
  return next ? `Resets ${countdown(next, now)}` : ''
}

/** One Provider's row: its meters, or its sign-ins, and the note beside its name. */
export function providerRow(provider: ProviderUsage, now: Date, signIns: readonly ProviderAccount[] = []): ProviderRow {
  const { id, name } = provider
  if (provider.problem === 'not-connected') {
    return { id, name, kind: 'not-connected', note: 'Not connected', reason: provider.reason, meters: [], accounts: [] }
  }
  const meters = metersOf(provider.windows)
  // One sign-in is not a list: the row keeps its own meters and says nothing more (frame `TMviL`).
  const accounts = signIns.length > 1 ? accountMeterRows(provider, signIns, now) : []
  if (accounts.length > 0) {
    // A sign-in that answered is numbers on the card, whatever the others did: each says for itself.
    const read = accounts.some((account) => account.meters.length > 0)
    return {
      id,
      name,
      kind: read ? 'ready' : 'unavailable',
      note: read ? accountsNote(accounts.length) : (provider.reason ?? USAGE_UNAVAILABLE),
      reason: provider.reason,
      meters,
      accounts,
    }
  }
  if (provider.problem !== null || provider.windows.length === 0) {
    return {
      id,
      name,
      kind: 'unavailable',
      note: provider.reason ?? USAGE_UNAVAILABLE,
      reason: provider.reason,
      meters: [],
      accounts: [],
      ...(provider.signedOut && { signIn: true as const }),
    }
  }
  return { id, name, kind: 'ready', note: resetsIn(provider.windows, now), reason: null, meters, accounts: [] }
}

/** `2 accounts`, where the reset time sits on a Provider with one sign-in (frame `nV8jR`). */
export function accountsNote(count: number): string {
  return `${count} accounts`
}

/**
 * One row per sign-in, each with the numbers read from that account's own config folder (T257).
 *
 * An account TinyCorp could not read says {@link NOT_READ} where its reset time goes and carries
 * the reason — including where it looked — rather than an empty meter at zero.
 */
function accountMeterRows(provider: ProviderUsage, signIns: readonly ProviderAccount[], now: Date): AccountMeterRow[] {
  return signIns.map((account) => {
    const read: AccountUsage | undefined = provider.accounts.find((entry) => entry.id === account.id)
    const windows = read?.windows ?? []
    return {
      id: account.id,
      label: accountName(account),
      isDefault: account.isDefault,
      note: windows.length > 0 ? resetsIn(windows, now) : NOT_READ,
      reason: windows.length > 0 ? null : (read?.reason ?? null),
      meters: metersOf(windows),
      ...(windows.length === 0 && read?.signedOut && { signIn: true as const }),
    }
  })
}

function metersOf(windows: UsageWindow[]): MeterView[] {
  return windows.map(({ label, percent }) => ({ label, percent, value: `${percent}%` }))
}

/**
 * What the Usage button and its popover show. The button carries the highest meter across every
 * Provider that answered — the window closest to running out is the one that parks Employees.
 *
 * It is each Provider's **own** meter, which is the login in its default config folder, however
 * many sign-ins the boss has added beside it (T257): the button reads what a Session that nothing
 * pins would spend.
 */
export function usageView(snapshot: UsageSnapshot, now: Date, accounts: readonly ProviderAccount[] = []): UsageView {
  const rows = snapshot.providers.map((provider) =>
    providerRow(
      provider,
      now,
      accounts.filter((account) => account.provider === provider.id),
    ),
  )
  const percents = rows.flatMap((row) => row.meters.map((meter) => meter.percent))
  const percent = percents.length > 0 ? Math.max(...percents) : null
  return {
    rows,
    percent,
    value: percent === null ? '—' : `${percent}%`,
    label: percent === null ? `Usage — ${USAGE_UNAVAILABLE.toLowerCase()}` : `Usage — ${percent}% used`,
    known: percent !== null,
  }
}

/** The most of a place the reason line keeps before it is cut in the middle. */
export const PLACE_MAX = 44

const LOOKED_IN = 'Looked in: '

/**
 * A reason as its row can hold it (T262): the `Looked in: …` it ends with names each place by its
 * folder, a distro's home as `~` and the distro it is in, and cuts what is still too long in the
 * middle — where a path says the least. The row's `title` keeps the whole sentence.
 *
 * A login is one file in its Provider's config folder, so the folder says which login it is; a
 * keychain item, and anything that is not a path, is left as it came.
 */
export function shortReason(reason: string): string {
  const at = reason.lastIndexOf(LOOKED_IN)
  if (at < 0) return reason
  const places = reason.slice(at + LOOKED_IN.length).split(' · ')
  return `${reason.slice(0, at)}${LOOKED_IN}${places.map(shortPlace).join(' · ')}`
}

function shortPlace(place: string): string {
  const unc = /^\\\\wsl(?:\.localhost|\$)\\([^\\]+)\\(?:home\\[^\\]+|root)(\\.*)?$/i.exec(place)
  if (unc) return middle(`~${folderOf(unc[2] ?? '').replaceAll('\\', '/')} in WSL · ${unc[1]}`)
  const home = /^\/(?:home|Users)\/[^/]+(\/.*)?$/.exec(place)
  if (home) return middle(`~${folderOf(home[1] ?? '')}`)
  return middle(folderOf(place))
}

/** The folder a login file is in; a path that ends in a folder is left as it is. */
function folderOf(path: string): string {
  return path.replace(/[\\/][^\\/]+\.(?:json|toml)$/i, '')
}

function middle(text: string): string {
  if (text.length <= PLACE_MAX) return text
  const keep = PLACE_MAX - 1
  return `${text.slice(0, Math.ceil(keep / 2))}…${text.slice(text.length - Math.floor(keep / 2))}`
}
