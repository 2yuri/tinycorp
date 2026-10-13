/**
 * Restore points: a worktree's snapshots, and putting one back (T118).
 *
 * The feature's front door. A point is a commit in the Company folder rather than in the repo
 * (decision 45), so going back never rewrites a branch an Employee is pushing; what the ticket
 * drawer draws, and how long a point is kept, are in `src/shared/restore-points`.
 */

export { registerRestorePointsIpc } from './ipc'
export { type CompanyRestorePoints, RESTORE_POINTS_FOLDER, RESTORE_POINTS_MIGRATION } from './restore-points'
export { createRestoreGit } from './restore-points-git'
export type { RestorePointsFacade } from './wire'
export { type RestorePointsOptions, register as registerRestorePoints } from './wire'
