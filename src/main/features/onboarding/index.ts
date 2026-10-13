/**
 * Onboarding: the first-run walk through setting a Company up (T59).
 *
 * The feature's front door. The wizard's steps and the draft it resumes from are in
 * `src/shared/onboarding`, because the renderer draws them; what is here is the hiring, the first
 * Sessions and the goal DM that Finish sets off.
 */

export { registerOnboardingIpc } from './ipc'
export {
  ONBOARDING_MIGRATION,
  ONBOARDING_PROGRESS_MIGRATION,
  readOnboardingCompletedAt,
} from './onboarding'
export type { OnboardingFacade } from './wire'
export { register as registerOnboarding } from './wire'
