import { resolve } from 'node:path'
import type { McpTransport } from '../../shared/catalogue/mcp-servers'
import type { Employee, Provider } from '../../shared/domain/staff'
import type { ProviderCheck } from '../../shared/providers/preflight'
import type { RtkHook } from '../../shared/rtk'
import { ASK_WHAT_MAX } from '../../shared/session'
import type { PtySession, PtySpawnOptions, SpawnPty } from '../platform'

/**
 * A PTY is the machine's (`main/platform/pty.ts`), not a Provider's. It is re-exported here
 * because an adapter is declared in terms of one, so a new Provider reads one file (T186a).
 */
export type { PtySession, PtySpawnOptions, SpawnPty }

export interface SpawnRequest {
  employee: Employee
  cwd: string
  /**
   * This Employee's whole system prompt, rendered by the engine (T184). The adapter puts it on the
   * process itself, never into a file: two Employees share the `cwd`, so a file there would be
   * read by both. Absent when the engine has nothing to say about the Company yet, and the adapter
   * then falls back to the Employee's own name.
   *
   * What goes in it is the Company's business, so no adapter builds it and none of them imports
   * the renderer.
   */
  instructions?: string
  /**
   * Set when this is a Session an Employee started for one piece of its ticket (T163), naming that
   * piece. Every adapter spawns it exactly like an Employee's own Session — it is here because the
   * engine and the fakes at this seam have to tell the two apart, and reading the prompt to do it
   * would be worse.
   */
  subSession?: { name: string }
  /** App-chosen provider session id, of the shape {@link isProviderSessionId} holds adapters to. */
  sessionId: string
  /** Continue the session `sessionId` instead of starting it. */
  resume?: boolean
  /**
   * Secret the Session's hooks send back to the hook receiver, so the engine knows
   * which Session a hook belongs to even when several Sessions share a cwd.
   */
  hookToken: string
  /**
   * The sign-in this Session runs as (T173), or absent for the product's own default one. The
   * adapter puts {@link ProviderAdapter.configDirEnv} on the process for it; nothing else about
   * an account reaches a Session, and no credential ever passes through here.
   */
  account?: SpawnAccount
  /**
   * The RTK this Session's shell commands are rewritten through (T179), or absent when the Company
   * has compression off, RTK is not on this machine, or it is too old. The adapter is handed it and
   * decides nothing about it beyond how its own product hooks a command rewrite.
   */
  rtk?: RtkHook
}

/** The account a Session is spawned as: an id for the log, and the directory the CLI reads. */
export interface SpawnAccount {
  id: string
  /** The config directory this sign-in lives in. The CLI signed in there; TinyCorp never read it. */
  configDir: string
}

/**
 * One MCP server the boss granted this Employee (T136), as the adapter has to write it. It is the
 * only place a secret travels through the seam: it goes into the environment the process is
 * spawned with, or into a config file the adapter writes with mode `0600`, and never into `argv`.
 */
export interface GrantedMcpServer {
  /** The key it is written under. Unique in the Session, and never `company`. */
  name: string
  transport: McpTransport
  /** `http`: where the server is. */
  url: string
  /** `stdio`: the command to spawn, and its arguments. */
  command: string
  args: string[]
  /** `stdio`: extra environment for the command. Holds nothing secret. */
  env: Record<string, string>
  /** `stdio`: the variable {@link secret} arrives under. Empty for `http`. */
  secretEnv: string
  /** The token from the OS keychain — a bearer token for `http` — or null when it has none. */
  secret: string | null
  /**
   * `stdio`: further named values from the OS store, to be merged into the server's environment
   * beside {@link env}. This is how an imported server's environment travels (T235) — TinyCorp
   * cannot tell which of its values are secret, so it treats every one of them as one and none of
   * them is ever in the Company database. Empty for a server the boss typed in.
   */
  secrets: Record<string, string>
  /**
   * `http`: headers to send with every request, whose values hold nothing secret (T245). SigNoz's
   * `X-SigNoz-URL` is one: the server has to be told which instance is the boss's own.
   */
  headers: Record<string, string>
  /**
   * `http`: further headers whose **values** come from the OS store, to be sent beside
   * {@link headers} (T245). This is how a server that authenticates with named headers rather than
   * a bearer token is reached — Datadog's `DD_API_KEY` and `DD_APPLICATION_KEY`, SigNoz's
   * `SIGNOZ-API-KEY`. Every one of these is a secret and none of them may reach `argv`, which is
   * the only reason it is a second field rather than more of {@link headers}: a product that takes
   * its configuration on the command line has to put these somewhere else.
   */
  headerSecrets: Record<string, string>
}

/**
 * One skill folder the boss granted this Employee (T137), as the adapter is handed it: a name and
 * the folder on this Mac. Nothing in it is parsed, validated or run by TinyCorp — the agent opens
 * it at its own discretion, like any other file in its worktree.
 */
export interface GrantedSkill {
  /** The folder name the agent sees it under, inside the product's own skills folder. */
  name: string
  /** Absolute path of the boss's own folder. Never copied into the Company. */
  path: string
  /** Whether the folder is gone from this Mac. A missing skill is left out and fails no spawn. */
  missing?: boolean
}

/** Everything one Session's MCP configuration is built from. */
export interface SessionMcp {
  /**
   * The Company's own server: chat, the board, approvals. Null when the engine gives this Session
   * none, which is a Session with no hands.
   */
  company: { url: string; token: string } | null
  /** The catalogue servers this Employee holds, in catalogue order. Empty for most Employees. */
  granted: readonly GrantedMcpServer[]
}

/** What a provider hook POSTs to the hook receiver: the hook's stdin JSON. */
export interface HookPayload {
  hook_event_name?: string
  session_id?: string
  notification_type?: string
  [key: string]: unknown
}

/**
 * The Session stopped in its own terminal to ask the boss before it acts (T165), and what it asks.
 * The app never answers it and never types y/n: it only says who is waiting, and on what.
 */
export interface AskSignal {
  kind: 'asking'
  /**
   * What the Session asks, in the product's own words: the tool and its target, such as
   * `Write src/api/usage.ts`. Clipped to {@link ASK_WHAT_MAX} — a permission hook can carry a whole
   * command, and none of it belongs in a notification.
   */
  what: string
}

/**
 * What a hook means for the status machine. `ready` is the startup signal,
 * the engine turns it into `idle` after a short delay; an {@link AskSignal} is the Session stopping
 * to ask the boss, which the next `busy`, `idle` or `ready` signal clears.
 */
export type SessionSignal = 'ready' | 'busy' | 'idle' | AskSignal

/** The ask a signal carries, or null when the signal says nothing about one. */
export function askOf(signal: SessionSignal | null | undefined): AskSignal | null {
  return typeof signal === 'object' && signal?.kind === 'asking' ? signal : null
}

/** One ask, as an adapter builds it: the words clipped to what a boss reads. */
export function asking(what: string): AskSignal {
  const line = what.replace(/\s+/g, ' ').trim()
  return {
    kind: 'asking',
    what: line.length <= ASK_WHAT_MAX ? line : `${line.slice(0, ASK_WHAT_MAX - 1).trimEnd()}\u2026`,
  }
}

/**
 * What a hook says about a subagent the Session runs inside its own process (T162), in words that
 * belong to no one Provider. The engine keeps the model; the adapter only translates.
 *
 * A product tells the two halves apart: the parent's *call* (the tool it asked with, carrying the
 * task) and the *agent* that then runs (its own id, which its tool hooks carry). `called` and
 * `returned` share a `callId`; `started`, `tool` and `stopped` share an `agentId`. A `returned`
 * that names its agent pairs the two for certain; until one does, an agent is paired with the
 * oldest call of its `type` still waiting for one. `settled` is the parent's own turn ending, so a
 * subagent whose stop was lost does not show as running until the Session ends.
 */
export type SubagentSignal =
  | { kind: 'called'; callId: string; type: string | null; name: string; task: string }
  | { kind: 'started'; agentId: string; type: string | null }
  | { kind: 'tool'; agentId: string; now: string; file: string | null }
  | {
      kind: 'returned'
      callId: string
      agentId: string | null
      /** The call came back at once and the agent works on: its `stopped` is what ends it. */
      background: boolean
    }
  | { kind: 'stopped'; agentId: string }
  | {
      /**
       * The parent's turn is over. A call no agent answered by now never will be; and when the
       * product lists the agents still working, `running`, any other one has stopped, whether or
       * not its own stop was heard. Null when the product does not say.
       */
      kind: 'settled'
      running: string[] | null
    }

/**
 * How a product holds more than one sign-in (T173). A Provider whose CLI has no config directory
 * of its own leaves {@link ProviderAdapter.accounts} out; it then runs on one sign-in, and the
 * Accounts card says so rather than offering an `Add another account` that would do nothing.
 */
export interface ProviderAccountSupport {
  /** The variable its CLI reads its config directory from, e.g. `CLAUDE_CONFIG_DIR`. */
  env: string
  /** Where it keeps its sign-in when that variable is unset, e.g. `~/.claude`. */
  defaultDir: string
  /**
   * Marks `folder` trusted in the config inside `configDir`, so the product never stops a sign-in to
   * ask about it (T263). Called only for a config folder TinyCorp made, and only for the empty
   * folder TinyCorp runs its sign-ins in — never for the boss's own config. `folder` is spelled the
   * way the product sees it, which inside a WSL distro is the Linux path. Left out by a product that
   * asks no such thing.
   */
  trustFolder?(configDir: string, folder: string): void
  /**
   * The address the product wrote beside its login in `configDir`, or null where it wrote none
   * (T263). A file read and never a subprocess, so every account in a list can carry one. The
   * login itself is never read here.
   */
  email?(configDir: string): string | null
}

/**
 * How one product runs every shell command through RTK before it runs it (T179).
 *
 * A Provider that has no such thing leaves {@link ProviderAdapter.commandRewriteHook} out, and the
 * Tokens tab says *not hooked* for it rather than the app pretending the toggle did something.
 */
export interface CommandRewriteHook {
  /** One line for the Tokens tab's own row: `Bash hook · rewrites git status → rtk git status`. */
  how: string
  /**
   * Whether a rewritten command still stops at this product's approval — and so at TinyCorp's, and
   * at the *needs you* notification — when the Employee asks first rather than skipping permissions.
   *
   * False is an answer, not a gap: that Employee is left unhooked, because compressing what an
   * Employee reads is worth nothing next to a `git push` that went out without being asked about.
   */
  keepsApprovals: boolean
  /**
   * Writes the rewrite into the Session's own config in `cwd`, beside our status hooks and never in
   * the boss's global one. Called with the RTK the Session really runs with, or with none — the
   * Company turned it off, RTK went away, or this Employee asks first and this product cannot
   * promise the approval — in which case it takes whatever rewrite is there back out, because off
   * means off at the next start.
   */
  install(cwd: string): void
}

/**
 * The RTK this Session really runs with, or null.
 *
 * One rule, read by every adapter and by the conformance suite, so what is checked and what is
 * spawned cannot drift: RTK has to be on the request, this product has to have a rewrite at all,
 * and an Employee that asks first only gets one from a product that keeps its approvals.
 */
export function sessionRtk(adapter: ProviderAdapter, request: SpawnRequest): RtkHook | null {
  if (!adapter.commandRewriteHook || !request.rtk) return null
  if (request.employee.permissionMode !== 'interactive') return request.rtk
  return adapter.commandRewriteHook(request.rtk).keepsApprovals ? request.rtk : null
}

/** The seam between the Company engine and one CLI product. */
export interface ProviderAdapter {
  /**
   * Prepares the cwd (hooks) and starts the CLI in a PTY, with the Employee's instructions on the
   * process itself. Nothing Employee-specific is written into the cwd.
   */
  spawn(request: SpawnRequest): PtySession
  /**
   * Writes an MCP config for this Session and returns the CLI args that load it. An adapter that
   * names a file after `sessionId` runs it through {@link requireProviderSessionId} first: the id
   * can have come back from a hook, and a hook is written by the Session itself (T199-H1).
   */
  injectMcp(sessionId: string, servers: SessionMcp): string[]
  /**
   * Optional (T199, finding H5). The Session is over: take away whatever was written for it and
   * forget whatever is held for it in memory — the MCP config Claude Code reads, the Session
   * config OpenCode reads, the bearer token Codex keeps to put on the next spawn.
   *
   * The engine calls it wherever it ends a Session, and calls it for a Session that was never
   * given an MCP server at all, so it is written to find nothing and say nothing. It is the
   * difference between a token that is readable by every other Employee *while the Session runs*
   * and one that is readable for the life of the install: every Employee is a process of the same
   * OS user as the app, so `0600` and a per-Session name are housekeeping, not a boundary.
   *
   * A Provider that writes nothing and holds nothing may leave it out. One whose `injectMcp` (or
   * `spawn`) puts a secret on the disk must implement it, and the conformance suite reads the
   * whole of `dataDir` back afterwards to say so.
   */
  forgetSession?(sessionId: string): void
  /**
   * Optional (T137). Makes the granted skill folders available in `worktree`, where this product
   * looks for them — Claude Code reads `.claude/skills/` — and takes away the ones the boss no
   * longer grants. It is called with the whole grant every time, so it reconciles rather than
   * adds, and it links rather than copies where the platform allows: the boss edits the folder
   * once and every Employee holding it sees the edit.
   *
   * A Provider whose product reads no skill folders leaves this out. That is an answer, not a
   * gap: the Employee's drawer then says `<Provider> — no skills` rather than the app pretending
   * the grant did something. Leaving it out and naming a `skillsFolder` in the catalogue (or the
   * other way round) is the one thing that is wrong, and a test says so.
   *
   * Nothing in a skill folder is executed when it is granted, here or anywhere else.
   */
  installSkills?(worktree: string, skills: readonly GrantedSkill[]): void
  /**
   * Optional (T179). How this product is made to run its shell commands through RTK, given the RTK
   * a Session runs with — or given null, which is the same question with the answer *not at all*.
   *
   * It is called at every spawn, and it is called with null too: a Company that turns the toggle
   * off has to stop being compressed, and the hook file it was written into is in the Company
   * folder and outlives the Session that wrote it.
   *
   * A Provider whose product cannot rewrite a command leaves this out. That is an answer: its row
   * on the Tokens tab reads *not hooked*, and its Employees read what their commands really print.
   */
  commandRewriteHook?(rtk: RtkHook | null): CommandRewriteHook
  /** The CLI args that continue `sessionId`, or null when the provider cannot resume. */
  resumeCommand(sessionId: string): string[] | null
  /**
   * Optional (T164). The whole command the boss types in their own terminal to open this
   * Employee's Session: the CLI, the args that continue `providerSessionId`, and the same
   * permission and model args {@link spawn} puts on it — so what the boss gets behaves like what
   * the drawer shows. `claude --resume <id>` typed by hand drops the skip flag, which is the bug
   * this exists for.
   *
   * It carries none of the app's own half of a Session: no MCP config, no hook token and no
   * appended system prompt. Those belong to the Session TinyCorp runs, not to the boss's terminal.
   *
   * Null when this Provider cannot hand a Session over — its CLI cannot resume, or it cannot be
   * driven from a terminal the app did not start. The drawer then draws no button and says
   * nothing. Leaving the method out says the same thing.
   *
   * It builds a command. It never runs one, and nothing here spawns anything.
   */
  handoffCommand?(employee: Employee, providerSessionId: string): string[] | null
  /**
   * For a Session spawned to resume: whether its `ready` hook says the previous conversation was
   * continued. Without it, every `ready` hook counts as a confirmation.
   */
  confirmsResume?(hook: HookPayload): boolean
  /**
   * Maps a hook to a status signal, or null when the hook says nothing about idleness.
   *
   * A product whose CLI stops to ask the boss before it acts maps that event to an
   * {@link AskSignal} too, built with {@link asking} (T165) — and maps whatever it sends next onto
   * `busy` or `idle`, which is what clears the ask. A product that cannot tell us it is asking
   * says so in `docs/providers.md` rather than having the app guess.
   */
  detectIdle(hook: HookPayload): SessionSignal | null
  /**
   * Optional (T162). What a hook says about a subagent this Session runs inside its own process,
   * or null when it says nothing about one. It reads; it never starts anything.
   *
   * A Provider whose product has no subagents leaves this out, and the Employee's drawer draws no
   * strip for it. Keep only what the boss reads — the task's name, its first line, the command it
   * is running — clipped short: a hook can carry a whole prompt, and none of it belongs here.
   */
  subagentOf?(hook: HookPayload): SubagentSignal | null
  /**
   * The provider's own id for the conversation a hook came from, when the product names its
   * sessions itself rather than taking the app's. Without it, the hook's `session_id` is read.
   */
  sessionIdOf?(hook: HookPayload): string | null
  /**
   * Optional (T173). How this product holds more than one sign-in. Leaving it out is an answer:
   * the Provider keeps one account, `Add another account` is not drawn, and every Session runs on
   * whatever the boss signed the CLI in as.
   *
   * An adapter that answers this also answers {@link configDirEnv} and puts it on every spawn, and
   * a conformance check holds the three together.
   */
  accounts?(): ProviderAccountSupport
  /**
   * Optional (T173). The environment that points this product's CLI at one account's config
   * directory. It names a directory and nothing else: no credential is read, written or carried.
   */
  configDirEnv?(configDir: string): Record<string, string>
  /** True when terminal or hook output says the subscription limit was hit. */
  detectBudgetExhausted(output: string): boolean
  /** When the limit named in `output` resets, relative to `now`, or null when it names no time. */
  budgetResetAt(output: string, now: Date): Date | null
  /** Types `text` into the Session and submits it. */
  pushPrompt(session: PtySession, text: string): void
  /** Whether the product's CLI is on this machine. An Employee on a missing one is never spawned. */
  installed(): boolean
  /**
   * Whether this product's CLI can run an Employee at all, and the product's own words for fixing
   * it when it cannot (T135): is the command here, is the boss signed in, and on what.
   *
   * It is a subprocess with a timeout, and nothing in it may spend the boss's subscription. The
   * caller asks once on start and caches the answer, so no render path and no Session start ever
   * waits on it; `Check again` is the only thing that asks a second time.
   */
  checkCli(): Promise<ProviderCheck>
}

/**
 * The shape of a provider session id: a short opaque token, which is what every product this app
 * has met writes and what it writes itself (a UUID). It is deliberately narrower than *a string*,
 * because the id is spent twice over — as a token in a CLI's argv, and as a path component in the
 * file a Session is spawned with — so it may not open with `-`, where a parser reads it as a flag
 * instead of a value, and may hold no `/`, `\\` or anything else `join` would walk out on.
 */
const PROVIDER_SESSION_ID = /^[A-Za-z0-9._][A-Za-z0-9._-]{0,127}$/

/** Whether `value` is a provider session id this app would have written or spent (T199-H1). */
export function isProviderSessionId(value: string): boolean {
  return PROVIDER_SESSION_ID.test(value)
}

/**
 * `value` as a provider session id, or a throw. This is the last line before the id becomes argv
 * or a path: everything that reaches it has been checked already, so one that has not is a bug in
 * this app and not something to tell the boss about.
 */
export function requireProviderSessionId(value: string, what: string): string {
  if (!isProviderSessionId(value)) throw new Error(`${what}: ${JSON.stringify(value)} is not a provider session id`)
  return value
}

/**
 * The provider session id a hook belongs to, or null when it names none. Claude Code takes the
 * app's id and echoes it back as `session_id`; a product that names its own conversations reads
 * it out of its own payload instead.
 *
 * A hook names its own Session and a Session holds its own hook token by design, so this string
 * is one an Employee can choose (T199-H1). An id of another shape is refused rather than tidied:
 * it is not an id this app wrote a settings file for, and the Session it claims to be keeps the
 * id it already had.
 */
export function hookSessionId(adapter: ProviderAdapter, hook: HookPayload): string | null {
  const named = adapter.sessionIdOf
    ? adapter.sessionIdOf(hook)
    : typeof hook.session_id === 'string'
      ? hook.session_id
      : null
  return named !== null && isProviderSessionId(named) ? named : null
}

/**
 * The environment a Session takes to run as one account, or an empty one for a Provider that keeps
 * a single sign-in. One rule, read by the engine and by every adapter, so what the conformance
 * suite checks and what a Session is spawned with cannot drift.
 */
export function accountEnv(adapter: ProviderAdapter, account: SpawnAccount | undefined): Record<string, string> {
  if (!account) return {}
  return configDirVars(adapter, account.configDir)
}

/**
 * The variables that point a CLI at one config directory — and none at all for the directory it
 * uses when the variable is unset. That is not a nicety: Claude Code on macOS keys its keychain
 * login by whether `CLAUDE_CONFIG_DIR` is set, so naming `~/.claude` explicitly reads a different,
 * empty keychain entry and a boss who is signed in shows as signed out.
 */
export function configDirVars(adapter: ProviderAdapter, configDir: string): Record<string, string> {
  if (!adapter.accounts) return {}
  const support = adapter.accounts()
  if (sameDir(configDir, support.defaultDir)) return {}
  if (adapter.configDirEnv) return adapter.configDirEnv(configDir)
  return { [support.env]: configDir }
}

/** Whether `configDir` is the folder the product uses when nothing names another. */
export function isDefaultDir(support: ProviderAccountSupport, configDir: string): boolean {
  return sameDir(configDir, support.defaultDir)
}

function sameDir(a: string, b: string): boolean {
  const norm = (p: string) => resolve(p).replace(/[\\/]+$/, '')
  return process.platform === 'win32' || process.platform === 'darwin'
    ? norm(a).toLowerCase() === norm(b).toLowerCase()
    : norm(a) === norm(b)
}

/**
 * One adapter per Provider a Session can run on, or none where this machine has no CLI for it.
 *
 * Partial because the catalogue is what a Company may hire on and this is what it can spawn today;
 * `createProviderAdapters` refuses a set that is missing an entry the catalogue names. It lived in
 * `features/sessions` until T188, where the seam was reaching up into the feature it serves for the
 * shape of its own map.
 */
export type ProviderAdapters = Partial<Record<Provider, ProviderAdapter>>
