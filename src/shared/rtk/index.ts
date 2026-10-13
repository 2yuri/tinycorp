import type { Provider } from '../domain/providers'

/**
 * RTK (https://github.com/rtk-ai/rtk, Apache-2.0), as TinyCorp holds it (T179).
 *
 * Most of what an Employee reads is command output: `git status`, a diff, a test run, `ls`, a log.
 * RTK is a single Rust binary that rewrites those commands to `rtk <cmd>` before they run and hands
 * back filtered output — failures only, grouped matches, compact stats — which it reports cuts
 * 60–90% of that output.
 *
 * Three rules hold everywhere below, and they are why this is a file of its own rather than a flag
 * somewhere:
 *
 * - **TinyCorp never installs it.** The boss runs one line; the app finds it or says it cannot.
 * - **It is hooked per Session**, into the config TinyCorp already writes for that Session, and
 *   never through `rtk init -g`, which would edit the boss's own global agent config.
 * - **The savings are an estimate.** RTK ships no tokenizer and counts bytes ÷ 4, and command
 *   output is only part of what a Session spends. Every number here says so, and none of them is
 *   ever mixed into the usage bars.
 */

/** The command RTK is looked for under. It is `rtk.exe` on Windows, which the resolver handles. */
export const RTK_COMMAND = 'rtk'

/**
 * The first RTK whose hook is a native binary — `rtk hook <agent>` — on every platform. Before it
 * the Claude Code hook was a shell script that needed `sh` and `jq`, which is not something that
 * runs on a Windows without Git Bash, so an older RTK reads here as too old rather than as a hook
 * that works on two of the three platforms TinyCorp ships on.
 */
export const RTK_MIN_VERSION = '0.37.2'

/**
 * Where RTK stands on this machine.
 *
 * - `found`: on `PATH`, new enough, and the right `rtk`.
 * - `missing`: nothing answers to `rtk`, or what does is not this one (see {@link RTK_CLASH_ARGS}).
 * - `too-old`: below {@link RTK_MIN_VERSION}.
 * - `missing-in-wsl`: found where TinyCorp runs, and absent from a distro an Employee's Provider
 *   runs in (T167). Those Employees run uncompressed; the rest are hooked.
 */
export type RtkState = 'found' | 'missing' | 'too-old' | 'missing-in-wsl'

export interface RtkStatus {
  state: RtkState
  /** What `rtk --version` said, e.g. `0.41.0`. Null when nothing answered. */
  version: string | null
  /** The binary's own path, as the status row prints it. Null when it was not found. */
  path: string | null
  /** The WSL distros an Employee's Provider runs in that have no RTK inside them. */
  missingIn: readonly string[]
}

/** What the app knows before it has looked, and what it reports on a machine with no RTK. */
export const RTK_NOT_FOUND: RtkStatus = { state: 'missing', version: null, path: null, missingIn: [] }

/**
 * The arguments that tell this RTK from the other one. A different project named `rtk` — Rust Type
 * Kit — is on crates.io, and a boss who ran `cargo install rtk` has a binary that answers
 * `--version` and knows nothing about command output. `rtk gain` is this RTK's own subcommand, so
 * asking it for its help is the question only the right binary answers.
 */
export const RTK_CLASH_ARGS = ['gain', '--help'] as const

/** Whether any Session can be hooked at all. A distro without it is a partial yes, not a no. */
export function rtkUsable(status: RtkStatus): boolean {
  return status.state === 'found' || status.state === 'missing-in-wsl'
}

/**
 * The version `rtk --version` printed, or null when its answer named none. RTK prints `rtk 0.41.0`;
 * a build from git adds more after it, and only the first three numbers are read.
 */
export function rtkVersionOf(output: string): string | null {
  const found = /(\d+)\.(\d+)\.(\d+)/.exec(output)
  return found ? `${found[1]}.${found[2]}.${found[3]}` : null
}

/** Whether `version` is {@link RTK_MIN_VERSION} or newer. An unreadable version is never enough. */
export function rtkNewEnough(version: string | null, minimum = RTK_MIN_VERSION): boolean {
  if (!version) return false
  const parts = (text: string) => text.split('.').map((part) => Number.parseInt(part, 10) || 0)
  const [major = 0, minor = 0, patch = 0] = parts(version)
  const [wantMajor = 0, wantMinor = 0, wantPatch = 0] = parts(minimum)
  if (major !== wantMajor) return major > wantMajor
  if (minor !== wantMinor) return minor > wantMinor
  return patch >= wantPatch
}

/** One line the boss runs, and the platform it is for. The tab draws it with a Copy button. */
export interface RtkCommand {
  /** `macOS`, `Windows`, `Linux`, or a distro's own name. */
  label: string
  command: string
  /**
   * What the row prints, when the whole line is too long for it — the install script's URL is
   * 78 characters and the card is not. Copy always puts {@link command} on the clipboard: a line
   * the boss can read and a line that works have to be the same line when they paste it.
   */
  shown?: string
}

/** RTK's own installer, which is the Linux line and the one that runs inside a WSL distro. */
export const RTK_INSTALL_SCRIPT =
  'curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | sh'

/** The same line as frame `p4np9V` prints it, with the URL's middle elided. */
export const RTK_INSTALL_SCRIPT_SHOWN = 'curl -fsSL \u2026/install.sh | sh'

/** The three lines frame `p4np9V` draws under *RTK isn't on this computer*, in its order. */
export const RTK_INSTALL: readonly RtkCommand[] = [
  { label: 'macOS', command: 'brew install rtk' },
  { label: 'Windows', command: 'winget install rtk-ai.rtk' },
  { label: 'Linux', command: RTK_INSTALL_SCRIPT, shown: RTK_INSTALL_SCRIPT_SHOWN },
]

/** How an RTK that is here is brought up to date, per platform. */
export const RTK_UPGRADE: Record<'darwin' | 'win32' | 'linux', RtkCommand> = {
  darwin: { label: 'macOS', command: 'brew upgrade rtk' },
  win32: { label: 'Windows', command: 'winget upgrade rtk-ai.rtk' },
  linux: { label: 'Linux', command: RTK_INSTALL_SCRIPT, shown: RTK_INSTALL_SCRIPT_SHOWN },
}

/** The lines the Tokens tab offers for `status`, or none at all when RTK is here and current. */
export function rtkFixCommands(status: RtkStatus, platform: string): readonly RtkCommand[] {
  if (status.state === 'missing') return RTK_INSTALL
  if (status.state === 'too-old') return [upgradeFor(platform)]
  // Found on the host, missing inside the distros Employees work in: one line each, run in there.
  return status.missingIn.map((distro) => ({
    label: distro,
    command: RTK_INSTALL_SCRIPT,
    shown: RTK_INSTALL_SCRIPT_SHOWN,
  }))
}

function upgradeFor(platform: string): RtkCommand {
  if (platform === 'win32') return RTK_UPGRADE.win32
  if (platform === 'darwin') return RTK_UPGRADE.darwin
  return RTK_UPGRADE.linux
}

/** The status row's own title and body, in the frames' words (`L0glbm`, `p4np9V`). */
export function rtkStatusWords(status: RtkStatus): { title: string; body: string } {
  switch (status.state) {
    case 'found':
      return {
        title: `RTK ${status.version} found`,
        body: status.path ?? '',
      }
    case 'too-old':
      return {
        title: `RTK ${status.version} is too old`,
        body:
          `TinyCorp needs ${RTK_MIN_VERSION} or newer, the first whose hook runs on every ` +
          'platform. Employees run uncompressed until then.',
      }
    case 'missing-in-wsl':
      return {
        title: `Found on Windows, not in ${listOf(status.missingIn)}`,
        body:
          `RTK ${status.version} is on Windows. Employees that run in WSL use the RTK inside the ` +
          'distro, and run uncompressed until it is there.',
      }
    default:
      return {
        title: 'RTK isn’t on this computer',
        body: 'TinyCorp doesn’t install it for you. Run one line, then Check again.',
      }
  }
}

/**
 * The line under `Compress command output`, which says who it is on for — and, where RTK cannot
 * run yet, what would turn it on. The frames write a different one in each of the four states
 * (`L0glbm`, `Pzs8W`, `VHnp1`, `q3YiCf`), so the switch is here rather than a ternary per screen.
 */
export function rtkCompressWords(status: RtkStatus, companyName: string): string {
  switch (status.state) {
    case 'found':
      return `Every Employee in ${companyName}. Hooked into each session’s own worktree; your global settings are never touched.`
    case 'too-old':
      return `Available once RTK is ${RTK_MIN_VERSION} or newer.`
    case 'missing-in-wsl':
      return `On for Employees on Windows. Employees in WSL join once RTK is inside ${listOf(status.missingIn)}.`
    default:
      return 'Available once RTK is found.'
  }
}

/** `Ubuntu`, `Ubuntu and Debian`, `Ubuntu, Debian and Alpine`. */
function listOf(names: readonly string[]): string {
  if (names.length === 0) return 'the distro'
  if (names.length === 1) return names[0]!
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** The Company's own two switches. Both live in the Company database; neither touches the machine. */
export interface RtkSettings {
  /** Whether Sessions of this Company are hooked. On by default, and only ever on where RTK is. */
  enabled: boolean
  /** Whether RTK's own anonymous daily ping may go out. Off unless the boss turns it on. */
  ping: boolean
}

/** What a Company that has never touched the Tokens tab runs with. */
export const RTK_SETTINGS_DEFAULT: RtkSettings = { enabled: true, ping: false }

/**
 * The RTK a Session is spawned with: the binary, this Company's own history file, and whether the
 * ping may go out. A Session that is not hooked is handed none of it.
 */
export interface RtkHook {
  /** The binary's full path, as the hook command names it. */
  path: string
  /** `RTK_DB_PATH` for this Company — in the app's data folder, never in a repo. */
  dbPath: string
  ping: boolean
}

/** RTK blocks its own telemetry whatever its stored consent says when this is set. */
export const RTK_TELEMETRY_ENV = 'RTK_TELEMETRY_DISABLED'

/** Where RTK keeps its history. One per Company, so no Company reads the boss's own numbers. */
export const RTK_DB_ENV = 'RTK_DB_PATH'

/**
 * What a hooked Session carries on its process, and nothing when it is not hooked.
 *
 * The ping is off unless the boss turned it on: RTK's own consent is the boss's to give for their
 * own terminal, and an Employee is not a person who was asked.
 */
export function rtkEnv(rtk: RtkHook | null): Record<string, string> {
  if (!rtk) return {}
  return { [RTK_DB_ENV]: rtk.dbPath, ...(rtk.ping ? {} : { [RTK_TELEMETRY_ENV]: '1' }) }
}

/** One Provider's row under HOW IT HOOKS IN. */
export interface RtkHookRow {
  provider: Provider
  /** The product's full name, from the catalogue. */
  name: string
  /** How this product hooks in, or null when it has no command rewrite at all. */
  how: string | null
  /**
   * Whether a rewritten command still stops at TinyCorp's approval when the Employee asks first.
   * False leaves that Employee unhooked rather than widening what a Session may do unasked.
   */
  keepsApprovals: boolean
}

/** What a Provider's row says on the right. */
export function rtkHookBadge(row: RtkHookRow, hooked: boolean): string {
  if (!row.how) return 'Not hooked'
  if (!hooked) return 'Off'
  return row.keepsApprovals ? 'Hooked' : 'Hooked · not when asking'
}

/**
 * What RTK says it saved, for a window of days. An estimate, and labelled one everywhere it is
 * drawn: RTK counts bytes ÷ 4, and command output is only part of what a Session spends.
 */
export interface RtkSavings {
  /** Command output cut, as a whole percentage. */
  cutPercent: number
  /** Tokens not read, estimated. */
  tokensNotRead: number
  commandsFiltered: number
}

/** The days one `Saved this week` covers, counting today. */
export const RTK_WEEK_DAYS = 7

/**
 * `rtk gain --daily --format json`, read.
 *
 * `since` keeps it to the days from that date on, which is what *this week* means; without one the
 * whole summary is read. Anything that is not the JSON this RTK writes — an older RTK, a different
 * `rtk`, a binary that printed a warning first — is null, and the tab says it cannot read the
 * numbers rather than drawing invented ones.
 */
export function parseRtkGain(text: string, since?: string): RtkSavings | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null
  const days = Array.isArray(parsed['daily']) ? parsed['daily'].filter(isRecord) : null
  if (since && days) return fromDays(days.filter((day) => typeof day['date'] === 'string' && day['date'] >= since))
  const summary = parsed['summary']
  if (!isRecord(summary)) return days ? fromDays(days) : null
  const input = number(summary['total_input'])
  const saved = number(summary['total_saved'])
  const commands = number(summary['total_commands'])
  if (input === null || saved === null || commands === null) return null
  const pct = number(summary['avg_savings_pct'])
  return {
    cutPercent: Math.round(pct ?? cutOf(saved, input)),
    tokensNotRead: Math.round(saved),
    commandsFiltered: Math.round(commands),
  }
}

/** The days of the window, added up. A window RTK has no day for is a real zero, not a failure. */
function fromDays(days: readonly Record<string, unknown>[]): RtkSavings {
  let input = 0
  let saved = 0
  let commands = 0
  for (const day of days) {
    input += number(day['input_tokens']) ?? 0
    saved += number(day['saved_tokens']) ?? 0
    commands += number(day['commands']) ?? 0
  }
  return { cutPercent: Math.round(cutOf(saved, input)), tokensNotRead: Math.round(saved), commandsFiltered: commands }
}

function cutOf(saved: number, input: number): number {
  return input > 0 ? (saved / input) * 100 : 0
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** The ISO date {@link RTK_WEEK_DAYS} days back from `now`, which is where *this week* starts. */
export function rtkWeekStart(now: Date, days = RTK_WEEK_DAYS): string {
  const start = new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000)
  return start.toISOString().slice(0, 10)
}

/** `1.8M`, `4,212`, `980` — the stat cards' own rounding, which never invents precision. */
export function rtkTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (tokens >= 10_000) return `${Math.round(tokens / 1000)}K`
  return tokens.toLocaleString('en-US')
}

/** The chip in an Employee's terminal header (frame `p4np9V`), and its hover text. */
export interface RtkChip {
  label: string
  title: string
}

/**
 * The chip, or null when there is nothing to say.
 *
 * `session` is false when RTK cannot be asked for one Session's own window — it keeps its history
 * by day, not by conversation — and the chip then reports the Company's number and drops *this
 * session* rather than labelling a Company figure as one Session's.
 */
export function rtkChip(savings: RtkSavings | null, session: boolean): RtkChip | null {
  if (!savings || savings.commandsFiltered === 0) return null
  const window = session ? ' this session' : ''
  return {
    label: `RTK · ${savings.cutPercent}% cut${window}`,
    title:
      `Command output this Employee read, filtered by RTK. ` +
      `${savings.commandsFiltered.toLocaleString('en-US')} commands, about ` +
      `${rtkTokenCount(savings.tokensNotRead)} tokens not read. An estimate: RTK counts bytes ÷ 4.`,
  }
}
