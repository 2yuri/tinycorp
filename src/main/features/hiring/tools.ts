import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { AUTONOMY_LABEL } from '../../../shared/approvals'
import type { StaffingOutcome } from '../../../shared/hiring'
import { hireableModelLines } from '../../../shared/staff/models'
import { run } from '../../core'
import type { McpCaller } from '../../core/engine'

/**
 * `team_load`, `hire_request` and `fire_request`, acting as the calling Employee.
 * Colleagues are named, never shown by id; hiring and firing need the `hire` capability.
 */
export function registerHiringTools(server: McpServer, { employee, chat, approvals, hiring }: McpCaller): void {
  function person(name: string): string {
    const wanted = name.trim().replace(/^@/, '').toLowerCase()
    const found = chat.people().find((p) => p.name.toLowerCase() === wanted)
    if (!found) throw new Error(`Nobody is called ${name}`)
    return found.id
  }

  function answer(outcome: StaffingOutcome) {
    if (outcome.status === 'done') {
      const { name, title } = outcome.employee
      return {
        status: outcome.request.kind === 'hire' ? 'hired' : 'fired',
        employee: { name, title },
        next: `No approval was needed under ${AUTONOMY_LABEL[approvals.level()]}; it is done.`,
      }
    }
    const approval = approvals.list().find((a) => a.id === outcome.approvalId)!
    return {
      status: 'pending',
      approval_id: approval.id,
      thread: { channel: `#${approval.channelId}`, message_id: approval.messageId },
      next:
        'The boss must approve this. Wait: end your turn now, and the decision arrives in your inbox. ' +
        'If approved, the app does the hiring or firing itself; you do not need to do anything more.',
    }
  }

  server.registerTool(
    'team_load',
    {
      description:
        'Read the team’s load before proposing a hire: each Employee’s open tickets (WIP), WIP and headcount ' +
        'per role, tickets nobody holds, Todo tickets per repo, blocked tickets, the average time tickets ' +
        'spend in Review, column WIP limits, the team’s headcount against its maximum, skill gaps ' +
        '(capabilities nobody holds, repos no coder covers, with the catalog roles that would fill them) ' +
        'and the role catalog.',
      inputSchema: {},
    },
    () =>
      run(() => {
        const load = hiring.teamLoad()
        return {
          employees: load.employees.map(({ id: _id, repoFilter, ...rest }) => ({ ...rest, repo_filter: repoFilter })),
          unassigned: load.unassigned,
          columns: load.columns.map(({ id, wipLimit, count, overLimit }) => ({
            column: id,
            wip_limit: wipLimit,
            count,
            over_limit: overLimit,
          })),
          role_load: load.roleLoad.map(({ roleId: _roleId, ...rest }) => rest),
          todo_by_repo: load.todoByRepo,
          blocked: load.blocked,
          review_wait: {
            average_minutes: load.review.averageMs === null ? null : Math.round(load.review.averageMs / 60_000),
            tickets_measured: load.review.stays,
          },
          headcount: load.headcount,
          skill_gaps: load.skillGaps,
          roles: load.roles.map(({ id, name, capabilities, repoFilter }) => ({
            id,
            name,
            capabilities,
            repo_filter: repoFilter,
          })),
        }
      }),
  )

  server.registerTool(
    'hire_request',
    {
      description:
        'Propose hiring a new Employee from the role catalog, with the numbers from team_load as the reason. ' +
        'Needs the hire capability. Usually the boss must approve: then wait for the decision in your inbox. ' +
        'The app proposes the new Employee from the role (the boss may edit it before approving). ' +
        'Once approved the app hires them, gives them a desk and they say hello in #general. ' +
        'Above the maximum headcount (see team_load) even an Autonomous Company asks the boss. ' +
        'To bring back someone who was fired, pass their name.',
      inputSchema: {
        role: z.string().describe('A catalog role, by name or id, e.g. "Frontend".'),
        reason: z.string().describe('Why the team needs them, with numbers: WIP, unassigned tickets, gaps.'),
        name: z.string().optional().describe('Optional: the hire’s name, or a former Employee’s name to rehire.'),
        model: z
          .string()
          .optional()
          .describe(
            // Every product's models, never one product's (T169): the model names the Provider the
            // hire is put on (T139), and leaving it out uses whichever one this Mac is ready for.
            'Optional: the model the hire runs on, and the product that runs it. One of:\n' +
              hireableModelLines().join('\n') +
              '\nLeft out, this machine’s own default.',
          ),
      },
    },
    ({ role, reason, name, model }) =>
      run(() =>
        answer(
          hiring.requestHire({
            requesterId: employee.id,
            role,
            reason,
            ...(name !== undefined && { name }),
            ...(model !== undefined && { model }),
          }),
        ),
      ),
  )

  server.registerTool(
    'fire_request',
    {
      description:
        'Propose firing a colleague. Needs the hire capability and always needs the boss’s approval. ' +
        'Their memory is kept, so they can be rehired later.',
      inputSchema: {
        employee: z.string().describe('The colleague’s name.'),
        reason: z.string().describe('Why.'),
      },
    },
    ({ employee: name, reason }) =>
      run(() => answer(hiring.requestFire({ requesterId: employee.id, employeeId: person(name), reason }))),
  )
}
