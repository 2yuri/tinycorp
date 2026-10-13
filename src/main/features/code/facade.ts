import type { PullRequestDetails } from '../../../shared/code'
import type { CompanyChanged } from '../company'
import type { CodeFlow } from './code-flow'

/**
 * The Code panel's face on the engine (T188).
 *
 * `details` is the forge's answer about a ticket's PRs, cached briefly; it is on the face rather
 * than inside the flow because reading it is a network call and the flow never makes one.
 */
export interface CodeFacade extends CompanyChanged {
  /** The current Company's ticket worktrees and PRs. */
  code: CodeFlow & {
    /** Called after any ticket's worktrees or PRs change, in any open Company. */
    onChange(listener: () => void): () => void
    /** What the forge says about each of a ticket's PRs (size, mergeability, checks). */
    details(ticketId: number): Promise<PullRequestDetails[]>
  }
}
