import { describe, expect, it } from 'vitest'
import { NO_REMOTE, NO_REMOTE_BADGE, noForgeReason, type TicketCode } from '../../../shared/code'
import { prState } from './ticket-code-model'

const worktree = (repoId: string) => ({
  ticketId: 7,
  repoId,
  branch: 'ticket-7-x',
  base: 'main',
  path: `/wt/${repoId}`,
  createdAt: '',
})
const code: TicketCode = {
  ticketId: 7,
  worktrees: [worktree('web'), worktree('notes'), worktree('api')],
  pullRequests: [{ ticketId: 7, repoId: 'web', number: 3, url: 'https://github.com/acme/web/pull/3', openedAt: '' }],
  withoutPullRequest: [
    { repoId: 'notes', badge: NO_REMOTE_BADGE, reason: NO_REMOTE },
    { repoId: 'infra', badge: 'No forge', reason: noForgeReason('gitlab.example.com') },
  ],
}

describe('a ticket worktree PR state', () => {
  it('shows the PR, why none can be opened, or that none is open yet', () => {
    expect(prState(code, 'web')).toMatchObject({ kind: 'open', pr: { number: 3 } })
    expect(prState(code, 'notes')).toEqual({
      kind: 'refused',
      refusal: { repoId: 'notes', badge: 'No remote', reason: NO_REMOTE },
    })
    // A repo on a forge nobody wrote an adapter for reads the same way, in its own words.
    expect(prState(code, 'infra')).toEqual({
      kind: 'refused',
      refusal: { repoId: 'infra', badge: 'No forge', reason: 'No adapter for gitlab.example.com, cannot open a PR' },
    })
    expect(prState(code, 'api')).toEqual({ kind: 'none' })
    // A snapshot from before the refusals were recorded has no list at all, not an empty one.
    const { withoutPullRequest: _refusals, ...noRefusals } = code
    expect(prState(noRefusals, 'notes')).toEqual({ kind: 'none' })
  })
})
