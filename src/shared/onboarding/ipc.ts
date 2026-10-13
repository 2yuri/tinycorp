/**
 * The wizard's slice of the IPC contract (T186). `src/shared/ipc/index.ts` composes the slices
 * into `TinyCorpApi`, so preload and the renderer keep importing one contract.
 */

import type { Result } from '../domain/result'
import type { OnboardingDraft, OnboardingFinish, OnboardingOutcome, OnboardingProgress } from './index'

/** The current Company's setup wizard. Exposed as `window.tinyCorp.onboarding`. */
export interface OnboardingApi {
  /** Whether the wizard is still owed, and the draft it resumes from (T59). */
  progress(): Promise<Result<OnboardingProgress>>
  /** Records the step and draft the boss is on; a finished wizard keeps nothing. */
  save(draft: OnboardingDraft): Promise<Result<null>>
  /** Hires the roster, starts Sessions and hands the goal over; a second call fails. */
  finish(input: OnboardingFinish): Promise<Result<OnboardingOutcome>>
}
