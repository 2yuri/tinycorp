import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { PROVIDERS, type Provider, providerEntry } from '../../../shared/domain/providers'
import type { ProviderRuntime } from '../../../shared/platform/wsl'
import type { ProviderAccount } from '../../../shared/usage/provider-accounts'
import {
  SIGN_IN_ENDED,
  SIGN_IN_SEEN,
  type SignInRequest,
  type SignInState,
  type SignInView,
  signInSub,
  stepReached,
} from '../../../shared/usage/sign-in'
import { isWsl, type PtySession, runtimePaths, type SpawnPty, wslSpawnPty } from '../../platform'
import { configDirVars, type ProviderAdapters, stripAnsi } from '../../providers'
import type { ProviderAccounts } from './provider-accounts'
import type { LoginAccount } from './provider-logins'

/**
 * The product's own sign-in, in a terminal inside TinyCorp (T263, frames `Tmldc` and `iA8Wm`).
 *
 * T173 opened a terminal window of the boss's own and T258 taught it WSL, through three parsers
 * nobody could run here — and then TinyCorp never knew the sign-in was done. This is the way Orca
 * does it: the CLI in a PTY, which every Employee already runs in, spawned **where the Provider
 * runs** through the same wrapped PTY a Session is — the CLI itself on macOS and Linux, through
 * `cli-command.ts` on Windows, through `wsl.exe` on the distro's own `PATH` in WSL — with the
 * account's config folder in its environment and an empty folder of TinyCorp's as its cwd.
 *
 * **TinyCorp never sees, types or stores the credential** (decision 3): the product asks for it in
 * that terminal and writes it where it always does. What TinyCorp does is look, every
 * {@link POLL_MS}, at whether that account's login has appeared — the same read the Usage meter
 * makes (T257) — and when it has, it says so, closes the terminal and checks the Provider again.
 */

/** How often the login is looked for while the terminal is open. */
export const POLL_MS = 1500

/** How long the signed-in terminal stays up, so the boss sees the product's own success lines. */
export const CLOSE_AFTER_MS = 2500

/** How much of what the terminal printed is kept to tell which step the boss is on. */
const SHOWN_LIMIT = 16_000

/** A login, as the sign-in compares one: a digest of the token, never the token itself. */
export interface SeenLogin {
  fingerprint: string
  /** The plan the login names, e.g. `Max 20×`. */
  plan: string | null
}

/** Reads one account's login, or null when there is none. The Usage meter's own read (T257). */
export type SeenLoginReader = (account: LoginAccount | null) => Promise<SeenLogin | null>

/** A token's digest, so the sign-in can tell a new login from an old one without holding either. */
export function loginFingerprint(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * The PTY a sign-in runs in, for the place its Provider runs (T258's runtime): the one node-pty
 * spawn everywhere but WSL, where it is the same spawn through `wsl.exe` on the distro's `PATH`.
 * The account's folder crosses into the distro through `WSLENV`, translated on the way.
 */
export function signInPty(
  runtime: ProviderRuntime | null,
  inner: SpawnPty,
  options: { path?: string | null; host?: NodeJS.ProcessEnv } = {},
): SpawnPty {
  if (!isWsl(runtime)) return inner
  return wslSpawnPty(inner, {
    distro: runtime.distro,
    path: options.path ?? null,
    ...(options.host && { host: options.host }),
  })
}

export interface SignInOptions {
  accounts: Pick<ProviderAccounts, 'list' | 'of'>
  providers: ProviderAdapters
  /** Where this Provider's Sessions run, or null where that is simply this machine. */
  runtimeOf(provider: Provider): ProviderRuntime | null
  /** Starts a PTY where this Provider runs: {@link signInPty} over node-pty. */
  spawnIn(provider: Provider): SpawnPty
  /** TinyCorp's own folder for sign-ins; each Provider's runs in an empty folder under it. */
  folder: string
  makeDir?(path: string): void
  /** This Provider's login reader, or null for one TinyCorp cannot read — its terminal's exit decides. */
  loginOf(provider: Provider): SeenLoginReader | null
  /** The sign-in is done: check the Provider again and read its usage again. */
  afterSignIn(provider: Provider): void
  onData(id: string, data: string): void
  onState(id: string, state: SignInState): void
  env?: NodeJS.ProcessEnv
  every?(run: () => void, ms: number): () => void
  after?(run: () => void, ms: number): () => void
  log?(line: string): void
}

export interface SignIns {
  start(request: SignInRequest): Promise<SignInView>
  write(id: string, data: string): void
  resize(id: string, cols: number, rows: number): void
  /** Kills the terminal and forgets it. Nothing else changes. */
  cancel(id: string): void
  /** Every terminal, on quit. */
  cancelAll(): void
}

interface Running {
  pty: PtySession
  state: SignInState
  stop(): void
}

export function createSignIns(options: SignInOptions): SignIns {
  const {
    accounts,
    providers,
    runtimeOf,
    spawnIn,
    folder,
    makeDir = (path: string) => mkdirSync(path, { recursive: true }),
    loginOf,
    afterSignIn,
    onData,
    onState,
    env = process.env,
    every = (run, ms) => {
      const timer = setInterval(run, ms)
      return () => clearInterval(timer)
    },
    after = (run, ms) => {
      const timer = setTimeout(run, ms)
      return () => clearTimeout(timer)
    },
    log = console.warn,
  } = options
  const running = new Map<string, Running>()

  function close(id: string): void {
    const entry = running.get(id)
    if (!entry) return
    running.delete(id)
    entry.stop()
    try {
      entry.pty.kill()
    } catch {
      // It had already exited.
    }
  }

  function accountOf({ provider, accountId }: SignInRequest): ProviderAccount | null {
    if (accountId === null) return accounts.of(provider)[0] ?? null
    const found = accounts.list().find((account) => account.id === accountId)
    if (!found || found.provider !== provider) throw new Error(`Unknown account: ${accountId}`)
    return found
  }

  return {
    async start(request) {
      const { provider } = request
      if (!isProvider(provider)) throw new Error(`Unknown Provider: ${String(provider)}`)
      const adapter = providers[provider]
      if (!adapter) throw new Error(`${providerEntry(provider).name} is not on this machine`)
      const account = accountOf(request)
      const support = adapter.accounts?.() ?? null
      // An account TinyCorp made has a folder of its own; the Provider's own default has none here.
      const own = account && !account.primary ? account.configDir : null
      const login: LoginAccount | null = account ? { id: account.id, configDir: own } : null
      const runtime = runtimeOf(provider)
      const flow = providerEntry(provider).auth.signIn

      const cwd = join(folder, provider)
      makeDir(cwd)
      // Only ever a folder TinyCorp made, in its own account config: the boss's own `~/.claude` is
      // never written, and the modal's sentence tells them to answer yes there instead.
      if (own && support?.trustFolder) {
        try {
          support.trustFolder(own, runtimePaths(runtime).toRuntime(cwd))
        } catch (error) {
          log(`Sign-in: could not mark ${cwd} trusted: ${(error as Error).message}`)
        }
      }

      const read = loginOf(provider)
      const before = read ? await read(login).catch(() => null) : null
      // A folder TinyCorp made that holds no login yet is a first run, where the product has one.
      const args = own && !before && flow.firstRunArgs ? flow.firstRunArgs : flow.args
      const pty = spawnIn(provider)(providerEntry(provider).command, [...args], {
        cwd,
        env: { ...plain(env), ...(account && own ? configDirVars(adapter, own) : {}) },
        cols: 80,
        rows: 24,
      })

      const id = randomUUID()
      let shown = ''
      const stops: (() => void)[] = []
      const entry: Running = {
        pty,
        state: { phase: 'waiting', step: 0 },
        stop: () => {
          for (const stop of stops.splice(0)) stop()
        },
      }
      running.set(id, entry)

      const move = (state: SignInState) => {
        entry.state = state
        onState(id, state)
      }

      const signedIn = (plan: string | null) => {
        if (entry.state.phase !== 'waiting') return
        const email = own ? emailOf(support, own) : support ? emailOf(support, support.defaultDir) : null
        move({ phase: 'signed-in', who: [email, plan].filter(Boolean).join(' · ') || null })
        onData(id, `\r\n\r\n\x1b[2m${SIGN_IN_SEEN}\x1b[0m\r\n`)
        stops.push(after(() => close(id), CLOSE_AFTER_MS))
        afterSignIn(provider)
      }

      let asking = false
      const look = async (): Promise<boolean> => {
        if (!read || asking || entry.state.phase !== 'waiting') return false
        asking = true
        try {
          const now = await read(login).catch(() => null)
          if (now && now.fingerprint !== before?.fingerprint) {
            signedIn(now.plan)
            return true
          }
          return false
        } finally {
          asking = false
        }
      }

      stops.push(
        pty.onData((data) => {
          onData(id, data)
          if (entry.state.phase !== 'waiting') return
          shown = (shown + stripAnsi(data)).slice(-SHOWN_LIMIT)
          const step = stepReached(flow.steps, shown)
          if (step !== entry.state.step) move({ phase: 'waiting', step })
        }),
        pty.onExit(({ exitCode }) => {
          if (entry.state.phase !== 'waiting') return
          // A product TinyCorp cannot read says it is done by leaving cleanly; one it can read is
          // looked at once more, because the login is written just before the CLI exits.
          if (!read) {
            if (exitCode === 0) signedIn(null)
            else move({ phase: 'ended', reason: SIGN_IN_ENDED })
            return
          }
          void look().then((found) => {
            if (!found && entry.state.phase === 'waiting') move({ phase: 'ended', reason: SIGN_IN_ENDED })
          })
        }),
      )
      if (read) stops.push(every(() => void look(), POLL_MS))

      return {
        id,
        provider,
        sub: signInSub(account?.label ?? null, runtime),
        state: entry.state,
      }
    },

    write(id, data) {
      running.get(id)?.pty.write(data)
    },

    resize(id, cols, rows) {
      running.get(id)?.pty.resize(cols, rows)
    },

    cancel: close,

    cancelAll() {
      for (const id of [...running.keys()]) close(id)
    },
  }
}

function isProvider(value: unknown): value is Provider {
  return (PROVIDERS as readonly unknown[]).includes(value)
}

/** The address beside a login, where the product writes one; a read that fails is no address. */
function emailOf(support: { email?(configDir: string): string | null } | null, configDir: string): string | null {
  try {
    return support?.email?.(configDir) ?? null
  } catch {
    return null
  }
}

/** An environment as the PTY takes one: no variable that is set to nothing. */
function plain(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined))
}
