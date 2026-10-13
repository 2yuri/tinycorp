import { FORGE_CATALOGUE, type Forge, type ForgeEntry, forgeOfRemote } from '../../shared/forges'
import type { ForgeAdapter, ForgeAdapterOptions, ForgeAdapters, RunForge } from '../../shared/forges/adapter'
import { createGithubAdapter } from './github/adapter'
import { createGitlabAdapter } from './gitlab/adapter'

/**
 * Where every forge's adapter is built — the main-process half of `shared/forges.ts`.
 *
 * A new forge adds one line to {@link ADAPTERS} and nothing else here: the engine and the UI
 * already read the catalogue. The line only compiles once the forge is in that catalogue, and
 * {@link createForgeAdapters} refuses to hand back a set that is missing one, so a catalogued forge
 * with no adapter never reaches a repo — a repo would attach, look supported on the card, and then
 * fail at the moment an Employee was ready to open a PR, which is the worst place to find out.
 */

/** What a forge registry is built with. */
export interface ForgeRegistryOptions {
  /** Where the preflight's status command runs. The app's own folder; never a Company folder. */
  cwd?: string
  /** Runs a forge's CLI. Left out, each adapter uses the real one. */
  runForge?: RunForge
  /** Overrides the `PATH` lookup that decides whether a forge's CLI is on this machine. */
  installed?: (forge: string) => boolean
}

/** One factory per forge. Every forge in the catalogue must appear here. */
const ADAPTERS: Record<Forge, (options: ForgeAdapterOptions) => ForgeAdapter> = {
  github: createGithubAdapter,
  gitlab: createGitlabAdapter,
}

/** Every forge's adapter, ready for `createGitService({ forges })`. */
export function createForgeAdapters(options: ForgeRegistryOptions = {}): ForgeAdapters {
  return buildForgeAdapters(FORGE_CATALOGUE, ADAPTERS, options)
}

/**
 * The registry, over a catalogue and a set of factories.
 *
 * It takes both rather than reading them, so the promise this file makes can be tested: a
 * catalogue with a forge nobody wrote an adapter for is refused here, loudly, at start — not
 * discovered by an Employee whose PR will not open.
 */
export function buildForgeAdapters(
  catalogue: readonly ForgeEntry[],
  factories: Record<string, ((options: ForgeAdapterOptions) => ForgeAdapter) | undefined>,
  { cwd, runForge, installed }: ForgeRegistryOptions = {},
): ForgeAdapters {
  const missing = catalogue.filter((entry) => !factories[entry.id])
  if (missing.length > 0) {
    throw new Error(
      `No adapter registered for ${missing.map((entry) => entry.id).join(', ')} — add one in forge-registry.ts, ` +
        'or take the entry out of the catalogue: a forge on the repo card that cannot open a PR is worse than one nobody offers',
    )
  }
  return Object.fromEntries(
    catalogue.map((entry) => [
      entry.id,
      factories[entry.id]!({
        command: entry.command,
        name: entry.name,
        ...(cwd !== undefined && { cwd }),
        ...(runForge && { runForge }),
        ...(installed && { installed: () => installed(entry.id) }),
      }),
    ]),
  )
}

/** The adapter for the forge a remote is on, or null when nothing here answers for that host. */
export function adapterForRemote(adapters: ForgeAdapters, remote: string | null): ForgeAdapter | null {
  const forge = forgeOfRemote(remote)
  return forge ? (adapters[forge] ?? null) : null
}
