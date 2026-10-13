import type { DatabaseSync } from 'node:sqlite'
import { BOSS } from '../../../shared/domain/chat'
import type { TicketRemoval } from '../../../shared/ticket-removal'
import { ticketCodeIn } from '../../core'
import type { GitService } from '../../platform'
import type { CompanyApprovals } from '../approvals'
import type { NewInboxItem } from '../inbox'

/**
 * Deleting a ticket (T275). The boss's own action, from the ticket's drawer: no MCP tool offers it,
 * so an Employee cannot take a ticket off the board.
 *
 * Only a ticket that holds no work goes. One that opened a pull request, or was reviewed, tested or
 * given a security pass, keeps its history on the board; one whose branch has commits nobody merged,
 * or whose worktree has changes nobody committed, would lose them. Each is refused with its reason.
 * Everything else that points at the ticket goes with it: its worktrees and their branches, its
 * restore points, and — through `ON DELETE CASCADE` — its subtasks, links, plan and column history.
 * A wake that named it forgets it, an Approval still waiting on it is turned down, and whoever held
 * it is told to drop it.
 */
export interface TicketRemovals {
  /** What deleting `ticketId` would take with it. Rejects with the reason the ticket stays. */
  ticketRemoval(ticketId: number): Promise<TicketRemoval>
  /** Deletes the ticket and everything that points at it, and resolves to what went. */
  deleteTicket(ticketId: number): Promise<TicketRemoval>
}

export interface TicketRemovalsOptions {
  db: DatabaseSync
  /** Without one, a ticket has no worktree to read or remove. */
  git?: GitService
  approvals: Pick<CompanyApprovals, 'list' | 'decide'>
  /** Drops the ticket's restore points, and the work they keep on disk, before its row goes. */
  forgetRestorePoints(ticketId: number): void
  /** The name of an Employee on the roster, or null for anyone else. */
  nameOf(employeeId: string): string | null
  /** Files an inbox item for this Company. */
  deliver(item: NewInboxItem): void
  /** The ticket went: the activity log's line. */
  onDeleted?(input: { ticketId: number; title: string }): void
  onChange(): void
  log(line: string): void
}

/** Each table that keeps a ticket's history, and how the refusal says it. */
const HISTORY: readonly (readonly [table: string, what: string])[] = [
  ['pull_request', 'opened a pull request'],
  ['merged_pull_request', 'was merged'],
  ['review', 'was reviewed'],
  ['review_thread', 'was reviewed'],
  ['review_comment', 'was reviewed'],
  ['test_run', 'was tested'],
  ['security_pass', 'had a security pass'],
  ['security_finding', 'had a security pass'],
]

interface TicketRow {
  id: number
  title: string
  assignee_id: string | null
}

interface WorktreeRow {
  repo_id: string
  path: string
  branch: string
  base: string
  repo_name: string | null
  repo_path: string | null
}

export function createTicketRemovals(options: TicketRemovalsOptions): TicketRemovals {
  const { db, git } = options

  function ticket(id: number): TicketRow {
    const row = Number.isInteger(id)
      ? (db.prepare('SELECT id, title, assignee_id FROM ticket WHERE id = ?').get(id) as TicketRow | undefined)
      : undefined
    if (!row) throw new Error(`There is no ticket ${id}`)
    return row
  }

  function count(sql: string, ...params: number[]): number {
    return (db.prepare(sql).get(...params) as { n: number }).n
  }

  /** The ticket, what goes with it and its worktrees, or the reason it stays. */
  async function removalOf(id: number): Promise<{ row: TicketRow; removal: TicketRemoval; worktrees: WorktreeRow[] }> {
    const row = ticket(id)
    const code = ticketCodeIn(db, row.id)
    for (const [table, what] of HISTORY) {
      if (count(`SELECT COUNT(*) AS n FROM ${table} WHERE ticket_id = ?`, id) > 0) {
        throw new Error(`${code} ${what}, so it stays on the board with its history.`)
      }
    }
    const worktrees = db
      .prepare(
        `SELECT w.repo_id, w.path, w.branch, w.base, r.name AS repo_name, r.path AS repo_path
           FROM worktree w LEFT JOIN repo r ON r.id = w.repo_id
          WHERE w.ticket_id = ? ORDER BY w.created_at, w.repo_id`,
      )
      .all(id) as unknown as WorktreeRow[]
    for (const worktree of worktrees) {
      // A repo that was disconnected has no path left to read, and nothing of it to lose here.
      if (!git || worktree.repo_path === null) continue
      const repo = worktree.repo_name ?? worktree.repo_id
      const work = await git
        .branchWork({ repoPath: worktree.repo_path, path: worktree.path, base: worktree.base, branch: worktree.branch })
        .catch((error: unknown) => {
          throw new Error(`Could not read what ${code}’s branch in ${repo} holds, so it stays: ${messageOf(error)}`)
        })
      if (work.commits > 0) {
        throw new Error(
          `${code}’s branch in ${repo} has ${plural(work.commits, 'commit')} nobody merged, ` +
            'and deleting it would throw them away.',
        )
      }
      if (work.uncommitted) {
        throw new Error(
          `${code}’s worktree in ${repo} has changes nobody committed, and deleting it would throw them away.`,
        )
      }
    }
    return {
      row,
      worktrees,
      removal: {
        ticketId: row.id,
        code,
        title: row.title,
        subtasks: count('SELECT COUNT(*) AS n FROM subtask WHERE ticket_id = ?', id),
        links: count('SELECT COUNT(*) AS n FROM ticket_dependency WHERE ticket_id = ? OR blocked_by_id = ?', id, id),
        worktrees: worktrees.map((worktree) => worktree.repo_name ?? worktree.repo_id),
        holder: row.assignee_id === null ? null : options.nameOf(row.assignee_id),
      },
    }
  }

  return {
    ticketRemoval: async (ticketId) => (await removalOf(ticketId)).removal,

    async deleteTicket(ticketId) {
      // Asked again rather than trusted from the confirmation: work may have landed in between.
      const { row, removal, worktrees } = await removalOf(ticketId)
      // An Approval still waiting on the ticket has nothing left to decide; its requester hears why.
      for (const approval of options.approvals.list({ status: 'pending' })) {
        if (approval.ticketId !== row.id) continue
        options.approvals.decide(approval.id, { approve: false, reason: `${removal.code} was deleted.` })
      }
      // Git first, since no transaction can take it back; a worktree that held nothing is made
      // again the next time the ticket moves to Doing, should anything below fail.
      for (const worktree of worktrees) {
        if (!git || worktree.repo_path === null) continue
        await git.removeWorktree({ repoPath: worktree.repo_path, path: worktree.path, branch: worktree.branch })
      }
      options.forgetRestorePoints(row.id)
      db.exec('BEGIN')
      try {
        db.prepare('DELETE FROM worktree WHERE ticket_id = ?').run(row.id)
        // A wake that named the ticket stays in its Employee's history, pointing nowhere.
        db.prepare('UPDATE inbox_item SET ticket_id = NULL WHERE ticket_id = ?').run(row.id)
        db.prepare('DELETE FROM ticket WHERE id = ?').run(row.id)
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
      if (row.assignee_id !== null && removal.holder !== null) {
        options.deliver({
          employeeId: row.assignee_id,
          kind: 'deleted',
          fromId: BOSS,
          channelId: null,
          threadId: null,
          messageId: null,
          ticketId: null,
          text: row.title,
          prompt:
            `[company] The boss deleted ${removal.code} ${JSON.stringify(row.title)}: it is off the board, ` +
            'with its worktree and branch. Drop it: do not work on it or make it again.',
        })
      }
      options.log(`Deleted ${removal.code} ${JSON.stringify(row.title)}`)
      options.onDeleted?.({ ticketId: row.id, title: row.title })
      options.onChange()
      return removal
    },
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}
