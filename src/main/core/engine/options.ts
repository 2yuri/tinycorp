import type { Provider } from '../../../shared/domain/staff'
import type { ProviderRuntime } from '../../../shared/platform/wsl'
import { folderExists as folderOnDisk } from '../../features/catalogue'
import type { ChatOptions } from '../../features/chat'
import type { CompanyOptions } from '../../features/company'
import type { EnvironmentsOptions } from '../../features/environments'
import type { MemoryOptions } from '../../features/memory'
import type { PlanningOptions } from '../../features/planning'
import type { ReposOptions } from '../../features/repos'
import type { RestorePointsOptions } from '../../features/restore-points'
import type { RtkOptions } from '../../features/rtk'
import type { SandboxOptions } from '../../features/sandbox'
import type { SessionsOptions } from '../../features/sessions'
import type { StaffOptions } from '../../features/staff'
import type { TestingOptions } from '../../features/testing'
import type { UsageOptions } from '../../features/usage'
import { type GitService, memorySecrets, type SecretStore } from '../../platform'
import type { ProviderAdapters } from '../../providers'

/**
 * What the boss's app hands the engine, and what every test leaves out.
 *
 * There is no list of fields here on purpose (T201). Each feature declares the options its own
 * `register` takes, beside the code that reads them and with its own defaults — so an option can
 * never drift from what it is for, and adding one is a line in one module rather than two. What is
 * left below is the core's own: what more than one feature is handed, so it is defaulted once and
 * the same one reaches all of them.
 */
export interface CompanyEngineOptions
  extends CoreOptions,
    ChatOptions,
    CompanyOptions,
    EnvironmentsOptions,
    MemoryOptions,
    PlanningOptions,
    ReposOptions,
    RestorePointsOptions,
    RtkOptions,
    SandboxOptions,
    SessionsOptions,
    StaffOptions,
    TestingOptions,
    UsageOptions {}

/** The handful more than one feature needs: defaulted once, so each of them gets the same one. */
export interface CoreOptions {
  /** One adapter per Provider; Sessions of a Provider without one cannot start. */
  providers?: ProviderAdapters
  /**
   * Where an MCP server's token and an Environment's values are kept (T136, T176). Defaults to this
   * process's memory, so a test never touches the machine's keychain; the app passes the real one.
   */
  secrets?: SecretStore
  /** Creates ticket worktrees and opens PRs. Without one, tickets move without touching any repo. */
  git?: GitService
  /**
   * Whether a skill folder is on this Mac (T137). Injected so the engine's tests never need one;
   * nothing here ever opens a skill folder, only asks whether it is still there.
   */
  folderExists?: (path: string) => boolean
  /** Where engine warnings go, e.g. an unanswered prompt push. Defaults to `console.warn`. */
  log?: (line: string) => void
  /** The clock caches read. Defaults to `Date.now`. */
  now?: () => number
  /**
   * A Session reported the subscription limit. The Usage popover's numbers are stale the moment
   * that happens, so whoever holds them reads again (T80).
   */
  onLimitReported?: () => void
  /**
   * Where a Provider runs on this machine (T167). `env_run` uses it so a command runs beside the
   * Employee's own tools; without one everything runs on the host, which is every test.
   */
  providerRuntime?(provider: Provider): ProviderRuntime | null
}

/** The options as every `register` is handed them: the boss's, with the shared defaults filled in. */
export type ResolvedOptions = CompanyEngineOptions &
  Required<Pick<CoreOptions, 'providers' | 'secrets' | 'folderExists' | 'log' | 'now'>>

/**
 * Fills in the handful of options more than one feature needs, once, so all of them get the same
 * one — the same keychain, the same clock, the same adapters. Everything else a feature defaults
 * for itself, beside the code that reads it.
 */
export function withDefaults(options: CompanyEngineOptions): ResolvedOptions {
  return {
    ...options,
    providers: options.providers ?? {},
    secrets: options.secrets ?? memorySecrets(),
    folderExists: options.folderExists ?? folderOnDisk,
    log: options.log ?? console.warn,
    now: options.now ?? Date.now,
  }
}
