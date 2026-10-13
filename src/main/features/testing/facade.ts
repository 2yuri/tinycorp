import type { RepoTestChanges, TestMode, TestSettings } from '../../../shared/testing'
import type { CompanyChanged } from '../company'
import type { AppRuns } from './app-runs'
import type { Tests } from './test-flow'

/** The Testing stage's face on the engine (T174, T188). */
export interface TestingFacade extends CompanyChanged {
  /** The current Company's Testing stage: the attempts, and the boss's own pass and fail. */
  tests: Tests & {
    /** Why this ticket may not merge yet, in one sentence, or null when Testing is not in the way. */
    refusal(ticketId: number): string | null
    /** Called after any attempt, step or screenshot changes, in any open Company. */
    onChange(listener: () => void): () => void
    /** Who tests, and the per-repo run command and port. */
    settings(): TestSettings
    setMode(mode: TestMode): TestSettings
    setRepo(repoId: string, changes: RepoTestChanges): TestSettings
  }
  /** The apps the current Company has running for its tickets in Testing, and Run it / Stop. */
  appRuns: AppRuns
}
