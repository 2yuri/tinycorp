import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { AUTONOMY_LABEL, REQUESTABLE_ACTIONS } from '../../../shared/approvals'
import { APPROVAL_SUBJECT_RULE } from '../../../shared/approvals/approval-subject'
import { APPROVAL_SUMMARY_RULE } from '../../../shared/approvals/approval-summary'
import { TICKET_ID_HELP, ticketIdInput, ticketNumber } from '../../core'
import type { McpCaller } from '../../core/engine'

/** `approval_request`: asks the boss for a gated action, acting as the calling Employee. */
export function registerApprovalTools(server: McpServer, { company, employee, approvals, repos }: McpCaller): void {
  function repoId(name: string): string {
    const found = repos().find((r) => r.name === name)
    if (!found) throw new Error(`There is no repo named ${JSON.stringify(name)}`)
    return found.id
  }

  server.registerTool(
    'approval_request',
    {
      description:
        'Ask the boss before a gated action: assigning or starting a ticket, opening a PR, merging, hiring, ' +
        'firing, switching provider or changing the process. Use action "other" for anything else the boss ' +
        'should decide. ' +
        APPROVAL_SUBJECT_RULE +
        ' ' +
        APPROVAL_SUMMARY_RULE +
        ' If the Company’s autonomy level lets the action through, the answer says so and you ' +
        'may go ahead. Otherwise wait: end your turn, and the decision arrives in your inbox. ' +
        'A merge in a repo that is `PR only` or `local only` is refused here rather than asked: the repo ' +
        'says what is possible and no autonomy level gets past it.',
      inputSchema: {
        action: z.enum(REQUESTABLE_ACTIONS).describe('What you want to do.'),
        summary: z
          .string()
          .optional()
          .describe(
            'One human sentence to the boss, as you would say it in chat, e.g. "PR #128 on billing-api is ' +
              'reviewed and green, so the merge needs your call." No "@boss", no "Approval needed".',
          ),
        subject: z
          .string()
          .optional()
          .describe('What it is about, in words, when it is not about a ticket, e.g. "a Designer".'),
        ticket: ticketIdInput
          .optional()
          .describe(`The ticket it is about. ${TICKET_ID_HELP} open_pr and merge need it, or pr.`),
        pr: z
          .object({
            repo: z.string().describe('The repo’s name.'),
            number: z.number().int().describe('The PR number in that repo.'),
          })
          .optional()
          .describe('For merge: the PR to merge. Its ticket is found from it.'),
        reason: z.string().optional().describe('Why, in one or two sentences.'),
        ci_red: z.boolean().optional().describe('For open_pr or merge: CI is failing.'),
        limit_exceeded: z.boolean().optional().describe('A WIP or budget limit is exceeded.'),
        above_headcount: z.boolean().optional().describe('For hire: the team is at its maximum headcount.'),
      },
    },
    ({ action, summary, subject, ticket, pr, reason, ci_red, limit_exceeded, above_headcount }) =>
      run(() => {
        const outcome = approvals.request({
          requesterId: employee.id,
          action,
          ...(summary !== undefined && { summary }),
          ...(subject !== undefined && { subject }),
          ...(ticket !== undefined && { ticketId: ticketNumber(ticket, company.key) }),
          ...(pr !== undefined && { pullRequest: { repoId: repoId(pr.repo), number: pr.number } }),
          ...(reason !== undefined && { reason }),
          // A condition the caller left out is one that does not hold: the gate reads all three as facts.
          conditions: {
            ciRed: ci_red === true,
            limitExceeded: limit_exceeded === true,
            aboveHeadcount: above_headcount === true,
          },
        })
        const level = AUTONOMY_LABEL[outcome.level]
        if (outcome.gate === 'free') {
          return {
            status: 'not_needed',
            level: outcome.level,
            next:
              action === 'merge'
                ? `No approval is needed under ${level}. For a repo without a remote, merge with ticket_merge; ` +
                  'PRs merge through review, and a merge that failed is asked again with merge_retry. ' +
                  'Never merge with git yourself.'
                : `No approval is needed under ${level}. Go ahead.`,
          }
        }
        const { approval } = outcome
        return {
          status: 'pending',
          approval_id: approval.id,
          level: outcome.level,
          subject: approval.subject,
          thread: { channel: `#${approval.channelId}`, message_id: approval.messageId },
          next:
            `The boss must approve this under ${level}. Wait: do not start it, end your turn now, ` +
            'and the decision (with the reason if rejected) arrives in your inbox as your next prompt.',
        }
      }),
  )
}

function run(action: () => unknown): CallToolResult {
  try {
    return { content: [{ type: 'text', text: JSON.stringify(action()) }] }
  } catch (error) {
    return {
      isError: true,
      content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
    }
  }
}
