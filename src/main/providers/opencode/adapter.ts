import { COMPANY_MCP_NAME } from '../../../shared/catalogue/mcp-servers'
import { type Effort, nameList } from '../../../shared/domain/providers'
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
  asking,
  type CommandRewriteHook,
  type GrantedMcpServer,
  type GrantedSkill,
  type HookPayload,
  type ProviderAdapter,
  type SessionMcp,
  type SessionSignal,
  type SpawnPty,
  type SpawnRequest,
  sessionRtk,
} from '../provider-adapter'
import { HOOK_TOKEN_ENV, stripAnsi } from '../provider-hooks'
import {
  checkProviderCli,
  NO_IDENTITY,
  type ProviderIdentity,
  type ProviderSignIn,
  type SignInVerdict,
} from '../provider-preflight'
import { forgetSessionFile, writeSessionFile } from '../session-files'
import { installOpencodePlugin, READY_EVENT, RESUME_ENV } from './plugin'

/**
 * OpenCode (https://opencode.ai), written from `docs/providers.md`.
 *
 * Four things about OpenCode are its own, and they are what this file is:
 *
 * - **Its instructions and its MCP server ride in a config file, not on the command line.** The
 *   CLI has no `--append-system-prompt` and no `--mcp-config`; what it has is `OPENCODE_CONFIG`,
 *   an environment variable naming a JSON file that is merged over the boss's own config. So each
 *   Session gets one file of its own, in the app's `dataDir`, holding a private agent whose prompt
 *   is that Employee's instructions — and `--agent` on the command line picks it. Nothing
 *   Employee-specific ever reaches the Company folder (decision 48).
 * - **Its idle signal is a plugin, not a hook file.** See `plugin.ts`.
 * - **It fronts several products rather than being one.** The boss signs in to whichever they
 *   already pay for — Anthropic, GitHub Copilot, OpenAI, an OpenCode Zen account — and the model
 *   is spelled `provider/model`. Which model an Employee runs is therefore the Employee's own
 *   setting, and the limit OpenCode reports is the upstream product's words, not OpenCode's.
 * - **Its reasoning effort is a per-model `variant`, and it rides in the config too.** OpenCode
 *   has one — `opencode models <provider> --verbose` prints the variants each model accepts — but
 *   `--variant` is an option of `opencode run`, and this adapter spawns the TUI, which has no such
 *   option. So the Employee's level goes in the Session's own config beside its prompt, as
 *   `agent.<AGENT_NAME>.variant`, and only for a model the catalogue names a level for.
 */

export interface OpencodeAdapterOptions {
  /** Where the hook receiver listens, e.g. `http://127.0.0.1:7377/hook`. */
  hookUrl: string
  /** App-owned folder for per-Session files: the MCP config and this Session's OpenCode config. */
  dataDir: string
  /** Starts a process in a PTY. Defaults to node-pty. */
  spawnPty?: SpawnPty
  /** The environment a Session inherits, before this adapter strips OpenCode's own variables. */
  env?: NodeJS.ProcessEnv
  /** The command the catalogue says this Provider is installed as. */
  command?: string
  /** The product's full name, from the catalogue. The preflight card's words are built from it. */
  name?: string
  /** Whether that command is on this machine. Defaults to a `PATH` lookup. */
  installed?: () => boolean
  /** Where this CLI was found and where it runs (T167); filled in by the registry on Windows. */
  placement?: ProviderPlacement | null
  /** Runs `opencode auth list` for the preflight. Defaults to the real subprocess with a timeout. */
  runCli?: RunCli
}

/** How long after typing a prompt the adapter presses the submit key. */
const KEY_DELAY_MS = 250

/** The key that sends a prompt typed into OpenCode's TUI. */
export const SUBMIT_KEY = '\r'

/**
 * The agent the Employee's instructions are written as. One name for every Session: the file it
 * is defined in is this Session's own, so two Employees never read each other's.
 */
export const AGENT_NAME = 'tinycorp'

/** Where this product reads a working directory's own skills, and so where a grant is put (T253). */
export const OPENCODE_SKILLS_FOLDER = '.opencode/skills'

/**
 * What the Tokens tab's OpenCode row says (frame `L0glbm`). OpenCode has no hook file: its whole
 * extension surface is the plugin, so the rewrite is `rtk rewrite` run from `tool.execute.before`.
 */
export const OPENCODE_RTK_HOW = 'Plugin · tool.execute.before'

/** The environment variable OpenCode reads its extra configuration file from. */
export const CONFIG_ENV = 'OPENCODE_CONFIG'

/** Where this Session's OpenCode config lives, under the app's own `dataDir`. */
const CONFIG_FOLDER = 'opencode'

/** Never on a Session's environment: TinyCorp runs on the boss's own login, not on a key. */
const API_KEY_VARS = ['OPENCODE_API_KEY', 'OPENCODE_AUTH_CONTENT']

export function createOpencodeAdapter({
  hookUrl,
  dataDir,
  spawnPty = nodePtySpawn,
  env = process.env,
  command = 'opencode',
  name = 'OpenCode',
  installed = () => onPath(command, env),
  placement = null,
  runCli = realRunCli,
}: OpencodeAdapterOptions): ProviderAdapter {
  /** The MCP servers each Session was given, by the app's own session id. */
  const mcp = new Map<string, SessionMcp>()

  /**
   * This Session's OpenCode config: its own agent, at its own reasoning effort, and its own MCP
   * servers. The file holds every secret this Session has, so it is written `0600` in a `0700`
   * folder of the app's own — never in the Company folder two Employees share — and `forgetSession`
   * takes it away when the Session ends (T199, finding H5).
   *
   * OpenCode 1.18.31 does substitute `{env:NAME}` anywhere in this file, so the bearer token could
   * ride in the Session's environment the way Codex's does. It does not, on purpose: a sibling
   * process of the same OS user reads another's environment as easily as its file
   * (`/proc/<pid>/environ`, `ps -E`), so that moves the token rather than protecting it, and it
   * would put a substitution pass over the Employee's own instructions.
   */
  function writeSessionConfig(sessionId: string, instructions: string, variant: Effort | null): string {
    const servers = mcp.get(sessionId)
    const entries = {
      ...(servers?.company && {
        [COMPANY_MCP_NAME]: {
          type: 'remote',
          url: servers.company.url,
          headers: { Authorization: `Bearer ${servers.company.token}` },
          enabled: true,
        },
      }),
      ...Object.fromEntries((servers?.granted ?? []).map((server) => [server.name, opencodeMcpEntry(server)])),
    }
    return writeSessionFile(
      dataDir,
      CONFIG_FOLDER,
      sessionId,
      `${JSON.stringify(
        {
          $schema: 'https://opencode.ai/config.json',
          agent: {
            [AGENT_NAME]: {
              description: 'This Employee of the Company.',
              mode: 'primary',
              prompt: instructions,
              // Only for a model the catalogue claims a level for. OpenCode types `variant` as a
              // free-form optional string and validates it nowhere: 1.18.31 takes an invented one
              // without a word and runs at its default. So a guess here is never an error anyone
              // sees — it is an Employee quietly thinking less hard than the catalogue promised.
              ...(variant !== null && { variant }),
            },
          },
          ...(Object.keys(entries).length > 0 && { mcp: entries }),
        },
        null,
        2,
      )}\n`,
    )
  }

  const adapter: ProviderAdapter = {
    spawn(request: SpawnRequest) {
      const { employee, cwd, instructions, sessionId, resume = false, hookToken } = request
      // The plugin is the same for every Employee in the folder: it carries no identity, only the
      // receiver's URL and the RTK this Session rewrites through, and it reads the token off the
      // process it was started with (decision 48). A Session that runs with no RTK writes the same
      // plugin without the rewrite, which is how off means off at the next start (T179).
      const rtk = sessionRtk(adapter, request)
      installOpencodePlugin(cwd, hookUrl, rtk)
      excludeFromGit(cwd, ['.opencode/'])

      // The model is one catalogue entry, and it is spent in two places: the name on the command
      // line, and the effort in the config. A resumed Session writes the config again, so it keeps
      // its level rather than dropping to OpenCode's default every restart.
      const chosen = modelOption(employee.provider, employee.model)
      const config = writeSessionConfig(sessionId, instructions ?? identityLine(employee), chosen?.effort ?? null)
      const args = [
        // OpenCode names its own conversations, so a fresh Session asks for nothing and a resumed
        // one asks for the id the engine learned from this Session's own hooks.
        ...(resume ? ['--session', sessionId] : []),
        ...(chosen ? ['--model', chosen.model] : []),
        '--agent',
        AGENT_NAME,
      ]
      return spawnPty(command, args, {
        cwd,
        env: {
          ...subscriptionEnv(env),
          ...rtkEnv(rtk),
          [HOOK_TOKEN_ENV]: hookToken,
          [CONFIG_ENV]: config,
          ...(resume && { [RESUME_ENV]: sessionId }),
        },
        cols: 120,
        rows: 40,
      })
    },

    /**
     * This Session's MCP servers: the Company's own, and the ones the boss granted this Employee
     * (T136). OpenCode takes no MCP flag — they go into this Session's own config file at spawn,
     * so no secret is ever in `argv` where `ps` can read it, and no file another Employee reads.
     */
    injectMcp(sessionId, servers) {
      mcp.set(sessionId, servers)
      return []
    },

    /**
     * The Session ended: its config file — agent, prompt and every MCP token in it — goes with it
     * (T199, finding H5). Every Employee runs as the same OS user as the app, so a file that
     * outlives its Session is one Employee's bearer token left where every other one can read it.
     */
    forgetSession(sessionId) {
      mcp.delete(sessionId)
      forgetSessionFile(dataDir, CONFIG_FOLDER, sessionId)
    },

    /**
     * The granted skill folders, in `.opencode/skills/` in the Employee's worktree, which is where
     * OpenCode loads a project's skills from (T253). Symlinks, so the boss edits the folder once
     * and every Employee holding it sees the edit; git-excluded, because the app writes into a
     * worktree and never commits (decision 45). Nothing in one is read or run here.
     */
    installSkills(worktree, skills: readonly GrantedSkill[]) {
      syncSkillFolder(worktree, OPENCODE_SKILLS_FOLDER, skills)
    },

    commandRewriteHook: (rtk: RtkHook | null): CommandRewriteHook => ({
      how: OPENCODE_RTK_HOW,
      // OpenCode's plugin API mutates the command the tool is about to run and answers nothing
      // about permission: OpenCode's own approval then fires on the rewritten command, so an
      // Employee that asks first still asks (T179).
      keepsApprovals: true,
      install: (cwd) => installOpencodePlugin(cwd, hookUrl, rtk),
    }),

    resumeCommand: (sessionId) => ['--session', sessionId],

    /**
     * What the boss types to open this Session themselves (T164): `--session` and the model.
     * OpenCode carries no permission flag at all — it is the one thing it takes from neither the
     * command line nor this Employee — so there is none to reproduce and none to drop. The agent
     * this Employee runs as lives in the Session's own config file, which is the app's: the boss
     * gets the conversation, not TinyCorp's half of it.
     */
    handoffCommand(employee, providerSessionId) {
      const chosen = modelOption(employee.provider, employee.model)
      return [command, ...adapter.resumeCommand(providerSessionId)!, ...(chosen ? ['--model', chosen.model] : [])]
    },

    /**
     * Whether the ready signal says the previous conversation was really continued. OpenCode
     * itself says nothing at start-up either way, so the plugin asks OpenCode and answers here;
     * a `session.created` means it opened a new conversation instead, which is a resume that did
     * not take.
     */
    confirmsResume: (hook) => eventOf(hook) === READY_EVENT && propertiesOf(hook)['resumed'] === true,

    detectIdle,

    sessionIdOf(hook) {
      const id = propertiesOf(hook)['sessionID']
      return typeof id === 'string' && id !== '' ? id : null
    },

    detectBudgetExhausted: (output) => LIMIT_WORDS.some((words) => words.test(stripAnsi(output))),

    budgetResetAt: (output, now) => resetAt(stripAnsi(output), now),

    pushPrompt(session, text) {
      session.write(text)
      // The TUI needs a beat between the text landing and the key that sends it.
      setTimeout(() => session.write(SUBMIT_KEY), KEY_DELAY_MS)
    },

    installed,

    /**
     * Whether OpenCode on this Mac can run an Employee (T135). OpenCode holds no subscription of
     * its own: it runs on whichever accounts the boss has signed it in to, so the question is
     * whether `opencode auth list` names any at all.
     */
    checkCli(): Promise<ProviderCheck> {
      return checkProviderCli({
        name,
        command,
        signIn: OPENCODE_SIGN_IN,
        installed,
        runCli,
        env: subscriptionEnv(env),
        placement,
      })
    },
  }
  return adapter
}

/** One granted server as OpenCode's own config: `remote` for `http`, `local` for a command. */
function opencodeMcpEntry(server: GrantedMcpServer): Record<string, unknown> {
  if (server.transport === 'http') {
    // OpenCode takes a `headers` object of its own, so a server that authenticates with named
    // headers (T245) travels in the same `0600` config file the bearer token does.
    const headers = {
      ...server.headers,
      ...server.headerSecrets,
      ...(server.secret && { Authorization: `Bearer ${server.secret}` }),
    }
    return {
      type: 'remote',
      url: server.url,
      ...(Object.keys(headers).length > 0 && { headers }),
      enabled: true,
    }
  }
  return {
    type: 'local',
    command: [server.command, ...server.args],
    environment: {
      ...server.env,
      ...server.secrets,
      ...(server.secret && server.secretEnv && { [server.secretEnv]: server.secret }),
    },
    enabled: true,
  }
}

/**
 * What one of OpenCode's events says about idleness.
 *
 * `session.created` is a conversation beginning, which is as close as OpenCode comes to Claude
 * Code's `SessionStart`; the plugin's own `tinycorp.session.started` covers the start-up OpenCode
 * is silent through. `session.status` carries the turn, and `session.idle` ends it.
 *
 * `permission.asked` is the Session stopping to ask the boss (T165). OpenCode names an approval by
 * what it would do and to what — `{ action: "edit", resources: ["src/api/usage.ts"] }` — which is
 * the ask, in its own words. `permission.replied` is the boss having answered in the terminal, so
 * it reads as the Session going back to work and clears the ask.
 */
export function detectIdle(hook: HookPayload): SessionSignal | null {
  switch (eventOf(hook)) {
    case READY_EVENT:
    case 'session.created':
      return 'ready'
    case 'session.idle':
      return 'idle'
    case 'permission.asked':
      return asking(opencodeAsk(propertiesOf(hook)))
    case 'permission.replied':
      return 'busy'
    case 'session.status': {
      const status = propertiesOf(hook)['status']
      const type = isRecord(status) ? status['type'] : null
      if (type === 'busy') return 'busy'
      return type === 'idle' ? 'idle' : null
    }
    default:
      return null
  }
}

/** What an approval is asking for when OpenCode names nothing the boss would recognise. */
export const OPENCODE_PERMISSION_ASK = 'a permission'

/** `edit src/api/usage.ts`: what one `permission.asked` would do, and to what. */
function opencodeAsk(properties: Record<string, unknown>): string {
  const action =
    opencodeText(properties['action']) ?? opencodeText(properties['permission']) ?? opencodeText(properties['type'])
  const resources = Array.isArray(properties['resources'])
    ? properties['resources']
    : Array.isArray(properties['patterns'])
      ? properties['patterns']
      : []
  const target = resources.map(opencodeText).find((one) => one !== null)
  if (!action) return target ?? OPENCODE_PERMISSION_ASK
  return target ? `${action} ${target}` : action
}

function opencodeText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/** OpenCode's event name, which its plugin API calls `type` and the receiver stores as the hook. */
function eventOf(hook: HookPayload): string | null {
  if (typeof hook['type'] === 'string') return hook['type']
  return typeof hook.hook_event_name === 'string' ? hook.hook_event_name : null
}

/** Every OpenCode event's payload sits under `properties`. */
function propertiesOf(hook: HookPayload): Record<string, unknown> {
  return isRecord(hook['properties']) ? hook['properties'] : {}
}

/**
 * The words a subscription limit arrives in. OpenCode fronts several products, so these are its
 * own copy (`Usage limit reached`, `Free usage exceeded`) and the sentences it relays from the
 * account the boss signed in with. Everything here names a limit that is spent, never a transient
 * throttle: a bare HTTP 429 parks a working Employee for no reason.
 */
const LIMIT_WORDS: readonly RegExp[] = [
  /usage limit (reached|exceeded)/i,
  /free (usage exceeded|limit reached)/i,
  /exceeded your (monthly|premium request) /i,
  /quota exceeded/i,
  /out of (credits|premium requests)/i,
]

/** `resets at 3pm`, `try again at 15:30`, `resets in 2h 15m` — whichever the account's words use. */
export function resetAt(output: string, now: Date): Date | null {
  return atClockTime(output, now) ?? afterDuration(output, now)
}

/** Where a message names the time a limit comes back. */
const RESETS_AT = /\b(?:resets?|try again|available again|back)\s+(?:at|on)\s+/i

/** A clock time the message names, read as the next time that clock reads it. */
function atClockTime(output: string, now: Date): Date | null {
  // A timestamp the account spelled out in full, which carries its own offset and its own day.
  const stamp = new RegExp(`${RESETS_AT.source}(\\d{4}-\\d{2}-\\d{2}[T ][\\d:.]+(?:Z|[+-]\\d{2}:?\\d{2})?)`, 'i').exec(
    output,
  )
  if (stamp) {
    const at = new Date(stamp[1]!)
    return Number.isNaN(at.getTime()) ? null : at
  }

  const named = new RegExp(`${RESETS_AT.source}([^.,;\\n)]+)`, 'i').exec(output)
  if (!named) return null
  const text = named[1]!.trim()

  const clock = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(text)
  if (!clock) return null
  const hours = Number(clock[1])
  const minutes = clock[2] ? Number(clock[2]) : 0
  const half = clock[3]?.toLowerCase()
  if (hours > 23 || minutes > 59 || (half && hours > 12)) return null
  const hour = half === 'pm' ? (hours % 12) + 12 : half === 'am' ? hours % 12 : hours
  const at = new Date(now)
  at.setHours(hour, minutes, 0, 0)
  // A clock time already past is tomorrow's.
  if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1)
  return at
}

/** A duration the message names — `in 2h 15m`, `in 45 minutes` — counted from `now`. */
function afterDuration(output: string, now: Date): Date | null {
  const named = /\b(?:resets?|try again|available again|back|wait)\s+(?:in|after)\s+([^.,;\n)]+)/i.exec(output)
  if (!named) return null
  const parts = [...named[1]!.matchAll(/(\d+)\s*(h(?:ours?|rs?)?|m(?:in(?:ute)?s?)?|s(?:ec(?:ond)?s?)?)\b/gi)]
  if (parts.length === 0) return null
  const ms = parts.reduce((total, [, amount, unit]) => {
    const scale = unit!.toLowerCase().startsWith('h') ? 3_600_000 : unit!.toLowerCase().startsWith('m') ? 60_000 : 1000
    return total + Number(amount) * scale
  }, 0)
  return ms === 0 ? null : new Date(now.getTime() + ms)
}

/**
 * The environment a Session inherits, with OpenCode's own variables stripped.
 *
 * Two rules, and a PR that breaks either is refused: a Session runs on the boss's own login, so
 * `OPENCODE_API_KEY` and the inline `OPENCODE_AUTH_CONTENT` are removed here; and a Session
 * started from inside another one must not adopt its parent's config, server or conversation, so
 * every other `OPENCODE_*` variable goes with them. None of that signs anybody out: OpenCode keeps
 * the boss's login in its XDG data folder (`~/.local/share/opencode/auth.json`), which no
 * `OPENCODE_*` variable names and this adapter never reads.
 *
 * A third rule since T234: another orchestrator's variables go too. OpenCode loads the boss's
 * global plugins from `~/.config/opencode/plugins/`, and `--pure` would take TinyCorp's own status
 * plugin with them, so the strip is what is left — and those plugins read the environment to know
 * whose pane an event belongs to.
 */
export function subscriptionEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(withoutOrchestratorEnv(env)).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && !API_KEY_VARS.includes(entry[0]) && !entry[0].startsWith('OPENCODE'),
    ),
  )
}

/** What an Employee is told when it has no Company brief — a Session started outside a Company. */
function identityLine(employee: Employee): string {
  return (
    `You are ${employee.name}, ${employee.title} at this Company. ${employee.persona} ` +
    'Messages from the Company arrive as prompts prefixed "[company]".'
  ).trim()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * How OpenCode is asked where it stands. It fronts other products rather than being one, so
 * `opencode auth list` is the question — it prints the accounts the boss has signed in to — and
 * there is no key of OpenCode's own to be signed in on, only the upstream accounts' own.
 */
export const OPENCODE_SIGN_IN: ProviderSignIn = {
  statusArgs: ['auth', 'list'],
  installWith: 'npm install -g opencode-ai',
  signInWith: 'opencode auth login',
  verdict: opencodeVerdict,
  identity: opencodeIdentity,
}

/**
 * Who `opencode auth list` says is signed in (T141). OpenCode holds no subscription of its own —
 * it runs on whichever accounts the boss already has — so the account here is those accounts, by
 * the names OpenCode itself prints, and there is no plan for it to name.
 */
export function opencodeIdentity(outcome: CliOutcome): ProviderIdentity {
  if (outcome.kind !== 'output') return NO_IDENTITY
  const accounts = credentialLines(stripAnsi(outcome.output)).map(credentialAccount)
  return { account: accounts.length > 0 ? nameList(accounts) : null, plan: null }
}

/**
 * What `opencode auth list` said. It prints one line per credential under a `Credentials` heading
 * and says so plainly when there are none; anything that did not answer is not a login.
 */
export function opencodeVerdict(outcome: CliOutcome): SignInVerdict {
  if (outcome.kind !== 'output') return 'none'
  const text = stripAnsi(outcome.output)
  if (/\bno\s+(credentials|providers|accounts)\b/i.test(text)) return 'none'
  return credentialLines(text).length > 0 ? 'subscription' : 'none'
}

/**
 * The rows of `opencode auth list`: one credential per line under the heading, each `<account>
 * <method>`.
 *
 * The real CLI draws a box around them and bullets each row — `●  GitHub Copilot oauth` — and
 * closes with `└  1 credentials`, so the borders come off, the count at the foot is not a
 * credential, and neither is the sentence it prints when there are none.
 */
function credentialLines(text: string): string[] {
  const lines = text.split('\n').map((line) => unboxed(stripAnsi(line)))
  const heading = lines.findIndex((line) => /^credentials\b/i.test(line))
  if (heading === -1) return []
  return lines
    .slice(heading + 1)
    .filter((line) => !/^\d+\s+credentials?\b/i.test(line))
    .filter((line) => !/^no\s+(credentials|providers|accounts)\b/i.test(line))
    .filter((line) => /^[a-z0-9][\w.@/ -]*\s+\S+$/i.test(line))
}

/** One row without the box the CLI draws around it. */
function unboxed(line: string): string {
  return line.replace(/^[\s\u2022\u25CB\u25CF\u2500-\u257F|]+/, '').trim()
}

/** `GitHub Copilot oauth` → `GitHub Copilot`: the row without the method it was signed in by. */
function credentialAccount(line: string): string {
  return line.replace(/\s+\S+$/, '').trim()
}
