import { readFileSync } from 'node:fs'
import { PROVIDER_COMMAND, PROVIDERS, type Provider } from '../../shared/domain/providers'
import {
  chooseRuntime,
  type ProviderPlacement,
  type ProviderRuntime,
  WINDOWS_PATH_LOOKED_IN,
  WINDOWS_RUNTIME,
  type WslReach,
  windowsOnlyPlacement,
  wslLookedIn,
} from '../../shared/platform/wsl'
import {
  bindAddresses,
  cachedWslDistros,
  cachedWslLoginPath,
  cachedWslProbe,
  confirmMirrored,
  forgetWsl,
  hostUrlFor,
  isWsl,
  LOOPBACK,
  onPath,
  runWsl,
  type WslDistro,
  type WslHost,
  type WslRunner,
  wslAdapterAddress,
  wslConfigPath,
  wslHost,
  wslNetworkingMode,
  wslReachesHook,
} from '../platform'

/**
 * Where every Provider runs on this machine (T167) — the one place the two lookups are put
 * together, and the only thing the rest of the app asks.
 *
 * On a Mac or a Linux desktop it answers in one line: the CLI is on `PATH` or it is not. On
 * Windows it answers the question that machine actually has — *which of the two places is this
 * CLI in* — by looking at the Windows `PATH` through T166's resolver and then inside WSL, and it
 * holds the boss's pick when the answer is "both".
 *
 * What it will not do is cost anything twice. `wsl.exe -l -v` and each probe are cached the way
 * `cli-command.ts` caches a `PATH` walk, because the Providers card asks for every Provider every
 * time it draws; `Check again` is the only thing that asks again.
 */

export interface ProviderRuntimesOptions {
  platform?: NodeJS.Platform
  /** Runs `wsl.exe`. Injected, so no test ever starts a distro. */
  run?: WslRunner
  env?: NodeJS.ProcessEnv
  /** Whether a command is on the Windows `PATH` — T166's resolver by default. */
  onWindowsPath?: (command: string) => boolean
  /** The place the boss picked for a Provider, from their profile. Null when they have not. */
  picked?: (provider: Provider) => ProviderRuntime | null
  /**
   * Where the team runs: the boss's one answer for every Provider that has no pick of its own
   * (T249), from their profile. Null when they have not answered, which is every Mac.
   */
  teamDefault?: () => ProviderRuntime | null
  /** Reads `.wslconfig`; null when there is none. */
  readConfig?: (path: string) => string | null
  /** This machine's address on the WSL virtual switch. */
  adapterAddress?: () => string | null
  /** The catalogue, so a test can hand in a shorter one. */
  catalogue?: readonly Provider[]
  /** The command each Provider is installed as. */
  commandOf?: (provider: Provider) => string
}

export interface ProviderRuntimes {
  /** Where this Provider's CLI is, and where its next Session starts. */
  placement(provider: Provider): ProviderPlacement
  /**
   * Every distro this Windows has, the default one first; empty everywhere else. It is the cached
   * listing the rows were drawn from, so asking costs nothing and starts nothing — which is what
   * lets the first-launch step offer the distros without waking one (T249).
   */
  distros(): readonly WslDistro[]
  /** Where its next Session starts, or null when the CLI is nowhere. */
  runtime(provider: Provider): ProviderRuntime | null
  /**
   * Where **the team** runs (T249, T259) — the boss's one answer, and the only one for everything
   * TinyCorp runs that is not a Provider Session: git, `gh`, `rtk`, a repo's run command, a test run.
   *
   * It is the boss's pick when that pick still names a distro this Windows has, and Windows
   * otherwise. Unlike {@link runtime} it is never null and never gated on a CLI being installed
   * anywhere, because *where the team is* is a fact about the machine, not about a product: a boss
   * who has chosen Arch has chosen it for their git whether or not they have installed `claude` in
   * there yet. A stale pick — the distro was removed — falls back to Windows rather than sending
   * every command to a distro that is not on the machine.
   *
   * Listing the distros starts none of them, so this wakes nothing.
   */
  team(): ProviderRuntime
  /**
   * Where `command` is **where the team runs**, or null when it is not there (T259).
   *
   * This is how `git`, `gh`, `glab` and `rtk` are found: the `gh` on the Windows `PATH` is not on the
   * distro's, so a boss whose team is in Arch and whose `gh` is only in Arch must read *installed*,
   * and one whose `gh` is only on Windows must read *not installed* — because a command that is not
   * where it will be run is a command that will fail there.
   *
   * The probe is `cachedWslProbe`, the same one the Providers card was drawn from, so nothing is
   * woken that was not already awake.
   */
  inTeam(command: string): string | null
  /** Where the host is, seen from inside a runtime. Null for Windows, which needs no translating. */
  host(runtime: ProviderRuntime | null): WslHost | null
  /**
   * Everywhere the receivers have to listen: loopback, and this machine's address on the WSL
   * switch when this Windows has a distro at all. Never `0.0.0.0` — `listenOn` refuses it.
   *
   * It is decided by *this machine has WSL* rather than by *a Provider runs in WSL*, and that is
   * deliberate: the receivers bind before the first window draws, and finding out which Providers
   * are inside a distro means waking every distro, which is seconds the boss would wait for
   * nothing. Listing them starts nothing. What is bound is one address on a virtual switch only
   * this machine's own distros are on, answering only what it answered before — every hook still
   * carries its Session's token and every MCP call its bearer.
   */
  addresses(): string[]
  /**
   * Where `command` is inside each distro some Provider really runs in, or null where it is not
   * there. Empty off Windows, and empty on a Windows whose Providers all run on Windows itself.
   *
   * It is how RTK is found for an Employee inside a distro (T179): the `rtk` on the Windows `PATH`
   * is not on that distro's, and could rewrite nothing there. Probes are the cached ones — the same
   * answer the Providers card was drawn from — so this wakes nothing that was not already awake.
   */
  inDistros(command: string): { distro: string; path: string | null }[]
  /**
   * The `PATH` the boss's own shell has inside `distro`, or null where it would not say (T258).
   *
   * It is what every Session in that distro is started under, so the CLI the lookup found on it is
   * the CLI the Session runs. Read once per distro and cached, so asking here costs nothing.
   */
  loginPath(distro: string): string | null
  /**
   * The self-test (T167): from inside each distro a Provider runs in, `curl` the hook receiver's
   * health path. Run once the receiver is listening, and again on `Check again`. The answer lands
   * on the Providers card's row.
   */
  test(healthUrl: string, token: string, header: string): void
  /**
   * The boss moved a Provider between Windows and WSL. Only the pick changed, so only the pick is
   * recomputed: the probes stand, and nothing is woken up to answer a question already answered.
   */
  repick(): void
  /** Forgets every lookup, so the next ask runs `wsl.exe` and walks `PATH` again. */
  forget(): void
}

export function createProviderRuntimes({
  platform = process.platform,
  run = runWsl,
  env = process.env,
  onWindowsPath = (command) => onPath(command, env),
  picked = () => null,
  teamDefault = () => null,
  readConfig = readTextFile,
  adapterAddress = wslAdapterAddress,
  catalogue = PROVIDERS,
  commandOf = (provider) => PROVIDER_COMMAND[provider],
}: ProviderRuntimesOptions = {}): ProviderRuntimes {
  const windows = platform === 'win32'
  const placements = new Map<Provider, ProviderPlacement>()
  const reach = new Map<string, WslReach>()
  let mode: ReturnType<typeof wslNetworkingMode> | null = null

  /** How WSL is wired. Read from `.wslconfig`, which costs nothing and starts nothing. */
  function networkingMode() {
    if (mode === null) {
      const path = wslConfigPath(env)
      mode = wslNetworkingMode(path ? readConfig(path) : null)
    }
    return mode
  }

  /**
   * The distros to look in, the default one first. The default is first because it is the one the
   * boss's own `wsl` opens, so it is where they installed things.
   */
  function distros(): WslDistro[] {
    return windows ? cachedWslDistros(run) : []
  }

  /**
   * The distros to ask for one Provider, in order: **the ones the boss named first** (T258).
   *
   * The search stops at the first distro that has the CLI, so an order that put the boss's own
   * distro third would often never reach it: `claude` in Ubuntu would answer for a team that runs in
   * Arch, and the app would report a place the boss never chose. Their Provider's own pick comes
   * first, then where the team runs, then every distro as the listing gave them — the default one
   * leading, because that is the one their own `wsl` opens.
   */
  function toAsk(provider: Provider): WslDistro[] {
    const named = [picked(provider), teamDefault()].filter(isWsl).map((runtime) => runtime.distro)
    const installed = distros()
    const first = named.flatMap((name) => installed.filter((distro) => distro.name === name))
    return [...new Set([...first, ...installed])]
  }

  /**
   * Where one Provider's CLI is.
   *
   * The distros are asked **in order and only until one answers**. Every probe starts a distro
   * that was asleep, and waking three of them to find a `claude` that the first one has would cost
   * the boss half a minute for nothing. A Provider that is in none of them has been looked for in
   * all of them, which is what makes "not installed" honest.
   */
  function detect(provider: Provider): ProviderPlacement {
    const command = commandOf(provider)
    const onWindows = onWindowsPath(command)
    const installed = toAsk(provider)
    if (installed.length === 0) return windowsOnlyPlacement(onWindows)
    const found: string[] = []
    const asked: string[] = []
    const asleep: string[] = []
    for (const distro of installed) {
      asked.push(distro.name)
      const probe = cachedWslProbe(run, distro, command)
      if (probe.path === null) continue
      found.push(distro.name)
      if (!distro.running) asleep.push(distro.name)
      break
    }
    const lookedIn = [WINDOWS_PATH_LOOKED_IN, wslLookedIn(asked)].filter((line): line is string => line !== null)
    const { runtime: chosen, missingAt } = chooseRuntime(
      { windows: onWindows, distros: found },
      picked(provider),
      teamDefault(),
    )
    return {
      windows: onWindows,
      distros: found,
      stopped: asleep,
      chosen,
      missingAt,
      lookedIn,
      reach: chosen?.kind === 'wsl' ? (reach.get(chosen.distro) ?? 'untested') : 'untested',
    }
  }

  function placement(provider: Provider): ProviderPlacement {
    const known = placements.get(provider)
    if (known) return known
    const found = detect(provider)
    placements.set(provider, found)
    return found
  }

  /** Every distro some Provider actually runs in — the only ones whose network has to work. */
  function inUse(): string[] {
    const used = new Set<string>()
    for (const provider of catalogue) {
      const chosen = placement(provider).chosen
      if (chosen?.kind === 'wsl') used.add(chosen.distro)
    }
    return [...used]
  }

  function hostFor(distro: string): WslHost {
    // `.wslconfig` says what the machine is configured for; the distro itself is asked to confirm
    // when it is already awake, because a config edited since it started has not taken effect.
    const mirrored = confirmMirrored(run, distro)
    const effective = mirrored === null ? networkingMode() : mirrored ? 'mirrored' : 'nat'
    return wslHost(effective, effective === 'mirrored' ? LOOPBACK : adapterAddress())
  }

  const hosts = new Map<string, WslHost>()
  function host(runtime: ProviderRuntime | null): WslHost | null {
    if (runtime?.kind !== 'wsl') return null
    const known = hosts.get(runtime.distro)
    if (known) return known
    const found = hostFor(runtime.distro)
    hosts.set(runtime.distro, found)
    return found
  }

  function team(): ProviderRuntime {
    const picked = teamDefault()
    if (!windows || picked?.kind !== 'wsl') return WINDOWS_RUNTIME
    return distros().some((one) => one.name.toLowerCase() === picked.distro.toLowerCase()) ? picked : WINDOWS_RUNTIME
  }

  return {
    placement,
    distros,
    runtime: (provider) => placement(provider).chosen,
    team,
    inTeam(command) {
      const where = team()
      if (where.kind !== 'wsl') return onWindowsPath(command) ? command : null
      const distro = distros().find((one) => one.name.toLowerCase() === where.distro.toLowerCase())
      return distro ? cachedWslProbe(run, distro, command).path : null
    },
    host,
    loginPath: (distro) => (windows ? cachedWslLoginPath(run, distro) : null),
    addresses() {
      if (distros().length === 0) return bindAddresses([])
      return bindAddresses([wslHost(networkingMode(), adapterAddress())])
    },
    inDistros(command) {
      const known = distros()
      return inUse().flatMap((name) => {
        const distro = known.find((one) => one.name === name)
        return distro ? [{ distro: name, path: cachedWslProbe(run, distro, command).path }] : []
      })
    },
    test(healthUrl, token, header) {
      for (const distro of inUse()) {
        const url = hostUrlFor(healthUrl, host({ kind: 'wsl', distro }))
        reach.set(distro, wslReachesHook(run, distro, url, token, header) ? 'ok' : 'blocked')
      }
      // The rows carry the answer, so the placements have to be built again with it in them.
      placements.clear()
    },
    repick() {
      placements.clear()
    },
    forget() {
      placements.clear()
      hosts.clear()
      reach.clear()
      mode = null
      forgetWsl()
    },
  }
}

/** A file's text, or null when there is none — a machine with no `.wslconfig`, which is most. */
function readTextFile(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}
