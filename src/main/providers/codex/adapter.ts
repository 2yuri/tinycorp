import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { COMPANY_MCP_NAME } from '../../../shared/catalogue/mcp-servers'
import type { Employee } from '../../../shared/domain/staff'
import type { ProviderPlacement } from '../../../shared/platform/wsl'
import type { ProviderCheck } from '../../../shared/providers/preflight'
import { type RtkHook, rtkEnv } from '../../../shared/rtk'
import { modelOption } from '../../../shared/staff/models'
import {
  type CliOutcome,
  excludeFromGit,
  nodePtySpawn,
  onPath,
  type RunCli,
  runCli as realRunCli,
  syncSkillFolder,
} from '../../platform'
import { withoutOrchestratorEnv } from '../orchestrator-env'
import {
  accountEnv,
  asking,
  type CommandRewriteHook,
  type GrantedMcpServer,
  type GrantedSkill,
  type HookPayload,
  type ProviderAdapter,
  type SessionSignal,
  type SpawnPty,
  type SpawnRequest,
  sessionRtk,
} from '../provider-adapter'
import {
  HOOK_TOKEN_ENV,
  type HookHandler,
  hookCommand,
  installHookFile,
  installRewriteHook,
  rtkHookCommand,
  stripAnsi,
} from '../provider-hooks'
import {
  checkProviderCli,
  NO_IDENTITY,
  type ProviderIdentity,
  type ProviderSignIn,
  type SignInVerdict,
} from '../provider-preflight'

/**
 * Codex, the second Provider. It answers the same conformance suite as Claude Code
 * (`provider-conformance.ts`) and differs everywhere the product differs:
 *
 * - it takes its whole configuration as `-c key=value` TOML overrides, not as flags;
 * - it names its own conversations, so the app learns the session id from the first signal
 *   rather than choosing it (`sessionIdOf`);
 * - its hooks live in `.codex/hooks.json` and name their event `hookEventName`, not
 *   `hook_event_name`, and it has no idle notification of its own;
 * - it does hook the moment it stops to ask the boss: `PermissionRequest`, with the tool and its
 *   input (T165), so nothing here has to read the approval dialog off the terminal;
 * - it reports the subscription limit in ChatGPT's words, and names the reset as a duration
 *   from now rather than a clock time.
 */

/** The hook events the status machine listens to, as Codex names them. */
export const CODEX_HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PermissionRequest',
  'Stop',
  'SessionEnd',
] as const

/** The env var the MCP bearer token travels in, so it never appears in the process's argv. */
export const CODEX_MCP_TOKEN_ENV = 'TINYCORP_CODEX_MCP_TOKEN'

/** Where this product reads a working directory's own skills, and so where a grant is put (T253). */
export const CODEX_SKILLS_FOLDER = '.codex/skills'

/** The name the Company's MCP server is registered under in Codex's config. */
const MCP_SERVER = COMPANY_MCP_NAME

/**
 * The env var one granted `http` server's bearer token travels in. Codex takes its whole
 * configuration on the command line, so a token written as `-c` would sit in `argv` where `ps`
 * reads it: the config names the variable, and the variable carries the secret (T136).
 */
export function grantTokenEnv(name: string): string {
  return `TINYCORP_MCP_TOKEN_${shout(name)}`
}

/**
 * The env var one granted `http` server's **header** value travels in (T245). Same reason as the
 * bearer token's: Codex reads its whole configuration off the command line, so a header value
 * written as `-c` would sit in `argv` where `ps` reads it. Codex's own `env_http_headers` names the
 * variable, and the variable carries the secret.
 *
 * Two header names that differ only in their punctuation would shout the same, so a name already
 * taken is numbered rather than quietly overwritten.
 */
export function grantHeaderEnv(server: string, header: string, taken: ReadonlySet<string> = new Set()): string {
  const base = `TINYCORP_MCP_HEADER_${shout(server)}_${shout(header)}`
  if (!taken.has(base)) return base
  let at = 2
  while (taken.has(`${base}_${at}`)) at += 1
  return `${base}_${at}`
}

/** A name as an environment variable spells it: upper case, and anything else an underscore. */
function shout(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9]/g, '_')
}

/** The `-c` overrides that register one granted server, and the environment it needs beside them. */
export function codexGrantConfig(server: GrantedMcpServer): { args: string[]; env: Record<string, string> } {
  const key = `mcp_servers.${server.name}`
  if (server.transport === 'http') {
    const variable = grantTokenEnv(server.name)
    // A header name is a TOML bare key — `MCP_HEADER_PATTERN` is what keeps it one — so it goes in
    // the dotted path the same way a `stdio` server's environment does.
    const env: Record<string, string> = server.secret ? { [variable]: server.secret } : {}
    const secretHeaders = Object.entries(server.headerSecrets).map(([header, value]) => {
      const held = grantHeaderEnv(server.name, header, new Set(Object.keys(env)))
      env[held] = value
      return ['-c', `${key}.env_http_headers.${header}=${tomlString(held)}`]
    })
    return {
      args: [
        '-c',
        `${key}.url=${tomlString(server.url)}`,
        ...(server.secret ? ['-c', `${key}.bearer_token_env_var=${tomlString(variable)}`] : []),
        // Only the headers whose values are plain text: a secret one is named here and carried
        // in the environment, never written into `argv`.
        ...Object.entries(server.headers).flatMap(([header, value]) => [
          '-c',
          `${key}.http_headers.${header}=${tomlString(value)}`,
        ]),
        ...secretHeaders.flat(),
      ],
      env,
    }
  }
  return {
    args: [
      '-c',
      `${key}.command=${tomlString(server.command)}`,
      ...(server.args.length ? ['-c', `${key}.args=[${server.args.map(tomlString).join(', ')}]`] : []),
      // Only what the boss typed as plain environment: the secret is not written here.
      ...Object.entries(server.env).flatMap(([name, value]) => ['-c', `${key}.env.${name}=${tomlString(value)}`]),
    ],
    // Codex spawns a stdio server as its own child, so the secrets ride on the Session's
    // environment under the variables they were named by, never on the command line.
    env: {
      ...server.secrets,
      ...(server.secret && server.secretEnv ? { [server.secretEnv]: server.secret } : {}),
    },
  }
}

export interface CodexAdapterOptions {
  /** Where the hook receiver listens, e.g. `http://127.0.0.1:7377/hook`. */
  hookUrl: string
  /**
   * App-owned folder for per-Session files. Codex needs none — its hooks live in the cwd and its
   * MCP server travels on the command line — but every adapter takes the same options.
   */
  dataDir?: string
  /** Starts a process in a PTY. Defaults to node-pty. */
  spawnPty?: SpawnPty
  /** Environment the Session inherits before `CODEX*` variables are stripped. */
  env?: NodeJS.ProcessEnv
  command?: string
  /** The product's full name, from the catalogue. The preflight card's words are built from it. */
  name?: string
  /** Whether `codex` is on this machine. Defaults to a `PATH` lookup. */
  installed?: () => boolean
  /** Where this CLI was found and where it runs (T167); filled in by the registry on Windows. */
  placement?: ProviderPlacement | null
  /** Runs `codex login status` for the preflight. Defaults to the real subprocess with a timeout. */
  runCli?: RunCli
}

/**
 * Codex hooks → status signals. There is no idle notification: a turn ending is `Stop`, and a
 * Session that has started but not yet run a turn is `ready`.
 *
 * `PermissionRequest` is Codex stopping to ask the boss (T165): `codex-cli` 0.155.1 runs it on the
 * approval path with `tool_name` and `tool_input`, so the ask is read from a hook like every other
 * signal and nothing here has to read the approval dialog off the terminal. The next `PreToolUse`,
 * `PostToolUse` or `Stop` is the Session moving on, and clears it.
 */
export function codexHookSignal(hook: HookPayload): SessionSignal | null {
  switch (codexEvent(hook)) {
    case 'SessionStart':
      return 'ready'
    case 'UserPromptSubmit':
    case 'PreToolUse':
    case 'PostToolUse':
      return 'busy'
    case 'PermissionRequest':
      return asking(codexAsk(hook))
    case 'Stop':
      return 'idle'
    default:
      return null
  }
}

/** What a Codex approval is asking for when it names no tool of its own. */
export const CODEX_PERMISSION_ASK = 'an approval'

/**
 * What a `PermissionRequest` is asking for: the tool and its target. Codex runs a shell command as
 * `shell` with `{ command: ["bash", "-lc", "…"] }`, and an edit with a `path`, so both read as one
 * line the boss can decide on.
 */
function codexAsk(hook: HookPayload): string {
  const tool = codexText(hook['tool_name'])
  if (!tool) return CODEX_PERMISSION_ASK
  const input = codexRecord(hook['tool_input'])
  const command = Array.isArray(input['command'])
    ? input['command']
        .map((part) => (typeof part === 'string' ? part : ''))
        .join(' ')
        .trim()
    : codexText(input['command'])
  const target = command || codexText(input['path']) || codexText(input['file_path']) || codexText(input['url'])
  return target ? `${tool} ${target}` : tool
}

function codexText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function codexRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/**
 * Codex reports a continued conversation as `SessionStart` with `source: "resume"`. A Codex old
 * enough to name no source is taken at its word, as a fresh start would have been spawned fresh.
 */
export function codexConfirmsResume(hook: HookPayload): boolean {
  return codexEvent(hook) === 'SessionStart' && hook['source'] !== 'startup'
}

/**
 * The thread a Codex signal belongs to. Codex names its own conversations, so this is the id
 * `codex resume` later takes — not the one the app handed it.
 */
export function codexThreadId(hook: HookPayload): string | null {
  for (const key of ['threadId', 'thread_id', 'thread-id', 'session_id']) {
    const value = hook[key]
    if (typeof value === 'string' && value) return value
  }
  return null
}

/** Codex's event name, whichever spelling this Codex uses. */
function codexEvent(hook: HookPayload): string | null {
  for (const key of ['hookEventName', 'hook_event_name', 'event_name']) {
    const value = hook[key]
    if (typeof value === 'string') return value
  }
  return null
}

const BUDGET_PATTERNS = [
  /you['’]ve\s*(hit|reached)\s*your\s*usage\s*limit/i,
  /usage\s*limit\s*reached/i,
  /you['’]re\s*out\s*of\s*credits/i,
  /out\s*of\s*credits/i,
  /rate\s*limit\s*exceeded/i,
]

/** True when Codex's terminal or hook output says the subscription limit was hit. */
export function codexBudgetExhausted(output: string): boolean {
  const text = stripAnsi(output)
  return BUDGET_PATTERNS.some((pattern) => pattern.test(text))
}

/** `resets_at: 2026-09-17T16:00:00Z`, as the rate-limit snapshot carries it. */
const RESET_AT = /resets?[_\s-]*at["'\s:]+([0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9:.]+(?:Z|[+-][0-9:]{2,5})?)/i
/** `try again in 2h 15m`, `resets in 45m`, `available again in 3 hours` — Codex counts down. */
const RESET_IN =
  /(?:try\s*again|resets?|available\s*again)\s*in\s*((?:\d+\s*(?:h|hr|hrs|hours?|m|min|mins|minutes?|s|sec|secs|seconds?)\s*)+)/i
const DURATION_PART = /(\d+)\s*(h|hr|hrs|hours?|m|min|mins|minutes?|s|sec|secs|seconds?)/gi

/**
 * When the limit Codex reports resets. Codex names a duration from now — `try again in 2h 15m` —
 * where Claude Code names a clock time; an absolute `resets_at` is read too, for the rate-limit
 * snapshot the CLI prints.
 */
export function codexBudgetResetAt(output: string, now: Date): Date | null {
  const text = stripAnsi(output)
  const at = RESET_AT.exec(text)
  if (at) {
    const when = new Date(at[1]!.replace(' ', 'T'))
    if (!Number.isNaN(when.getTime())) return when
  }
  const countdown = RESET_IN.exec(text)
  if (!countdown) return null
  let ms = 0
  for (const [, amount, unit] of countdown[1]!.matchAll(DURATION_PART)) {
    const scale = unit!.toLowerCase().startsWith('h') ? 3_600_000 : unit!.toLowerCase().startsWith('m') ? 60_000 : 1000
    ms += Number(amount) * scale
  }
  return ms > 0 ? new Date(now.getTime() + ms) : null
}

/** `-m` and the reasoning effort for the Employee's model; none for Codex's default. */
export function codexModelArgs(employee: Pick<Employee, 'provider' | 'model'>): string[] {
  const option = modelOption(employee.provider, employee.model)
  if (!option) return []
  return ['-m', option.model, ...(option.effort ? ['-c', `model_reasoning_effort=${tomlString(option.effort)}`] : [])]
}

const KEY_DELAY_MS = 250
const ENTER = '\r'

export function createCodexAdapter({
  hookUrl,
  spawnPty = nodePtySpawn,
  env = process.env,
  command = 'codex',
  name = 'Codex',
  installed = () => onPath(command, env),
  placement = null,
  runCli = realRunCli,
}: CodexAdapterOptions): ProviderAdapter {
  const mcp = new Map<string, { args: string[]; env: Record<string, string>; token: string | null }>()

  const adapter: ProviderAdapter = {
    spawn(request: SpawnRequest) {
      const { employee, cwd, instructions, sessionId, resume = false, hookToken } = request
      installCodexHooks(cwd, hookUrl)
      // The rewrite goes in the same `.codex/hooks.json`, beside our own (T179); a Session that
      // runs with no RTK writes a null, which takes the last one's entry back out.
      const rtk = sessionRtk(adapter, request)
      codexCommandRewrite(rtk).install(cwd)
      const server = mcp.get(sessionId)
      const args = [
        ...(resume ? adapter.resumeCommand(sessionId)! : []),
        ...(server?.args ?? []),
        ...permissionArgs(employee),
        ...codexRtkArgs(rtk),
        ...codexModelArgs(employee),
        '-c',
        `additional_developer_instructions=${tomlString(instructions ?? identityLine(employee))}`,
        // The app's own hooks are written by the app: Codex must not stop to ask about them.
        '--dangerously-bypass-hook-trust',
      ]
      return spawnPty(command, args, {
        cwd,
        env: {
          ...cleanEnv(env),
          ...accountEnv(adapter, request.account),
          ...rtkEnv(rtk),
          [HOOK_TOKEN_ENV]: hookToken,
          ...(server?.token && { [CODEX_MCP_TOKEN_ENV]: server.token }),
          ...server?.env,
        },
        cols: 120,
        rows: 40,
      })
    },

    /**
     * Codex takes its MCP servers as config, not as a file: each URL goes on the command line and
     * every token travels in the environment, so no secret is visible in `ps`. Nothing is written
     * anywhere, least of all the shared cwd.
     */
    /**
     * Codex keeps its sign-in in `$CODEX_HOME/auth.json` (T173), so an account is one `CODEX_HOME`.
     * The login inside it is written by `codex` itself and never read, copied or stored here.
     */
    accounts: () => ({
      env: CODEX_HOME_ENV,
      defaultDir: join(homedir(), '.codex'),
    }),

    configDirEnv: (configDir) => ({ [CODEX_HOME_ENV]: configDir }),

    /**
     * The granted skill folders, in `.codex/skills/` in the Employee's worktree, which is one of
     * the two roots Codex reads inside a working directory (T253). Symlinks, so the boss edits the
     * folder once and every Employee holding it sees the edit; git-excluded, because the app
     * writes into a worktree and never commits (decision 45). Nothing in one is read or run here.
     */
    installSkills(worktree, skills: readonly GrantedSkill[]) {
      syncSkillFolder(worktree, CODEX_SKILLS_FOLDER, skills)
    },

    commandRewriteHook: codexCommandRewrite,

    injectMcp(sessionId, { company, granted }) {
      const grants = granted.map(codexGrantConfig)
      const args = [
        ...(company
          ? [
              '-c',
              `mcp_servers.${MCP_SERVER}.url=${tomlString(company.url)}`,
              '-c',
              `mcp_servers.${MCP_SERVER}.bearer_token_env_var=${tomlString(CODEX_MCP_TOKEN_ENV)}`,
            ]
          : []),
        ...grants.flatMap((grant) => grant.args),
      ]
      mcp.set(sessionId, {
        args,
        env: Object.assign({}, ...grants.map((grant) => grant.env)) as Record<string, string>,
        token: company?.token ?? null,
      })
      return args
    },

    /**
     * The Session ended. Codex wrote nothing to the disk — every token of its rides in the
     * environment of the process that has just gone — so all there is to forget is what this
     * adapter held to spawn it with (T199, finding H5).
     */
    forgetSession(sessionId) {
      mcp.delete(sessionId)
    },

    resumeCommand: (sessionId) => ['resume', sessionId],

    /**
     * What the boss types to open this Session themselves (T164): `codex resume <id>`, the same
     * approval and sandbox flags the Session runs with, and its model. The Company's MCP server,
     * the hook token and the developer instructions stay behind: they are the app's Session.
     */
    handoffCommand: (employee, providerSessionId) => [
      command,
      ...adapter.resumeCommand(providerSessionId)!,
      ...permissionArgs(employee),
      ...codexModelArgs(employee),
    ],

    confirmsResume: codexConfirmsResume,

    detectIdle: codexHookSignal,

    sessionIdOf: codexThreadId,

    detectBudgetExhausted: codexBudgetExhausted,

    budgetResetAt: codexBudgetResetAt,

    pushPrompt(session, text) {
      session.write(text)
      setTimeout(() => session.write(ENTER), KEY_DELAY_MS)
    },

    installed,

    /**
     * Whether Codex on this Mac can run an Employee (T135). `codex login status` in the environment
     * a Session is spawned with; Codex can also be signed in on a billed API key, and says so, so
     * that is a third answer rather than a login like any other.
     */
    checkCli(): Promise<ProviderCheck> {
      return checkProviderCli({
        name,
        command,
        signIn: CODEX_SIGN_IN,
        installed,
        runCli,
        env: cleanEnv(env),
        placement,
      })
    },
  }
  return adapter
}

/** How Codex is asked where it stands, and its own commands for the two ways to fix it. */
export const CODEX_SIGN_IN: ProviderSignIn = {
  statusArgs: ['login', 'status'],
  installWith: 'npm install -g @openai/codex',
  signInWith: 'codex login',
  verdict: codexVerdict,
  identity: codexIdentity,
}

/**
 * What `codex login status` says about the account (T141). It names the subscription it is logged
 * in with — `Logged in using ChatGPT` — and no more than that: no email, no tier, and nothing that
 * can be had without spending the subscription. So the plan is all this reports, and the card
 * draws the state alone under it.
 */
export function codexIdentity(outcome: CliOutcome): ProviderIdentity {
  if (outcome.kind !== 'output') return NO_IDENTITY
  const using = /\blogged\s+in\s+using\s+(.+)/i.exec(stripAnsi(outcome.output))
  const plan = using?.[1]?.split('\n')[0]?.trim().replace(/[.]+$/, '')
  return { account: null, plan: plan && !/\bapi\s*key\b/i.test(plan) ? plan : null }
}

/**
 * What `codex login status` said. Codex prints one sentence — `Logged in using ChatGPT`, `Logged in
 * using an API key`, `Not logged in` — and exits non-zero for the last of them. A timeout or an
 * unreadable answer is not a login: TinyCorp knows nothing, and says so.
 */
export function codexVerdict(outcome: CliOutcome): SignInVerdict {
  if (outcome.kind !== 'output') return 'none'
  const text = stripAnsi(outcome.output)
  if (/\bnot\s+logged\s+in\b/i.test(text) || !/\blogged\s+in\b/i.test(text)) return 'none'
  return /\bapi\s*key\b/i.test(text) ? 'api-key' : 'subscription'
}

/**
 * Writes the status hooks into `cwd/.codex/hooks.json`, Codex's project hook file, keeping every
 * hook that is not ours. The file is the same for every Employee in the folder (decision 48).
 */
export function installCodexHooks(cwd: string, hookUrl: string): void {
  installHookFile({
    file: join(cwd, '.codex', 'hooks.json'),
    events: CODEX_HOOK_EVENTS,
    hookUrl,
    handler: codexHookHandler,
  })
  excludeFromGit(cwd, ['.codex/'])
}

/** RTK's own name for Codex in `rtk hook <agent>`. */
export const CODEX_RTK_AGENT = 'codex'

/** What the Tokens tab's Codex row says (frame `L0glbm`). */
export const CODEX_RTK_HOW = 'Bash hook · same rewrite'

/**
 * Codex's command rewrite (T179): a `PreToolUse` entry matched to `Bash`, running `rtk hook codex`,
 * in the same `.codex/hooks.json` the status hooks are written into — the project file, never
 * `$CODEX_HOME/hooks.json`, which is the boss's own.
 *
 * **It cannot widen what an Employee may do.** Codex needs a protocol-level `allow` for its
 * `updatedInput` to take effect at all, and it applies the replacement *before* its own approval and
 * sandbox checks — so a Session on `--ask-for-approval on-request` still stops on the rewritten
 * command, its `PermissionRequest` hook still fires, and the boss still gets the *needs you*. What
 * changes is the words in the prompt: Codex's own classifier does not unwrap `rtk`, so a wrapped
 * `git push` reads as an unfamiliar command and is asked about rather than waved through.
 */
export function codexCommandRewrite(rtk: RtkHook | null): CommandRewriteHook {
  return {
    how: CODEX_RTK_HOW,
    keepsApprovals: true,
    install(cwd) {
      installRewriteHook({
        file: join(cwd, '.codex', 'hooks.json'),
        event: 'PreToolUse',
        matcher: 'Bash',
        agent: CODEX_RTK_AGENT,
        handler: rtk ? codexRewriteHandler(rtk.path) : null,
      })
    },
  }
}

/** The rewrite entry, in both shells Codex runs a hook command in (T166). */
export function codexRewriteHandler(rtkPath: string): HookHandler {
  return {
    type: 'command',
    command: rtkHookCommand(rtkPath, CODEX_RTK_AGENT),
    commandWindows: rtkHookCommand(rtkPath, CODEX_RTK_AGENT, 'cmd'),
  }
}

/**
 * The one `-c` override RTK needs of Codex: the folder its history file is in, added to the
 * `workspace-write` sandbox's writable roots.
 *
 * Rewriting works without it — Codex replaces the command before the sandbox is involved — but the
 * SQLite history does not: the write fails with `SQLITE_CANTOPEN` and this Company's savings stay at
 * zero. The folder is the app's own `rtk` directory and holds nothing but that database, so what is
 * granted is one directory of ours and never the boss's.
 */
export function codexRtkArgs(rtk: RtkHook | null): string[] {
  if (!rtk) return []
  return ['-c', `sandbox_workspace_write.writable_roots=[${tomlString(dirname(rtk.dbPath))}]`]
}

/**
 * The hook entry Codex gets: the POSIX command, and `commandWindows` beside it (T166).
 *
 * Codex runs a hook command through the login shell on macOS and Linux and through `%COMSPEC% /C`
 * — `cmd.exe` — on Windows, where nothing of `[ -z "$VAR" ]` means anything. `commandWindows` is
 * Codex's own answer to that: the Windows-only override it reads in place of `command`. One file
 * therefore works on both, which matters because the file sits in the Company folder and a boss
 * may open that folder on either.
 */
export function codexHookHandler(hookUrl: string): HookHandler {
  return { type: 'command', command: hookCommand(hookUrl), commandWindows: hookCommand(hookUrl, 'cmd') }
}

/**
 * `skip-permissions` runs Codex without approvals or its sandbox, as the boss asked; `interactive`
 * leaves it asking, with the workspace writable.
 */
function permissionArgs(employee: Pick<Employee, 'permissionMode'>): string[] {
  return employee.permissionMode === 'skip-permissions'
    ? ['--dangerously-bypass-approvals-and-sandbox']
    : ['--ask-for-approval', 'on-request', '--sandbox', 'workspace-write']
}

/**
 * Where Codex keeps the boss's ChatGPT login and config. The boss's own setting, not session
 * state, so it is inherited: stripping it would sign every Session out.
 */
export const CODEX_HOME_ENV = 'CODEX_HOME'

/**
 * Every other inherited `CODEX*` variable removed, so a Session started from inside another Codex
 * does not adopt its sandbox, its escalation socket or its thread — Claude Code's finding 1, in
 * Codex's spelling. The login itself lives in `$CODEX_HOME/auth.json` and is never read here.
 *
 * Another orchestrator's variables go with them (T234). Codex has no `--setting-sources`: it reads
 * `$CODEX_HOME/hooks.json`, and `$CODEX_HOME` is the boss's own because that is where the login
 * is, so the strip is the whole of what this adapter can do about a global hook.
 */
function cleanEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(withoutOrchestratorEnv(env)).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && (!entry[0].startsWith('CODEX') || entry[0] === CODEX_HOME_ENV),
    ),
  )
}

function identityLine(employee: Employee): string {
  return (
    `You are ${employee.name}, ${employee.title} at this Company. ${employee.persona} ` +
    'Messages from the Company arrive as prompts prefixed "[company]".'
  ).trim()
}

/** `value` as a TOML basic string, so `-c key=value` parses however the instructions read. */
export function tomlString(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
  return `"${escaped}"`
}
