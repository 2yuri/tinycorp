import type { NoPullRequest, PullRequest, TicketCode } from '../../../shared/code'

/** What a worktree's row says about its PR: the PR, why none can be opened, or that none is open yet. */
export type PrState = { kind: 'open'; pr: PullRequest } | { kind: 'refused'; refusal: NoPullRequest } | { kind: 'none' }

export function prState(code: TicketCode, repoId: string): PrState {
  const pr = code.pullRequests.find((p) => p.repoId === repoId)
  if (pr) return { kind: 'open', pr }
  const refusal = code.withoutPullRequest?.find((entry) => entry.repoId === repoId)
  return refusal ? { kind: 'refused', refusal } : { kind: 'none' }
}
