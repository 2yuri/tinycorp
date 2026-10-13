import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { SUB_SESSION_WORKSPACES, type SubSessionInfo } from '../../../shared/sub-sessions'
import { TICKET_ID_HELP, ticketIdInput, ticketNumber } from '../../core'
import type { McpCaller } from '../../core/engine'

/**
 * `session_start`, `session_read` and `session_stop` (T163): an Employee starting Sessions of its
 * own, reading what they did and stopping them. A sub-session is never given these — its token
 * reaches {@link registerSubSessionTools} alone, which is what keeps it one level deep.
 */
export function registerSessionTools(server: McpServer, { company, subSessions }: McpCaller): void {
  server.registerTool(
    'session_start',
    {
      description:
        'Start a Session of your own for one piece of your ticket: a full Session on your Provider and model, ' +
        'with its own terminal, taking one of the Company’s Session seats (it waits when none is free). ' +
        'Only for work that is genuinely parallel. workspace "own" gives it a new worktree and branch off your ' +
        'ticket’s branch, which you merge back when it is done; "shared" puts it in your own worktree, where ' +
        'its writes and yours can collide. It cannot start sessions, chat, push, open a PR or merge. Returns its ' +
        'id; you are woken with its result when it finishes.',
      inputSchema: {
        name: z.string().describe('A few words for its piece of the work, e.g. "tests". Names its chip and branch.'),
        task: z
          .string()
          .describe(
            'What to do, written for a colleague who has not read the ticket: which files are its, what done is.',
          ),
        workspace: z.enum(SUB_SESSION_WORKSPACES).describe('"own" for a worktree of its own; "shared" for yours.'),
        ticket_id: ticketIdInput
          .optional()
          .describe(`The ticket it works on; your one ticket in Doing when left out. ${TICKET_ID_HELP}`),
        repo: z.string().optional().describe('The repo it works in, when the ticket has worktrees in more than one.'),
      },
    },
    ({ name, task, workspace, ticket_id, repo }) =>
      attempt(() => {
        const started = subSessions.start({
          name,
          task,
          workspace,
          ...(ticket_id !== undefined && { ticketId: ticketNumber(ticket_id, company.key) }),
          ...(repo !== undefined && { repo }),
        })
        return {
          ...view(started),
          note:
            started.state === 'waiting'
              ? 'Every Session seat is taken, so it waits and starts on its own once one frees.'
              : 'It is starting. You are woken with its result when it finishes.',
        }
      }),
  )

  server.registerTool(
    'session_read',
    {
      description:
        'Read one of the Sessions you started, or all of them: its state, where it works, the branch to merge ' +
        'and what it reported.',
      inputSchema: {
        id: z.string().optional().describe('The id session_start returned; every one of yours when left out.'),
      },
    },
    ({ id }) => attempt(() => (id === undefined ? subSessions.list().map(view) : view(subSessions.get(id)))),
  )

  server.registerTool(
    'session_stop',
    {
      description:
        'Stop one of the Sessions you started. Its own worktree stays while it holds work, for you to merge; ' +
        'one that changed nothing leaves nothing behind.',
      inputSchema: {
        id: z.string().describe('The id session_start returned.'),
      },
    },
    ({ id }) => attempt(() => view(subSessions.stop(id))),
  )
}

/**
 * The one tool a sub-session has on the Company server: handing its result back to the Employee
 * that started it. No chat, no board, and nothing that starts a Session.
 */
export function registerSubSessionTools(server: McpServer, { subSession }: McpCaller): void {
  server.registerTool(
    'session_report',
    {
      description:
        'Report what you did to the Employee that started you: what you changed, where, and anything they must ' +
        'know before merging. Call it once, when the task is done, then end your turn.',
      inputSchema: {
        result: z.string().describe('What you did, in a few sentences.'),
      },
    },
    ({ result }) =>
      attempt(() => {
        if (!subSession) throw new Error('Only a Session another Employee started can report')
        subSession.report(result)
        return { status: 'reported' }
      }),
  )
}

/** What the parent reads of a sub-session. */
function view(sub: SubSessionInfo) {
  return {
    id: sub.id,
    name: sub.name,
    state: sub.state,
    workspace: sub.workspace,
    ticket_id: sub.ticketId,
    repo: sub.repoName,
    path: sub.path,
    branch: sub.branch,
    parent_branch: sub.parentBranch,
    files_changed: sub.filesChanged,
    worktree_kept: sub.worktreeKept,
    branch_kept: sub.branchKept,
    result: sub.result,
  }
}

function attempt(run: () => unknown): CallToolResult {
  try {
    return { content: [{ type: 'text', text: JSON.stringify(run()) }] }
  } catch (error) {
    return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] }
  }
}
