import { readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import { COMPANY_MCP_NAME } from '../../../shared/catalogue/mcp-servers'
import type { Employee } from '../../../shared/domain/staff'
import { fromWallClock, wallClock } from '../../../shared/platform/wall-clock'
import type { ProviderPlacement } from '../../../shared/platform/wsl'
import type { ProviderCheck } from '../../../shared/providers/preflight'
import { type RtkHook, rtkEnv } from '../../../shared/rtk'
import { GENERATED_INSTRUCTIONS_MARKER } from '../../../shared/session'
import { modelOption } from '../../../shared/staff/models'
import { clip, SUBAGENT_NAME_MAX, SUBAGENT_NOW_MAX, SUBAGENT_TASK_MAX } from '../../../shared/subagents'
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
  type PtySession,
  type PtySpawnOptions,
  type SessionSignal,
  type SpawnPty,
  type SubagentSignal,
  sessionRtk,
} from '../provider-adapter'
import {
  gitBashPath,
  HOOK_TOKEN_ENV,
  HOOK_TOKEN_HEADER,
  type HookHandler,
  hookCommand,
  hookPlatform,
  installHookFile,
  installRewriteHook,
  rtkHookCommand,
  stripAnsi,
} from '../provider-hooks'
import {
  checkProviderCli,
  NO_IDENTITY,
  type PreflightWords,
  type ProviderIdentity,
  type ProviderSignIn,
  type SignInVerdict,
  statusCommand,
} from '../provider-preflight'
import { forgetSessionFile, writeSessionFile } from '../session-files'
import { apiKeyVarsIn, subscriptionEnv } from '../subscription-env'
import { CLAUDE_CONFIG_FILE, claudeEmailIn, trustClaudeFolder } from './account-config'

export type { PtySpawnOptions, SpawnPty }
export { HOOK_TOKEN_ENV, HOOK_TOKEN_HEADER, hookCommand }

/**
 * Where Claude Code looks for skill folders, relative to the folder it is working in. The
 * catalogue entry names the same folder, and a test holds the two to each other.
 */
export const CLAUDE_SKILLS_FOLDER = '.claude/skills'

/**
 * Where this Session's MCP config lives, under the app's own `dataDir`. One file per Session,
 * written at `injectMcp` and taken away at `forgetSession`.
 */
const MCP_FOLDER = 'mcp'

/**
 * The hook events the status machine listens to (spike v0), the two that report subagents (T162),
 * and `PermissionRequest`, which is the Session stopping to ask the boss (T165). `claude` 2.1.280
 * emits both `SubagentStart` and `SubagentStop`; an older one that knows no `SubagentStart`
 * ignores the entry, and its subagents are paired by their tool call instead.
 */
export const CLAUDE_HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Stop',
  'Notification',
  'PermissionRequest',
  'SubagentStart',
  'SubagentStop',
] as const

export interface ClaudeAdapterOptions {
  /** Where the hook receiver listens, e.g. `http://127.0.0.1:7377/hook`. */
  hookUrl: string
  /** App-owned folder for per-Session files such as MCP configs. */
  dataDir: string
  /** Starts a process in a PTY. Defaults to node-pty. */
  spawnPty?: SpawnPty
  /** Environment the Session inherits before `CLAUDE*` variables are stripped. */
  env?: NodeJS.ProcessEnv
  command?: string
  /** The product's full name, from the catalogue. The preflight card's words are built from it. */
  name?: string
  /** Whether `claude` is on this machine. Defaults to a `PATH` lookup. */
  installed?: () => boolean
  /** Runs `claude auth status` for the preflight. Defaults to the real subprocess with a timeout. */
  runCli?: RunCli
  /**
   * Where this CLI was found on this machine and where it runs (T167). The registry fills it in on
   * Windows; on a Mac there is one place and the card says nothing about it.
   */
  placement?: ProviderPlacement | null
}

/** Claude Code reports a continued conversation as `SessionStart` with `source: "resume"` (spike v0). */
export function claudeConfirmsResume(hook: HookPayload): boolean {
  return hook.hook_event_name === 'SessionStart' && hook['source'] === 'resume'
}

/**
 * Claude Code hooks → status signals. SessionStart is the ready signal (spike v0, finding 2).
 *
 * Two of them say the Session is stopped asking the boss (T165), and `claude` 2.1.280 sends both,
 * in this order:
 *
 * - `PermissionRequest`, which runs only on the ask path — it never fires for a tool the settings
 *   already allow — and carries the tool and its `tool_input`, so it is the one that can say
 *   *`Write src/api/usage.ts`* rather than *a permission*;
 * - `Notification` with `notification_type: "permission_prompt"`, a moment later, whose whole
 *   message is `Claude needs your permission`.
 *
 * The engine keeps the first of the two and ignores the second, so the boss reads the tool and the
 * target. `idle_prompt` stays `idle`: it is the composer waiting for a prompt, and 2.1.280 does not
 * send it while a permission prompt is on screen.
 */
export function claudeHookSignal(hook: HookPayload): SessionSignal | null {
  switch (hook.hook_event_name) {
    case 'SessionStart':
      return 'ready'
    case 'UserPromptSubmit':
    case 'PreToolUse':
    case 'PostToolUse':
      return 'busy'
    case 'Stop':
      return 'idle'
    case 'PermissionRequest':
      return asking(claudeAsk(hook))
    case 'Notification':
      if (hook.notification_type === 'idle_prompt') return 'idle'
      return hook.notification_type === 'permission_prompt'
        ? asking(text(hook['message']) ?? CLAUDE_PERMISSION_ASK)
        : null
    default:
      return null
  }
}

/** What a `permission_prompt` notification says when it carries no message of its own. */
export const CLAUDE_PERMISSION_ASK = 'a permission'

/** What a `PermissionRequest` is asking for: its tool and its target, as the subagent strip reads one. */
function claudeAsk(hook: HookPayload): string {
  const tool = text(hook['tool_name'])
  if (!tool) return CLAUDE_PERMISSION_ASK
  return toolNow(tool, record(hook['tool_input']), hook)
}

/** The tool Claude Code starts a subagent with: `Agent`, and `Task` before it was renamed. */
const SUBAGENT_TOOLS = new Set(['Agent', 'Task'])
/** The tools whose `file_path` a subagent changes. */
const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])

/**
 * Claude Code hooks → subagent signals (T162), from what 2.1.280 sends:
 *
 * - `PreToolUse` of `Agent` from the parent is the call: `description` names the task, `prompt`
 *   says it, and only the prompt's first line is kept.
 * - `SubagentStart` / `SubagentStop` carry the agent's `agent_id`, and so does every tool hook it
 *   sends — that is what it is running now.
 * - `PostToolUse` of `Agent` hands back `agentId`, which pairs the two for certain, and says
 *   `async_launched` when the agent runs on in the background.
 * - `Stop` ends the parent's turn and lists `background_tasks` still running.
 */
export function claudeSubagentSignal(hook: HookPayload): SubagentSignal | null {
  const agentId = text(hook['agent_id'])
  const tool = text(hook['tool_name'])
  const input = record(hook['tool_input'])
  switch (hook.hook_event_name) {
    case 'SubagentStart':
      return agentId ? { kind: 'started', agentId, type: text(hook['agent_type']) } : null
    case 'SubagentStop':
      return agentId ? { kind: 'stopped', agentId } : null
    case 'Stop': {
      const tasks = Array.isArray(hook['background_tasks']) ? hook['background_tasks'].map(record) : null
      const running = tasks
        ?.filter((task) => task['type'] === 'subagent' && task['status'] === 'running')
        .flatMap((task) => text(task['id']) ?? [])
      return { kind: 'settled', running: running ?? null }
    }
    case 'PreToolUse': {
      if (!tool) return null
      if (agentId) {
        const file = EDIT_TOOLS.has(tool) ? (text(input['file_path']) ?? text(input['notebook_path'])) : null
        return { kind: 'tool', agentId, now: toolNow(tool, input, hook), file }
      }
      const callId = text(hook['tool_use_id'])
      if (!SUBAGENT_TOOLS.has(tool) || !callId) return null
      const type = text(input['subagent_type'])
      const name = text(input['description']) ?? type ?? 'subagent'
      const firstLine = (text(input['prompt']) ?? '').split('\n').find((line) => line.trim() !== '')
      return {
        kind: 'called',
        callId,
        type,
        name: clip(name, SUBAGENT_NAME_MAX),
        task: clip(firstLine ?? name, SUBAGENT_TASK_MAX),
      }
    }
    case 'PostToolUse': {
      const callId = text(hook['tool_use_id'])
      if (agentId || !tool || !SUBAGENT_TOOLS.has(tool) || !callId) return null
      const response = record(hook['tool_response'])
      return {
        kind: 'returned',
        callId,
        agentId: text(response['agentId']),
        background: response['status'] === 'async_launched' || response['isAsync'] === true,
      }
    }
    default:
      return null
  }
}

/** One line for what a subagent's tool is doing: the command it runs, or the tool and its file. */
function toolNow(tool: string, input: Record<string, unknown>, hook: HookPayload): string {
  const command = text(input['command'])
  if (tool === 'Bash' && command) return clip(command.split('\n')[0]!, SUBAGENT_NOW_MAX)
  const path = text(input['file_path']) ?? text(input['notebook_path']) ?? text(input['path'])
  const cwd = text(hook['cwd'])
  const shown = path && cwd && isAbsolute(path) && !relative(cwd, path).startsWith('..') ? relative(cwd, path) : path
  const target = shown ?? text(input['pattern']) ?? text(input['url']) ?? text(input['query'])
  return clip(target ? `${tool} ${target}` : tool, SUBAGENT_NOW_MAX)
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

const DIALOG_ANSWER_DELAY_MS = 300
const KEY_DELAY_MS = 250
const DOWN = '\x1b[B'
const ENTER = '\r'

/** Startup dialogs a Session must get past. Stripped TUI output loses spaces, hence `\s*`. */
const DIALOGS = [
  { name: 'folder-trust', yes: /Yes,\s*I\s*trust\s*this\s*folder/i },
  { name: 'bypass-permissions', yes: /Yes,\s*I\s*accept/i },
]

const BUDGET_PATTERNS = [
  /usage\s*limit\s*reached/i,
  /limit\s*will\s*reset\s*at/i,
  /you['’]ve\s*hit\s*your\s*(usage\s*)?limit/i,
  /out\s*of\s*extra\s*usage/i,
]

/** True when Claude Code's terminal or hook output says the subscription limit was hit. */
export function claudeBudgetExhausted(output: string): boolean {
  const text = stripAnsi(output)
  return BUDGET_PATTERNS.some((pattern) => pattern.test(text))
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** `Claude AI usage limit reached|<epoch seconds>`, the older machine-readable message. */
const RESET_EPOCH = /limit\s*reached\s*\|\s*(\d{10})/i
/** `resets 3pm (Zone)`, `reset at 7:30am`, `resets Sep 20, 4pm (Zone)`. */
const RESET_CLOCK =
  /resets?\s*(?:at\s*)?(?:([a-z]{3})[a-z]*\s*(\d{1,2})\s*,?\s*(?:at\s*)?)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)(?:\s*\(([^)\s]+)\))?/i

/**
 * When the limit Claude Code reports resets. A clock time is its next occurrence after `now`
 * in the named zone, or in local time when none is named.
 */
export function claudeBudgetResetAt(output: string, now: Date): Date | null {
  const text = stripAnsi(output)
  const epoch = RESET_EPOCH.exec(text)
  if (epoch) return new Date(Number(epoch[1]) * 1000)
  const clock = RESET_CLOCK.exec(text)
  if (!clock) return null
  const [, monthName, dayText, hourText, minuteText, meridiem, zone] = clock
  const month = monthName ? MONTHS.indexOf(monthName.toLowerCase()) : -1
  if (monthName && month === -1) return null
  const hour = (Number(hourText) % 12) + (meridiem!.toLowerCase() === 'pm' ? 12 : 0)
  const minute = Number(minuteText ?? 0)
  if (hour > 23 || minute > 59) return null

  const wall = wallClock(now, zone)
  if (!wall) return null
  let target = { ...wall, hour, minute }
  if (month !== -1) target = { ...target, month, day: Number(dayText) }
  let at = fromWallClock(target, now, zone)
  while (at <= now) {
    target = month === -1 ? { ...target, day: target.day + 1 } : { ...target, year: target.year + 1 }
    at = fromWallClock(target, now, zone)
  }
  return at
}

export function createClaudeAdapter({
  hookUrl,
  dataDir,
  spawnPty = nodePtySpawn,
  env = process.env,
  command = 'claude',
  name = 'Claude Code',
  installed = () => onPath(command, env),
  runCli = realRunCli,
  placement = null,
}: ClaudeAdapterOptions): ProviderAdapter {
  const mcpArgs = new Map<string, string[]>()
  /** Where this Session's hooks will run: in the distro, when that is where the Session is (T258). */
  const hooksRunOn = hookPlatform(placement)

  const adapter: ProviderAdapter = {
    spawn(request) {
      const { employee, cwd, instructions, sessionId, resume = false, hookToken, account } = request
      installHooks(cwd, hookUrl, env, hooksRunOn)
      // Beside our own hooks, in the same settings file, and never in `~/.claude` (T179). Written
      // with what this Session really runs with, which is null when it runs with none — and a null
      // takes last Session's rewrite back out.
      const rtk = sessionRtk(adapter, request)
      claudeCommandRewrite(rtk, env, hooksRunOn).install(cwd)
      removeGeneratedInstructions(cwd)
      const args = [
        ...(resume ? adapter.resumeCommand(sessionId)! : ['--session-id', sessionId]),
        '--setting-sources',
        CLAUDE_SETTING_SOURCES.join(','),
        ...(mcpArgs.get(sessionId) ?? []),
        ...claudePermissionArgs(employee),
        ...claudeModelArgs(employee),
        '--append-system-prompt',
        instructions ?? identityLine(employee),
      ]
      const pty = spawnPty(command, args, {
        cwd,
        // The account's own config directory, after `cleanEnv` has stripped every inherited CLAUDE*.
        env: { ...cleanEnv(env), [HOOK_TOKEN_ENV]: hookToken, ...accountEnv(adapter, account), ...rtkEnv(rtk) },
        cols: 120,
        rows: 40,
      })
      answerDialogs(pty)
      return pty
    },

    /**
     * This Session's MCP servers, as the one JSON file Claude Code reads: the Company's own, and
     * the ones the boss granted this Employee (T136). `--strict-mcp-config` stays — it is what
     * keeps the boss's own `~/.claude.json` servers out of every Employee — so this file is the
     * whole of what the Session can reach. Each secret is written into it and nowhere else; the
     * file is the app's, per Session, and `0600`.
     */
    /**
     * Claude Code keeps one sign-in per config directory, named by `CLAUDE_CONFIG_DIR` (T173). An
     * account is that directory; the login inside it is written by `claude` itself and is never
     * read, copied or stored here. The folder's `.claude.json` is read for the address, and — for a
     * folder TinyCorp made — written to trust the folder its sign-ins run in (T263).
     */
    accounts: () => {
      const defaultDir = join(homedir(), '.claude')
      return {
        env: CLAUDE_CONFIG_DIR_ENV,
        defaultDir,
        trustFolder: trustClaudeFolder,
        // The default folder keeps its `.claude.json` beside it, in the home, rather than inside.
        email: (configDir) =>
          claudeEmailIn(
            configDir === defaultDir ? join(homedir(), CLAUDE_CONFIG_FILE) : join(configDir, CLAUDE_CONFIG_FILE),
          ),
      }
    },

    configDirEnv: (configDir) => ({ [CLAUDE_CONFIG_DIR_ENV]: configDir }),

    injectMcp(sessionId, { company, granted }) {
      const config = {
        mcpServers: {
          ...(company && {
            [COMPANY_MCP_NAME]: {
              type: 'http',
              url: company.url,
              headers: { authorization: `Bearer ${company.token}` },
            },
          }),
          ...Object.fromEntries(granted.map((server) => [server.name, claudeMcpEntry(server)])),
        },
      }
      const file = writeSessionFile(dataDir, MCP_FOLDER, sessionId, JSON.stringify(config, null, 2))
      const args = ['--mcp-config', file, '--strict-mcp-config']
      mcpArgs.set(sessionId, args)
      return args
    },

    /**
     * The Session ended, so its MCP config goes with it (T199, finding H5). Claude Code read the
     * file once, at start-up; what is left is a bearer token in a folder every other Employee of
     * this Mac can read, for as long as the install lasts.
     */
    forgetSession(sessionId) {
      mcpArgs.delete(sessionId)
      forgetSessionFile(dataDir, MCP_FOLDER, sessionId)
    },

    /**
     * The granted skill folders, in `.claude/skills/` in the Employee's worktree, where Claude
     * Code looks for them (T137). Symlinks, so the boss edits the folder once and every Employee
     * holding it sees the edit; git-excluded, because the app writes into a worktree and never
     * commits (decision 45). Nothing in a skill folder is read or run here.
     */
    installSkills(worktree, skills: readonly GrantedSkill[]) {
      syncSkillFolder(worktree, CLAUDE_SKILLS_FOLDER, skills)
    },

    commandRewriteHook: (rtk) => claudeCommandRewrite(rtk, env),

    resumeCommand: (sessionId) => ['--resume', sessionId],

    /**
     * What the boss types to open this Session themselves (T164): `--resume`, the skip flag the
     * Session runs with and its model. Not the MCP config, the hook token or the instructions —
     * those are the app's Session, and a second terminal has no business holding them.
     */
    handoffCommand: (employee, providerSessionId) => [
      command,
      ...adapter.resumeCommand(providerSessionId)!,
      ...claudePermissionArgs(employee),
      ...claudeModelArgs(employee),
    ],

    confirmsResume: claudeConfirmsResume,

    detectIdle: claudeHookSignal,

    subagentOf: claudeSubagentSignal,

    detectBudgetExhausted: claudeBudgetExhausted,

    budgetResetAt: claudeBudgetResetAt,

    pushPrompt(session, text) {
      // Spike v0, finding 6: text, a short pause, then Enter.
      session.write(text)
      setTimeout(() => session.write(ENTER), KEY_DELAY_MS)
    },

    installed,

    /**
     * Whether Claude Code on this Mac can run an Employee (T129, T135). `claude auth status` in the
     * same environment a Session is spawned with, and then one state of its own: an API key set
     * around TinyCorp is a warning rather than a wall, because a Session never inherits it.
     */
    async checkCli(): Promise<ProviderCheck> {
      const signIn = claudeSignIn(env)
      const check = await checkProviderCli({
        name,
        command,
        signIn,
        installed,
        runCli,
        env: authStatusEnv(env),
        placement,
      })
      if (check.state !== 'ready') return check
      const vars = apiKeyVarsIn(env)
      return vars.length > 0
        ? claudeApiKeyCheck(vars, { name, command, signIn, placement }, { account: check.account, plan: check.plan })
        : check
    },
  }
  return adapter
}

/** How Claude Code is asked where it stands, and its own commands for the two ways to fix it. */
export function claudeSignIn(env: NodeJS.ProcessEnv): ProviderSignIn {
  return {
    statusArgs: ['auth', 'status'],
    installWith: CLAUDE_INSTALL_COMMAND,
    // The frame's own two (`c8knu`): Claude Code's native installers, which is what a boss on a
    // Windows with WSL is offered — one line for PowerShell, one for the distro's shell.
    installOnWindows: CLAUDE_INSTALL_POWERSHELL,
    installInWsl: CLAUDE_INSTALL_SHELL,
    // The frame's own command (`KB9AX`), which is how the CLI itself spells it inside a session.
    signInWith: 'claude /login',
    verdict: (outcome) => claudeVerdict(outcome, env),
    identity: claudeIdentity,
  }
}

/**
 * Who `claude auth status` says is signed in (T141): the `email` it prints, and the plan behind
 * `subscriptionType` — `max` as `Max`, because the card draws it beside a product name. Both are
 * optional in that JSON and either may be missing, in which case the card leaves the line out
 * rather than have one invented for it.
 */
export function claudeIdentity(outcome: CliOutcome): ProviderIdentity {
  if (outcome.kind !== 'output') return NO_IDENTITY
  let status: { email?: unknown; subscriptionType?: unknown }
  try {
    status = JSON.parse(outcome.output) as { email?: unknown; subscriptionType?: unknown }
  } catch {
    return NO_IDENTITY
  }
  return { account: text(status.email), plan: planName(text(status.subscriptionType)) }
}

/** A field of that JSON, when it is a non-empty string and not something else entirely. */
function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/** `max` as `Max`: the CLI's own word for the plan, capitalised for a line the boss reads. */
function planName(plan: string | null): string | null {
  return plan ? plan[0]!.toUpperCase() + plan.slice(1) : null
}

/** Where `claude` comes from when this Mac has none. */
export const CLAUDE_INSTALL_COMMAND = 'npm install -g @anthropic-ai/claude-code'

/** The same thing on Windows itself, in the one line Claude Code's own docs give for PowerShell. */
export const CLAUDE_INSTALL_POWERSHELL = 'irm https://claude.ai/install.ps1 | iex'

/** And inside a distro, where the shell is bash and the installer is the POSIX one. */
export const CLAUDE_INSTALL_SHELL = 'curl -fsSL https://claude.ai/install.sh | bash'

/**
 * What `claude auth status` said. A subscription login, or the long-lived token a CI runner logs in
 * with (decision 29); a login that is not on `claude.ai` is a key that gets billed. A timeout, a
 * failure and an unreadable answer are all `none`: `claude` is there and TinyCorp has no
 * subscription login out of it, which is exactly what that card says — and the boss can press
 * `Check again` rather than be told a story about a command that does exist.
 */
export function claudeVerdict(outcome: CliOutcome, env: NodeJS.ProcessEnv): SignInVerdict {
  if (env[OAUTH_TOKEN_ENV]?.trim()) return 'subscription'
  if (outcome.kind !== 'output') return 'none'
  let status: { loggedIn?: unknown; authMethod?: unknown }
  try {
    status = JSON.parse(outcome.output) as { loggedIn?: unknown; authMethod?: unknown }
  } catch {
    return 'none'
  }
  if (status.loggedIn !== true) return 'none'
  return status.authMethod === 'claude.ai' ? 'subscription' : 'api-key'
}

/**
 * Claude Code's own extra state: an API key set around TinyCorp itself. Every Session has it
 * stripped (see {@link cleanEnv}), so nothing is broken and nothing will be billed — but a boss who
 * has one exported deserves to be told that before the bill arrives, not after.
 */
export function claudeApiKeyCheck(
  vars: string[],
  words: PreflightWords,
  identity: ProviderIdentity = NO_IDENTITY,
): ProviderCheck {
  return {
    state: 'warning',
    title: `${words.name} is using an API key`,
    body: `${listVars(vars)} set around TinyCorp. Every Employee runs on your subscription login, and a Session never inherits those variables, so this key is not what will be billed.`,
    lead: 'Clear it where you start TinyCorp if you would rather it were not there at all:',
    commands: [`unset ${vars.join(' ')}`, statusCommand(words)],
    note: 'Everything still runs — this is here so the bill is never a surprise.',
    ...identity,
  }
}

/** `ANTHROPIC_API_KEY is` / `ANTHROPIC_API_KEY and ANTHROPIC_AUTH_TOKEN are`. */
function listVars(vars: string[]): string {
  if (vars.length === 0) return 'An API key is'
  if (vars.length === 1) return `${vars[0]} is`
  return `${vars.slice(0, -1).join(', ')} and ${vars[vars.length - 1]} are`
}

/** The environment `claude auth status` is asked in: the one a Session would be spawned with. */
export function authStatusEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return cleanEnv(env)
}

/** Where Claude Code keeps one sign-in: the directory an account is (T173). */
export const CLAUDE_CONFIG_DIR_ENV = 'CLAUDE_CONFIG_DIR'

/** The subscription token from `claude setup-token`: a credential, not session state, so it is inherited. */
export const OAUTH_TOKEN_ENV = 'CLAUDE_CODE_OAUTH_TOKEN'

/**
 * Every inherited `CLAUDE*` variable removed (spike v0, finding 1), except the subscription token,
 * and every API key with them: a Session runs on the boss's subscription or not at all (T129).
 * Another orchestrator's variables go too (T234): the boss's global `settings.json` is not the
 * only way one of them reaches in, and `--setting-sources` says nothing about `ORCA_PANE_KEY`.
 */
function cleanEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(withoutOrchestratorEnv(subscriptionEnv(env))).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && (!entry[0].startsWith('CLAUDE') || entry[0] === OAUTH_TOKEN_ENV),
    ),
  )
}

/** One granted server as Claude Code's own JSON: headers for `http`, an env entry for `stdio`. */
function claudeMcpEntry(server: GrantedMcpServer): Record<string, unknown> {
  if (server.transport === 'http') {
    // Claude Code takes any headers it is given, so a server that authenticates with named ones
    // (T245) is written the same way its own documentation writes it, the bearer beside them.
    const headers = {
      ...server.headers,
      ...server.headerSecrets,
      ...(server.secret && { authorization: `Bearer ${server.secret}` }),
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

/**
 * The settings Claude Code loads for a Session: the folder's, and never the boss's own (T234).
 *
 * `--setting-sources` takes `user`, `project` and `local`, and `user` is `~/.claude/settings.json`.
 * The boss uses other orchestrators — Orca, Conductor — and each of them installs its hooks there,
 * so every Employee's `claude` was loading them and firing another app's notifications for a
 * TinyCorp Session. `project` is `.claude/settings.json` in the Company folder, which is the file
 * `installHooks` writes, so leaving `user` out costs the app nothing and takes the boss's own
 * permissions, environment and model setting out of the Session with the hooks.
 *
 * **It takes the boss's `~/.claude/CLAUDE.md` with it**, which the ticket expected it not to:
 * measured on `claude` 2.1.282, a Session without the `user` source cannot read that file. The
 * repo's own `CLAUDE.md` and `AGENTS.md` still load — they are the folder's, not the user's — and
 * an Employee's own instructions come from the Company anyway (T184), so what is lost is the
 * boss's personal preferences reaching an Employee, which is the same leak as the hooks.
 *
 * Known to `claude` since the setting-sources flag landed; a CLI too old to know it fails the
 * spawn outright rather than quietly ignoring it, which is why `docs/providers.md` names it.
 */
export const CLAUDE_SETTING_SOURCES = ['project', 'local'] as const

/**
 * `--dangerously-skip-permissions` for an Employee that skips them; nothing for one that asks,
 * which is Claude Code's own default. Spawn and the handoff command share it, so a Session opened
 * in the boss's terminal cannot quietly behave differently from the one in the drawer.
 */
export function claudePermissionArgs(employee: Pick<Employee, 'permissionMode'>): string[] {
  return employee.permissionMode === 'skip-permissions' ? ['--dangerously-skip-permissions'] : []
}

/** `--model` and `--effort` for the Employee's model (decision 31); none for the provider default. */
export function claudeModelArgs(employee: Pick<Employee, 'provider' | 'model'>): string[] {
  const option = modelOption(employee.provider, employee.model)
  if (!option) return []
  return ['--model', option.model, ...(option.effort ? ['--effort', option.effort] : [])]
}

function identityLine(employee: Employee): string {
  return (
    `You are ${employee.name}, ${employee.title} at this Company. ${employee.persona} ` +
    'Messages from the Company arrive as prompts prefixed "[company]".'
  ).trim()
}

/**
 * Writes the status hooks into `cwd/.claude/settings.json`, keeping every other setting
 * and hook. Each hook POSTs its stdin JSON to the receiver with the Session's token,
 * and does nothing when `claude` was not started by the app.
 */
export function installHooks(
  cwd: string,
  hookUrl: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): void {
  // No matcher on `Notification`: it used to be `idle_prompt`, which kept `permission_prompt` —
  // the Session stopping to ask the boss — out of the app entirely (T165). Every notification type
  // arrives now, and `claudeHookSignal` reads the two it knows.
  installHookFile({
    file: join(cwd, '.claude', 'settings.json'),
    events: CLAUDE_HOOK_EVENTS,
    hookUrl,
    handler: (url) => claudeHookHandler(url, env, platform),
  })
  excludeFromGit(cwd, ['.claude/'])
}

/** RTK's own name for Claude Code in `rtk hook <agent>`. */
export const CLAUDE_RTK_AGENT = 'claude'

/** What the Tokens tab's Claude Code row says, in the frame's words (`L0glbm`). */
export const CLAUDE_RTK_HOW = 'Bash hook · rewrites git status → rtk git status'

/**
 * Claude Code's command rewrite (T179): one more `PreToolUse` entry, matched to `Bash`, running
 * `rtk hook claude`. It sits beside the status hooks in the Session's own
 * `<cwd>/.claude/settings.json`, so no Session TinyCorp did not start is touched and `~/.claude` is
 * never written.
 *
 * **It cannot widen what an Employee may do.** RTK reads Claude Code's own `permissions` rules and
 * answers `deny > ask > allow > default`, where *default* — no rule matched — is `ask`. TinyCorp
 * writes no `permissions` into that file at all, so every rewritten command an Employee on
 * `interactive` runs falls through to `ask`: Claude Code prompts, its `PermissionRequest` hook
 * fires, and the boss gets the same *needs you* they would have got for the unrewritten command.
 */
export function claudeCommandRewrite(
  rtk: RtkHook | null,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): CommandRewriteHook {
  return {
    how: CLAUDE_RTK_HOW,
    keepsApprovals: true,
    install(cwd) {
      installRewriteHook({
        file: join(cwd, '.claude', 'settings.json'),
        event: 'PreToolUse',
        matcher: 'Bash',
        agent: CLAUDE_RTK_AGENT,
        handler: rtk ? claudeRewriteHandler(rtk.path, env, platform) : null,
      })
    },
  }
}

/**
 * The rewrite entry, in the shell Claude Code will run it in — the same question `claudeHookHandler`
 * answers for the status hooks, and the same answer, because both lines run through the same shell.
 */
export function claudeRewriteHandler(
  rtkPath: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): HookHandler {
  const agent = CLAUDE_RTK_AGENT
  if (platform !== 'win32') return { type: 'command', command: rtkHookCommand(rtkPath, agent) }
  return gitBashPath(env)
    ? { type: 'command', command: rtkHookCommand(rtkPath, agent, 'posix'), shell: 'bash' }
    : { type: 'command', command: rtkHookCommand(rtkPath, agent, 'powershell'), shell: 'powershell' }
}

/**
 * The hook entry Claude Code gets, and the shell it says to run it in (T166).
 *
 * `platform` is the platform the **Session** runs on and not always this process's (T258): a Session
 * inside a WSL distro is Linux, and gets the POSIX form whatever Windows has installed.
 *
 * Git for Windows is optional on native Windows: with it Claude Code runs a hook command in Git
 * Bash, and without it in PowerShell. The command and the shell have to agree, so the app looks for
 * Git Bash exactly where Claude Code does, writes the form that shell parses, and names the shell
 * in the entry — so a Claude Code that reads `shell` is pinned to it, and one too old to read it
 * picks the same shell by its own default rule.
 */
export function claudeHookHandler(
  hookUrl: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): HookHandler {
  if (platform !== 'win32') return { type: 'command', command: hookCommand(hookUrl) }
  return gitBashPath(env)
    ? { type: 'command', command: hookCommand(hookUrl, 'posix'), shell: 'bash' }
    : { type: 'command', command: hookCommand(hookUrl, 'powershell'), shell: 'powershell' }
}

/**
 * Deletes the `CLAUDE.md` an earlier build wrote into the Company folder. It described one Employee
 * to every Session sharing the folder, and it is already git-excluded. A `CLAUDE.md` without the
 * generated marker is the boss's and is left alone.
 */
export function removeGeneratedInstructions(cwd: string): void {
  const file = join(cwd, 'CLAUDE.md')
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return
  }
  if (text.includes(GENERATED_INSTRUCTIONS_MARKER)) rmSync(file, { force: true })
}

/**
 * Answers the folder-trust and bypass-permissions dialogs once each. When the cursor
 * already sits on the "Yes" option Enter is enough; otherwise Down+Enter (spike v0, finding 5).
 * A killed Session is left alone: whatever the TUI paints on its way out is not a dialog.
 */
function answerDialogs(pty: PtySession): void {
  let recent = ''
  let gone = false
  const answered = new Set<string>()
  const stopWatching = pty.onData((data) => {
    if (gone) return
    recent = (recent + stripAnsi(data)).slice(-4000)
    for (const dialog of DIALOGS) {
      if (answered.has(dialog.name) || !dialog.yes.test(recent)) continue
      answered.add(dialog.name)
      const onYes = new RegExp(`\u276f\\s*(\\d\\.\\s*)?${dialog.yes.source}`, 'i').test(recent)
      setTimeout(() => {
        if (gone) return
        if (onYes) return pty.write(ENTER)
        pty.write(DOWN)
        setTimeout(() => !gone && pty.write(ENTER), KEY_DELAY_MS)
      }, DIALOG_ANSWER_DELAY_MS)
    }
  })
  const stopWatchingExit = pty.onExit(() => {
    gone = true
    stopWatching()
    stopWatchingExit()
  })
}
