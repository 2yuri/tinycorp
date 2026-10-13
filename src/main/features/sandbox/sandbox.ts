import { readFileSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'
import {
  AI_JAIL_COMMAND,
  type LinuxFlavour,
  linuxFlavour,
  SANDBOX_NOT_FOUND,
  SANDBOX_SETTINGS_DEFAULT,
  SANDBOX_UNSUPPORTED,
  type SandboxCommand,
  type SandboxSettings,
  type SandboxStatus,
  sandboxInstall,
  sandboxLookedIn,
  sandboxUsable,
  sandboxVersionOf,
} from '../../../shared/sandbox'
import type { Migration } from '../../core'
import { type RunCli, runCli as realRunCli, resolveCli } from '../../platform'

/**
 * ai-jail on this machine, and what this Company does with it (T260).
 *
 * Two jobs, and it is one module because they share one cached answer: find ai-jail where the
 * Employee's Provider really runs, and hold the Company's one switch. It never installs anything
 * and never writes outside this Company's own database — ai-jail is GPL-3.0-only, so TinyCorp runs
 * it and never ships it.
 *
 * The detection is deliberately cheap and deliberately honest. `ai-jail --version` is the whole of
 * it: there is no second binary called `ai-jail` to tell this one apart from, which is the question
 * RTK has to ask, and no minimum version to enforce yet — every flag this add-on uses
 * (`--agent-state`, `--worktree`, `--network`, `--ro-map`, `--rw-map`, `--env`) has been there since
 * long before the release the report was read against. A minimum arrives the day we need a flag
 * that has not.
 */

/** The Company's one switch. */
export const SANDBOX_MIGRATION: Migration = {
  name: 'sandbox-add-on',
  sql: `
  CREATE TABLE sandbox_setting (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    enabled INTEGER NOT NULL
  );
`,
}

export interface SandboxOptions {
  /** The current Company's database; throws when none is open. */
  current(): DatabaseSync
  /** Runs `ai-jail`. Injected, so no test ever needs the binary. */
  runCli?: RunCli
  /** Where `ai-jail` is on this machine, or null. The same resolver every Provider CLI is found with. */
  resolve?: (command: string) => string | null
  /**
   * The distro the team's Providers run in, when they run in WSL (T167, T258). ai-jail runs in
   * there and not on the Windows around it, so that is where it is looked for and where the install
   * line is run. Null everywhere else, which is every Mac and every Linux desktop.
   */
  distro?: () => string | null
  /** Where `ai-jail` is inside that distro, asked through the same probe the Providers card used. */
  resolveInDistro?: (command: string, distro: string) => string | null
  platform?: NodeJS.Platform
  /** `/etc/os-release`, for the one question the install line asks. Injected for the tests. */
  readOsRelease?: () => string | null
}

/** What the engine is told about this machine, so a test can answer for it without a binary. */
export type SandboxMachine = Omit<SandboxOptions, 'current'>

export interface SandboxService {
  /** Where ai-jail stands, detecting once on the first ask and remembering the answer. */
  status(): Promise<SandboxStatus>
  /** What the last detection said, without asking the machine. */
  cached(): SandboxStatus
  /** `Check again`: forgets the answer and asks the machine again. */
  recheck(): Promise<SandboxStatus>
  /** The line the boss runs on this machine, or none where there is nothing to install. */
  install(): SandboxCommand[]
  /** This Company's switch. */
  settings(): SandboxSettings
  setSettings(patch: Partial<SandboxSettings>): SandboxSettings
  /**
   * Whether a Session of this Company is jailed, read at spawn and nowhere else — which is what
   * *off means off at the next start* is. False when the Company turned it off, and false when
   * ai-jail is not there to run, because a Session that cannot be jailed still has to start.
   */
  jailed(): boolean
  /** Fires when the toggle or the detected status changes. Returns an unsubscribe function. */
  onChange(listener: () => void): () => void
}

export function createSandbox({
  current,
  runCli = realRunCli,
  resolve = (command) => resolveCli(command),
  distro = () => null,
  resolveInDistro = () => null,
  platform = process.platform,
  readOsRelease = () => readTextFile('/etc/os-release'),
}: SandboxOptions): SandboxService {
  const listeners = new Set<() => void>()
  let known: SandboxStatus = SANDBOX_NOT_FOUND
  let asking: Promise<SandboxStatus> | null = null

  function changed(): void {
    for (const listener of [...listeners]) listener()
  }

  async function detect(): Promise<SandboxStatus> {
    const found = await detectSandbox({ runCli, resolve, distro, resolveInDistro, platform })
    known = found
    changed()
    return found
  }

  function settingsRow(): SandboxSettings {
    const row = current().prepare('SELECT enabled FROM sandbox_setting WHERE id = 1').get() as
      | { enabled: number }
      | undefined
    if (!row) return SANDBOX_SETTINGS_DEFAULT
    return { enabled: row.enabled === 1 }
  }

  function status(): Promise<SandboxStatus> {
    asking ??= detect()
    return asking
  }

  return {
    status,
    cached: () => known,
    recheck() {
      known = SANDBOX_NOT_FOUND
      asking = null
      return status()
    },
    install() {
      const inside = distro()
      // The distro's own flavour picks the line, not the Windows around it: `yay` belongs to the
      // Arch an Employee runs in, and reading this machine's `/etc/os-release` there would answer
      // for the wrong computer. A distro we cannot read is offered Cargo, which works wherever Rust does.
      const flavour: LinuxFlavour = inside ? 'other' : linuxFlavour(readOsRelease())
      return sandboxInstall({ platform, flavour, distro: inside })
    },
    settings: settingsRow,
    setSettings(patch) {
      const next = { ...settingsRow(), ...patch }
      current()
        .prepare(
          'INSERT INTO sandbox_setting (id, enabled) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET enabled = excluded.enabled',
        )
        .run(next.enabled ? 1 : 0)
      changed()
      return next
    },
    jailed() {
      if (!sandboxUsable(known)) return false
      try {
        return settingsRow().enabled
      } catch {
        // No Company open, or a database that has gone: the Session starts unjailed rather than not at all.
        return false
      }
    },
    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export interface DetectSandboxOptions {
  runCli: RunCli
  resolve: (command: string) => string | null
  distro: () => string | null
  resolveInDistro: (command: string, distro: string) => string | null
  platform: NodeJS.Platform
}

/**
 * Where ai-jail stands, asked of the machine an Employee's Provider really runs on.
 *
 * Windows itself answers before anything is looked for: ai-jail does not run there at all, and
 * *there is nothing to install* is a different sentence from *you have not installed it yet*. A
 * Windows whose team runs inside a distro is not that case — ai-jail is looked for **in the
 * distro**, on the same `PATH` the Provider's own CLI was found on (T258).
 */
export async function detectSandbox({
  runCli,
  resolve,
  distro,
  resolveInDistro,
  platform,
}: DetectSandboxOptions): Promise<SandboxStatus> {
  const inside = distro()
  if (platform === 'win32' && !inside) return SANDBOX_UNSUPPORTED
  const lookedIn = sandboxLookedIn(inside)
  const path = inside ? resolveInDistro(AI_JAIL_COMMAND, inside) : resolve(AI_JAIL_COMMAND)
  if (!path) return { ...SANDBOX_NOT_FOUND, lookedIn }
  const version = await runCli(path, ['--version'])
  if (version.kind !== 'output') return { ...SANDBOX_NOT_FOUND, lookedIn }
  const number = sandboxVersionOf(version.output)
  // A binary that answers but names no version is not one we can report on, so it reads as missing
  // rather than as a Found row with a blank where the version goes.
  if (!number) return { ...SANDBOX_NOT_FOUND, lookedIn }
  return { state: 'found', version: number, path, lookedIn }
}

/** A file's text, or null when there is none — a container, or a distro that ships no os-release. */
function readTextFile(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}
