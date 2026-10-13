/**
 * The activity log: the append-only record of what the Company did (decision 36).
 *
 * The feature's front door. Every other feature hands it what it did through the recorders in
 * `activity-sources.ts`, so the log names the flow rather than the table; the kinds, the groups and
 * the sentences the Activity view draws are in `src/shared/activity`.
 */

export { ACTIVITY_MIGRATION } from './activity'
export {
  type ActivityContext,
  recordDecidedStaffing,
  recordingApprovals,
  recordingCapacity,
  recordingHiring,
  recordingRepos,
  recordingReviews,
  recordingWakes,
  recordLocalMerge,
  recordMerged,
  recordPullRequestOpened,
  recordReviewRequested,
  recordTicketDeleted,
  recordWorktreeOpened,
} from './activity-sources'
export { registerActivityIpc } from './ipc'
export type { ActivityFacade } from './wire'
export { register as registerActivity } from './wire'
