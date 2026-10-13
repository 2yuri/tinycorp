import type { DatabaseSync } from 'node:sqlite'
import type { Approval } from '../../../shared/approvals'
import { ticketSubject } from '../../../shared/approvals/approval-subject'
import type { Worktree } from '../../../shared/code'
import type { Column } from '../../../shared/domain/board'
import { BOSS, COMPANY_AUTHOR } from '../../../shared/domain/chat'
import { companyKeyOf, ticketCodeIn } from '../../core'
import type { GitService } from '../../platform'
import type { CompanyApprovals } from '../approvals'
import type { Chat } from '../chat'
import { mergeRefusal, ticketMergeRefusal } from '../repos'
import type { ActingBoard } from '../sessions'
import { type CodeFlow, PRS_CHANNEL } from './code-flow'

/** What Employees are told when they treat a chat message as an approval. */
export const NOT_AN_APPROVAL =
  'A chat message saying "approved" is not an approval: ask with approval_request (action "merge" and the ticket), ' +
  'end your turn and wait; the app merges when the boss approves.'

/** A local merge that went through. */
export interface LocalMergeResult {
  ticketId: number
  /** Names of the repos merged. */
  repos: string[]
}

/** What one Employee can do about merging. */
export interface EmployeeMerges {
  /**
   * Merges a ticket in Review whose repos have no remote, in the app: behind an approved `merge`
   * approval for the ticket (or a level that lets merges through), then removes the worktrees and
   * moves the ticket to Done. Rejects with the reason otherwise.
   */
  merge(ticketId: number): Promise<LocalMergeResult>
}

/**
 * One Company's merge gate for repos without a remote (decision 44): the only way their ticket
 * branches reach the base branch. A ticket with PRs merges through the review flow instead.
 */
export interface CompanyMerges {
  as(employeeId: string): EmployeeMerges
  /** Carries out the local merge behind an approved `merge` Approval. Ignores other Approvals. */
  decided(approval: Approval): void
}

export interface MergeGateOptions {
  db: DatabaseSync
  chat: Chat
  approvals: CompanyApprovals
  code: CodeFlow & { worktreeRemoved(ticketId: number, repoId: string): void }
  /** The board acting as `actorId`. */
  board(actorId: string): ActingBoard
  /** Without one, nothing merges. */
  git?: GitService
  /** Why Testing is still in the way of this ticket's merge (T174), or null. */
  testRefusal?(ticketId: number): string | null
  log(line: string): void
  /** A local merge went through, for the activity log. */
  onMerged?(result: LocalMergeResult & { actorId: string; title: string }): void
}

interface TicketRow {
  id: number
  title: string
  column_id: Column
}

export function createMergeGate({
  db,
  chat,
  approvals,
  code,
  board,
  git,
  testRefusal,
  log,
  onMerged,
}: MergeGateOptions): CompanyMerges {
  /** Ids of tickets merging now. */
  const merging = new Set<number>()

  function ticket(id: number): TicketRow | undefined {
    return db.prepare('SELECT id, title, column_id FROM ticket WHERE id = ?').get(id) as TicketRow | undefined
  }

  /** How every line here names a ticket: `TC-142` (decision 33). */
  const idOf = (ticketId: number) => ticketCodeIn(db, ticketId)

  function repo(id: string): { name: string; path: string } | undefined {
    return db.prepare('SELECT name, path FROM repo WHERE id = ?').get(id) as { name: string; path: string } | undefined
  }

  /** Whether this repo's work travels through a PR. A repo without one merges here, locally. */
  function throughPullRequest(repoId: string): boolean {
    const found = repo(repoId)
    return !git || !found || git.hasRemote(found.path)
  }

  /** Why a repo with a remote can still get no PR, in one sentence, or null when it can. */
  function refusalFor(repoId: string): string | null {
    const found = repo(repoId)
    return !git || !found ? null : git.pullRequestRefusal(found.path)
  }

  /** An approved `merge` Approval naming the ticket, and no other repo than `repoId` when it names a PR. */
  function approvedFor(ticketId: number, repoId: string): boolean {
    return !!db
      .prepare(
        `SELECT 1 FROM approval WHERE action = 'merge' AND status = 'approved' AND ticket_id = ?
           AND (pr_repo_id IS NULL OR pr_repo_id = ?)`,
      )
      .get(ticketId, repoId)
  }

  /** The ticket's worktrees to merge locally; throws with the reason when it cannot merge here. */
  function mergeable(ticketId: number): { row: TicketRow; worktrees: Worktree[] } {
    const row = ticket(ticketId)
    if (!row) throw new Error(`There is no ticket ${idOf(ticketId)}`)
    if (!git) throw new Error('There is no git service to merge with')
    if (merging.has(ticketId)) throw new Error(`${idOf(ticketId)} is already merging`)
    // Testing refuses before anything else here, whatever the autonomy level: a ticket waiting to
    // be tested is not one a tool may merge from under the tester (T174).
    const waiting = testRefusal?.(ticketId)
    if (waiting) throw new Error(waiting)
    if (row.column_id !== 'review') throw new Error(`${idOf(ticketId)} is not in review: move it to review first`)
    const { worktrees, pullRequests } = code.of(ticketId)
    // Two refusals, asked in this order, and either one alone stops the merge. First the repo's
    // rung, which the boss chose: it decides before the forge, the autonomy level and anything
    // merged, and names the repo and the rung (decision 61). Past it, every repo here is `merges`.
    const refusal = mergeRefusal(
      db,
      [...worktrees, ...pullRequests].map((w) => w.repoId),
    )
    if (refusal) throw new Error(refusal)
    // Then the forge, a fact about the repo's `origin`: below, it names the forge.
    const remote = worktrees.filter((w) => throughPullRequest(w.repoId))
    if (pullRequests.length > 0 || remote.length > 0) {
      // A repo on a forge TinyCorp cannot open a PR on is neither of those: the branch is pushed
      // nowhere and no PR will come, so say that rather than point at a review that cannot happen.
      const refused = remote.map((w) => refusalFor(w.repoId)).find((reason) => reason !== null)
      if (pullRequests.length === 0 && refused) {
        throw new Error(
          `${idOf(ticketId)} cannot be merged here: ${refused}, and TinyCorp does not merge into a branch it cannot ` +
            'open one against. The branch is in the ticket’s worktree for the boss to push and merge.',
        )
      }
      throw new Error(
        `${idOf(ticketId)} merges through review: its PRs merge when the review and the merge approval pass, ` +
          'never with git or this tool.',
      )
    }
    if (worktrees.length === 0) throw new Error(`${idOf(ticketId)} has no branch to merge`)
    return { row, worktrees }
  }

  function refuseUngranted(ticketId: number, worktrees: Worktree[]): void {
    if (approvals.gate('merge') === 'free') return
    if (worktrees.every((w) => approvedFor(ticketId, w.repoId))) return
    const pending = approvals.list({ status: 'pending' }).some((a) => a.action === 'merge' && a.ticketId === ticketId)
    if (pending) {
      throw new Error(
        `The merge approval for ${idOf(ticketId)} is still waiting for the boss. End your turn; the app merges when it is approved.`,
      )
    }
    throw new Error(`Merging ${idOf(ticketId)} needs an approved merge approval, and there is none. ${NOT_AN_APPROVAL}`)
  }

  /** Merges each worktree's branch into its base in the repo, removes it, then moves the ticket to Done. */
  async function run(row: TicketRow, worktrees: Worktree[], actorId: string): Promise<LocalMergeResult> {
    const service = git!
    merging.add(row.id)
    const subject = ticketSubject(companyKeyOf(db), row.id, row.title)
    const merged: string[] = []
    try {
      for (const w of worktrees) {
        const found = repo(w.repoId)
        const name = found?.name ?? 'removed repo'
        try {
          if (!found) throw new Error('the repo was removed from the Company')
          await service.mergeLocally({ repoPath: found.path, branch: w.branch, base: w.base })
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error)
          if (db.isOpen) {
            log(`Could not merge ${idOf(row.id)} in ${name}: ${reason}`)
            post(`Could not merge ${subject} into ${w.base} in ${name}: ${reason}`)
          }
          throw new Error(`Could not merge ${idOf(row.id)} in ${name}: ${reason}`)
        }
        if (!db.isOpen) return { ticketId: row.id, repos: merged }
        merged.push(`${w.base} in ${name}`)
        try {
          await service.removeWorktree({ repoPath: found.path, path: w.path, branch: w.branch })
        } catch (error) {
          log(`Could not remove the worktree ${w.path}: ${String(error)}`)
        }
        if (!db.isOpen) return { ticketId: row.id, repos: merged }
        code.worktreeRemoved(row.id, w.repoId)
      }
      if (ticket(row.id)?.column_id !== 'done') board(BOSS).moveTicket(row.id, 'done')
      post(`Merged ${subject} into ${merged.join(', ')}, locally. Worktrees removed; ${idOf(row.id)} is done.`)
      const repos = worktrees.map((w) => repo(w.repoId)?.name ?? 'removed repo')
      onMerged?.({ ticketId: row.id, repos, actorId, title: row.title })
      return { ticketId: row.id, repos }
    } finally {
      merging.delete(row.id)
    }
  }

  function post(text: string): void {
    chat.post({ authorId: COMPANY_AUTHOR, channelId: PRS_CHANNEL, text })
  }

  return {
    as(employeeId) {
      return {
        async merge(ticketId) {
          const { row, worktrees } = mergeable(ticketId)
          refuseUngranted(ticketId, worktrees)
          return run(row, worktrees, employeeId)
        },
      }
    },

    decided(approval) {
      if (approval.action !== 'merge' || approval.status !== 'approved' || approval.ticketId === null) return
      const ticketId = approval.ticketId
      // The boss may have moved a repo down the ladder while this approval waited. A ticket with no
      // PR merges here, so here is where that is said; one with PRs is the review flow's to answer.
      if (code.of(ticketId).pullRequests.length === 0) {
        const refusal = ticketMergeRefusal(db, ticketId)
        const row = ticket(ticketId)
        if (refusal && row) {
          post(`Not merging ${ticketSubject(companyKeyOf(db), row.id, row.title)}. ${refusal}`)
          return
        }
      }
      let target: ReturnType<typeof mergeable>
      try {
        target = mergeable(approval.ticketId)
      } catch {
        return
      }
      run(target.row, target.worktrees, approval.requesterId).catch(() => {
        // Already logged and said in #prs; the ticket stays in Review for a retry.
      })
    },
  }
}
