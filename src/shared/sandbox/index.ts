/**
 * ai-jail (https://github.com/akitaonrails/ai-jail, **GPL-3.0-only**), as TinyCorp holds it (T260).
 *
 * An Employee is a coding agent with a shell, working in a repo on the boss's own computer. The
 * Sandbox add-on puts every one of its Sessions inside ai-jail: a fresh home each launch, its
 * worktrees writable, its Session config and the Company's instructions read-only, its Provider
 * login mounted so the CLI can start, and the boss's own home unreachable.
 *
 * Three rules hold everywhere below, and they are why this is a file of its own:
 *
 * - **TinyCorp never installs it, and never ships it.** The licence is GPL-3.0-only, so ai-jail is
 *   found on the runtime's `PATH` and run as a separate program — never vendored, never a
 *   dependency, never bundled. The boss runs one line; the app finds it or says it cannot. This is
 *   the same shape RTK has since T179, for a different reason: RTK is Apache-2.0 and we still do
 *   not ship it, ai-jail is GPL-3.0 and we could not.
 * - **It is off until the boss turns it on**, per Company, and read at every spawn — so turning it
 *   off takes at the next Session and never mid-turn.
 * - **It is not a virtual machine.** The card says so in the frame's own words
 *   ({@link SANDBOX_FOOT}): it constrains a process, it does not stop a kernel or driver exploit.
 *
 * Windows itself is not a place ai-jail runs — upstream says to use WSL2 with the Linux backend —
 * so a team on Windows itself is told that rather than offered a toggle that would do nothing.
 *
 * **The network stays open, and the card says why** (T260, Step 0). ai-jail's *filtered egress*
 * (`--allow-host`) fences the sandbox down to ai-jail's own CONNECT proxy, and that proxy's SSRF
 * guard refuses loopback and every private range — upstream pins it with a test named
 * `e2e_ssrf_range_is_403_even_when_allowlisted`, and `--allow-tcp-port` fails the launch outright.
 * TinyCorp's hook receiver and Company MCP server are both HTTP on loopback and neither is
 * optional, so a filtered Session is a deaf Session. `--network` reaches loopback and cannot be
 * combined with `--allow-host`, so this add-on guards the **files** and says so in the boss's own
 * words ({@link SANDBOX_NETWORK_WHY}) rather than implying a filtering it does not do.
 * `docs/sandbox.md` carries the request that would unlock the other half.
 */

/** The command ai-jail is looked for under, on `PATH` like every other CLI. */
export const AI_JAIL_COMMAND = 'ai-jail'

/**
 * Where ai-jail stands on the machine an Employee's Provider really runs on.
 *
 * - `found`: on the runtime's `PATH`, and it answered `--version`.
 * - `missing`: nothing on that `PATH` answers to `ai-jail`.
 * - `unsupported`: this is Windows itself, where ai-jail does not run at all. Not a missing
 *   install — there is nothing to install — so it is its own state and its own sentence.
 */
export type SandboxState = 'found' | 'missing' | 'unsupported'

export interface SandboxStatus {
  state: SandboxState
  /** What `ai-jail --version` said, e.g. `2.2.0`. Null when nothing answered. */
  version: string | null
  /** The binary's own path, as the Found row prints it. Null when it was not found. */
  path: string | null
  /**
   * Where the app looked, as the `Looked in:` line prints it — `PATH`, or the distro whose `PATH`
   * was searched when the team runs in WSL (T258). Empty when there was nowhere to look.
   */
  lookedIn: string[]
}

/** What the app knows before it has looked, and what it reports on a machine with no ai-jail. */
export const SANDBOX_NOT_FOUND: SandboxStatus = { state: 'missing', version: null, path: null, lookedIn: [] }

/** Windows itself: nothing was looked for, because nothing there could answer. */
export const SANDBOX_UNSUPPORTED: SandboxStatus = { state: 'unsupported', version: null, path: null, lookedIn: [] }

/**
 * The version `ai-jail --version` printed, or null when its answer named none. It prints
 * `ai-jail 2.2.0`, and only the first three numbers are read — the same rule RTK's version takes,
 * because a build from git adds more after it.
 */
export function sandboxVersionOf(output: string): string | null {
  const found = /(\d+)\.(\d+)\.(\d+)/.exec(output)
  return found ? `${found[1]}.${found[2]}.${found[3]}` : null
}

/** Whether a Session of this Company can be jailed at all. */
export function sandboxUsable(status: SandboxStatus): boolean {
  return status.state === 'found'
}

/** One line the boss runs, and the place it is for. The card draws it with a Copy button. */
export interface SandboxCommand {
  /** `macOS`, `Arch`, `Linux`, or a distro's own name when the team runs in WSL. */
  label: string
  command: string
}

/**
 * How ai-jail is installed, per machine — its README's three ways, and no fourth invented here.
 *
 * Homebrew on macOS, `yay` on Arch (where a binary package is published), and Cargo on any other
 * Linux. Cargo is the fallback rather than a curl-to-shell line because ai-jail publishes no
 * install script, and `--locked` is upstream's own spelling.
 */
export const AI_JAIL_BREW = 'brew tap akitaonrails/tap && brew install ai-jail'
export const AI_JAIL_YAY = 'yay -S ai-jail-bin'
export const AI_JAIL_CARGO = 'cargo install --locked ai-jail'

/** Which Linux this is, as far as the install line cares. Read from `/etc/os-release`. */
export type LinuxFlavour = 'arch' | 'other'

/**
 * The `ID` and `ID_LIKE` of `/etc/os-release`, read for the one question the card asks: is this an
 * Arch, where `yay -S ai-jail-bin` is the line, or anything else, where Cargo is.
 *
 * `ID_LIKE` counts, because Manjaro and EndeavourOS are `ID=manjaro` with `ID_LIKE=arch` and both
 * have the AUR. A file that is not there — a container, a distro that ships none — reads as
 * `other`, which offers Cargo: a line that works everywhere Rust does, rather than one that works
 * only where it was guessed right.
 */
export function linuxFlavour(osRelease: string | null): LinuxFlavour {
  if (!osRelease) return 'other'
  for (const line of osRelease.split('\n')) {
    const match = /^(ID|ID_LIKE)=(.*)$/.exec(line.trim())
    if (!match) continue
    const values = match[2]!.replace(/["']/g, '').split(/\s+/)
    if (values.includes('arch')) return 'arch'
  }
  return 'other'
}

export interface SandboxInstallOptions {
  /** Where the Employee's Provider runs: this desktop, or a distro inside a Windows (T167). */
  platform: NodeJS.Platform
  /** Which Linux, when this is one. Ignored elsewhere. */
  flavour?: LinuxFlavour
  /**
   * The distro the team runs in, when the Provider runs inside WSL. The line is a Linux one and it
   * is run **in there**, so the row is labelled with the distro rather than with `Linux`.
   */
  distro?: string | null
}

/**
 * The line the boss runs, or none at all.
 *
 * None on Windows itself: there is nothing to install there, and offering `cargo install` would be
 * offering a binary that cannot run. That case is {@link SANDBOX_ON_WINDOWS} instead.
 *
 * Inside WSL the line is the distro's own — and it is the *distro's* flavour that picks it, not the
 * Windows around it, which is why `flavour` is read the same way in both places.
 */
export function sandboxInstall({
  platform,
  flavour = 'other',
  distro = null,
}: SandboxInstallOptions): SandboxCommand[] {
  if (platform === 'win32' && !distro) return []
  if (platform === 'darwin') return [{ label: 'macOS', command: AI_JAIL_BREW }]
  const command = flavour === 'arch' ? AI_JAIL_YAY : AI_JAIL_CARGO
  return [{ label: distro ?? (flavour === 'arch' ? 'Arch' : 'Linux'), command }]
}

/** The `Looked in:` line's own value. `PATH`, or the distro whose `PATH` was searched (T258). */
export function sandboxLookedIn(distro: string | null): string[] {
  return [distro ? `${distro} PATH` : 'PATH']
}

/** The status row's title and body, in the frames' words (`fBHiz` Found, `gJyAJ` Not installed). */
export function sandboxStatusWords(status: SandboxStatus): { title: string; body: string } {
  switch (status.state) {
    case 'found':
      return { title: 'Found', body: `${AI_JAIL_COMMAND} ${status.version} · ${status.path ?? ''}` }
    case 'unsupported':
      return { title: 'Not on Windows', body: SANDBOX_ON_WINDOWS }
    default:
      return { title: 'Not installed', body: 'TinyCorp runs ai-jail from your PATH and never installs it.' }
  }
}

/**
 * Whether the toggle can be pressed at all.
 *
 * Off on Windows itself, where there is nothing to turn on, and off where ai-jail is not installed
 * — the card offers the line and `Check again` instead. A Company whose setting is already on keeps
 * it: the setting is the boss's, and a machine that cannot honour it today is not a reason to
 * rewrite what they chose. What that Company's Employees get is said on the Employee's own drawer.
 */
export function sandboxToggleEnabled(status: SandboxStatus): boolean {
  return status.state === 'found'
}

/** The panel's own label, over where ai-jail stands. `{machine}` as {@link SANDBOX_NETWORK_WHY}. */
export const SANDBOX_WHERE_LABEL = 'ai-jail on {machine}'

/** The `ON WINDOWS` paragraph, in frame `fBHiz`'s words. */
export const SANDBOX_ON_WINDOWS =
  'Only inside WSL: install it in the distro your team runs in. An Employee on Windows itself runs ' +
  'without it, and its drawer says so.'

/** The add-on's name and the chip beside it, as frames `fBHiz` and `gJyAJ` draw them. */
export const SANDBOX_NAME = 'Sandbox'
export const SANDBOX_SOURCE = 'ai-jail · GPL-3.0'

/**
 * The head's one line. It promises what the jail really does — a fresh home, the worktrees
 * writable — and **nothing about the network**, which is the one thing it cannot keep.
 */
export const SANDBOX_DESCRIPTION =
  'Every Employee’s Session runs inside ai-jail: a fresh home each time, and only its worktrees writable.'

/** The `NETWORK` block: one state, and the reason it is the only one. */
export const SANDBOX_NETWORK_STATE = 'Open'
/**
 * `{machine}` is the machine's own word, put in by `inMachineWords` where it is drawn (T265): this
 * sentence is written once and read on three platforms, and *this computer* on a Mac names a
 * machine the boss is not on.
 */
export const SANDBOX_NETWORK_WHY =
  'The jail guards your files, not the network. ai-jail cannot yet let a Session reach TinyCorp on ' +
  '{machine} while it filters everything else, so the network stays open.'

/** The foot under the panel: what TinyCorp does with ai-jail, and what a sandbox is not. */
export const SANDBOX_FOOT =
  'TinyCorp runs ai-jail and never ships it. It is not a virtual machine — it does not stop a ' +
  'kernel or driver exploit.'

/**
 * Whether this Company asked for the jail and this machine cannot give it.
 *
 * True is what puts {@link SANDBOX_DRAWER_UNJAILED} on an Employee's drawer: the boss turned the
 * add-on on for the Company, and these Sessions are starting without it. It is deliberately the
 * machine's answer rather than one Employee's — on Windows itself ai-jail runs nowhere, which is
 * the case the frame describes, and a Company whose ai-jail has gone missing is in the same boat.
 */
export function sandboxUnjailed(status: SandboxStatus, settings: SandboxSettings): boolean {
  return settings.enabled && status.state !== 'found'
}

/**
 * The line an Employee's drawer draws when its Session could not be jailed although the add-on is
 * on — which is an Employee running on Windows itself (T260).
 *
 * It is words on a line the drawer already draws, and no new element: the boss turned something on
 * for the Company and this one Employee is not getting it, so it says so where they look at that
 * Employee rather than only on a settings tab they are not on.
 */
export const SANDBOX_DRAWER_UNJAILED = 'Not sandboxed — ai-jail does not run on Windows itself.'

/** One row of *What an Employee can reach*, as the frames' left panel draws them. */
export interface SandboxReach {
  what: string
  detail: string
}

/**
 * The five rows, in the frames' order. They are data rather than markup because the card and its
 * test read the same list, and a row that stopped being true would otherwise only be wrong on
 * screen — and `{machine}` is put in where they are drawn, like every other sentence here (T265).
 */
export const SANDBOX_REACH: readonly SandboxReach[] = [
  { what: 'Its worktrees', detail: 'Read and write — and nothing else in your repos.' },
  { what: 'Its Session config and the Company’s instructions', detail: 'Read only.' },
  {
    what: 'Its own login',
    detail: 'The Provider’s sign-in folder, so the Session can start. Nothing else from your home.',
  },
  { what: 'TinyCorp', detail: 'Its hooks and tools, over {machine}’s loopback.' },
  { what: 'Your home', detail: 'Never — a fresh, empty one every Session.' },
]

/**
 * What one Session's jail is allowed, beyond ai-jail's own defaults.
 *
 * Everything here is a fact about *that* Session — where its worktree is, which folders its
 * Provider reads, which variables TinyCorp put on it — and never about a product: the plan is
 * built above, and this module only spells it as argv.
 */
export interface SandboxPlan {
  /** Folders the Session may read and not write. */
  readOnly: readonly string[]
  /** Folders outside the working directory the Session may also write. */
  readWrite: readonly string[]
  /**
   * The **names** of the variables that have to cross into the jail. ai-jail's default is a minimal
   * environment allowlist, so a Session's hook token, its config folder and `RTK_DB_PATH` would all
   * be stripped and the Session would start deaf and unhooked. Names only — `--env NAME` carries
   * the value that is already on the process, so no secret is written into an argument list where
   * `ps` would show it.
   */
  env: readonly string[]
}

/** Nothing beyond ai-jail's defaults — what a plan is before anything is added to it. */
export const EMPTY_SANDBOX_PLAN: SandboxPlan = { readOnly: [], readWrite: [], env: [] }

/**
 * The flags in front of `--`, in one fixed order so a test can pin the whole line.
 *
 * The three that are always there:
 *
 * - `--agent-state` mounts the Provider's own sign-in folder, which is the only thing from the
 *   boss's home a Session gets, and without it the CLI starts signed out.
 * - `--worktree` makes the per-worktree git dir **and the shared common dir** writable. Every
 *   Employee works in a linked worktree, whose `.git` is a file pointing into the main repo, so
 *   without this flag `git commit` fails inside the jail and the Employee can do no work at all.
 * - `--network` leaves the network open, for the reason {@link SANDBOX_NETWORK_WHY} gives.
 *
 * Paths are de-duplicated and empties dropped, because the callers build them from several places
 * and a folder named twice is noise in a line the boss may read in a bug report.
 */
export function sandboxArgs(plan: SandboxPlan): string[] {
  return [
    '--agent-state',
    '--worktree',
    '--network',
    ...unique(plan.readOnly).flatMap((path) => ['--ro-map', path]),
    ...unique(plan.readWrite).flatMap((path) => ['--rw-map', path]),
    ...unique(plan.env).flatMap((name) => ['--env', name]),
  ]
}

/**
 * The whole line: `ai-jail <flags> -- <the Provider's own command>`.
 *
 * `--` is what keeps a Provider's own flags its own. A `claude --resume …` after it is argv to
 * ai-jail and never parsed as ai-jail's, so a Provider that adds a flag tomorrow needs no thought
 * here.
 */
export function sandboxCommand(plan: SandboxPlan, command: string, args: readonly string[]): string[] {
  return [AI_JAIL_COMMAND, ...sandboxArgs(plan), '--', command, ...args]
}

/** The entries that are really there, each one once, in the order they were first named. */
function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value !== ''))]
}

/**
 * The Company's one switch. It is one switch and not two because the network has one honest state
 * (see {@link SANDBOX_NETWORK_WHY}); a second setting arrives with the filtering it would choose.
 */
export interface SandboxSettings {
  /** Whether every Employee of this Company is jailed. Read at each spawn, never mid-turn. */
  enabled: boolean
}

/** What a Company that has never opened the Add-ons tab runs with: an add-on is offered, never assumed. */
export const SANDBOX_SETTINGS_DEFAULT: SandboxSettings = { enabled: false }
