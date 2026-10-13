import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { ENVIRONMENT_IDS } from '../../../shared/environments'
import type { McpCaller } from '../../core/engine'

/**
 * `env_run`: the only way an Employee uses one of the Company's secrets (T176).
 *
 * The description is the whole contract as the Employee sees it — the app runs the command, the
 * values are in that one child process, the output comes back with every value replaced by its
 * name. An Employee asking the boss to paste a value in chat is the failure this tool exists to
 * prevent, so the tool says so in as many words.
 */
export function registerEnvTools(server: McpServer, { envRun }: McpCaller): void {
  server.registerTool(
    'env_run',
    {
      description:
        'Run one command with a Company environment’s secrets in it. Use it whenever a command needs a ' +
        'secret — a migration, a seed, an e2e run, a dev server, a deploy check — instead of looking for a ' +
        '`.env`, exporting a variable in your shell, or asking anyone for a value. ' +
        'TinyCorp runs the command in your worktree with the variables set in that one process, and answers ' +
        'with the exit code and the output, with every value replaced by ‹NAME›. You never see a value, and ' +
        'you must never ask the boss or a colleague for one: if something is missing, say which NAME is ' +
        'missing and in which environment, and the boss adds it. ' +
        'An environment can be set to ask the boss before every use (prod is, by default): then the answer ' +
        'is status "pending" — end your turn, and the decision arrives in your inbox; run env_run again with ' +
        'the same command once it is approved. One approval covers one run.',
      inputSchema: {
        command: z
          .string()
          .describe('The command line to run, e.g. "pnpm db:migrate". It runs through the shell, in your worktree.'),
        environment: z
          .enum(ENVIRONMENT_IDS)
          .optional()
          .describe('Which environment’s values to use. Leave it out for the repo’s default.'),
        cwd: z
          .string()
          .optional()
          .describe('Where to run, inside one of your worktrees. Leave it out when you have only one.'),
      },
    },
    async ({ command, environment, cwd }) => {
      try {
        const result = await envRun({
          command,
          ...(environment !== undefined && { environment }),
          ...(cwd !== undefined && { cwd }),
        })
        return json({
          status: result.status,
          exit_code: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          variables: result.variables,
          redacted: result.redacted,
          ...(result.timedOut && { timed_out: true }),
          ...(result.truncated && { truncated: true }),
          next: nextLine(result.status),
        })
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
        }
      }
    },
  )
}

function nextLine(status: 'ran' | 'pending' | 'denied'): string {
  if (status === 'pending') {
    return 'Wait: end your turn now. When the boss approves, run env_run again with the same command.'
  }
  if (status === 'denied') {
    return 'Do not run it another way. Say in the thread what you needed it for, and take the next step without it.'
  }
  return 'The ‹NAME› in the output is a value you are not shown. Never try to print, decode or guess one.'
}

function json(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] }
}
