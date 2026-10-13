import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { Approval } from '../../../shared/approvals'
import { ticketSubject } from '../../../shared/approvals/approval-subject'
import {
  NO_REMOTE,
  type NoPullRequest,
  type PullRequest,
  refusalOf,
  type TicketCode,
  type Worktree,
} from '../../../shared/code'
import type { Column } from '../../../shared/domain/board'
import { BOSS, COMPANY_AUTHOR, type Mentionable } from '../../../shared/domain/chat'
import type { ProviderRuntime } from '../../../shared/platform/wsl'
import type { Migration } from '../../core'
import {
  companyKeyOf,
  inFolder,
  sameFilesystemKind,
  ticketCodeIn,
  worktreeRootOutside,
  worktreesBeside,
} from '../../core'
import { branchName, type GitService, runtimePaths, slugify } from '../../platform'
import type { CompanyApprovals } from '../approvals'
import type { Chat } from '../chat'
import type { NewInboxItem } from '../inbox'
import type { OpenedPullRequest } from '../notifications'
import { pushRefusal, repoMayPush } from '../repos'
import type { ActingBoard, TicketWakes } from '../sessions'

/** Where code-flow events are announced. */
export const PRS_CHANNEL = 'prs'

/** The folder under the Company folder that holds every ticket's worktrees. */
export const WORKTREES_FOLDER = 'worktrees'

/**
 * The folder that holds a repo's ticket worktrees, one sub-folder per branch.
 *
 * Under the Company folder, with two rules over that. Never inside the repo (decision 45): when
 * the Company folder is in the repo, the worktrees go beside it. And never on the other side of a
 * filesystem boundary from the repo (T255): a repo inside a WSL distro, reached from Windows over
 * `\\wsl.localhost\…`, keeps its worktrees beside it inside the distro rather than on the `C:`
 * drive the Company folder has to be on, so the Employee working in there never edits, builds or
 * installs through `/mnt/c`.
 *
 * On macOS and Linux, and on Windows with both on a drive, `sameFilesystemKind` is always true and
 * this is the layout it always was.
 */
export function worktreeRootOf(companyFolder: string, repo: { id: string; name: string; path?: string }): string {
  if (repo.path && !sameFilesystemKind(companyFolder, repo.path)) return worktreesBeside(repo.path)
  return worktreeRootOutside(join(companyFolder, WORKTREES_FOLDER, slugify(repo.name) || repo.id), repo.path)
}

/**
 * A worktree remembers the base it was cut from, and a PR used to be opened against that — so a
 * ticket moved to `develop` after its worktree was opened on `main` opened its MR into `main`
 * (T286, TP-15). The ticket's base is the one that counts: this puts every worktree already on
 * disk back on it, and `updateTicket` keeps them there from now on.
 */
export const WORKTREE_BASE_FOLLOWS_TICKET_MIGRATION: Migration = {
  name: 'worktree-base-follows-ticket',
  sql: `
  UPDATE worktree SET base = (SELECT base_branch FROM ticket WHERE ticket.id = worktree.ticket_id)
  WHERE EXISTS (
    SELECT 1 FROM ticket
    WHERE ticket.id = worktree.ticket_id AND ticket.base_branch IS NOT NULL AND ticket.base_branch <> worktree.base
  );
  `,
}

/** The code-flow migration step, appended to the engine's migrations. */
export const CODE_FLOW_MIGRATION: Migration = {
  name: 'code-flow-worktrees-and-pull-requests',
  sql: `
  CREATE TABLE worktree (
    ticket_id INTEGER NOT NULL REFERENCES ticket (id),
    repo_id TEXT NOT NULL,
    path TEXT NOT NULL,
    branch TEXT NOT NULL,
    base TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (ticket_id, repo_id)
  );
  CREATE TABLE pull_request (
    ticket_id INTEGER NOT NULL REFERENCES ticket (id),
    repo_id TEXT NOT NULL,
    url TEXT NOT NULL,
    number INTEGER,
    opened_at TEXT NOT NULL,
    PRIMARY KEY (ticket_id, repo_id)
  );
`,
}

/** Tickets' worktrees and PRs in the Company's repos. */
export interface CodeFlow {
  /** A ticket's worktrees and PRs, in the order of its repos. */
  of(ticketId: number): TicketCode
  /** Every ticket that has a worktree or a PR, by ticket id. */
  list(): TicketCode[]
  /** What the assignee is told about a ticket's worktrees, or null when it has none. */
  brief(ticketId: number): string | null
}

/**
 * One Company's code flow. Moving an assigned ticket into Doing gives it a worktree and branch per
 * repo in scope; moving it to Review opens a PR per repo, behind the `open_pr` gate for Employees.
 */
export interface CompanyCodeFlow extends CodeFlow {
  /** The board acting as `actorId`, with the code flow's side effects. */
  boardAs(actorId: string): ActingBoard
  /** Carries out an approved `open_pr` request. */
  decided(approval: Approval): void
  /** Forgets a ticket's worktree in a repo, once it is removed from disk. */
  worktreeRemoved(ticketId: number, repoId: string): void
}

export interface CodeFlowOptions {
  db: DatabaseSync
  /** The Company folder; worktrees live under it. */
  folder: string
  wakes: TicketWakes
  chat: Chat
  approvals: CompanyApprovals
  /** Files an inbox item for this Company. */
  deliver(item: NewInboxItem): void
  /** Without one, tickets move without touching any repo. */
  git?: GitService
  onChange(): void
  log(line: string): void
  /** Called after a PR opens and `#prs` says so. */
  onPullRequestOpened?(opened: OpenedPullRequest): void
  /** Called when a ticket in Review has a PR open for every worktree. */
  onReadyForReview?(ticketId: number): void
  /**
   * Where the Employee holding the ticket runs (T259), so the worktree paths its brief names are the
   * ones it can actually `cd` to: an Employee inside a distro is told `/home/b/Acme/worktrees/t-4`,
   * not the `\\wsl.localhost\Arch\…` this Windows process opens the same folder by. Left out,
   * every path is this machine's, which is every Mac and every Linux desktop.
   */
  runtimeOf?(employeeId: string): ProviderRuntime | null
  /** Called after a ticket's worktree is created in a repo, for the activity log. */
  onWorktreeCreated?(input: {
    ticketId: number
    title: string
    actorId: string
    repo: string
    branch: string
    base: string
    path: string
  }): void
}

interface TicketRow {
  id: number
  title: string
  description: string
  column_id: Column
  assignee_id: string | null
  repos: string
  base_branch: string | null
}

interface RepoRow {
  id: string
  name: string
  path: string
}

interface WorktreeRow {
  ticket_id: number
  repo_id: string
  path: string
  branch: string
  base: string
  created_at: string
}

interface PullRequestRow {
  ticket_id: number
  repo_id: string
  url: string
  number: number | null
  opened_at: string
}

export function createCodeFlow({
  db,
  folder,
  wakes,
  chat,
  approvals,
  deliver,
  git,
  onChange,
  log,
  onPullRequestOpened,
  onReadyForReview,
  onWorktreeCreated,
  runtimeOf,
}: CodeFlowOptions): CompanyCodeFlow {
  /** `<ticket>:<repo>` of every PR being opened now. */
  const opening = new Set<string>()

  function ticket(id: number): TicketRow | undefined {
    return db
      .prepare('SELECT id, title, description, column_id, assignee_id, repos, base_branch FROM ticket WHERE id = ?')
      .get(id) as TicketRow | undefined
  }

  function repo(id: string): RepoRow | undefined {
    return db.prepare('SELECT id, name, path FROM repo WHERE id = ?').get(id) as RepoRow | undefined
  }

  function repoName(id: string): string {
    return repo(id)?.name ?? 'removed repo'
  }

  /** How every line here names a ticket: `TC-142` (decision 33). */
  const idOf = (ticketId: number) => ticketCodeIn(db, ticketId)

  function people(): Mentionable[] {
    return chat.people()
  }

  function worktrees(ticketId: number): Worktree[] {
    const rows = db
      .prepare('SELECT * FROM worktree WHERE ticket_id = ? ORDER BY created_at, rowid')
      .all(ticketId) as unknown as WorktreeRow[]
    return rows.map((r) => ({
      ticketId: r.ticket_id,
      repoId: r.repo_id,
      path: r.path,
      branch: r.branch,
      base: r.base,
      createdAt: r.created_at,
    }))
  }

  function pullRequests(ticketId: number): PullRequest[] {
    const rows = db
      .prepare('SELECT * FROM pull_request WHERE ticket_id = ? ORDER BY opened_at, rowid')
      .all(ticketId) as unknown as PullRequestRow[]
    return rows.map((r) => ({
      ticketId: r.ticket_id,
      repoId: r.repo_id,
      url: r.url,
      number: r.number,
      openedAt: r.opened_at,
    }))
  }

  /** A ticket's worktrees and PRs in the order of its repos. */
  function sorted(ticketId: number): Pick<TicketCode, 'worktrees' | 'pullRequests'> {
    const row = ticket(ticketId)
    const order = row ? (JSON.parse(row.repos) as string[]) : []
    const sort = (a: { repoId: string }, b: { repoId: string }) => rank(order, a.repoId) - rank(order, b.repoId)
    return { worktrees: worktrees(ticketId).sort(sort), pullRequests: pullRequests(ticketId).sort(sort) }
  }

  function of(ticketId: number): TicketCode {
    // Testing is still before the merge (T174), so a repo that can get no PR says so there too.
    const column = ticket(ticketId)?.column_id
    const inReview = column === 'review' || column === 'testing'
    const refused = inReview ? unpushable(ticketId).map((w) => noPullRequest(w.repoId)) : []
    const localOnly = inReview ? refusingPush(ticketId).map((w) => w.repoId) : []
    return {
      ticketId,
      ...sorted(ticketId),
      ...(refused.length > 0 && { withoutPullRequest: refused }),
      ...(localOnly.length > 0 && { localOnly }),
    }
  }

  /** One repo that can get no PR, as the drawer and the board draw it: the badge and the sentence. */
  function noPullRequest(repoId: string): NoPullRequest {
    return { repoId, ...refusalOf(refusalFor(repoId) ?? NO_REMOTE) }
  }

  function brief(ticketId: number): string | null {
    const row = ticket(ticketId)
    const code = of(ticketId)
    if (!row || code.worktrees.length === 0) return null
    // In the Employee's own spelling, because this sentence is the one that tells it where to work.
    const spelling = runtimePaths(row.assignee_id === null ? null : (runtimeOf?.(row.assignee_id) ?? null))
    const list = code.worktrees
      .map((w) => `${repoName(w.repoId)}: ${spelling.toRuntime(w.path)} (branch ${w.branch})`)
      .join('; ')
    return (
      `Your ticket ${idOf(row.id)} ${JSON.stringify(row.title)} has its own worktrees, one per repo: ${list}. ` +
      'Work, commit and push only in those directories, never in the Company folder. ' +
      `When it is done, move ${idOf(row.id)} to review with ticket_move: that opens a PR per repo.`
    )
  }

  /** Makes sure an assigned ticket in Doing has a worktree for each of its repos. */
  function prepareWorktrees(row: TicketRow, actorId: string): void {
    const assignee = row.assignee_id
    if (!git || row.column_id !== 'doing' || !assignee) return
    if (!people().some((p) => p.id === assignee)) return
    const existing = worktrees(row.id)
    const branch = existing[0]?.branch ?? branchName(companyKeyOf(db), row.id, row.title)
    let created = 0
    try {
      for (const repoId of JSON.parse(row.repos) as string[]) {
        if (existing.some((w) => w.repoId === repoId)) continue
        const found = repo(repoId)
        if (!found) continue
        const path = inFolder(worktreeRootOf(folder, found), branch)
        const added = git.addWorktree({
          repoPath: found.path,
          path,
          branch,
          ...(row.base_branch !== null && { base: row.base_branch }),
        })
        db.prepare(
          'INSERT INTO worktree (ticket_id, repo_id, path, branch, base, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        ).run(row.id, repoId, added.path, added.branch, added.base, new Date().toISOString())
        created++
        onWorktreeCreated?.({
          ticketId: row.id,
          title: row.title,
          actorId: assignee,
          repo: found.name,
          branch: added.branch,
          base: added.base,
          path: added.path,
        })
      }
    } finally {
      if (created > 0) onChange()
    }
    if (created === 0 || assignee === actorId) return
    deliver({
      employeeId: assignee,
      kind: 'ticket',
      fromId: actorId,
      channelId: null,
      threadId: null,
      messageId: null,
      ticketId: row.id,
      text: `Worktrees ready for ${idOf(row.id)}`,
      prompt: `[company] ${brief(row.id)} Talk through the company MCP server, never in plain text.`,
    })
  }

  /** Worktrees of a ticket that have no PR and none being opened. */
  function withoutPullRequest(ticketId: number): Worktree[] {
    const opened = new Set(pullRequests(ticketId).map((p) => p.repoId))
    return sorted(ticketId).worktrees.filter((w) => !opened.has(w.repoId) && !opening.has(`${ticketId}:${w.repoId}`))
  }

  /** Why this repo can get no PR — no `origin`, or a forge with no adapter — or null when it can. */
  function refusalFor(repoId: string): string | null {
    const found = repo(repoId)
    return !git || !found ? null : git.pullRequestRefusal(found.path)
  }

  /** Worktrees without a PR whose repo is `local only`, so TinyCorp opens none there (decision 61). */
  function refusingPush(ticketId: number): Worktree[] {
    return withoutPullRequest(ticketId).filter((w) => !repoMayPush(db, w.repoId))
  }

  /**
   * Worktrees without a PR whose repo may be pushed to but can get no PR — no `origin`, or a forge
   * with no adapter. A `local only` repo is left out: it refuses by choice, and says so itself. The
   * rung is asked first, so a `local only` repo that also has no `origin` names the rung.
   */
  function unpushable(ticketId: number): Worktree[] {
    return withoutPullRequest(ticketId).filter((w) => repoMayPush(db, w.repoId) && refusalFor(w.repoId) !== null)
  }

  /** Worktrees without a PR that can get one now: the rung allows it and the forge can open it. */
  function openable(ticketId: number): Worktree[] {
    return withoutPullRequest(ticketId).filter((w) => repoMayPush(db, w.repoId) && refusalFor(w.repoId) === null)
  }

  /**
   * Worktrees whose PR is still to come. A repo the forge refuses is one of them: the boss can add
   * the remote, or push and open the PR, and the round waits for that. A `local only` repo is not:
   * no PR is ever coming there, and the review must not wait for one (decision 61).
   */
  function awaitingPullRequest(ticketId: number): Worktree[] {
    return withoutPullRequest(ticketId).filter((w) => repoMayPush(db, w.repoId))
  }

  /** Says in `#prs`, which wakes the assignee, why these repos get no PR. */
  function refuseWithoutPullRequest(row: TicketRow): void {
    for (const w of unpushable(row.id)) {
      const found = repo(w.repoId)
      const where = found?.path ?? 'the repo'
      const reason = refusalFor(w.repoId) ?? NO_REMOTE
      const fix =
        reason === NO_REMOTE
          ? `add an origin remote to ${where}, then move the ticket to Review again.`
          : `the work is committed on ${w.branch} in ${w.path} — push it and open the PR yourself.`
      chat.post({
        authorId: COMPANY_AUTHOR,
        channelId: PRS_CHANNEL,
        text: `${reason} for ${idOf(row.id)} ${row.title} in ${repoName(w.repoId)}: ${fix}`,
      })
    }
  }

  /** Says in `#prs` why a `local only` repo gets no PR; the rung is the reason, not the remote. */
  function refuseLocalOnly(row: TicketRow): void {
    for (const w of refusingPush(row.id)) {
      const refusal = pushRefusal(db, w.repoId)
      if (!refusal) continue
      chat.post({
        authorId: COMPANY_AUTHOR,
        channelId: PRS_CHANNEL,
        text: `No PR for ${idOf(row.id)} ${row.title}. ${refusal}`,
      })
    }
  }

  /** Tells `onReadyForReview` when the ticket is in Review with every PR open and none opening. */
  function reviewIfReady(ticketId: number): void {
    const row = ticket(ticketId)
    if (!onReadyForReview || row?.column_id !== 'review') return
    if (pullRequests(ticketId).length === 0 || awaitingPullRequest(ticketId).length > 0) return
    if ([...opening].some((key) => key.startsWith(`${ticketId}:`))) return
    onReadyForReview(ticketId)
  }

  function subjectOf(row: TicketRow): string {
    return ticketSubject(companyKeyOf(db), row.id, row.title)
  }

  /** Opens the ticket's missing PRs, or asks the boss first when an Employee may not. */
  function requestPullRequests(row: TicketRow, actorId: string): void {
    if (!git) return
    refuseLocalOnly(row)
    refuseWithoutPullRequest(row)
    if (openable(row.id).length === 0) return
    const isEmployee = people().some((p) => p.id === actorId)
    if (actorId !== BOSS && isEmployee && !approvals.granted(actorId, 'open_pr', { ticketId: row.id })) {
      const asked = approvals.list({ status: 'pending' }).some((a) => a.action === 'open_pr' && a.ticketId === row.id)
      if (asked) return
      const repos = openable(row.id).map((w) => repoName(w.repoId))
      approvals.request({
        requesterId: actorId,
        action: 'open_pr',
        ticketId: row.id,
        reason: `${idOf(row.id)} is ready for review; this opens a PR in ${repos.join(', ')}.`,
      })
      return
    }
    openPullRequests(row.id)
  }

  /**
   * The ticket's base moved: its worktrees follow, so the PRs still to open go into the new base
   * (T286). A PR already open stays where the forge has it, and the channel says so, because
   * retargeting one is the holder's to do on the forge.
   */
  function rebase(ticketId: number, base: string): void {
    const moved = db.prepare('UPDATE worktree SET base = ? WHERE ticket_id = ? AND base <> ?').run(base, ticketId, base)
    if (Number(moved.changes) === 0) return
    onChange()
    const open = pullRequests(ticketId)
    if (open.length === 0) return
    chat.post({
      authorId: COMPANY_AUTHOR,
      channelId: PRS_CHANNEL,
      text:
        `${idOf(ticketId)} now goes into ${base}. Its open ${open.length === 1 ? 'PR still targets' : 'PRs still target'} ` +
        `the old base: retarget ${open.map((pr) => pr.url).join(', ')} to ${base} before it is reviewed.`,
    })
  }

  function openPullRequests(ticketId: number): void {
    const pending = openable(ticketId)
    for (const w of pending) opening.add(`${ticketId}:${w.repoId}`)
    void (async () => {
      for (const worktree of pending) {
        try {
          await openOne(worktree)
        } finally {
          opening.delete(`${ticketId}:${worktree.repoId}`)
        }
      }
      if (db.isOpen) reviewIfReady(ticketId)
    })().catch((error: unknown) => log(`Opening PRs for ${idOf(ticketId)} failed: ${String(error)}`))
  }

  async function openOne(worktree: Worktree): Promise<void> {
    const row = ticket(worktree.ticketId)
    if (!row || !git) return
    const name = repoName(worktree.repoId)
    // Read the rung again here: the boss may have moved the repo down the ladder while the PRs of
    // this ticket were being opened, and nothing is pushed against the rung it holds now.
    const refusal = pushRefusal(db, worktree.repoId)
    if (refusal) {
      chat.post({
        authorId: COMPANY_AUTHOR,
        channelId: PRS_CHANNEL,
        text: `No PR for ${idOf(row.id)} ${row.title}. ${refusal}`,
      })
      return
    }
    try {
      const pr = await git.openPullRequest({
        path: worktree.path,
        branch: worktree.branch,
        // The ticket's base, not the one the worktree was cut from: it may have moved since (T286).
        base: row.base_branch ?? worktree.base,
        title: subjectOf(row),
        body: pullRequestBody(row),
      })
      if (!db.isOpen) return
      db.prepare('INSERT INTO pull_request (ticket_id, repo_id, url, number, opened_at) VALUES (?, ?, ?, ?, ?)').run(
        row.id,
        worktree.repoId,
        pr.url,
        pr.number,
        new Date().toISOString(),
      )
      onChange()
      const message = chat.post({
        authorId: COMPANY_AUTHOR,
        channelId: PRS_CHANNEL,
        text: `PR opened for ${idOf(row.id)} ${row.title} in ${name}: ${pr.url}`,
      })
      onPullRequestOpened?.({
        ticketId: row.id,
        title: row.title,
        assigneeId: row.assignee_id,
        repo: name,
        number: pr.number,
        message,
      })
    } catch (error) {
      if (!db.isOpen) return
      const reason = error instanceof Error ? error.message : String(error)
      log(`Could not open a PR for ${idOf(row.id)} in ${name}: ${reason}`)
      chat.post({
        authorId: COMPANY_AUTHOR,
        channelId: PRS_CHANNEL,
        text: `Could not open a PR for ${idOf(row.id)} ${row.title} in ${name}: ${reason}`,
      })
    }
  }

  function pullRequestBody(row: TicketRow): string {
    const assignee = people().find((p) => p.id === row.assignee_id)?.name
    return [
      `Ticket ${idOf(row.id)}: ${row.title}`,
      row.description.trim(),
      `Opened by TinyCorp${assignee ? ` for ${assignee}` : ''}.`,
    ]
      .filter(Boolean)
      .join('\n\n')
  }

  return {
    of,
    brief,

    list() {
      const ids = db
        .prepare('SELECT ticket_id FROM worktree UNION SELECT ticket_id FROM pull_request ORDER BY ticket_id')
        .all() as { ticket_id: number }[]
      return ids.map((r) => of(r.ticket_id))
    },

    boardAs(actorId) {
      const board = wakes.boardAs(actorId)
      const afterEdit = (id: number) => {
        const row = ticket(id)
        if (row) prepareWorktrees(row, actorId)
      }
      return {
        ...board,

        createTicket(input) {
          const created = board.createTicket(input)
          afterEdit(created.id)
          return created
        },

        updateTicket(id, changes) {
          const before = changes.baseBranch === undefined ? undefined : ticket(id)
          const updated = board.updateTicket(id, changes)
          if (before && updated.baseBranch !== null && updated.baseBranch !== before.base_branch) {
            rebase(updated.id, updated.baseBranch)
          }
          afterEdit(updated.id)
          return updated
        },

        moveTicket(id, column, index) {
          const before = ticket(id)
          if (before && column === 'done' && before.column_id !== 'done' && actorId !== BOSS) {
            if (worktrees(id).length > 0) {
              throw new Error(
                `${idOf(id)} has a branch to merge, so the app moves it to Done when it merges; ` +
                  'never merge, push to the default branch or move it to Done yourself.',
              )
            }
          }
          if (before && column === 'doing') prepareWorktrees({ ...before, column_id: 'doing' }, actorId)
          const moved = board.moveTicket(id, column, index)
          if (before && column === 'review' && before.column_id !== 'review') {
            requestPullRequests(ticket(id)!, actorId)
            reviewIfReady(id)
          }
          return moved
        },
      }
    },

    decided(approval) {
      if (approval.action !== 'open_pr' || approval.status !== 'approved') return
      const row = approval.ticketId === null ? undefined : ticket(approval.ticketId)
      if (row?.column_id === 'review' && git) openPullRequests(row.id)
    },

    worktreeRemoved(ticketId, repoId) {
      db.prepare('DELETE FROM worktree WHERE ticket_id = ? AND repo_id = ?').run(ticketId, repoId)
      onChange()
    },
  }
}

function rank(order: string[], repoId: string): number {
  const index = order.indexOf(repoId)
  return index === -1 ? order.length : index
}
