/**
 * Review: the round a ticket gets before it merges, and everything said in it.
 *
 * The feature's front door. A ticket in Review with every PR open gets a round, routed to an
 * Employee holding `review` other than the assignee, else to the boss; an approved round either
 * hands the ticket to Testing or merges its PRs. The conversation is threads and line comments,
 * kept here and mirrored onto the forge where the repo has one. What a round *is*, and the words
 * the review screen draws, are in `src/shared/review`.
 *
 * `ReviewTesting` is review's half of the seam with Testing (T174): the two call each other, and
 * each names the other as an interface of its own rather than reaching for its internals.
 *
 * The security pass (T241) is here rather than a module of its own because it is part of this
 * flow: it reads the round's own change, writes its findings as this feature's threads, and the
 * only thing it decides is whether this feature's merge goes ahead.
 */

export type { ReviewFacade } from './facade'
export { registerReviewIpc } from './ipc'
export { REVIEW_COMMENTS_MIGRATION, type ReviewComments } from './review-comments'
export { type CompanyReviews, type EmployeeReviews, REVIEW_FLOW_MIGRATION } from './review-flow'
export { REVIEW_THREADS_MIGRATION, type ReviewThreads } from './review-threads'
export { type EmployeeSecurity, SECURITY_PASS_MIGRATION } from './security-flow'
export { registerReviewTools, registerSecurityTools, reviewView } from './tools'
export { register as registerReview } from './wire'
