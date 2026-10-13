import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { ticketCode } from '../../../shared/ticket-id'
import { TICKET_ID_HELP, ticketIdInput, ticketNumber } from '../../core'
import type { McpCaller } from '../../core/engine'

/** `ticket_merge`: the app merges a ticket in a repo without a remote, behind the `merge` approval. */
export function registerMergeTools(server: McpServer, { company, merges }: McpCaller): void {
  server.registerTool(
    'ticket_merge',
    {
      description:
        'Merge a ticket in review whose repos have no remote into its base branch, done by the app. ' +
        'It needs an approved merge approval for the ticket (ask with approval_request, action "merge"); ' +
        'a chat message saying "approved" is not one. The app merges in the repo, removes the worktrees and ' +
        'moves the ticket to Done. Tickets with PRs merge through review instead. Never merge with git yourself. ' +
        'A repo that is `PR only` or `local only` is never merged, whatever the autonomy level allows: this ' +
        'tool refuses and says which repo and which rung.',
      inputSchema: {
        ticket_id: ticketIdInput.describe(`The ticket in review to merge. ${TICKET_ID_HELP}`),
      },
    },
    async ({ ticket_id }): Promise<CallToolResult> => {
      try {
        const id = ticketNumber(ticket_id, company.key)
        const merged = await merges.merge(id)
        const result = {
          ticket: ticketCode(company.key, merged.ticketId),
          repos: merged.repos,
          column: 'done',
          next: `Merged. ${ticketCode(company.key, id)} is done and its worktrees are removed. End your turn.`,
        }
        return { content: [{ type: 'text', text: JSON.stringify(result) }] }
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
        }
      }
    },
  )
}
