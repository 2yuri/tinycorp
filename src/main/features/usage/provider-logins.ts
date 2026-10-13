import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { homedir, userInfo } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { Provider } from '../../../shared/domain/providers'
import type { ProviderRuntime } from '../../../shared/platform/wsl'
import { isWsl, wslHomeFolders } from '../../platform'
import {
  type ClaudeCredential,
  type CodexCredential,
  claudeCredentialIn,
  codexCredentialIn,
  type LoginRead,
  type ProviderUsageOptions,
} from './provider-usage'
import { loginFingerprint, type SeenLoginReader } from './sign-in'

/**
 * Where each Provider keeps the boss's login, on the machine the Provider really runs on (T257).
 *
 * The Usage meter is one GET per sign-in with the token that product's own CLI wrote, so the only
 * question this module answers is *which file, or which keychain item, is that token in* — and
 * that answer has three axes:
 *
 * - **the platform.** Claude Code keeps the login in the macOS keychain on a Mac and in
 *   `<config folder>/.credentials.json` on Windows and Linux; Codex keeps a file everywhere.
 * - **where the Provider runs** (T167, T249). A Session inside a WSL distro signs in *inside* that
 *   distro, so the login is in the distro's home — which this Windows process reads over
 *   `\\wsl.localhost\<distro>\home\…`, the way T253 reads that home's skill folders.
 * - **which sign-in** (T173). An account *is* a config folder, so an added account's login is in
 *   the folder TinyCorp made for it, under the app's own data folder.
 *
 * Nothing here writes anything, nothing is kept after the read, and only the subscription token is
 * read — never an API key stored beside it (decision 3).
 */

const run = promisify(execFile)

/** The keychain item Claude Code writes for its **default** config folder. */
export const CLAUDE_KEYCHAIN_ITEM = 'Claude Code-credentials'

/** The file Claude Code writes the same JSON into off macOS. */
export const CLAUDE_CREDENTIALS_FILE = '.credentials.json'

/** Claude Code's own config folder, under the home, when nothing names another. */
export const CLAUDE_CONFIG_FOLDER = '.claude'

/** The variable that names another one. The same one the Claude adapter sets per account (T173). */
export const CLAUDE_CONFIG_DIR_ENV = 'CLAUDE_CONFIG_DIR'

/** Codex's own folder and the file `codex login` writes in it. */
export const CODEX_CONFIG_FOLDER = '.codex'
export const CODEX_AUTH_FILE = 'auth.json'
export const CODEX_HOME_ENV = 'CODEX_HOME'

/**
 * One sign-in, as this module needs it: the config folder its login lives in, or null for the
 * Provider's **own** default folder — the one the boss signed into with the product itself, which
 * is the only one that can be somewhere else (a distro's home, the macOS keychain).
 */
export interface LoginAccount {
  id: string
  configDir: string | null
}

/** Somewhere a login can be. Plain data, because it is what the tests and the row's line read. */
export type LoginPlace = { kind: 'file'; path: string } | { kind: 'keychain'; item: string }

/** How a place is named in the `Looked in: …` the row prints when there was no login. */
export function placeName(place: LoginPlace): string {
  return place.kind === 'file' ? place.path : `the login keychain (${place.item})`
}

export interface LoginPlaceOptions {
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  home?: () => string
  /** Where this Provider's Sessions run (T167, T249). Null, or Windows, is this machine itself. */
  runtime?: () => ProviderRuntime | null
  /** The home folders inside a distro, as this Windows process reaches them. T253's listing. */
  homesIn?: (distro: string) => readonly string[]
  /** This OS account's name, whose home inside the distro is tried first (T256's rule). */
  account?: string
}

interface Places {
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  home: () => string
  runtime: () => ProviderRuntime | null
  homesIn: (distro: string) => readonly string[]
  account: string
}

function settle({
  platform = process.platform,
  env = process.env,
  home = homedir,
  runtime = () => null,
  homesIn = wslHomeFolders,
  account = userInfo().username,
}: LoginPlaceOptions): Places {
  return { platform, env, home, runtime, homesIn, account }
}

/**
 * A distro's homes, the boss's own first (T256's rule, for T256's reason): which Linux account is
 * theirs cannot be asked from this side without running something inside the distro, and `b` on
 * Windows is `b` in the distro far more often than not. The rest follow, because a home that holds
 * no login contributes nothing — the reader takes the first that does.
 */
function homesBestFirst(homes: readonly string[], account: string): string[] {
  const named = (folder: string) => folder.split(/[\\/]/).filter(Boolean).at(-1)?.toLowerCase()
  const mine = homes.filter((folder) => named(folder) === account.toLowerCase())
  return [...mine, ...homes.filter((folder) => !mine.includes(folder))]
}

/**
 * The keychain item Claude Code writes for one config folder, which is how a Mac holds a second
 * sign-in (T173).
 *
 * The name is the CLI's own: `Claude Code-credentials` for the default folder, and the same name
 * with the first eight hex digits of the SHA-256 of the folder path behind it for any other. It is
 * read out of the installed CLI rather than guessed at, and it is why an added account on a Mac has
 * numbers at all — its login is never in the default item.
 */
export function claudeKeychainItem(configDir: string | null): string {
  if (configDir === null) return CLAUDE_KEYCHAIN_ITEM
  const digest = createHash('sha256').update(configDir.normalize('NFC')).digest('hex').slice(0, 8)
  return `${CLAUDE_KEYCHAIN_ITEM}-${digest}`
}

/**
 * Everywhere one account's Claude Code login could be, in the order it is looked for.
 *
 * An account with a folder of its own is read from that folder, wherever its Sessions run: the
 * folder is one TinyCorp made under the app's own data folder, and a Session in WSL is pointed at
 * that same Windows folder through `/mnt/c`, so the file is on this side either way.
 */
export function claudeLoginPlaces(account: LoginAccount | null, options: LoginPlaceOptions = {}): LoginPlace[] {
  const { platform, env, home, runtime, homesIn, account: me } = settle(options)
  const own = account?.configDir ?? null
  if (platform === 'darwin') return [{ kind: 'keychain', item: claudeKeychainItem(own ?? configDirEnv(env)) }]
  const where = runtime()
  if (own === null && isWsl(where)) {
    // Inside the distro the boss ran `claude`, so the login is in the distro's own home. This
    // process's own `CLAUDE_CONFIG_DIR` says nothing about it: that variable is Windows's.
    return homesBestFirst(homesIn(where.distro), me).map((folder) => credentialsIn(join(folder, CLAUDE_CONFIG_FOLDER)))
  }
  return [credentialsIn(own ?? configDirEnv(env) ?? join(home(), CLAUDE_CONFIG_FOLDER))]
}

/** Everywhere one account's Codex login could be. A file on all three platforms. */
export function codexLoginPlaces(account: LoginAccount | null, options: LoginPlaceOptions = {}): LoginPlace[] {
  const { env, home, runtime, homesIn, account: me } = settle(options)
  const own = account?.configDir ?? null
  const where = runtime()
  if (own === null && isWsl(where)) {
    return homesBestFirst(homesIn(where.distro), me).map((folder) => authIn(join(folder, CODEX_CONFIG_FOLDER)))
  }
  return [authIn(own ?? (env[CODEX_HOME_ENV]?.trim() || join(home(), CODEX_CONFIG_FOLDER)))]
}

function credentialsIn(configDir: string): LoginPlace {
  return { kind: 'file', path: join(configDir, CLAUDE_CREDENTIALS_FILE) }
}

function authIn(home: string): LoginPlace {
  return { kind: 'file', path: join(home, CODEX_AUTH_FILE) }
}

/** The config folder this process's own environment names, or null when it names none. */
function configDirEnv(env: NodeJS.ProcessEnv): string | null {
  return env[CLAUDE_CONFIG_DIR_ENV]?.trim() || null
}

export interface LoginReaderOptions extends LoginPlaceOptions {
  /** Reads a file, rejecting when there is none. */
  readText?: (path: string) => Promise<string>
  /** Reads a keychain item, rejecting when there is none. */
  readKeychain?: (item: string) => Promise<string>
}

/**
 * The boss's Claude Code login for one sign-in, and everywhere it was looked for.
 *
 * The places are tried in order and the first that holds a login wins; the row that says there is
 * none names all of them, which is the whole of what a boss on Windows or in WSL needs to know to
 * fix it.
 */
export function claudeLogin(options: LoginReaderOptions = {}) {
  return (account: LoginAccount | null = null): Promise<LoginRead<ClaudeCredential>> =>
    readFirst(claudeLoginPlaces(account, options), options, claudeCredentialIn)
}

/** The boss's Codex login for one sign-in, and everywhere it was looked for. */
export function codexLogin(options: LoginReaderOptions = {}) {
  return (account: LoginAccount | null = null): Promise<LoginRead<CodexCredential>> =>
    readFirst(codexLoginPlaces(account, options), options, codexCredentialIn)
}

async function readFirst<T>(
  places: readonly LoginPlace[],
  { readText = (path) => readFile(path, 'utf8'), readKeychain = keychainItem }: LoginReaderOptions,
  parse: (read: () => Promise<string>) => Promise<T | null>,
): Promise<LoginRead<T>> {
  const lookedIn = places.map(placeName)
  for (const place of places) {
    const login = await parse(() => (place.kind === 'file' ? readText(place.path) : readKeychain(place.item)))
    if (login) return { login, lookedIn }
  }
  return { login: null, lookedIn }
}

/** One keychain item's password. Rejects when the item is not there, or the boss refused. */
function keychainItem(item: string): Promise<string> {
  return run('security', ['find-generic-password', '-s', item, '-w'], { timeout: 10_000 }).then(({ stdout }) => stdout)
}

/**
 * The two readers the app hands the Usage meter, each pointed at where that Provider runs (T167).
 *
 * The product names are written here rather than in the composition root because this file is
 * already about two products' own storage — the same reason `provider-usage.ts` may name them —
 * and a Provider added tomorrow reports no usage until somebody writes its reader beside these.
 */
export function providerLogins(
  options: LoginReaderOptions & { runtimeOf?: (provider: Provider) => ProviderRuntime | null } = {},
): Pick<ProviderUsageOptions, 'claudeCredential' | 'codexCredential'> {
  const { runtimeOf = () => null, ...rest } = options
  return {
    claudeCredential: claudeLogin({ ...rest, runtime: () => runtimeOf('claude') }),
    codexCredential: codexLogin({ ...rest, runtime: () => runtimeOf('codex') }),
  }
}

/**
 * The same two readers, as the sign-in modal watches one account for its login to appear (T263):
 * a digest of the token and the plan it names, and never the token. A Provider with no reader here
 * has none, and its terminal's own exit says when the sign-in is done.
 */
export function signInReaders(
  logins: Pick<ProviderUsageOptions, 'claudeCredential' | 'codexCredential'>,
): Partial<Record<Provider, SeenLoginReader>> {
  return {
    claude: async (account) => {
      const { login } = await logins.claudeCredential(account)
      return login && { fingerprint: loginFingerprint(login.accessToken), plan: login.plan ?? null }
    },
    codex: async (account) => {
      const { login } = await logins.codexCredential(account)
      return login && { fingerprint: loginFingerprint(login.accessToken), plan: null }
    },
  }
}
