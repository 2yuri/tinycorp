/**
 * Planning: the plan a ticket gets before it is Ready, the questions it asks the boss, and the
 * daily digest that says what is waiting (T171, T172).
 *
 * The feature's front door. One feature and not two, because the digest's "waiting on you" is the
 * plans. What a plan and a digest *are* is in `src/shared/planning`.
 */

export { DAILY_DIGEST_MIGRATION, digestsOfMany } from './daily-digest'
export { registerDigestIpc } from './digest-ipc'
export { registerPlanningIpc } from './ipc'
export { type CompanyPlanning, type EmployeePlanning, PLANNING_MIGRATION } from './planning'
export { registerPlanningTools } from './tools'
export type { DigestFacade, PlanningFacade } from './wire'
export { type PlanningFeature, type PlanningOptions, register as registerPlanning } from './wire'
