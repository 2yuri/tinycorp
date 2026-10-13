import { providerEntry } from '../../../shared/domain/providers'
import { lookedInLine } from '../../../shared/platform/wsl'
import {
  type AccountUsage,
  isConfigured,
  noAdapterYet,
  notConnected,
  noUsageEndpoint,
  PROVIDER_NAME,
  type ProviderId,
  type ProviderUsage,
  USAGE_PROVIDERS,
  type UsageSnapshot,
  type UsageWindow,
} from '../../../shared/usage/provider-usage'
import type { LoginAccount } from './provider-logins'

/** The same numbers `claude /usage` shows, read with the subscription login (T80). */
export const CLAUDE_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'

/** The OAuth scheme the endpoint answers under. */
const CLAUDE_OAUTH_BETA = 'oauth-2025-04-20'

/**
 * The same numbers `codex` draws in its own limit line, read with the ChatGPT login (T220).
 *
 * It is the call the Codex CLI makes itself, and the only one that answers: the CLI has no
 * subcommand that prints a percentage — `codex doctor --json` reports the login and not what it has
 * spent — so there is nothing to run instead of asking. `docs/providers.md` § 5 says as much.
 */
export const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'

/** How long one read is reused before the next asks again. */
export const USAGE_TTL_MS = 60_000

export const NO_CLAUDE_LOGIN = 'No Claude Code login found — sign in by running `claude`'

export const NO_CODEX_LOGIN = 'No Codex login found — sign in by running `codex login`'

/**
 * The windows the popover draws, in meter order, with the label each one carries (frame `z2AWfM`).
 * A window the plan does not track comes back `null` and is left out rather than drawn at zero.
 */
const CLAUDE_WINDOWS: { key: string; label: string }[] = [
  { key: 'five_hour', label: '5h' },
  { key: 'seven_day', label: 'wk' },
  { key: 'seven_day_opus', label: 'Opus' },
]

/**
 * Codex's two windows, in the meter order frame `TMviL` draws them: the rolling session, then the
 * week. They are read by position because that is what the endpoint promises — `primary_window` is
 * the short one and `secondary_window` the week — and a window the plan does not report is left out
 * rather than drawn at zero, the same rule Claude's read follows.
 */
const CODEX_WINDOWS: { key: string; label: string }[] = [
  { key: 'primary_window', label: '5h' },
  { key: 'secondary_window', label: 'wk' },
]

/** The boss's Claude Code subscription login. Never an API key (decision 3, and T80 says so twice). */
export interface ClaudeCredential {
  accessToken: string
  /** When the token stops being accepted, ms since the epoch, or null when the login names none. */
  expiresAt: number | null
  /** The plan the login was issued for, e.g. `Max 20×`, or null when it names none (T263). */
  plan?: string | null
}

/**
 * The boss's Codex login. Never an API key: the `OPENAI_API_KEY` that sits in the same file is not
 * read, because decision 3 is that every Employee runs on the boss's subscription.
 *
 * The file names no expiry beside the token, so a stale one is learnt from the endpoint's own 401
 * rather than guessed at — and refreshing it is the CLI's to do, never TinyCorp's.
 */
export interface CodexCredential {
  accessToken: string
  /** Which ChatGPT workspace the login is for, or null when it names none. */
  accountId: string | null
}

/** The one HTTP call this module makes, injected so tests never leave the process. */
export type UsageHttp = (request: {
  url: string
  headers: Record<string, string>
}) => Promise<{ status: number; body: string }>

/**
 * A login, and everywhere it was looked for (T257).
 *
 * The places travel with the answer because the row that has no numbers has to say *where* — a
 * meter that is blank on Windows because the app read a Mac's keychain is the bug this ticket is,
 * and `Looked in: …` is what would have shown it.
 */
export interface LoginRead<T> {
  login: T | null
  /** Every place that was looked in, in the order it was looked. */
  lookedIn: readonly string[]
}

export interface ProviderUsageOptions {
  /** The boss's Claude Code login for one sign-in, or for its default folder when given none. */
  claudeCredential(account: LoginAccount | null): Promise<LoginRead<ClaudeCredential>>
  /** The boss's Codex login for one sign-in. */
  codexCredential(account: LoginAccount | null): Promise<LoginRead<CodexCredential>>
  /**
   * The boss's sign-ins of one Provider, in the order the popover lists them, with the default one
   * marked (T173). Empty — the app before any account is known — is one read of the Provider's own
   * default folder, which is what every read was before T257.
   */
  accountsOf?(provider: ProviderId): readonly UsageAccountRef[]
  http?: UsageHttp
  now?: () => number
  ttlMs?: number
  log?(line: string): void
}

/** One sign-in, as the reader needs it: which account, and which folder its login is in. */
export interface UsageAccountRef extends LoginAccount {
  /** The product's own folder, which is where the Provider's own numbers come from. */
  primary: boolean
}

export interface ProviderUsageReader {
  /** The last read while it is younger than the TTL, else a fresh one. */
  read(): Promise<UsageSnapshot>
  /** Reads again however young the cache is: the popover's refresh control. */
  refresh(): Promise<UsageSnapshot>
  /** Drops the cache, so the next read asks again — a Session reported the limit. */
  invalidate(): void
  /** Called each time fresh numbers land. Returns an unsubscribe function. */
  onChange(listener: () => void): () => void
}

/**
 * Every Provider's usage, read in the main process and cached for {@link USAGE_TTL_MS}.
 *
 * Claude and Codex answer with real percentages, each read with the login its own CLI wrote and
 * never with an API key; OpenCode holds no subscription of its own and says so. Nothing here ever
 * reports a zero it did not read.
 */
export function createProviderUsage({
  claudeCredential,
  codexCredential,
  accountsOf = () => [],
  http = fetchUsage,
  now = Date.now,
  ttlMs = USAGE_TTL_MS,
  log = console.warn,
}: ProviderUsageOptions): ProviderUsageReader {
  const listeners = new Set<() => void>()
  let cached: { at: number; snapshot: Promise<UsageSnapshot> } | null = null

  /** What one sign-in reports: its windows, or why they could not be read. Never an invented zero. */
  type Numbers = Pick<ProviderUsage, 'windows' | 'problem' | 'reason' | 'signedOut'>

  const unreadable = (reason: string): Numbers => ({ windows: [], problem: 'unavailable', reason })
  /** Unreadable because the login is missing, stale or refused: signing in is what fixes it (T263). */
  const signedOut = (reason: string): Numbers => ({ ...unreadable(reason), signedOut: true })

  /** `No Claude Code login found …. Looked in: C:\Users\b\.claude\.credentials.json` (T257). */
  const noLogin = (sentence: string, lookedIn: readonly string[]): Numbers => {
    const where = lookedInLine(lookedIn)
    return signedOut(where ? `${sentence}. ${where}` : sentence)
  }

  async function readClaude(account: LoginAccount | null): Promise<Numbers> {
    let read: LoginRead<ClaudeCredential>
    try {
      read = await claudeCredential(account)
    } catch (error) {
      return unreadable(messageOf(error))
    }
    const login = read.login
    if (!login) return noLogin(NO_CLAUDE_LOGIN, read.lookedIn)
    if (login.expiresAt !== null && login.expiresAt <= now()) {
      return signedOut('The Claude Code login has expired — run `claude` to sign in again')
    }
    try {
      const { status, body } = await http({
        url: CLAUDE_USAGE_URL,
        headers: { Authorization: `Bearer ${login.accessToken}`, 'anthropic-beta': CLAUDE_OAUTH_BETA },
      })
      if (status === 401 || status === 403) {
        return signedOut(`Claude did not accept the login (HTTP ${status}) — run \`claude\` to sign in again`)
      }
      if (status !== 200) return unreadable(`Claude answered HTTP ${status}`)
      return { windows: parseClaudeWindows(body), problem: null, reason: null }
    } catch (error) {
      const reason = messageOf(error)
      log(`Usage: could not read Claude usage: ${reason}`)
      return unreadable(reason)
    }
  }

  async function readCodex(account: LoginAccount | null): Promise<Numbers> {
    let read: LoginRead<CodexCredential>
    try {
      read = await codexCredential(account)
    } catch (error) {
      return unreadable(messageOf(error))
    }
    const login = read.login
    if (!login) return noLogin(NO_CODEX_LOGIN, read.lookedIn)
    try {
      const { status, body } = await http({
        url: CODEX_USAGE_URL,
        headers: {
          Authorization: `Bearer ${login.accessToken}`,
          // Which workspace of the login to answer for. Left out when the file names none, which is
          // a login that has only one.
          ...(login.accountId === null ? {} : { 'ChatGPT-Account-Id': login.accountId }),
        },
      })
      if (status === 401 || status === 403) {
        return signedOut(
          `ChatGPT did not accept the Codex login (HTTP ${status}) — run \`codex\` to refresh it, or \`codex login\` to sign in again`,
        )
      }
      if (status !== 200) return unreadable(`ChatGPT answered HTTP ${status}`)
      return { windows: parseCodexWindows(body), problem: null, reason: null }
    } catch (error) {
      const reason = messageOf(error)
      log(`Usage: could not read Codex usage: ${reason}`)
      return unreadable(reason)
    }
  }

  /** The readers that can ask a Provider for real numbers. A Provider without one says so. */
  const readers: Partial<Record<string, (account: LoginAccount | null) => Promise<Numbers>>> = {
    claude: readClaude,
    codex: readCodex,
  }

  /**
   * One row per Provider the popover lists: the ones TinyCorp is configured for, then the ones it
   * is not. A Provider TinyCorp cannot ask says why, and never reports a zero it did not read.
   *
   * A Provider the boss has signed into twice is read twice — each account from its own config
   * folder (T257) — and the row's own numbers stay the default folder's, which is the sign-in every
   * Session takes unless something pins another. One sign-in is one read, as it always was.
   */
  async function row(id: ProviderId): Promise<ProviderUsage> {
    if (!isConfigured(id)) return notConnected(id, noAdapterYet(id))
    const read = providerEntry(id).readsUsage ? readers[id] : undefined
    if (!read) return notConnected(id, noUsageEndpoint(id))
    const name = PROVIDER_NAME[id]
    const signIns = accountsOf(id)
    if (signIns.length <= 1) return { id, name, ...(await read(signIns[0] ?? null)), accounts: [] }
    const accounts: AccountUsage[] = []
    for (const account of signIns) accounts.push({ id: account.id, ...(await read(account)) })
    const own = accounts[signIns.findIndex((account) => account.primary)] ?? accounts[0]!
    return {
      id,
      name,
      windows: own.windows,
      problem: own.problem,
      reason: own.reason,
      ...(own.signedOut && { signedOut: own.signedOut }),
      accounts,
    }
  }

  async function take(): Promise<UsageSnapshot> {
    const providers: ProviderUsage[] = []
    for (const id of USAGE_PROVIDERS) providers.push(await row(id))
    return { providers, readAt: new Date(now()).toISOString() }
  }

  function fresh(): Promise<UsageSnapshot> {
    const snapshot = take()
    cached = { at: now(), snapshot }
    void snapshot.then(() => {
      for (const listener of listeners) listener()
    })
    return snapshot
  }

  return {
    read() {
      if (cached && now() - cached.at < ttlMs) return cached.snapshot
      return fresh()
    },

    refresh: fresh,

    invalidate() {
      cached = null
    },

    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

/**
 * The windows in what the usage endpoint answered. The rate limits sit at the top level of the
 * body; a `rate_limits` wrapper is accepted too, so a future shape does not blank the popover.
 */
export function parseClaudeWindows(body: string): UsageWindow[] {
  const parsed: unknown = JSON.parse(body)
  if (!isRecord(parsed)) throw new Error('Claude answered with no usage object')
  const limits = isRecord(parsed['rate_limits']) ? parsed['rate_limits'] : parsed
  const windows = CLAUDE_WINDOWS.flatMap(({ key, label }) => {
    const window = limits[key]
    if (!isRecord(window) || typeof window['utilization'] !== 'number') return []
    return [{ key, label, percent: percentOf(window['utilization']), resetsAt: isoOrNull(window['resets_at']) }]
  })
  if (windows.length === 0) throw new Error('Claude answered with no rate limits')
  return windows
}

/** Utilization as the meter draws it: a whole percentage that cannot leave its track. */
function percentOf(utilization: number): number {
  return Math.min(100, Math.max(0, Math.round(utilization)))
}

function isoOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const at = new Date(value)
  return Number.isNaN(at.getTime()) ? null : at.toISOString()
}

/**
 * The windows in what the Codex usage endpoint answered: `used_percent` and `reset_at` on the two
 * windows under `rate_limit`. A missing `rate_limit` is a body TinyCorp cannot read rather than a
 * subscription with nothing spent, so it throws and the row says why.
 */
export function parseCodexWindows(body: string): UsageWindow[] {
  const parsed: unknown = JSON.parse(body)
  if (!isRecord(parsed)) throw new Error('Codex answered with no usage object')
  const limits = isRecord(parsed['rate_limit']) ? parsed['rate_limit'] : {}
  const windows = CODEX_WINDOWS.flatMap(({ key, label }) => {
    const window = limits[key]
    if (!isRecord(window) || typeof window['used_percent'] !== 'number') return []
    return [{ key, label, percent: percentOf(window['used_percent']), resetsAt: epochOrNull(window['reset_at']) }]
  })
  if (windows.length === 0) throw new Error('Codex answered with no rate limits')
  return windows
}

/** A reset time the way Codex writes it: whole seconds since the epoch, not a date. */
function epochOrNull(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  const at = new Date(value * 1000)
  return Number.isNaN(at.getTime()) ? null : at.toISOString()
}

/**
 * The boss's Claude Code login, from whatever `read` hands back — the macOS keychain in the app.
 * Only `claudeAiOauth.accessToken` is read: an API key stored beside it is never touched.
 */
export async function claudeCredentialIn(read: () => Promise<string>): Promise<ClaudeCredential | null> {
  let raw: string
  try {
    raw = await read()
  } catch {
    // No keychain item, or the boss refused the prompt: there is simply no login to read.
    return null
  }
  if (!raw.trim()) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  const oauth = isRecord(parsed) ? parsed['claudeAiOauth'] : null
  if (!isRecord(oauth) || typeof oauth['accessToken'] !== 'string' || oauth['accessToken'] === '') return null
  const plan = claudePlan(oauth['subscriptionType'], oauth['rateLimitTier'])
  return {
    accessToken: oauth['accessToken'],
    expiresAt: typeof oauth['expiresAt'] === 'number' ? oauth['expiresAt'] : null,
    ...(plan && { plan }),
  }
}

/**
 * `Max 20×` out of the two words the login is stored with — `subscriptionType: "max"` and
 * `rateLimitTier: "default_claude_max_20x"` — or null when it names no plan (T263).
 */
export function claudePlan(subscription: unknown, tier: unknown): string | null {
  if (typeof subscription !== 'string' || subscription.trim() === '') return null
  const name = subscription.trim()[0]!.toUpperCase() + subscription.trim().slice(1)
  const multiple = typeof tier === 'string' ? /_(\d+)x$/.exec(tier)?.[1] : undefined
  return multiple ? `${name} ${multiple}×` : name
}

/**
 * The boss's Codex login, from whatever `read` hands back — an `auth.json` in the app.
 * Only `tokens.access_token` is read: the API key `codex` can also store in that file is never
 * touched, and nothing here writes the file or keeps what it read.
 */
export async function codexCredentialIn(read: () => Promise<string>): Promise<CodexCredential | null> {
  let raw: string
  try {
    raw = await read()
  } catch {
    // No `auth.json`, or a home TinyCorp cannot read: there is simply no login to read.
    return null
  }
  if (!raw.trim()) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  const tokens = isRecord(parsed) ? parsed['tokens'] : null
  if (!isRecord(tokens) || typeof tokens['access_token'] !== 'string' || tokens['access_token'] === '') return null
  const account = tokens['account_id']
  return {
    accessToken: tokens['access_token'],
    accountId: typeof account === 'string' && account !== '' ? account : null,
  }
}

/** The default HTTP layer: one GET, its body read as text. */
const fetchUsage: UsageHttp = async ({ url, headers }) => {
  const response = await fetch(url, { headers })
  return { status: response.status, body: await response.text() }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * When a Provider's limit resets, from the numbers already read for the Usage popover (T173).
 *
 * It is the cheap re-check the engine does while it waits out a limit that named no reset time:
 * one HTTP read of the same endpoint the popover uses, cached for {@link USAGE_TTL_MS}, and never
 * a prompt — asking an agent when its limit resets would spend the usage it is asking about.
 *
 * Null when this Provider reports no window, or none of its windows names a time.
 */
export async function resetFromUsage(reader: ProviderUsageReader, provider: string): Promise<Date | null> {
  let snapshot: UsageSnapshot
  try {
    snapshot = await reader.read()
  } catch {
    return null
  }
  const row = snapshot.providers.find((entry) => entry.id === provider)
  const times = (row?.windows ?? []).flatMap((window) => (window.resetsAt ? [new Date(window.resetsAt)] : []))
  const soonest = times.sort((a, b) => a.getTime() - b.getTime())[0]
  return soonest && !Number.isNaN(soonest.getTime()) ? soonest : null
}
