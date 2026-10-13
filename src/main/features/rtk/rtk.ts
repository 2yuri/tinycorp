import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { PROVIDERS, type Provider, providerEntry } from '../../../shared/domain/providers'
import {
  parseRtkGain,
  RTK_CLASH_ARGS,
  RTK_COMMAND,
  RTK_NOT_FOUND,
  RTK_SETTINGS_DEFAULT,
  type RtkHook,
  type RtkHookRow,
  type RtkSavings,
  type RtkSettings,
  type RtkStatus,
  rtkEnv,
  rtkNewEnough,
  rtkUsable,
  rtkVersionOf,
  rtkWeekStart,
} from '../../../shared/rtk'
import type { Migration } from '../../core'
import { type RunCli, runCli as realRunCli, resolveCli } from '../../platform'
import type { ProviderAdapter } from '../../providers'

/**
 * RTK on this machine, and what this Company does with it (T179).
 *
 * Three jobs, and it is one module because they share one cached answer:
 *
 * 1. **Find it.** A `PATH` walk through the same resolver every Provider CLI is found with, then
 *    two questions asked of the binary itself — how old it is, and whether it is the right `rtk`.
 * 2. **Hand it to a Session.** The engine asks for a {@link RtkHook} at every spawn; the adapters
 *    do the rest, each in its own product's config.
 * 3. **Read back what it saved.** `rtk gain`, against this Company's own history file.
 *
 * It never installs anything, never runs `rtk init`, and never writes outside the app's own data
 * folder and the Session configs TinyCorp already writes.
 */

/** The Company's own two switches. */
export const RTK_MIGRATION: Migration = {
  name: 'rtk-command-output-compression',
  sql: `
  CREATE TABLE rtk_setting (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    enabled INTEGER NOT NULL,
    ping INTEGER NOT NULL
  );
`,
}

/** One WSL distro an Employee's Provider runs in, and whether RTK is inside it (T167). */
export interface RtkDistro {
  distro: string
  /** Where `rtk` is inside that distro, or null when it is not there. */
  path: string | null
}

export interface RtkOptions {
  /** The current Company's database; throws when none is open. */
  current(): DatabaseSync
  /** The current Company's id; throws when none is open. */
  currentId(): string
  /** The app's own folder for RTK's per-Company history. Never a Company folder, never a repo. */
  dataDir: string
  /** Every Provider's adapter, so the tab can say how each of them hooks in. */
  providers: Partial<Record<Provider, ProviderAdapter>>
  /** Runs `rtk`. Injected, so no test ever needs the binary. */
  runCli?: RunCli
  /** Where `rtk` is on this machine, or null. The same resolver every Provider CLI is found with. */
  resolve?: (command: string) => string | null
  /**
   * The distros an Employee's Provider runs in, and whether RTK is inside each (T167). Empty
   * everywhere but a Windows with WSL, and left out by every test that is not about one.
   */
  distros?: () => readonly RtkDistro[]
  platform?: NodeJS.Platform
  /** Now, for the week `Saved this week` covers. */
  now?: () => Date
}

/**
 * What the engine is told about this machine, so a test can answer for it without a binary. `dir`
 * is the app's own folder for the per-Company history files.
 */
export type RtkMachine = Pick<RtkOptions, 'runCli' | 'resolve' | 'distros' | 'platform' | 'now'> & { dir?: string }

export interface RtkService {
  /** Where RTK stands, detecting once on the first ask and remembering the answer. */
  status(): Promise<RtkStatus>
  /** What the last detection said, without asking the machine. {@link RTK_NOT_FOUND} before one. */
  cached(): RtkStatus
  /** `Check again`: forgets the answer and asks the machine again. */
  recheck(): Promise<RtkStatus>
  /** This Company's switches. */
  settings(): RtkSettings
  setSettings(patch: Partial<RtkSettings>): RtkSettings
  /**
   * What a Session of `companyId` is spawned with, or null when it is spawned with none: the
   * Company turned it off, RTK is not here, or it is too old.
   *
   * Read at spawn and nowhere else, which is what *off means off at the next start* is: a Session
   * already running keeps the hook it was started with, and its files are not edited mid-turn.
   */
  hookFor(companyId: string): RtkHook | null
  /** How each Provider hooks in, for the Tokens tab. In catalogue order. */
  rows(): RtkHookRow[]
  /** What RTK says this Company saved this week, or null when it could not be read. */
  savings(): Promise<RtkSavings | null>
  /** Fires when the toggles or the detected status change. Returns an unsubscribe function. */
  onChange(listener: () => void): () => void
}

export function createRtk({
  current,
  currentId,
  dataDir,
  providers,
  runCli = realRunCli,
  resolve = (command) => resolveCli(command),
  distros = () => [],
  platform = process.platform,
  now = () => new Date(),
}: RtkOptions): RtkService {
  const listeners = new Set<() => void>()
  let known: RtkStatus = RTK_NOT_FOUND
  let asking: Promise<RtkStatus> | null = null

  function changed(): void {
    for (const listener of [...listeners]) listener()
  }

  async function detect(): Promise<RtkStatus> {
    const found = await detectRtk({ runCli, resolve, distros, platform })
    known = found
    changed()
    return found
  }

  function settingsRow(): RtkSettings {
    const row = current().prepare('SELECT enabled, ping FROM rtk_setting WHERE id = 1').get() as
      | { enabled: number; ping: number }
      | undefined
    if (!row) return RTK_SETTINGS_DEFAULT
    return { enabled: row.enabled === 1, ping: row.ping === 1 }
  }

  /** This Company's own history file, in the app's data folder — never in a repo it works in. */
  function dbPath(companyId: string): string {
    return join(dataDir, companyId, 'history.db')
  }

  /**
   * The detection, once. The promise is kept rather than the answer, so two screens that ask while
   * it is still running wait on the same one lookup — and `recheck` is the only thing that drops it.
   */
  function status(): Promise<RtkStatus> {
    asking ??= detect()
    return asking
  }

  return {
    status,
    cached: () => known,
    recheck() {
      known = RTK_NOT_FOUND
      asking = null
      return status()
    },
    settings: settingsRow,
    setSettings(patch) {
      const next = { ...settingsRow(), ...patch }
      current()
        .prepare(
          'INSERT INTO rtk_setting (id, enabled, ping) VALUES (1, ?, ?) ON CONFLICT (id) DO UPDATE SET enabled = excluded.enabled, ping = excluded.ping',
        )
        .run(next.enabled ? 1 : 0, next.ping ? 1 : 0)
      changed()
      return next
    },
    hookFor(companyId) {
      if (!rtkUsable(known) || !known.path) return null
      let on: RtkSettings
      try {
        on = settingsRow()
      } catch {
        // No Company open, or a database that has gone: a Session then runs uncompressed.
        return null
      }
      if (!on.enabled) return null
      return { path: known.path, dbPath: dbPath(companyId), ping: on.ping }
    },
    rows() {
      return PROVIDERS.map((provider) => {
        const adapter = providers[provider]
        const hook = adapter?.commandRewriteHook?.(null)
        return {
          provider,
          name: providerEntry(provider).name,
          how: hook?.how ?? null,
          keepsApprovals: hook?.keepsApprovals ?? false,
        }
      })
    },
    async savings() {
      if (!known.path) return null
      let companyId: string
      try {
        companyId = currentId()
      } catch {
        return null
      }
      return readRtkSavings({ runCli, path: known.path, dbPath: dbPath(companyId), now: now() })
    },
    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export interface DetectRtkOptions {
  runCli: RunCli
  resolve: (command: string) => string | null
  distros: () => readonly RtkDistro[]
  platform: NodeJS.Platform
}

/**
 * Where RTK stands, asked of the machine.
 *
 * Two questions of the binary, in this order, because they fail differently:
 *
 * 1. `rtk --version`, which says how old it is. Below RTK_MIN_VERSION the hook is the old
 *    shell script that needs `sh` and `jq`, and TinyCorp says *too old* rather than hooking two
 *    platforms out of three.
 * 2. `rtk gain --help`. Another project called `rtk` — Rust Type Kit — is on crates.io and answers
 *    `--version` perfectly happily. `gain` is this RTK's own subcommand, so a binary that does not
 *    know it is not this one, and the answer is *missing* rather than a hook that rewrites nothing.
 *
 * Neither costs the boss anything: no subscription, no network, no write.
 */
export async function detectRtk({ runCli, resolve, distros, platform }: DetectRtkOptions): Promise<RtkStatus> {
  const path = resolve(RTK_COMMAND)
  if (!path) return RTK_NOT_FOUND
  const version = await runCli(path, ['--version'])
  if (version.kind !== 'output') return RTK_NOT_FOUND
  const number = rtkVersionOf(version.output)
  if (!number) return RTK_NOT_FOUND
  // Asked before the version is judged: a Rust Type Kit that happens to print `0.41.0` must read as
  // *not installed*, not as an RTK that is new enough.
  const clash = await runCli(path, [...RTK_CLASH_ARGS])
  if (clash.kind !== 'output' || clash.code !== 0) return RTK_NOT_FOUND
  if (!rtkNewEnough(number)) return { state: 'too-old', version: number, path, missingIn: [] }
  // A Provider inside a distro runs the RTK inside that distro; the one on Windows is not on its
  // `PATH` and could not rewrite a command there (T167).
  const missingIn =
    platform === 'win32'
      ? distros()
          .filter((one) => one.path === null)
          .map((one) => one.distro)
      : []
  return { state: missingIn.length > 0 ? 'missing-in-wsl' : 'found', version: number, path, missingIn }
}

export interface ReadSavingsOptions {
  runCli: RunCli
  /** The RTK binary. */
  path: string
  /** This Company's history file. */
  dbPath: string
  now: Date
}

/**
 * What RTK says was saved this week, against one Company's own history.
 *
 * `--daily` rather than the plain summary, because *this week* is a window and RTK's summary is
 * everything it has ever seen. The telemetry variable rides along for the same reason it rides on a
 * Session: reading a number is not consent to send one.
 *
 * Null is an answer, and the tab draws no numbers for it: an RTK too old to take `--format json`,
 * one that printed a warning in front of its JSON, or a history file that is not there yet.
 */
export async function readRtkSavings({ runCli, path, dbPath, now }: ReadSavingsOptions): Promise<RtkSavings | null> {
  const outcome = await runCli(path, ['gain', '--daily', '--format', 'json'], {
    env: { ...process.env, ...rtkEnv({ path, dbPath, ping: false }) },
  })
  if (outcome.kind !== 'output') return null
  return parseRtkGain(outcome.output, rtkWeekStart(now))
}
