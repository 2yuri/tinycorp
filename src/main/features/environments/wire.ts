import type { Provider } from '../../../shared/domain/staff'
import type { ProviderRuntime } from '../../../shared/platform/wsl'
import type { CompanyContext, OpenCompany } from '../../core'
import type { SecretBackend, SecretStore } from '../../platform'
import { createEnvironmentRuns, type EnvironmentRuns, type EnvironmentRunsOptions } from './environment-runs'
import { createEnvironments, type EnvironmentStore, environmentSummary } from './environments'

/** The other features an `env_run` goes through before a command starts. */
export interface EnvironmentsDeps extends EnvironmentsOptions {
  /**
   * Where a value lives: the OS secret store, under that Company's scope. Never the Company folder.
   */
  secrets: SecretStore
  /** A change to who holds what can change what a Session is handed, so the staff redraws. */
  notify(): void
  /** That Company's Approvals: an environment the boss guards asks before it is used. */
  approvals(entry: OpenCompany): EnvironmentRunsOptions['approvals']
  /** That Company's roster, to find which Provider the Employee running the command is on. */
  staff(entry: OpenCompany): { employees: { list(): { id: string; provider: Provider }[] } }
  /**
   * Where a Provider runs on this machine (T167): a WSL runtime puts the command inside that
   * distro, which is where the Employee's own tools are. Without one, everything runs on the host.
   */
  providerRuntime?(provider: Provider): ProviderRuntime | null
}

/** What the boss's app hands in, and a test leaves out. */
export interface EnvironmentsOptions {
  /**
   * Which secret store this machine really has (T177, T218). What a boss is told when a value is
   * missing names it, so the answer comes from the one place that decides it — never from
   * `process.platform` read inside the feature. A test leaves it out and is answered for a Mac.
   */
  secretBackend?: () => SecretBackend
  /**
   * Runs an `env_run` command with an Environment's values in it (T176). Injected so no test spawns
   * a real process, and so the one place values are handed out stays visible from the options.
   */
  runCommand?: EnvironmentRunsOptions['run']
}

/** The Environments feature, once it is wired. */
export interface EnvironmentsFeature {
  environments: EnvironmentStore
  /** What that Company keeps in each Environment, by name and never by value (T176). */
  summary(entry: OpenCompany): ReturnType<typeof environmentSummary>
  /**
   * The values `Run it` starts with, for a repo whose default Environment is available to checks
   * (T176). A repo with none runs exactly as it did before.
   */
  valuesForChecks(entry: OpenCompany, repoId: string): ReturnType<EnvironmentStore['valuesFor']>
  /** That Company's `env_run` flow, made the first time it is asked for. */
  runs(entry: OpenCompany): EnvironmentRuns
}

/**
 * Wires the Environments to the Companies the app has open (T176, T186).
 *
 * One store for the names and the toggles, and one `env_run` flow per open Company, because a run
 * is against that Company's approvals and that Company's worktrees.
 */
export function register(ctx: CompanyContext, deps: EnvironmentsDeps): EnvironmentsFeature {
  const environments = createEnvironments({
    current: () => {
      const entry = ctx.currentEntry()
      return { db: entry.db, companyId: entry.company.id }
    },
    secrets: deps.secrets,
    notify: deps.notify,
    ...(deps.secretBackend && { backend: deps.secretBackend }),
  })

  const runs = ctx.perCompany((entry) =>
    createEnvironmentRuns({
      db: () => entry.db,
      environments,
      approvals: deps.approvals(entry),
      ...(deps.runCommand && { run: deps.runCommand }),
      // The Employee's own Provider decides where its commands run: inside a distro when that is
      // where its CLI lives, on the host otherwise (T167).
      runtimeFor(employeeId) {
        const employee = deps
          .staff(entry)
          .employees.list()
          .find((row) => row.id === employeeId)
        return employee ? (deps.providerRuntime?.(employee.provider) ?? null) : null
      },
    }),
  )

  return {
    environments,
    runs: (entry) => runs.of(entry),
    summary: (entry) => environmentSummary(entry.db),
    valuesForChecks(entry, repoId) {
      const scope = { db: entry.db, companyId: entry.company.id }
      const use = environments.forChecks(repoId, scope)
      return use ? environments.valuesFor(use, scope) : []
    },
  }
}
