/**
 * Where a Provider's CLI runs on a Windows machine, in the words both halves of the app use (T167).
 *
 * On Windows a Provider can be in two places at once: installed on Windows itself, and installed
 * inside a WSL distro. Both are real installations with their own login, and plenty of bosses have
 * only the second one. So "installed" stops being a yes or no and becomes a *place* — and the
 * place travels: Your profile draws it, the preflight card says where it looked, the engine spawns
 * there, and the handoff command the boss copies has to start in the same distro.
 *
 * Nothing in this file is node code and nothing in it names a Provider: the renderer imports the
 * words, the main process imports the shape, and the distro names come from `wsl.exe`.
 *
 * On a Mac or a Linux desktop none of this shows. There is one place a CLI can be there, and a row
 * that says so would be noise.
 */

/** Where a Session runs: Windows itself, or one distro inside WSL. */
export type ProviderRuntime = { kind: 'windows' } | { kind: 'wsl'; distro: string }

/** Windows itself — what every Provider on a machine with no WSL runs in. */
export const WINDOWS_RUNTIME: ProviderRuntime = { kind: 'windows' }

/** One runtime as a single string, which is how the boss's profile stores the pick. */
export function runtimeKey(runtime: ProviderRuntime): string {
  return runtime.kind === 'windows' ? 'windows' : `wsl:${runtime.distro}`
}

/** A stored key back as a runtime, or null when it is not one — a hand-edited profile, an old file. */
export function parseRuntimeKey(key: unknown): ProviderRuntime | null {
  if (typeof key !== 'string') return null
  if (key === 'windows') return WINDOWS_RUNTIME
  const distro = key.startsWith('wsl:') ? key.slice(4).trim() : ''
  return distro ? { kind: 'wsl', distro } : null
}

/** Whether two runtimes are the same place. */
export function sameRuntime(a: ProviderRuntime | null, b: ProviderRuntime | null): boolean {
  if (!a || !b) return a === b
  return runtimeKey(a) === runtimeKey(b)
}

/** `Windows`, `WSL · Ubuntu` — what the chip and the switch draw (frames `nsfGb`, `N1yAKa`). */
export function runtimeLabel(runtime: ProviderRuntime): string {
  return runtime.kind === 'windows' ? WINDOWS_LABEL : `${WSL_LABEL} · ${runtime.distro}`
}

export const WINDOWS_LABEL = 'Windows'
export const WSL_LABEL = 'WSL'

/** The label on the row's control (frame `Ffs0V`). */
export const RUNS_IN_LABEL = 'Runs in'

/** The help under the switch when a Provider was found in both places (frame `j5S7OO`). */
export const RUNS_IN_BOTH_HELP = 'Found in both. New Sessions start where you pick; a running one keeps its place.'

/**
 * What a row says when the boss's own answer names a place this CLI is not in (T258).
 *
 * It names the empty place rather than the full one, because the empty one is the answer the boss
 * gave: the switch beside this line already offers every place the CLI really is, and pressing one
 * is all it takes.
 */
export function notInstalledThereNote(runtime: ProviderRuntime): string {
  return `Not installed in ${runtimeLabel(runtime)} — pick a place below, or install it there.`
}

/** What a row says about a distro that is asleep (frame `GacEW`). */
export function stoppedDistroNote(runtime: ProviderRuntime): string {
  return `${runtimeLabel(runtime)} is stopped — it starts when a Session does.`
}

/** How the self-test went: whether a Session inside the distro can reach the app's own receivers. */
export type WslReach =
  /** Nothing to test: the Provider runs on Windows, or nobody has asked yet. */
  | 'untested'
  /** A `curl` from inside the distro reached the hook receiver's health path.  */
  | 'ok'
  /** It did not. Almost always the Windows Firewall prompt nobody answered. */
  | 'blocked'

/**
 * What a Session inside the distro could not reach, said where the boss is already looking. The
 * firewall is named because it is the cause nine times out of ten, and because the fix — answering
 * a prompt that appeared behind the app — is one nobody guesses.
 */
export const WSL_BLOCKED_NOTE =
  'Sessions here cannot reach TinyCorp yet — Windows Firewall is blocking the WSL network. Allow TinyCorp on private networks and press Check again.'

/** Where a Provider's CLI was found on this machine, and where its next Session will start. */
export interface ProviderPlacement {
  /** Found on the Windows `PATH`. */
  windows: boolean
  /** The distros it was found in, the default distro first. Empty when WSL has none of it. */
  distros: readonly string[]
  /** The distros that were asleep when they were asked — the first Session wakes one (frame `GacEW`). */
  stopped: readonly string[]
  /** Where a new Session starts. Null when the CLI is in neither place. */
  chosen: ProviderRuntime | null
  /**
   * The place the boss asked for — this Provider's own pick, or where the team runs — when the CLI
   * is **not in it** (T258). Null whenever their answer was honoured, and null when they gave none.
   *
   * It is the difference between *not installed* and *installed somewhere else*, and it exists
   * because the second one used to be answered in silence: a boss who chose WSL and has `claude` on
   * the Windows `PATH` as well got Windows Sessions and no word about it. With this set the card
   * says which place is empty and offers that place's install command, and {@link chosen} is null —
   * so nothing starts anywhere until the boss has been told.
   */
  missingAt: ProviderRuntime | null
  /** Everywhere that was looked, in the words the preflight card prints (frame `c8knu`). */
  lookedIn: readonly string[]
  /** Whether a Session in {@link chosen} can reach the app's receivers. `untested` off WSL. */
  reach: WslReach
}

/** A machine with no WSL, or one that is not Windows at all: one place, and nothing to choose. */
export function windowsOnlyPlacement(found: boolean): ProviderPlacement {
  return {
    windows: found,
    distros: [],
    stopped: [],
    chosen: found ? WINDOWS_RUNTIME : null,
    missingAt: null,
    lookedIn: [],
    reach: 'untested',
  }
}

/** Whether the row draws the switch rather than a chip: found in both places, so there is a pick. */
export function hasRuntimeChoice(placement: ProviderPlacement): boolean {
  return placement.windows && placement.distros.length > 0
}

/** Every place this Provider could run, in the order the switch offers them: Windows, then distros. */
export function runtimeChoices(placement: Pick<ProviderPlacement, 'windows' | 'distros'>): ProviderRuntime[] {
  return [
    ...(placement.windows ? [WINDOWS_RUNTIME] : []),
    ...placement.distros.map((distro): ProviderRuntime => ({ kind: 'wsl', distro })),
  ]
}

/**
 * Where a Provider runs when the boss has not picked: Windows when it is there, and otherwise the
 * first distro that has it — which is the default distro whenever that one does.
 *
 * Windows wins the tie because it is the machine the app itself runs on: no path translation, no
 * network hop, no distro to wake. A boss whose real toolchain is in Ubuntu picks it once, and the
 * pick is remembered.
 */
export function defaultRuntime(placement: Pick<ProviderPlacement, 'windows' | 'distros'>): ProviderRuntime | null {
  if (placement.windows) return WINDOWS_RUNTIME
  const first = placement.distros[0]
  return first ? { kind: 'wsl', distro: first } : null
}

/** Where a Session starts, and — when the boss asked for somewhere the CLI is not — where that was. */
export interface RuntimeChoice {
  /** The place the next Session starts in. Null when there is nowhere it could. */
  runtime: ProviderRuntime | null
  /** The place the boss asked for and the CLI is not in. See {@link ProviderPlacement.missingAt}. */
  missingAt: ProviderRuntime | null
}

/**
 * The runtime a Session starts in, in the order the three answers are asked for (T167, T249, T258):
 *
 * 1. **this Provider's own pick**, from Your profile → Providers;
 * 2. **where the team runs**, the boss's one answer for every Provider, asked on the first launch
 *    on Windows and kept in their profile;
 * 3. **where the CLI was found** — Windows when it is there, else the first distro that has it.
 *
 * **The third is a last resort and not a correction.** An answer the boss gave that names a place
 * the CLI is not in does not fall through to the next level: it comes back as
 * {@link RuntimeChoice.missingAt}, which is the app saying *that Provider is not installed there*
 * rather than quietly starting Sessions somewhere the boss did not choose. Until T258 it did fall
 * through, and the machine it is wrong on is the common one: a boss who chose WSL on the first
 * launch and has the CLI on the Windows `PATH` too got Windows Employees and no word about it.
 *
 * A pick and a team default are treated the same way, because both are answers: the only thing
 * level 3 is for is a machine nobody has answered for at all.
 */
export function chooseRuntime(
  placement: Pick<ProviderPlacement, 'windows' | 'distros'>,
  picked: ProviderRuntime | null,
  teamDefault: ProviderRuntime | null = null,
): RuntimeChoice {
  const available = runtimeChoices(placement)
  for (const asked of [picked, teamDefault]) {
    if (!asked) continue
    const kept = available.find((runtime) => sameRuntime(runtime, asked))
    return kept ? { runtime: kept, missingAt: null } : { runtime: null, missingAt: asked }
  }
  return { runtime: defaultRuntime(placement), missingAt: null }
}

/** What a Provider's own row says about the team default it is overriding (T249). */
export const PROVIDER_RUNTIME_HELP = 'This Provider only. The rest of the team runs where On this PC says.'

/**
 * The mark on the distro `wsl.exe` opens when nobody names one: `Ubuntu · default` (frame `laIUL`).
 *
 * It is a mark on a real distro rather than an entry of its own, because what is stored has to
 * name a distro: a key meaning *whichever is default* would resolve, on the day the boss changes
 * their default, to a distro the CLI was never installed in — which `chooseRuntime` would then
 * report as a place the Provider is not installed in, for a place the boss never named.
 */
export const DEFAULT_DISTRO_NOTE = 'default'

/** One distro as the dropdown lists it. */
export function distroLabel(distro: string, isDefault: boolean): string {
  return isDefault ? `${distro} · ${DEFAULT_DISTRO_NOTE}` : distro
}

/** `Windows PATH`, `WSL: Ubuntu` — one entry per place the preflight looked (frame `c8knu`). */
export const WINDOWS_PATH_LOOKED_IN = 'Windows PATH'

export function wslLookedIn(distros: readonly string[]): string | null {
  return distros.length > 0 ? `${WSL_LABEL}: ${distros.join(', ')}` : null
}

/** `Looked in: Windows PATH · WSL: Ubuntu`, or empty when there was only one place to look. */
export function lookedInLine(lookedIn: readonly string[]): string {
  return lookedIn.length > 0 ? `Looked in: ${lookedIn.join(' · ')}` : ''
}
