import { PROVIDERS, type Provider, providerEntry } from '../../shared/domain/providers'
import { RTK_COMMAND } from '../../shared/rtk'
import {
  hostUrlFor,
  isWsl,
  nodePtySpawn,
  type RunCli,
  runCli as realRunCli,
  type SandboxPlanFor,
  sandboxSpawnPty,
  wslRunCli,
  wslSpawnPty,
} from '../platform'
import { createClaudeAdapter } from './claude/adapter'
import { createCodexAdapter } from './codex/adapter'
import { createOpencodeAdapter } from './opencode/adapter'
import type { ProviderAdapter, ProviderAdapters, SpawnPty } from './provider-adapter'
import type { ProviderRuntimes } from './provider-runtimes'
import { wslAdapter } from './wsl-adapter'

/**
 * Where every Provider's adapter is built — the main-process half of `shared/providers.ts`.
 *
 * A new Provider adds one line to {@link ADAPTERS} and nothing else here: the engine, the IPC and
 * the UI already read the catalogue. The line only compiles once the Provider is in that
 * catalogue, and {@link createProviderAdapters} refuses to hand back a set that is missing one,
 * so a half-registered Provider never reaches an Employee.
 *
 * It is also where a Provider is given the *machine* it runs on (T167). An adapter knows its
 * product's flags and nothing about WSL; the three seams it already takes — the PTY it is spawned
 * through, the `runCli` its preflight asks with, and the URL its hooks POST to — are wrapped here
 * when this Provider's CLI lives inside a distro. That is why adding a Provider takes no thought
 * about Windows at all.
 */

/** What every adapter factory is given. */
export interface AdapterOptions {
  /** Where the hook receiver listens, e.g. `http://127.0.0.1:7377/hook`. */
  hookUrl: string
  /** App-owned folder for per-Session files such as MCP configs. Never the Company folder. */
  dataDir: string
  /** Starts a process in a PTY. Left out, node-pty is used. */
  spawnPty?: SpawnPty
  /** The environment a Session inherits, before each adapter strips its own product's variables. */
  env?: NodeJS.ProcessEnv
  /** Overrides the `PATH` lookup that decides whether a Provider's CLI is on this machine. */
  installed?: (provider: Provider) => boolean
  /** Runs a Provider's CLI for the preflight (T135). Left out, the real one is used. */
  runCli?: RunCli
  /**
   * Where each Provider's CLI is and where it runs (T167). Left out — a Mac, a Linux desktop, a
   * test — every Provider runs where the app does and nothing below changes.
   */
  runtimes?: ProviderRuntimes
  /**
   * The ai-jail plan for the Session about to start, or null to start it as before (T260). Left
   * out — every test that is not about the add-on — nothing is wrapped and the line is today's.
   */
  sandbox?: SandboxPlanFor
}

/** One factory per Provider. Every Provider in the catalogue must appear here. */
const ADAPTERS: Record<Provider, (options: AdapterOptions) => ProviderAdapter> = {
  claude: (options) => createClaudeAdapter(shared('claude', options)),
  codex: (options) => createCodexAdapter(shared('codex', options)),
  opencode: (options) => createOpencodeAdapter(shared('opencode', options)),
}

/** Every Provider's adapter, ready for `createCompanyEngine({ providers })`. */
export function createProviderAdapters(options: AdapterOptions): ProviderAdapters {
  const missing = PROVIDERS.filter((provider) => !(provider in ADAPTERS))
  if (missing.length > 0) {
    throw new Error(`No adapter registered for ${missing.join(', ')} — add one in provider-registry.ts`)
  }
  return Object.fromEntries(PROVIDERS.map((provider) => [provider, buildAdapter(provider, options)]))
}

/**
 * Builds every adapter again, in place, because where a Provider runs has changed — the boss moved
 * one between Windows and WSL, or `Check again` found it somewhere new.
 *
 * In place, and not a new set: a Session that is already running holds its own adapter and keeps
 * it. That is the promise the switch makes — *a running one keeps its place* — and it is kept by
 * the object graph rather than by a rule somebody has to remember.
 */
export function refreshProviderAdapters(adapters: ProviderAdapters, options: AdapterOptions): void {
  for (const provider of PROVIDERS) adapters[provider] = buildAdapter(provider, options)
}

function buildAdapter(provider: Provider, options: AdapterOptions): ProviderAdapter {
  const adapter = ADAPTERS[provider]!(options)
  const runtime = options.runtimes?.runtime(provider) ?? null
  if (!isWsl(runtime)) return adapter
  // Three things an adapter hands back rather than does, so all three are wrapped above it: the
  // handoff command, which has to open the Session where the Session is (T164, T167); the login,
  // which has to sign in the installation the Sessions really run (T258); and the RTK a Session is
  // spawned with, which has to be the one inside this distro rather than the one on the Windows
  // `PATH` (T179). `rtkPath` is undefined where nothing has looked, which changes nothing.
  const rtkPath = options.runtimes?.inDistros(RTK_COMMAND).find((one) => one.distro === runtime.distro)?.path
  return wslAdapter(adapter, {
    distro: runtime.distro,
    ...(options.env !== undefined && { host: options.env }),
    ...(rtkPath !== undefined && { rtkPath }),
    path: options.runtimes?.loginPath(runtime.distro) ?? null,
  })
}

/**
 * The options every factory takes, with this Provider's own catalogue entry filled in: the command
 * it is installed as, the name its preflight card carries, the install check — and, when its CLI
 * lives inside a WSL distro, the three seams that put it there.
 */
function shared(provider: Provider, options: AdapterOptions) {
  const { installed, runtimes, sandbox, ...rest } = options
  /**
   * The jail goes **outside** the WSL wrap, so what reaches a distro is `wsl.exe … ai-jail … --
   * claude …` and ai-jail runs in the one place on a Windows it runs at all. Off, or on a machine
   * with no ai-jail, `sandbox` is left out here and the seam is handed through untouched.
   */
  const jailed = (inner: SpawnPty): SpawnPty => (sandbox ? sandboxSpawnPty(inner, sandbox) : inner)
  const entry = providerEntry(provider)
  const runtime = runtimes?.runtime(provider) ?? null
  const placement = runtimes?.placement(provider) ?? null
  const base = {
    ...rest,
    command: entry.command,
    name: entry.name,
    ...(placement && { placement }),
    ...(installed && { installed: () => installed(provider) }),
  }
  // The boss chose a place and their CLI is not in it (T258). Not installed *there* is what the card
  // has to say, so the answer is no whatever the Windows `PATH` holds: falling back to Windows is
  // exactly the silence this ticket is about, and the card's own words offer both ways out of it.
  if (placement?.missingAt) return { ...base, installed: () => false }
  if (!isWsl(runtime)) return sandbox ? { ...base, spawnPty: jailed(options.spawnPty ?? nodePtySpawn) } : base
  const wsl = {
    distro: runtime.distro,
    ...(options.env !== undefined && { host: options.env }),
    // Every Session, and the preflight's own `runCli`, start under the `PATH` the CLI was found on.
    path: runtimes?.loginPath(runtime.distro) ?? null,
  }
  return {
    ...base,
    // Found inside the distro, which the Windows `PATH` an adapter would look at knows nothing of.
    installed: () => true,
    spawnPty: jailed(wslSpawnPty(options.spawnPty ?? nodePtySpawn, wsl)),
    runCli: wslRunCli(options.runCli ?? realRunCli, wsl),
    // A NAT distro's `127.0.0.1` is the distro. The hooks have to dial the host (T167).
    hookUrl: hostUrlFor(options.hookUrl, runtimes?.host(runtime) ?? null),
  }
}
