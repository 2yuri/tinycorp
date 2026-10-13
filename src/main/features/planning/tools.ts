import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { BOSS } from '../../../shared/domain/chat'
import type { Plan, PlanSubject } from '../../../shared/planning/planning'
import { ticketCode } from '../../../shared/ticket-id'
import { run, TICKET_ID_HELP, ticketIdInput, ticketNumber } from '../../core'
import type { McpCaller } from '../../core/engine'

const SUBJECT_HELP = 'The ticket being planned. Leave it out and pass `epic_id` to plan an epic instead.'

const planSubtask = z.object({
  title: z.string(),
  repo: z.string().optional().describe('One of the plan’s repos, by name.'),
})

/**
 * `plan_ask`, `plan_draft`, `plan_ready` and `plan_replan` (T171), acting as the calling Employee.
 * The planner asks the boss what the plan turns on, drafts it, and asks for Ready; an engineer
 * that finds the plan no longer fits asks for a replan.
 */
export function registerPlanningTools(server: McpServer, { company, chat, board, repos, planning }: McpCaller): void {
  const idOf = (ticketId: number) => ticketCode(company.key, ticketId)
  const asTicketId = (input: number | string) => ticketNumber(input, company.key)

  function repoId(name: string): string {
    const wanted = name.trim().toLowerCase()
    const found = repos().find((r) => r.name.toLowerCase() === wanted || r.id === name)
    if (!found) throw new Error(`The Company has no repo ${name}`)
    return found.id
  }

  const repoName = (id: string) => repos().find((r) => r.id === id)?.name ?? 'removed repo'

  const nameOf = (id: string | null) => {
    if (id === null || id === '') return null
    if (id === BOSS) return 'the boss'
    return chat.people().find((p) => p.id === id)?.name ?? 'former employee'
  }

  /** Which ticket or epic a call is about; exactly one of the two. */
  function subjectOf(ticket: number | string | undefined, epicId: number | undefined): PlanSubject {
    if (ticket !== undefined && epicId !== undefined) {
      throw new Error('A plan is about a ticket or an epic, not both')
    }
    if (ticket !== undefined) return { kind: 'ticket', id: asTicketId(ticket) }
    if (epicId !== undefined) return { kind: 'epic', id: epicId }
    throw new Error('Name the ticket (ticket_id) or the epic (epic_id) being planned')
  }

  const planView = (plan: Plan) => ({
    id: plan.id,
    version: plan.version,
    ticket: plan.ticketId === null ? null : idOf(plan.ticketId),
    epic_id: plan.epicId,
    status: plan.status,
    planner: nameOf(plan.plannerId),
    goal: plan.goal,
    approach: plan.approach,
    acceptance_criteria: plan.acceptanceCriteria,
    repos: plan.repos.map(repoName),
    subtasks: plan.subtasks.map((s) => ({ title: s.title, repo: s.repo === null ? null : repoName(s.repo) })),
    risks: plan.risks,
    open_questions: plan.openQuestions,
    approved_by: nameOf(plan.approvedBy),
    approved_at: plan.approvedAt,
    replan_reason: plan.replanReason,
    replan_changes: plan.replanChanges,
    channel: `#${plan.channelId}`,
    questions: plan.questions.map((q) => ({
      number: q.number,
      question: q.text,
      answer: q.answer,
      answered_by: nameOf(q.answeredBy),
      /** True when the boss chose "Let … decide": the call is yours to make. */
      yours_to_decide: q.delegated,
    })),
    column: plan.ticketId === null ? null : board.snapshot().tickets.find((t) => t.id === plan.ticketId)?.column,
  })

  server.registerTool(
    'plan_ask',
    {
      description:
        'Ask the boss the questions the plan turns on, numbered, in the planning thread. ' +
        'Ask only what changes what you would build, and ask them all at once: the boss answers each ' +
        'one inline and you are woken with every answer together.',
      inputSchema: {
        ticket_id: ticketIdInput.optional().describe(`${TICKET_ID_HELP} ${SUBJECT_HELP}`),
        epic_id: z.number().int().optional().describe('The epic being planned, instead of a ticket.'),
        questions: z.array(z.string()).describe('One line each, in the order you want them answered.'),
      },
    },
    ({ ticket_id, epic_id, questions }) => run(() => planView(planning.ask(subjectOf(ticket_id, epic_id), questions))),
  )

  server.registerTool(
    'plan_draft',
    {
      description:
        'Post, or update, the Plan card: goal, approach, acceptance criteria, repos, subtasks, risks and ' +
        'whatever the plan still leaves open. Omitted fields keep what the card already says. ' +
        'Its subtasks become the ticket’s checklist when the plan is approved, so the subtask rule holds: ' +
        'work for another person or another repo is another ticket.',
      inputSchema: {
        ticket_id: ticketIdInput.optional().describe(`${TICKET_ID_HELP} ${SUBJECT_HELP}`),
        epic_id: z.number().int().optional().describe('The epic being planned, instead of a ticket.'),
        goal: z.string().optional().describe('What the boss gets out of it, in their words.'),
        approach: z.string().optional().describe('How you mean to build it, in two or three sentences.'),
        acceptance_criteria: z.array(z.string()).optional().describe('What has to be true for it to be done.'),
        repos: z.array(z.string()).optional().describe('Names of the Company’s repos the work touches.'),
        subtasks: z.array(planSubtask).optional(),
        risks: z.array(z.string()).optional().describe('What could go wrong, and what it depends on.'),
        open_questions: z
          .array(z.string())
          .optional()
          .describe('What the plan assumes and the boss can still say no to.'),
      },
    },
    (input) =>
      run(() => {
        const subject = subjectOf(input.ticket_id, input.epic_id)
        const repoIds = input.repos?.map(repoId)
        return planView(
          planning.draft(subject, {
            ...(input.goal !== undefined && { goal: input.goal }),
            ...(input.approach !== undefined && { approach: input.approach }),
            ...(input.acceptance_criteria !== undefined && { acceptanceCriteria: input.acceptance_criteria }),
            ...(repoIds !== undefined && { repos: repoIds }),
            ...(input.subtasks !== undefined && {
              subtasks: input.subtasks.map((s) => ({
                title: s.title,
                repo: s.repo === undefined ? null : repoId(s.repo),
              })),
            }),
            ...(input.risks !== undefined && { risks: input.risks }),
            ...(input.open_questions !== undefined && { openQuestions: input.open_questions }),
          }),
        )
      }),
  )

  server.registerTool(
    'plan_ready',
    {
      description:
        'Ask for the plan to go to Ready. Whether you may is the autonomy gate’s: when the boss approves ' +
        'plans it is posted and waits for them, and the answer says so; otherwise the plan is approved, its ' +
        'subtasks go on the ticket and the ticket becomes claimable.',
      inputSchema: {
        ticket_id: ticketIdInput.optional().describe(`${TICKET_ID_HELP} ${SUBJECT_HELP}`),
        epic_id: z.number().int().optional().describe('The epic being planned, instead of a ticket.'),
      },
    },
    ({ ticket_id, epic_id }) => run(() => planView(planning.ready(subjectOf(ticket_id, epic_id)))),
  )

  server.registerTool(
    'plan_replan',
    {
      description:
        'Send a ticket back to Planning because its approved plan no longer fits: the scope grew, an ' +
        'assumption broke. Its work pauses where it stands — the ticket keeps its assignee and worktrees — ' +
        'and the next version waits on whoever approved the last one.',
      inputSchema: {
        ticket_id: ticketIdInput.describe(TICKET_ID_HELP),
        reason: z.string().describe('What changed, in one or two sentences.'),
        changes: z
          .array(z.string())
          .optional()
          .describe('What you propose, one line each, e.g. "+ Subtask · cursor pagination on GET /usage".'),
      },
    },
    ({ ticket_id, reason, changes = [] }) =>
      run(() => planView(planning.replan(asTicketId(ticket_id), reason, changes))),
  )
}
