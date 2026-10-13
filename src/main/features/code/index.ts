/**
 * Code: the worktree a ticket is written in, the branch and PR it leaves behind, and the gate the
 * merge goes through.
 *
 * The feature's front door. Moving an assigned ticket into Doing gives it a worktree and a branch
 * per repo in scope; moving it to Review opens a PR per repo, behind the `open_pr` gate. A repo
 * with no remote has no PR to merge, so its branch goes through the merge gate instead (decision
 * 44). What a worktree and a PR *are*, and the words the Code panel draws, are in `src/shared/code`.
 */

export {
  CODE_FLOW_MIGRATION,
  type CodeFlow,
  type CompanyCodeFlow,
  PRS_CHANNEL,
  WORKTREE_BASE_FOLLOWS_TICKET_MIGRATION,
  WORKTREES_FOLDER,
  worktreeRootOf,
} from './code-flow'
export type { CodeFacade } from './facade'
export { registerCodeIpc } from './ipc'
export type { EmployeeMerges, LocalMergeResult } from './merge-gate'
export { registerMergeTools } from './tools'
export { register as registerCode } from './wire'
