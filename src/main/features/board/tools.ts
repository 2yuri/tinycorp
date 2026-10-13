import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { COLUMNS, type Epic, type Subtask, type Ticket } from '../../../shared/domain/board'
import { BOSS } from '../../../shared/domain/chat'
import { EPIC_COLORS, PRIORITIES } from '../../../shared/ticket-extras'
import { ticketCode } from '../../../shared/ticket-id'
import { openBlockers, waitingRefusal } from '../../../shared/ticket-links'
import { run, TICKET_ID_HELP, ticketIdInput, ticketNumber } from '../../core'
import type { McpCaller } from '../../core/engine'
import { reviewView } from '../review'

const PERSON_HELP = 'An Employee’s name.'
const REPOS_HELP = 'Names of the Company’s repos the ticket touches.'
const PRIORITY_HELP = 'How urgent the ticket is; normal when new.'
const LABELS_HELP = 'Free-form tags such as bug or checkout; the whole list, replacing any labels.'
const BASE_BRANCH_HELP =
  'The branch its worktrees start from and its PRs go into, in every repo; each repo’s default branch when omitted.'
const SUBTASK_RULE =
  'Subtasks are a checklist on the same branch and PR: same assignee, one of the ticket’s repos. ' +
  'Work for another person or another repo is another ticket.'

const newSubtask = z.object({
  title: z.string(),
  repo: z.string().optional().describe('One of the ticket’s repos.'),
  assignee: z.string().optional().describe('Must be the ticket’s assignee.'),
})
type NewSubtaskInput = z.infer<typeof newSubtask>

/**
 * `board_list`, `ticket_create`, `ticket_claim`, `ticket_move`, `ticket_update`,
 * `ticket_blocked_by`, `subtask_toggle`, `target_create` and `epic_create`, acting as the calling
 * Employee.
 * People and repos are named as Employees know them; the subtask rule is checked before any edit.
 */
export function registerBoardTools(
  server: McpServer,
  { company, employee, chat, board, repos, code, reviews, planning }: McpCaller,
): void {
  /** `TC-142`: the one way a ticket is named in an answer (decision 33). */
  const idOf = (ticketId: number) => ticketCode(company.key, ticketId)
  /** A `ticket_id` input, which may be `TC-142`, `#142` or 142. */
  const asTicketId = (input: number | string) => ticketNumber(input, company.key)
  /** A ticket named by another Company's key is refused by name, not read as a number of ours. */
  function ownTicketId(input: number | string): number {
    const key = typeof input === 'string' ? /^#?([A-Za-z][A-Za-z0-9]*)-\d+$/.exec(input.trim())?.[1] : undefined
    if (key !== undefined && key.toLowerCase() !== company.key.toLowerCase()) {
      throw new Error(
        `${input.toString().trim()} is not a ticket of this Company; a ticket waits only on its own board`,
      )
    }
    return asTicketId(input)
  }
  const nameOf = (id: string | null) =>
    id === null ? null : (chat.people().find((p) => p.id === id)?.name ?? 'former employee')
  const repoName = (id: string) => repos().find((r) => r.id === id)?.name ?? 'removed repo'

  /** An Employee's id from their name; null and blank mean nobody. */
  function person(name: string | null | undefined): string | null {
    const wanted = name?.trim().replace(/^@/, '').toLowerCase()
    if (!wanted) return null
    if (wanted === BOSS) throw new Error('Only Employees hold tickets')
    const found = chat.people().find((p) => p.name.toLowerCase() === wanted || p.id === name)
    if (!found) throw new Error(`Nobody is called ${name}`)
    return found.id
  }

  function repoId(name: string): string {
    const wanted = name.trim().toLowerCase()
    const found = repos().find((r) => r.name.toLowerCase() === wanted || r.id === name)
    if (!found) throw new Error(`The Company has no repo ${name}`)
    return found.id
  }

  function ticketById(id: number): Ticket {
    const found = board.snapshot().tickets.find((t) => t.id === id)
    if (!found) throw new Error(`There is no ticket ${idOf(id)}`)
    return found
  }

  /** Resolves new subtasks and refuses any that break the subtask rule for a ticket with this assignee and repos. */
  function checkSubtasks(subtasks: NewSubtaskInput[], assigneeId: string | null, repoIds: string[]) {
    return subtasks.map((s) => {
      if (!s.title.trim()) throw new Error('A subtask needs a title')
      const assignee = s.assignee === undefined ? undefined : person(s.assignee)
      if (assignee !== undefined && assignee !== assigneeId) {
        throw new Error(`Subtask "${s.title}" is for someone else than the ticket’s assignee; make it a ticket`)
      }
      const repo = s.repo === undefined ? null : repoId(s.repo)
      if (repo !== null && !repoIds.includes(repo)) {
        throw new Error(`Subtask "${s.title}" is in a repo the ticket does not touch; make it a ticket`)
      }
      return { title: s.title, repo }
    })
  }

  function addSubtasks(ticketId: number, subtasks: { title: string; repo: string | null }[]) {
    for (const s of subtasks) board.createSubtask({ ticketId, title: s.title, repo: s.repo })
  }

  const subtaskView = (s: Subtask) => ({
    id: s.id,
    ticket: idOf(s.ticketId),
    title: s.title,
    done: s.done,
    repo: s.repo === null ? null : repoName(s.repo),
  })

  const ticketView = (t: Ticket, tickets: readonly Ticket[] = board.snapshot().tickets) => ({
    id: idOf(t.id),
    /** The number behind the display id; either one may be given back as `ticket_id`. */
    number: t.id,
    title: t.title,
    description: t.description,
    column: t.column,
    epic_id: t.epicId,
    assignee: nameOf(t.assigneeId),
    repos: t.repos.map(repoName),
    blocked: t.blocked,
    blocked_reason: t.blockedReason,
    /** The tickets it waits on (T266); it is not started while one of them is not Done. */
    blocked_by: t.blockedBy.map(idOf),
    blocks: t.blocks.map(idOf),
    waits: openBlockers(t, tickets).length > 0,
    priority: t.priority,
    labels: t.labels,
    base_branch: t.baseBranch,
    subtasks: t.subtasks.map(subtaskView),
    ...codeView(t.id),
    review: reviewView({ chat }, reviews.of(t.id)),
  })

  const codeView = (ticketId: number) => {
    const { worktrees, pullRequests } = code.of(ticketId)
    return {
      worktrees: worktrees.map((w) => ({ repo: repoName(w.repoId), path: w.path, branch: w.branch })),
      pull_requests: pullRequests.map((p) => ({ repo: repoName(p.repoId), url: p.url })),
    }
  }

  const epicView = (e: Epic) => {
    const channel = board.epicChannel(e.id)
    return {
      id: e.id,
      title: e.title,
      description: e.description,
      target_id: e.targetId,
      color: e.color,
      channel: channel === null ? null : `#${channel}`,
    }
  }

  server.registerTool(
    'board_list',
    {
      description:
        'Read the kanban board: columns with WIP limits, targets, epics (with their channels) and tickets with subtasks.',
      inputSchema: {
        mine: z.boolean().optional().describe('Only tickets assigned to you.'),
        column: z.enum(COLUMNS).optional().describe('Only tickets in this column.'),
      },
    },
    ({ mine, column }) =>
      run(() => {
        const snapshot = board.snapshot()
        return {
          columns: snapshot.columns.map((c) => ({
            column: c.id,
            title: c.title,
            count: c.count,
            wip_limit: c.wipLimit,
            over_limit: c.overLimit,
          })),
          targets: snapshot.targets,
          epics: snapshot.epics.map(epicView),
          tickets: snapshot.tickets
            .filter((t) => (!mine || t.assigneeId === employee.id) && (!column || t.column === column))
            .map((t) => ticketView(t, snapshot.tickets)),
        }
      }),
  )

  server.registerTool(
    'target_create',
    {
      description: 'Record what the boss asked for, in one sentence. Group its work in epics.',
      inputSchema: {
        title: z.string(),
        description: z.string().optional(),
        due: z.string().optional().describe('The day it is due, 2026-09-25, when the boss gave one.'),
      },
    },
    ({ title, description, due }) =>
      run(() =>
        board.createTarget({
          title,
          ...(description !== undefined && { description }),
          ...(due !== undefined && { dueAt: due }),
        }),
      ),
  )

  server.registerTool(
    'epic_create',
    {
      description:
        'Create an epic, a feature grouping tickets, and its chat channel. You, the listed members and ' +
        'everyone assigned a ticket in it join the channel; every message there wakes its members.',
      inputSchema: {
        title: z.string(),
        description: z.string().optional(),
        target_id: z.number().int().optional().describe('The target this epic serves.'),
        color: z
          .enum(EPIC_COLORS)
          .optional()
          .describe('The dot on its tickets’ cards; the palette in turn when omitted.'),
        members: z.array(z.string()).optional().describe('Employees’ names to add to the channel.'),
      },
    },
    ({ title, description, target_id, color, members = [] }) =>
      run(() =>
        epicView(
          board.createEpic({
            title,
            ...(description !== undefined && { description }),
            ...(target_id !== undefined && { targetId: target_id }),
            ...(color !== undefined && { color }),
            members: members.map((m) => person(m)).filter((id) => id !== null),
          }),
        ),
      ),
  )

  server.registerTool(
    'ticket_create',
    {
      description: `Create a ticket: one assignee, one branch and one PR per repo. Assigning it wakes the assignee. ${SUBTASK_RULE}`,
      inputSchema: {
        title: z.string(),
        description: z.string().optional(),
        epic_id: z.number().int().optional(),
        column: z
          .enum(COLUMNS)
          .optional()
          .describe('Defaults to planning: a new ticket is planned before it is Ready.'),
        assignee: z.string().optional().describe(PERSON_HELP),
        repos: z.array(z.string()).optional().describe(REPOS_HELP),
        priority: z.enum(PRIORITIES).optional().describe(PRIORITY_HELP),
        labels: z.array(z.string()).optional().describe(LABELS_HELP),
        base_branch: z.string().optional().describe(BASE_BRANCH_HELP),
        subtasks: z.array(newSubtask).optional().describe('A checklist to add.'),
      },
    },
    ({
      title,
      description,
      epic_id,
      column,
      assignee,
      repos: repoNames = [],
      priority,
      labels,
      base_branch,
      subtasks = [],
    }) =>
      run(() => {
        const assigneeId = person(assignee)
        const repoIds = repoNames.map(repoId)
        const checked = checkSubtasks(subtasks, assigneeId, repoIds)
        const ticket = board.createTicket({
          title,
          ...(description !== undefined && { description }),
          ...(epic_id !== undefined && { epicId: epic_id }),
          ...(column !== undefined && { column }),
          assigneeId,
          repos: repoIds,
          ...(priority !== undefined && { priority }),
          ...(labels !== undefined && { labels }),
          ...(base_branch !== undefined && { baseBranch: base_branch }),
        })
        addSubtasks(ticket.id, checked)
        return ticketView(ticketById(ticket.id))
      }),
  )

  server.registerTool(
    'ticket_claim',
    {
      description:
        'Take a ticket that is Ready and free or already yours, and move it to doing. Do this before you ' +
        'start work. It gets a worktree and branch per repo; the answer says where to work. ' +
        'A ticket still in Planning is refused: its plan has to be approved first. So is one that waits on ' +
        'another ticket that is not Done yet.',
      inputSchema: { ticket_id: ticketIdInput.describe(TICKET_ID_HELP) },
    },
    ({ ticket_id }) =>
      run(() => {
        const ticket = ticketById(asTicketId(ticket_id))
        const refusal = planning.claimRefusal(ticket.id)
        if (refusal) throw new Error(refusal)
        // Refused before it is assigned, so a claim that cannot start takes nothing either.
        const open = ticket.column === 'doing' ? [] : openBlockers(ticket, board.snapshot().tickets)
        if (open.length > 0)
          throw new Error(
            waitingRefusal(
              idOf(ticket.id),
              open.map((t) => idOf(t.id)),
            ),
          )
        if (ticket.assigneeId !== null && ticket.assigneeId !== employee.id) {
          throw new Error(`${nameOf(ticket.assigneeId)} holds ${idOf(ticket.id)}; ask them or the boss to hand it over`)
        }
        if (ticket.assigneeId === null) board.updateTicket(ticket.id, { assigneeId: employee.id })
        if (ticket.column !== 'doing') board.moveTicket(ticket.id, 'doing')
        const next = code.brief(ticket.id)
        return { ...ticketView(ticketById(ticket.id)), ...(next && { next }) }
      }),
  )

  server.registerTool(
    'ticket_move',
    {
      description:
        'Move a ticket to a column: planning, todo (Ready), doing, review or done. Over-limit moves are allowed and shown. ' +
        'Moving your ticket to review opens a PR per repo from its worktrees, after the boss approves when the autonomy level asks. ' +
        'A ticket with a branch reaches done only when the app merges it.',
      inputSchema: {
        ticket_id: ticketIdInput.describe(TICKET_ID_HELP),
        column: z.enum(COLUMNS),
        position: z.number().int().min(0).optional().describe('Index in the column; the bottom when omitted.'),
      },
    },
    ({ ticket_id, column, position }) =>
      run(() => ticketView(board.moveTicket(asTicketId(ticket_id), column, position))),
  )

  server.registerTool(
    'ticket_update',
    {
      description:
        'Change a ticket. Omitted fields stay. A new assignee is woken; assignee null frees the ticket. ' +
        SUBTASK_RULE,
      inputSchema: {
        ticket_id: ticketIdInput.describe(TICKET_ID_HELP),
        title: z.string().optional(),
        description: z.string().optional(),
        epic_id: z.number().int().nullable().optional(),
        assignee: z.string().nullable().optional().describe(PERSON_HELP),
        repos: z.array(z.string()).optional().describe(REPOS_HELP),
        blocked: z.boolean().optional(),
        blocked_reason: z.string().optional(),
        priority: z.enum(PRIORITIES).optional().describe(PRIORITY_HELP),
        labels: z.array(z.string()).optional().describe(LABELS_HELP),
        base_branch: z
          .string()
          .nullable()
          .optional()
          .describe(`${BASE_BRANCH_HELP} Null goes back to the default. Worktrees already made keep their base.`),
        add_subtasks: z.array(newSubtask).optional(),
      },
    },
    (input) =>
      run(() => {
        const current = ticketById(asTicketId(input.ticket_id))
        const assigneeId = input.assignee === undefined ? current.assigneeId : person(input.assignee)
        const repoIds = input.repos === undefined ? current.repos : input.repos.map(repoId)
        const checked = checkSubtasks(input.add_subtasks ?? [], assigneeId, repoIds)
        // A field the call left out is a field the ticket keeps: the key is absent, never undefined.
        board.updateTicket(current.id, {
          ...(input.title !== undefined && { title: input.title }),
          ...(input.description !== undefined && { description: input.description }),
          ...(input.epic_id !== undefined && { epicId: input.epic_id }),
          ...(input.assignee !== undefined && { assigneeId }),
          ...(input.repos !== undefined && { repos: repoIds }),
          ...(input.blocked !== undefined && { blocked: input.blocked }),
          ...(input.blocked_reason !== undefined && { blockedReason: input.blocked_reason }),
          ...(input.priority !== undefined && { priority: input.priority }),
          ...(input.labels !== undefined && { labels: input.labels }),
          ...(input.base_branch !== undefined && { baseBranch: input.base_branch }),
        })
        addSubtasks(current.id, checked)
        return ticketView(ticketById(current.id))
      }),
  )

  server.registerTool(
    'ticket_blocked_by',
    {
      description:
        'Record that a ticket waits on another, or remove that link. A ticket that waits is never started ' +
        'or claimed until every ticket it waits on is Done; then its holder is told. Use it to record the ' +
        'order when you split work. A loop is refused.',
      inputSchema: {
        ticket_id: ticketIdInput.describe(`The ticket that waits. ${TICKET_ID_HELP}`),
        blocked_by: ticketIdInput.describe('The ticket it waits on, in this Company.'),
        remove: z.boolean().optional().describe('Remove the link instead of adding it.'),
      },
    },
    ({ ticket_id, blocked_by, remove }) =>
      run(() => {
        const id = ticketById(ownTicketId(ticket_id)).id
        const blocker = ticketById(ownTicketId(blocked_by)).id
        return ticketView(remove ? board.removeBlocker(id, blocker) : board.addBlocker(id, blocker))
      }),
  )

  server.registerTool(
    'subtask_toggle',
    {
      description: `Tick or untick a subtask of a ticket you hold. ${SUBTASK_RULE}`,
      inputSchema: {
        subtask_id: z.number().int(),
        done: z.boolean().optional().describe('Set instead of toggling.'),
      },
    },
    ({ subtask_id, done }) =>
      run(() => {
        const ticket = board.snapshot().tickets.find((t) => t.subtasks.some((s) => s.id === subtask_id))
        const subtask = ticket?.subtasks.find((s) => s.id === subtask_id)
        if (!ticket || !subtask) throw new Error(`There is no subtask ${subtask_id}`)
        if (ticket.assigneeId !== null && ticket.assigneeId !== employee.id) {
          throw new Error(
            `Subtask ${subtask.id} belongs to ${idOf(ticket.id)}, held by ${nameOf(ticket.assigneeId)}; ` +
              'if it is yours to do, make it a ticket',
          )
        }
        return subtaskView(board.updateSubtask(subtask.id, { done: done ?? !subtask.done }))
      }),
  )
}
