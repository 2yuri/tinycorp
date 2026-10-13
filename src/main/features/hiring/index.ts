/**
 * Hiring: proposing a hire or a fire, the boss deciding it, and carrying it out.
 *
 * The feature's front door. What a hire is made of — the team load a hirer reads, the proposed
 * Employee the boss may edit, the headcount it must stay under — is in `src/shared/hiring`.
 */

export { type CompanyHiring, HIRING_MIGRATION } from './hiring'
export { HIRING_PROPOSALS_MIGRATION } from './hiring-proposals'
export { registerHiringIpc } from './ipc'
export { registerHiringTools } from './tools'
export type { HiringFacade } from './wire'
export { type HiringFeature, register as registerHiring } from './wire'
