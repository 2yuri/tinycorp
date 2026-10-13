import { join } from 'node:path'
import { COMPANY_MCP_NAME } from '../../../shared/catalogue/mcp-servers'
import type { Employee } from '../../../shared/domain/staff'
import type { ProviderCheck } from '../../../shared/providers/preflight'
import { modelOption } from '../../../shared/staff/models'
import { excludeFromGit, nodePtySpawn, onPath, type RunCli, runCli as realRunCli } from '../../platform'
import { withoutOrchestratorEnv } from '../orchestrator-env'
import type { GrantedMcpServer, ProviderAdapter, SpawnPty, SpawnRequest } from '../provider-adapter'
import { HOOK_TOKEN_ENV, installHookFile } from '../provider-hooks'
import { checkProviderCli } from '../provider-preflight'
import { forgetSessionFile, writeSessionFile } from '../session-files'
import type { ExampleCli } from './cli'
import { EXAMPLE_CLI } from './cli-todo'

/**
 * The template. Copy this folder, rename it, and fill in `cli-todo.ts`.
 *
 * `pnpm provider:new <id>` does the copying and the renaming and writes both registry lines, so
 * the first move is a command rather than a paste. What is left to you is `cli-todo.ts`: eleven
 * spellings, one per question the conformance suite asks. Everything else — the command line, the
 * hook file, the per-Session MCP config, the kill — is written here and is the same for every
 * Provider.
 *
 * It does not pass the suite as it stands, on purpose: run `pnpm test` first and read what is
 * missing. See `README.md` beside this file.
 */

export interface ExampleAdapterOptions {
  /** Where the hook receiver listens, e.g. `http://127.0.0.1:7377/hook`. */
  hookUrl: string
  /** App-owned folder for per-Session files such as MCP configs. Never the Company folder. */
  dataDir: string
  /** Starts a process in a PTY. Defaults to node-pty. */
  spawnPty?: SpawnPty
  /** The environment a Session inherits, before this adapter strips its own product's variables. */
  env?: NodeJS.ProcessEnv
  /** The command the catalogue says this Provider is installed as. */
  command?: string
  /** The product's full name, from the catalogue. The preflight card's words are built from it. */
  name?: string
  /** Whether that command is on this machine. Defaults to a `PATH` lookup. */
  installed?: () => boolean
  /** Runs the CLI to answer the preflight. Defaults to the real subprocess with a timeout. */
  runCli?: RunCli
  /** The spellings of this CLI. The template leaves them TODO; a filled one passes them in. */
  cli?: ExampleCli
}

/** Where this Session's MCP config lives, under the app's own `dataDir`. */
const MCP_FOLDER = 'mcp'

/** How long after typing a prompt the adapter presses the submit key. */
const KEY_DELAY_MS = 250

export function createExampleAdapter({
  hookUrl,
  dataDir,
  spawnPty = nodePtySpawn,
  env = process.env,
  command = 'example',
  name = 'Example',
  installed = () => onPath(command, env),
  runCli = realRunCli,
  cli = EXAMPLE_CLI,
}: ExampleAdapterOptions): ProviderAdapter {
  /** The MCP config written for each Session, by the app's own session id. */
  const mcp = new Map<string, { path: string; args: string[] }>()

  const adapter: ProviderAdapter = {
    spawn(request: SpawnRequest) {
      const { employee, cwd, instructions, sessionId, resume = false, hookToken } = request
      // The hook file is the same for every Employee in the folder: it carries no identity,
      // only the token each process is given (decision 48).
      installHookFile({ file: join(cwd, '.example', 'hooks.json'), events: cli.hookEvents, hookUrl })
      excludeFromGit(cwd, ['.example/'])

      const args = [
        ...cli.sessionArgs(sessionId, resume),
        ...(mcp.get(sessionId)?.args ?? []),
        ...modelArgs(employee, cli),
        ...cli.instructionArgs(instructions ?? identityLine(employee)),
      ]
      return spawnPty(command, args, {
        cwd,
        env: { ...subscriptionEnv(env), [HOOK_TOKEN_ENV]: hookToken },
        cols: 120,
        rows: 40,
      })
    },

    /**
     * One MCP config per Session, in the app's own folder. Never in `cwd`: two Employees share it,
     * and one must never be handed the other's bearer token. It holds the Company's own server and
     * whatever the boss granted this Employee (T136), so `writeSessionFile` writes it `0600` in a
     * `0700` folder: every secret this Session has is in it, and nothing secret goes on the
     * command line. `forgetSession` below takes it away again when the Session ends.
     */
    injectMcp(sessionId, { company, granted }) {
      const servers = {
        ...(company && {
          [COMPANY_MCP_NAME]: {
            type: 'http',
            url: company.url,
            headers: { Authorization: `Bearer ${company.token}` },
          },
        }),
        ...Object.fromEntries(granted.map((server) => [server.name, mcpEntry(server)])),
      }
      const path = writeSessionFile(
        dataDir,
        MCP_FOLDER,
        sessionId,
        `${JSON.stringify({ mcpServers: servers }, null, 2)}\n`,
      )
      const args = cli.mcpArgs(path)
      mcp.set(sessionId, { path, args })
      return args
    },

    /**
     * The Session ended, so the file that held its tokens goes with it (T199, finding H5). Every
     * Employee runs as the same OS user as the app: a config that outlives its Session is one
     * Employee's bearer token left where every other one can read it.
     */
    forgetSession(sessionId) {
      mcp.delete(sessionId)
      forgetSessionFile(dataDir, MCP_FOLDER, sessionId)
    },

    resumeCommand: (sessionId) => cli.sessionArgs(sessionId, true),

    confirmsResume: (hook) => cli.confirmsResume(hook),

    detectIdle: (hook) => cli.signalOf(hook),

    sessionIdOf: (hook) => cli.sessionIdOf(hook),

    detectBudgetExhausted: (output) => cli.limitHit(output),

    budgetResetAt: (output, now) => cli.limitResetAt(output, now),

    pushPrompt(session, text) {
      session.write(text)
      // The CLI needs a beat between the text landing and the key that sends it.
      setTimeout(() => session.write(cli.submitKey), KEY_DELAY_MS)
    },

    installed,

    /**
     * Whether this CLI can run an Employee at all, asked before the Launcher draws (T135). One
     * status command with a timeout around it — never a Session, and never a token of the boss's.
     */
    checkCli(): Promise<ProviderCheck> {
      return checkProviderCli({ name, command, signIn: cli.signIn, installed, runCli, env: subscriptionEnv(env) })
    },
  }
  return adapter
}

/** The Employee's model as this CLI names it, or nothing at all for the product's own default. */
function modelArgs(employee: Pick<Employee, 'provider' | 'model'>, cli: ExampleCli): string[] {
  const option = modelOption(employee.provider, employee.model)
  return option ? cli.modelArgs(option.model, option.effort) : []
}

/**
 * The environment a Session inherits, with this product's own variables stripped.
 *
 * Two rules, and a PR that breaks either is refused: a Session runs on the boss's own
 * subscription login, so every API-key variable is removed here; and a Session started from
 * inside another one must not adopt its parent's transcript, sandbox or conversation, so every
 * `EXAMPLE*` variable goes except the one that names where the login is kept.
 *
 * And a third: another orchestrator's variables are taken out by `withoutOrchestratorEnv` (T234),
 * which every adapter calls. Copy that line into a new Provider — the conformance suite checks it.
 */
export function subscriptionEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(withoutOrchestratorEnv(env)).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined &&
        !API_KEY_VARS.has(entry[0]) &&
        (!entry[0].startsWith('EXAMPLE') || entry[0] === EXAMPLE_HOME_ENV),
    ),
  )
}

/**
 * One granted server, in the shape this CLI reads. An `http` server carries its keychain token as
 * a bearer header and any named headers beside it (T245); a `stdio` server takes it in the
 * environment variable the boss named. Both stay inside the `0600` file: a secret in `argv` is a
 * secret `ps` can read.
 */
function mcpEntry(server: GrantedMcpServer): Record<string, unknown> {
  if (server.transport === 'http') {
    const headers = {
      ...server.headers,
      ...server.headerSecrets,
      ...(server.secret && { Authorization: `Bearer ${server.secret}` }),
    }
    return {
      type: 'http',
      url: server.url,
      ...(Object.keys(headers).length > 0 && { headers }),
    }
  }
  return {
    type: 'stdio',
    command: server.command,
    args: server.args,
    env: {
      ...server.env,
      ...server.secrets,
      ...(server.secret && server.secretEnv && { [server.secretEnv]: server.secret }),
    },
  }
}

/** Where this CLI keeps the boss's login. The boss's own setting, so it is inherited, never read. */
export const EXAMPLE_HOME_ENV = 'EXAMPLE_HOME'

/** Never on a Session's environment: TinyCorp runs on the boss's subscription, not on a key. */
const API_KEY_VARS = new Set(['EXAMPLE_API_KEY', 'EXAMPLE_AUTH_TOKEN'])

/** What an Employee is told when it has no Company brief — a Session started outside a Company. */
function identityLine(employee: Employee): string {
  return (
    `You are ${employee.name}, ${employee.title} at this Company. ${employee.persona} ` +
    'Messages from the Company arrive as prompts prefixed "[company]".'
  ).trim()
}
