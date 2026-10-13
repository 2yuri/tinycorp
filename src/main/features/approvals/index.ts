/**
 * Approvals: what an Employee must ask the boss before it does it, and how it asks.
 *
 * The feature's front door. The Company's autonomy level decides which actions are free and which
 * are gated (decision 30); a gated one raises an Approval with a thread in the boss's own channel,
 * and the requester waits for the decision in its inbox. What the levels are, which actions exist
 * and the sentences the Approvals card draws are in `src/shared/approvals`.
 */

export { APPROVAL_SUBJECT_MIGRATION } from './approval-subject'
export { APP_MERGES, APPROVALS_MIGRATION, type Approvals, type CompanyApprovals } from './approvals'
export { registerApprovalIpc } from './ipc'
export { registerApprovalTools } from './tools'
export type { ApprovalsFacade } from './wire'
export { register as registerApprovals } from './wire'
