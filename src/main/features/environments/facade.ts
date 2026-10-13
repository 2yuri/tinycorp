import type { CurrentCompany } from '../company'
import type { ReposFacade } from '../repos'
import type { EnvironmentStore } from './environments'

/**
 * Company settings → Environments, as it sees the engine (T176, T188).
 *
 * The repos are on the face because an Environment is scoped to them: the screen offers the repos
 * this Company has attached, and nothing else.
 */
export interface EnvironmentsFacade extends CurrentCompany, Pick<ReposFacade, 'repos'> {
  /**
   * What is in each Environment, and the values, which live in the OS secret store. Company
   * settings reads and writes it; no Employee ever holds one.
   */
  environments: EnvironmentStore
}
