import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { McpTransport } from '../../shared/catalogue/mcp-servers'
import type { Employee, Provider } from '../../shared/domain/staff'
import { PREFLIGHT_STILL_OPENS, preflightBlocks } from '../../shared/providers/preflight'
import { RTK_DB_ENV, RTK_TELEMETRY_ENV, type RtkHook } from '../../shared/rtk'
import { type CliOutcome, type RunCli, untranslatePaths, WSL_LOGIN_SCRIPT, wslRunCli, wslSpawnPty } from '../platform'
import {
  askOf,
  type GrantedMcpServer,
  type GrantedSkill,
  type HookPayload,
  hookSessionId,
  isProviderSessionId,
  type ProviderAdapter,
  type PtySession,
  type PtySpawnOptions,
  type SpawnPty,
} from './provider-adapter'
import { HOOK_TOKEN_ENV } from './provider-hooks'

/**
 * What every Provider adapter has to do, as one suite each of them runs.
 *
 * The point is not to test an adapter twice: it is that the second adapter breaks in the same
 * place as the first. Everything here is asserted against a fake process, never a real CLI — no
 * test may spend the boss's subscription. The real-CLI checks live in `pnpm test:claude`.
 *
 * Every assertion carries a sentence written for someone who has never read this file: a stranger
 * filling in `providers/example/` should learn what is missing and which part of the contract it
 * belongs to from the failure alone — `resume: the adapter started a fresh conversation …`, not a
 * diff of two objects. {@link CONFORMANCE_CHECKS} is that contract, in order.
 */

/** The app-chosen session id the suite spawns with. */
export const CONFORMANCE_SESSION_ID = '11111111-2222-3333-4444-555555555555'
/** The token this Session's hooks carry back to the receiver. */
export const CONFORMANCE_HOOK_TOKEN = 'tok-conformance'
/** The second Session the isolation checks spawn beside the first. */
const OTHER_SESSION_ID = 'aaaaaaaa-2222-3333-4444-555555555555'

/**
 * The parts of the contract, as `docs/providers.md` names them. A failure says which one it
 * belongs to, so a contributor knows which section of the guide to re-read.
 */
export type ContractPart =
  | 'spawn'
  | 'instructions'
  | 'isolation'
  | 'resume'
  | 'mcp'
  | 'skills'
  | 'model'
  | 'signals'
  | 'limits'
  | 'accounts'
  | 'prompt'
  | 'shutdown'
  | 'install'
  | 'preflight'
  | 'rewrite'

/** One process the adapter started, and the terminal it started it in. */
export interface FakeProcess {
  file: string
  args: string[]
  /**
   * What was really spawned, when the adapter was built for a Provider inside WSL (T167):
   * `wsl.exe` and its envelope. {@link file} and {@link args} are then what the adapter *meant*,
   * unwrapped, so every check in this suite says the same thing in both runtimes.
   */
  raw?: { file: string; args: string[] }
  options: PtySpawnOptions
  /** Everything the adapter wrote into the terminal, in order. */
  written: string[]
  /** Anything the adapter wrote after the process was killed. Always empty. */
  writtenAfterKill: string[]
  killed: boolean
  /** The exit codes delivered to the adapter's own exit listeners, in order. */
  exits: number[]
  /** Simulates the CLI printing `data`. */
  output(data: string): void
}

/** What the suite hands the adapter's factory. */
export interface ConformanceSetup {
  spawnPty: SpawnPty
  /**
   * Runs the Provider's own CLI to answer the preflight. Injected like `spawnPty`, so a check can
   * say what the CLI answered without any product being on the machine — and so no check can
   * spend the boss's subscription.
   */
  runCli: RunCli
  /** The app's own folder, where per-Session files belong — never the Company folder. */
  dataDir: string
  /** Where the hook receiver listens. */
  hookUrl: string
  /** The environment the Session inherits. */
  env: NodeJS.ProcessEnv
}

/**
 * How one Provider answers the suite's questions. Everything an adapter does differently — the
 * flag that carries the instructions, the shape of its hook payload, the words it reports the
 * subscription limit in — is named here, and nowhere else.
 */
export interface ConformanceSpec {
  /**
   * The Provider whose catalogue entry the suite spawns an Employee on. The template in
   * `providers/example/` has no entry of its own yet, so it borrows one and names itself
   * with {@link label}.
   */
  provider: Provider
  /** What the suite calls this adapter, when that is not its Provider's id. */
  label?: string
  /**
   * Run the whole suite with this adapter inside a WSL distro (T167). Every check then holds
   * against a CLI started through `wsl.exe` — the contract is the contract wherever the CLI is —
   * and {@link FakeProcess.raw} carries the envelope for the checks that are about it.
   */
  runtime?: { distro: string }
  /** The CLI the adapter runs. */
  command: string
  create(setup: ConformanceSetup): ProviderAdapter
  /** The Employee's instructions as they ride on the process, or null when they are not on it. */
  instructionsOn(process: FakeProcess): string | null
  /** Whether the process was started to continue `sessionId`. */
  continues(process: FakeProcess, sessionId: string): boolean
  /** Whether the process was started fresh, continuing nothing. */
  startsFresh(process: FakeProcess): boolean
  /** The Company MCP server the process was given, read back from wherever the adapter put it. */
  mcpOn(process: FakeProcess): { url: string; token: string } | null
  /**
   * The granted servers the process was given (T136), read back from wherever the adapter really
   * put them — the command line, the environment or a file — in the order it wrote them.
   */
  grantedOn(process: FakeProcess): ReadBackServer[]
  /**
   * Optional (T137): the names of the skill folders a Session working in `worktree` can read,
   * in the order this product would find them, read back from wherever `installSkills` put them.
   *
   * A Provider whose product reads no skill folders leaves this out, and leaves `installSkills`
   * out of its adapter with it. The suite holds the two together: an adapter that installs skills
   * nobody can read back is untested, and a spec that reads back skills nothing installs is a
   * promise to the boss that the product never kept.
   */
  skillsIn?(worktree: string): string[]
  /**
   * Optional (T179): the RTK command rewrite this product's Session config in `cwd` carries, as the
   * line that would run, or null when it carries none.
   *
   * A Provider whose product cannot rewrite a command leaves this out, and leaves
   * `commandRewriteHook` out of its adapter with it. The suite holds the two together: an adapter
   * that writes a rewrite nobody can read back is untested, and a spec that reads one back that
   * nothing writes is a promise on the Tokens tab that the product never kept.
   */
  rewriteIn?(cwd: string): string | null
  /**
   * Optional (T179), and required of a Provider that claims `keepsApprovals`: the signal this
   * product sends when a Session stops to ask the boss about a **rewritten** command, and the words
   * that ask should read as.
   *
   * It is the other half of *permissions never widen*: the rewrite happens, and the Employee that
   * asks first still asks, on the command it will really run.
   */
  rewriteAsk?: { hook: HookPayload; what: string }
  /** The model and effort the process was told to use, as the CLI names them; null when it names none. */
  modelOn(process: FakeProcess): { model: string; effort: string | null } | null
  /** A model from this Provider's catalogue, and what its CLI should be told for it. */
  model: { id: string; model: string; effort: string | null }
  /** The Provider's own signals, as the hook receiver delivers them. */
  signals: {
    ready: HookPayload
    busy: HookPayload
    idle: HookPayload
    /** Something the product sends that says nothing about idleness. */
    quiet: HookPayload
  }
  /**
   * Optional (T165): the signal this product sends when a Session stops in its terminal to ask the
   * boss before it acts, and the words the ask should read as — the tool and its target, such as
   * `Write src/api/usage.ts`.
   *
   * A Provider whose product cannot tell us it is asking leaves this out and says so in
   * `docs/providers.md`; its Employees look Working while they wait, which is the old behaviour and
   * an honest one. A Provider that does claim `asking` answers this, and the suite holds it to the
   * other half of the promise: the ask has to clear when the Session moves on.
   */
  asking?: { hook: HookPayload; what: string }
  /** A ready signal that says the previous conversation was continued, and one that says it was not. */
  resumed: { continued: HookPayload; fresh: HookPayload }
  /** The provider session id every signal above belongs to. */
  signalSessionId: string
  /**
   * What this product's CLI says when it is asked whether the boss is signed in — signed in on the
   * subscription, and signed out — copied from its own output.
   */
  signIn: { in: CliOutcome; out: CliOutcome }
  /** What the product prints when the subscription limit is hit, and when that limit resets. */
  limit: { output: string; now: string; resetsAt: string }
  /** Output that says nothing about the subscription limit. */
  ordinary: string
  /** The key the adapter submits a typed prompt with. */
  submit: string
}

/**
 * One granted server as the suite reads it back off a started process. Every Provider spells its
 * configuration differently; this is the same question asked of all of them — which server, where
 * it is, and what secret went with it.
 */
export interface ReadBackServer {
  name: string
  transport: McpTransport
  /** `http`: the URL. `stdio`: the command and its arguments, as one line. */
  target: string
  /** The secret the Session was given for it, or null when it was given none. */
  secret: string | null
  /** The named values it was given beside that secret (T235), read out of its environment. */
  secrets: Record<string, string>
  /**
   * `http`: every header the Session will send with it (T245), whichever side of the product's
   * config the adapter put each one on — a plain value inline, a secret one through a variable.
   * The bearer token is not one of these: it is {@link secret}, whatever header it ends up in.
   */
  headers: Record<string, string>
}

/** The bearer token the granted `http` server of the suite carries. Never in `argv`. */
export const GRANTED_SECRET = 'grant-secret-0a1b2c'

/** The token the granted `stdio` server takes in its environment. Never in `argv` either. */
export const GRANTED_STDIO_SECRET = 'grant-stdio-3d4e5f'

/**
 * The named values an imported `stdio` server carries (T235). A server that came from the boss's
 * own config has no single token: every one of its environment values is kept in the OS store,
 * and an adapter that writes only `secretEnv` hands the Session a tool it cannot authenticate.
 */
export const GRANTED_NAMED_SECRETS = { SENTRY_AUTH_TOKEN: 'grant-named-6g7h8i', SENTRY_ORG: 'grant-named-9j0k1l' }

/**
 * The header a header-authenticated `http` server is called with whose value is plain text (T245).
 * SigNoz has to be told which instance is the boss's own, and there is nothing private in that.
 */
export const GRANTED_HEADERS = { 'X-SigNoz-URL': 'https://acme.us.signoz.cloud' }

/**
 * The headers whose values come out of the OS store (T245). A server that authenticates this way —
 * Datadog, SigNoz — is unreachable without them, and an adapter that drops them hands the Session a
 * tool that answers 401 to everything. Distinctive strings, because one check reads every file and
 * every argument the adapter wrote looking for them.
 */
export const GRANTED_HEADER_SECRETS = { 'SIGNOZ-API-KEY': 'grant-header-2m3n4o' }

/**
 * The servers the suite grants: one of each transport with a secret of its own, one that came from
 * the boss's own config and keeps a value per environment variable (T235), and one that
 * authenticates with named headers rather than a bearer token (T245).
 */
export const CONFORMANCE_GRANTS: GrantedMcpServer[] = [
  {
    name: 'linear',
    transport: 'http',
    url: 'https://mcp.linear.app/mcp',
    command: '',
    args: [],
    env: {},
    secretEnv: '',
    secret: GRANTED_SECRET,
    secrets: {},
    headers: {},
    headerSecrets: {},
  },
  {
    name: 'playwright',
    transport: 'stdio',
    url: '',
    command: 'npx',
    args: ['@playwright/mcp@latest'],
    env: { PLAYWRIGHT_BROWSER: 'chromium' },
    secretEnv: 'PLAYWRIGHT_TOKEN',
    secret: GRANTED_STDIO_SECRET,
    secrets: {},
    headers: {},
    headerSecrets: {},
  },
  {
    name: 'sentry',
    transport: 'stdio',
    url: '',
    command: 'npx',
    args: ['@sentry/mcp-server@latest'],
    env: {},
    secretEnv: '',
    secret: null,
    secrets: GRANTED_NAMED_SECRETS,
    headers: {},
    headerSecrets: {},
  },
  {
    name: 'signoz',
    transport: 'http',
    url: 'https://mcp.us.signoz.cloud/mcp',
    command: '',
    args: [],
    env: {},
    secretEnv: '',
    secret: null,
    secrets: {},
    headers: GRANTED_HEADERS,
    headerSecrets: GRANTED_HEADER_SECRETS,
  },
]

/** {@link CONFORMANCE_GRANTS}, as the suite expects to read them back. */
const GRANTS_READ_BACK: ReadBackServer[] = [
  {
    name: 'linear',
    transport: 'http',
    target: 'https://mcp.linear.app/mcp',
    secret: GRANTED_SECRET,
    secrets: {},
    headers: {},
  },
  {
    name: 'playwright',
    transport: 'stdio',
    target: 'npx @playwright/mcp@latest',
    secret: GRANTED_STDIO_SECRET,
    secrets: {},
    headers: {},
  },
  {
    name: 'sentry',
    transport: 'stdio',
    target: 'npx @sentry/mcp-server@latest',
    secret: null,
    secrets: GRANTED_NAMED_SECRETS,
    headers: {},
  },
  {
    name: 'signoz',
    transport: 'http',
    target: 'https://mcp.us.signoz.cloud/mcp',
    secret: null,
    secrets: {},
    headers: { ...GRANTED_HEADERS, ...GRANTED_HEADER_SECRETS },
  },
]

/**
 * One granted server read back out of a config in Claude Code's own JSON shape, which several
 * products share: `{ type, url, headers }` for `http`, `{ type, command, args, env }` for `stdio`.
 */
export function readBackJsonServer(name: string, entry: JsonServer): ReadBackServer {
  if (entry.url) {
    const header = entry.headers?.['authorization'] ?? entry.headers?.['Authorization'] ?? null
    return {
      name,
      transport: 'http',
      target: entry.url,
      secret: header ? header.replace(/^Bearer /, '') : null,
      secrets: {},
      headers: headersBesidesBearer(entry.headers ?? {}),
    }
  }
  return {
    name,
    transport: 'stdio',
    target: [entry.command ?? '', ...(entry.args ?? [])].filter(Boolean).join(' '),
    secret: secretIn(name, entry.env ?? {}),
    secrets: namedSecretsIn(name, entry.env ?? {}),
    headers: {},
  }
}

/**
 * Every header of an `http` server but the bearer one, which is read back as its secret. A product
 * that writes named headers (T245) writes them here beside it, whatever case it spells `authorization`.
 */
export function headersBesidesBearer(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter(([name]) => name.toLowerCase() !== 'authorization'))
}

/**
 * The command of the first hook under `event` in a product's JSON hook file whose line matches
 * `what`, or null when the file has none. How a spec reads back the RTK rewrite its Session was
 * given (T179): Claude Code and Codex keep hooks in the same shape, under different names.
 */
export function hookCommandFor(file: string, event: string, what: RegExp): string | null {
  if (!existsSync(file)) return null
  const settings = JSON.parse(readFileSync(file, 'utf8')) as { hooks?: Record<string, HookFileEntry[]> }
  for (const entry of settings.hooks?.[event] ?? []) {
    for (const hook of entry.hooks ?? []) {
      if (hook.command && what.test(hook.command)) return hook.command
    }
  }
  return null
}

/** One entry of a product's hook file, as a spec reads it back. */
interface HookFileEntry {
  matcher?: string
  hooks?: { command?: string }[]
}

/** An MCP server as a JSON config holds it, in the shape Claude Code reads. */
export interface JsonServer {
  url?: string
  headers?: Record<string, string>
  command?: string
  args?: string[]
  env?: Record<string, string>
}

/**
 * The secret a `stdio` server was given, out of whatever environment the adapter put it in: the
 * value under the variable the grant named. The suite knows what it granted, so it knows where to
 * look — and finding nothing there is a Session that was handed a tool it cannot authenticate.
 */
export function secretIn(name: string, env: Record<string, string | undefined>): string | null {
  const grant = CONFORMANCE_GRANTS.find((server) => server.name === name)
  return grant?.secretEnv ? (env[grant.secretEnv] ?? null) : null
}

/**
 * The named values a `stdio` server was given (T235), out of whatever environment the adapter put
 * them in. The suite knows what it granted, so it knows every variable to look under; a value that
 * is not there is a server whose environment was written without the half that is secret.
 */
export function namedSecretsIn(name: string, env: Record<string, string | undefined>): Record<string, string> {
  const grant = CONFORMANCE_GRANTS.find((server) => server.name === name)
  const found: Record<string, string> = {}
  for (const variable of Object.keys(grant?.secrets ?? {})) {
    const value = env[variable]
    if (value !== undefined) found[variable] = value
  }
  return found
}

/** The two skill folders the suite grants, as `openConformance` writes them to disk. */
export const CONFORMANCE_SKILL_NAMES = ['review-checklist', 'deploy-runbook'] as const

/**
 * The Company's own server, as every MCP check injects it. The token is a distinctive string, not
 * the word `secret`: one check reads every file the adapter wrote back looking for it.
 */
const COMPANY_SERVER = { url: 'http://127.0.0.1:9000/mcp', token: 'company-bearer-6b7c8d' }

/**
 * The Employee every check spawns, exported so a Provider's own tests can start one on a model of
 * their choosing without inventing a second Employee that drifts from this one.
 */
export const CONFORMANCE_EMPLOYEE: Employee = {
  id: 'emp-1',
  name: 'Ada',
  roleId: 'backend',
  title: 'Backend',
  persona: 'You build APIs.',
  capabilities: ['code'],
  repoFilter: ['*'],
  areas: [],
  mcpServers: [],
  skills: [],
  provider: 'claude',
  permissionMode: 'skip-permissions',
  model: null,
  overrides: [],
  desk: 0,
  sprite: 0,
  createdAt: '2026-09-17T00:00:00.000Z',
}

const ada = CONFORMANCE_EMPLOYEE

const grace: Employee = { ...ada, id: 'emp-2', name: 'Grace', title: 'Tech Lead', persona: 'You plan.' }

/**
 * One Employee's instructions as the engine renders them (`instructions.ts`), cut to the few lines
 * this suite reads. The adapter is handed the text and its whole job is to put it on the process
 * it starts: what goes in it is the Company's business, so nothing here calls the renderer and no
 * adapter imports it (T184).
 */
function conformanceInstructions(employee: Employee): string {
  return [
    `# You are ${employee.name}, ${employee.title} at Acme`,
    '',
    employee.persona,
    '',
    '## Repos',
    '',
    '- **api** (yours): TypeScript, Fastify, pnpm',
    '',
    '## Company tools',
    '',
    'Everything you do here you do through the `company` MCP server.',
  ].join('\n')
}

/**
 * A Session Ada started of her own (T163), for one piece of her ticket. The adapter spawns it like
 * any Session — the engine hands it a worktree for `cwd` and these instructions — so nothing here
 * is new to implement; the check proves it lands where it was sent, as who it was sent.
 */
const SUB_SESSION_NAME = 'tests'

const SUB_SESSION_TASK = 'Write the range picker tests in src/charts/range.test.ts.'

const SUB_SESSION_INSTRUCTIONS = [
  '# You are a Session Ada started, at Acme',
  '',
  'Ada (Backend) is working AC-7 "Usage chart" and started you for one piece of it: "tests".',
  '',
  '## Your task',
  '',
  SUB_SESSION_TASK,
].join('\n')

type SpawnOptions = Parameters<ProviderAdapter['spawn']>[0]

/** One adapter under test, with a fresh temp folder and a fresh set of fake processes. */
export interface ConformanceRun {
  adapter: ProviderAdapter
  /** The Company folder every Session is started in. */
  cwd: string
  /** The app's own folder, where a per-Session file the adapter writes belongs. */
  dataDir: string
  /** A ticket's worktree, where an Employee's skill folders belong (T137). */
  worktree: string
  /** The two skill folders of {@link CONFORMANCE_SKILL_NAMES}, on disk, in catalogue order. */
  skills: GrantedSkill[]
  /** A skill whose folder is not on this Mac: the boss moved it after granting it. */
  movedSkill: GrantedSkill
  /**
   * The boss's own home, for this check alone. Nothing an adapter writes may ever land in it: a
   * product's global config is the boss's and TinyCorp writes per Session (T179).
   */
  home: string
  /** The RTK a hooked Session is spawned with, in this check's own folders. */
  rtk: RtkHook
  /** Every process the adapter has started in this check, in order. */
  processes: FakeProcess[]
  /** Every CLI the adapter ran to answer the preflight, in order. */
  ran: { command: string; args: string[] }[]
  /** What the next CLI the adapter runs will answer. */
  answer(outcome: CliOutcome): void
  /** Starts a Session and hands back its terminal and the process behind it. */
  start(employee?: Employee, over?: Partial<SpawnOptions>): { session: PtySession; process: FakeProcess }
  close(): void
}

/** One question of the contract, and the sentence it fails with. */
export interface ConformanceCheck {
  /** Which part of `docs/providers.md` this belongs to. */
  contract: ContractPart
  /** What the check asks, as the test name reads it. */
  title: string
  run(run: ConformanceRun, spec: ConformanceSpec): void | Promise<void>
}

/**
 * Another orchestrator's own variables, as TinyCorp really inherits them (T234): the app is
 * started from the boss's shell, and Orca or Conductor were driving that shell. Every adapter is
 * spawned with these on its inherited environment, and the `isolation` check reads the spawned
 * process back to say none of them survived.
 */
export const CONFORMANCE_ORCHESTRATOR_ENV = {
  ORCA_PANE_KEY: 'pane-7',
  ORCA_AGENT_HOOK_TOKEN: 'another-app-s-bearer-token',
  CONDUCTOR_WORKSPACE_NAME: 'the-boss-s-other-workspace',
} as const

/** A check that did not hold, as `runProviderConformance` reports it. */
export interface ConformanceFailure {
  contract: ContractPart
  title: string
  /** The assertion's own sentence — what is missing, in words. */
  message: string
}

/** Opens a temp folder and an adapter for one check. The caller closes it. */
export function openConformance(spec: ConformanceSpec): ConformanceRun {
  const dir = mkdtempSync(join(tmpdir(), `conformance-${spec.provider}-`))
  const cwd = join(dir, 'company')
  mkdirSync(cwd)
  const worktree = join(dir, 'worktree')
  mkdirSync(worktree)
  const skills = CONFORMANCE_SKILL_NAMES.map((name) => {
    const path = join(dir, 'skills', name)
    mkdirSync(path, { recursive: true })
    writeFileSync(join(path, 'SKILL.md'), `# ${name}\n\nWhat this team does.\n`)
    return { name, path }
  })
  const processes: FakeProcess[] = []
  const ran: { command: string; args: string[] }[] = []
  // Until a check says otherwise, every CLI the adapter asks is not on this machine.
  let outcome: CliOutcome = { kind: 'missing' }
  const env = { PATH: '/usr/bin', HOME: join(dir, 'home'), ...CONFORMANCE_ORCHESTRATOR_ENV }
  const recordSpawn: SpawnPty = (file, args, options) => {
    const { record, session } = fakeProcess(file, args, options)
    processes.push(record)
    return session
  }
  const recordRun: RunCli = (command, args) => {
    ran.push({ command, args: [...args] })
    return Promise.resolve(outcome)
  }
  const spawnPty = spec.runtime
    ? unwrapWsl(wslSpawnPty(recordSpawn, { distro: spec.runtime.distro, host: env }), spec.runtime.distro, processes)
    : recordSpawn
  const runCli = spec.runtime
    ? unwrapWslRun(wslRunCli(recordRun, { distro: spec.runtime.distro, host: env }), spec.runtime.distro, ran)
    : recordRun
  const dataDir = join(dir, 'data')
  const adapter = spec.create({
    dataDir,
    hookUrl: 'http://127.0.0.1:4555/hook',
    env,
    spawnPty,
    runCli,
  })
  return {
    adapter,
    cwd,
    dataDir,
    worktree,
    skills,
    movedSkill: { name: 'pen-handoff', path: join(dir, 'skills', 'pen-handoff'), missing: true },
    home: join(dir, 'home'),
    rtk: { path: join(dir, 'bin', 'rtk'), dbPath: join(dir, 'data', 'rtk', 'history.db'), ping: false },
    processes,
    ran,
    answer(next) {
      outcome = next
    },
    start(employee = ada, over: Partial<SpawnOptions> = {}) {
      const session = adapter.spawn({
        employee: { ...employee, provider: spec.provider },
        cwd,
        instructions: conformanceInstructions(employee),
        sessionId: CONFORMANCE_SESSION_ID,
        hookToken: CONFORMANCE_HOOK_TOKEN,
        ...over,
      })
      return { session, process: processes.at(-1)! }
    },
    close() {
      vi.useRealTimers()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

/**
 * The contract, in order. Every entry is one question with one sentence for its answer, so a
 * stranger's first `pnpm test` on an unfilled adapter reads as a list of what is still missing.
 */
export const CONFORMANCE_CHECKS: readonly ConformanceCheck[] = [
  {
    contract: 'spawn',
    title: 'starts the provider’s CLI in the Company folder, with the Session’s hook token on it',
    run({ start, cwd }, spec) {
      const { process } = start()

      expect(
        process.file,
        `spawn: the adapter started "${process.file}", but this Provider's CLI is "${spec.command}" — spawn the command the catalogue names, not one of its own`,
      ).toBe(spec.command)
      expect(
        process.options.cwd,
        'spawn: the Session must run in the Company folder it was handed (request.cwd), because that is where the worktrees, the memory files and the repos are',
      ).toBe(cwd)
      expect(
        process.options.env[HOOK_TOKEN_ENV],
        `spawn: the Session's hooks carry ${HOOK_TOKEN_ENV} back to the receiver — without it the engine cannot tell which Session a hook belongs to when two Employees share a folder`,
      ).toBe(CONFORMANCE_HOOK_TOKEN)
      expect(
        process.options.cols,
        'spawn: the terminal was started with no width, so the CLI has nowhere to draw',
      ).toBeGreaterThan(0)
      expect(
        process.options.rows,
        'spawn: the terminal was started with no height, so the CLI has nowhere to draw',
      ).toBeGreaterThan(0)
    },
  },
  {
    contract: 'instructions',
    title: 'puts the Employee’s instructions on its own process',
    run({ start }, spec) {
      const { process } = start()
      const text = spec.instructionsOn(process)

      expect(
        text,
        'instructions: the Employee’s instructions are not on the process at all — the adapter must pass them to the CLI (Claude Code uses --append-system-prompt), never write them into the Company folder (decision 48)',
      ).toContain('You are Ada, Backend at Acme')
      expect(
        text,
        'instructions: the Employee’s persona is missing from the instructions, so this Employee would behave like every other one',
      ).toContain('You build APIs.')
      expect(
        text,
        'instructions: the Company’s repos and their stacks are missing, so the Employee does not know what it is allowed to touch',
      ).toContain('**api** (yours): TypeScript, Fastify, pnpm')
      expect(
        text,
        'instructions: the Company section is missing, so the Employee would not know which MCP server is the one it acts through',
      ).toContain('Everything you do here you do through the `company` MCP server.')
    },
  },
  {
    contract: 'instructions',
    title: 'starts a sub-session where it was sent, with its piece of the work, on the parent’s model (T163)',
    run({ start, worktree }, spec) {
      const { process } = start(
        { ...ada, model: spec.model.id },
        { cwd: worktree, instructions: SUB_SESSION_INSTRUCTIONS, subSession: { name: SUB_SESSION_NAME } },
      )
      const text = spec.instructionsOn(process)

      expect(
        process.options.cwd,
        'instructions: a sub-session must run in the worktree it was handed (request.cwd), not the Company folder — its own worktree is what keeps its writes off its parent’s',
      ).toBe(worktree)
      expect(
        text,
        'instructions: a sub-session’s task is missing from its instructions, so it starts knowing nothing of what it was started for. Put `request.instructions` on the process it starts, whatever is in them',
      ).toContain(SUB_SESSION_TASK)
      expect(
        text,
        'instructions: a sub-session was handed an Employee’s instructions; it must be given the instructions on its own request, not the ones from the last spawn',
      ).not.toContain('Everything you do here you do through the `company` MCP server.')
      expect(
        spec.modelOn(process),
        'instructions: a sub-session runs on its parent’s model — it is the Employee thinking in parallel, not a second hire',
      ).toEqual({ model: spec.model.model, effort: spec.model.effort })
    },
  },
  {
    contract: 'isolation',
    title: 'writes nothing Employee-specific into the Company folder (decision 48)',
    run({ start, cwd, processes }, spec) {
      start(ada)
      start(grace, { sessionId: OTHER_SESSION_ID })

      for (const [file, text] of filesUnder(cwd)) {
        const note = `isolation: the adapter wrote an Employee's own details into ${file} in the Company folder. Two Employees share that folder, so whoever starts last overwrites the other and both read the same file (decision 48). Per-Session files belong in the app's dataDir.`
        expect(`${file}: ${text}`, note).not.toContain('Ada')
        expect(`${file}: ${text}`, note).not.toContain('Grace')
        expect(`${file}: ${text}`, note).not.toContain('You build APIs.')
      }
      const mixed =
        'isolation: each process must carry only its own Employee’s instructions — this one carries another Employee’s, so the two Sessions would introduce themselves with the same name'
      expect(spec.instructionsOn(processes[0]!), mixed).toContain('Ada')
      expect(spec.instructionsOn(processes[0]!), mixed).not.toContain('Grace')
      expect(spec.instructionsOn(processes[1]!), mixed).toContain('Grace')
      expect(spec.instructionsOn(processes[1]!), mixed).not.toContain('Ada')
    },
  },
  {
    contract: 'isolation',
    title: 'spawns a Session with no other orchestrator’s environment on it (T234)',
    run({ start }) {
      const { process } = start()

      for (const name of Object.keys(CONFORMANCE_ORCHESTRATOR_ENV)) {
        expect(
          process.options.env[name],
          `isolation: ${name} reached the Session. TinyCorp is started from the boss's shell, and another orchestrator was driving it — its hook is in this product's global config and reads that variable to decide whose pane an event belongs to, so the boss gets that app's notifications for a TinyCorp Employee. Run the inherited environment through withoutOrchestratorEnv (main/providers/orchestrator-env.ts) before spawning`,
        ).toBeUndefined()
      }
      expect(
        process.options.env['PATH'],
        'isolation: the strip took PATH with it — it removes another orchestrator’s variables, not the machine’s',
      ).toBe('/usr/bin')
    },
  },
  {
    contract: 'resume',
    title: 'starts fresh by default and continues the same session on resume',
    run({ adapter, start }, spec) {
      expect(
        adapter.resumeCommand(CONFORMANCE_SESSION_ID),
        'resume: resumeCommand returned null, so this Provider claims it cannot resume. An Employee would lose its whole history every time its Session restarts — if the CLI really cannot resume, say so in docs/providers.md before sending the PR',
      ).not.toBeNull()

      const fresh = start().process
      const resumed = start(ada, { resume: true }).process

      expect(
        spec.startsFresh(fresh),
        'resume: a spawn without `resume` must start a new conversation, and this one did not',
      ).toBe(true)
      expect(
        spec.continues(fresh, CONFORMANCE_SESSION_ID),
        'resume: a spawn without `resume` continued an existing conversation — a newly hired Employee would wake up inside somebody else’s history',
      ).toBe(false)
      expect(
        spec.continues(resumed, CONFORMANCE_SESSION_ID),
        `resume: the adapter did not continue session ${CONFORMANCE_SESSION_ID}, so a resumed Employee would lose its history. The resume flag must put the app's own session id on the command line`,
      ).toBe(true)
      expect(
        spec.startsFresh(resumed),
        'resume: the resumed spawn still asked for a fresh conversation, so the Employee restarts with nothing it remembers',
      ).toBe(false)
    },
  },
  {
    contract: 'resume',
    title: 'hands the boss the same Session, with the same permission flags, for their own terminal',
    run({ adapter, start }, spec) {
      // Optional (T164): a Provider that cannot be driven from a terminal the app did not start
      // leaves it out, the drawer draws no button, and there is nothing here to check.
      if (!adapter.handoffCommand) return

      const modes = ['skip-permissions', 'interactive'] as const
      const spawned = Object.fromEntries(
        modes.map((permissionMode) => [
          permissionMode,
          start({ ...ada, permissionMode }, { resume: true }).process.args,
        ]),
      ) as Record<(typeof modes)[number], string[]>
      const handed = Object.fromEntries(
        modes.map((permissionMode) => [
          permissionMode,
          adapter.handoffCommand!({ ...ada, provider: spec.provider, permissionMode }, CONFORMANCE_SESSION_ID),
        ]),
      ) as Record<(typeof modes)[number], string[] | null>

      for (const mode of modes) {
        const command = handed[mode]
        if (command === null) continue
        expect(
          command[0],
          `resume: the handoff command must start with this Provider's CLI ("${spec.command}"), because the boss pastes the whole line into a shell`,
        ).toBe(spec.command)
        expect(
          contains(command, adapter.resumeCommand(CONFORMANCE_SESSION_ID) ?? []),
          `resume: the handoff command does not continue session ${CONFORMANCE_SESSION_ID}. The boss would open a fresh conversation beside the Employee's own instead of the one they were looking at`,
        ).toBe(true)
        // The app's own half of a Session stays behind: a second terminal must not carry the
        // Company's MCP token, the hook token or the Employee's instructions.
        expect(
          command.join(' '),
          "resume: the handoff command carries the Session's hook token. That token is how the engine tells one Session's hooks from another's — it belongs to the process the app spawned and to nothing else",
        ).not.toContain(CONFORMANCE_HOOK_TOKEN)
      }

      // The bug this exists for: `claude --resume <id>` typed by hand runs without the skip flag
      // the Employee was spawned with. Whatever spawn puts on the line for one mode and not the
      // other is the permission flag, whatever it is called, and the handoff must carry it too.
      for (const mode of modes) {
        const command = handed[mode]
        if (command === null) continue
        const other = mode === 'skip-permissions' ? 'interactive' : 'skip-permissions'
        for (const arg of spawned[mode].filter((a) => !spawned[other].includes(a))) {
          expect(
            command,
            `resume: an Employee on ${mode} is spawned with ${JSON.stringify(arg)} and the handoff command leaves it out. The Session the boss opens would behave differently from the one in the drawer — which is the whole reason this command is built here and not typed from memory`,
          ).toContain(arg)
        }
      }
    },
  },
  {
    contract: 'mcp',
    title: 'loads the Company MCP server it was given, for that Session only',
    run({ adapter, start }, spec) {
      adapter.injectMcp(CONFORMANCE_SESSION_ID, { company: COMPANY_SERVER, granted: [] })

      const loaded = start().process
      const other = start(grace, { sessionId: OTHER_SESSION_ID }).process

      expect(
        spec.mcpOn(loaded),
        'mcp: the Session was not given the Company MCP server injectMcp wrote for it, so this Employee cannot post to chat, move a ticket or open a PR',
      ).toEqual(COMPANY_SERVER)
      expect(
        spec.mcpOn(other),
        'mcp: a Session that was never given an MCP config got one anyway — the config is per Session, and one Employee must never hold another’s token',
      ).toBeNull()
    },
  },
  {
    contract: 'mcp',
    title: 'hands the Session the servers the boss granted this Employee, and no others',
    run({ adapter, start }, spec) {
      adapter.injectMcp(CONFORMANCE_SESSION_ID, { company: COMPANY_SERVER, granted: CONFORMANCE_GRANTS })
      adapter.injectMcp(OTHER_SESSION_ID, { company: COMPANY_SERVER, granted: [] })

      const granted = start().process
      const ungranted = start(grace, { sessionId: OTHER_SESSION_ID }).process

      expect(
        spec.grantedOn(granted),
        'mcp: the boss granted this Employee MCP servers of the Company’s own catalogue (T136) and the Session was not given them, so an Employee that was told it has a tool does not have it. Write every server in `granted` the way this product reads them, beside the Company’s own',
      ).toEqual(GRANTS_READ_BACK)
      expect(
        spec.grantedOn(ungranted),
        'mcp: a Session that was granted nothing was handed a server anyway. A grant is per Employee: the strict-MCP flag is what keeps the boss’s own config out, and this would put one Employee’s tools — and its token — in another’s hands',
      ).toEqual([])
      for (const secret of [
        GRANTED_SECRET,
        GRANTED_STDIO_SECRET,
        ...Object.values(GRANTED_NAMED_SECRETS),
        ...Object.values(GRANTED_HEADER_SECRETS),
      ]) {
        expect(
          [granted.file, ...granted.args].join(' '),
          'mcp: a granted server’s secret is in the process’s argv, where anyone running `ps` reads it. A secret reaches the Session in its environment or in a config file the adapter writes with mode 0600, never on the command line',
        ).not.toContain(secret)
      }
    },
  },
  {
    contract: 'mcp',
    title: 'leaves none of the Session’s tokens on the disk once the Session has ended',
    run({ adapter, start, dataDir }) {
      adapter.injectMcp(CONFORMANCE_SESSION_ID, { company: COMPANY_SERVER, granted: CONFORMANCE_GRANTS })
      start()

      adapter.forgetSession?.(CONFORMANCE_SESSION_ID)

      const secrets = [
        COMPANY_SERVER.token,
        GRANTED_SECRET,
        GRANTED_STDIO_SECRET,
        ...Object.values(GRANTED_HEADER_SECRETS),
      ]
      const left = filesUnder(dataDir)
        .filter(([, text]) => secrets.some((secret) => text.includes(secret)))
        .map(([file]) => file)
      expect(
        left,
        'mcp: the Session has ended and a file in the app’s dataDir still holds its tokens. Every Employee is a process of the same OS user as the app, so that file is one `cat` away for any of them, and nothing else ever deletes it — implement forgetSession and take away whatever this adapter wrote for that session id (T199, finding H5)',
      ).toEqual([])
    },
  },
  {
    contract: 'skills',
    title: 'puts the skill folders the boss granted this Employee where this product reads them',
    run({ adapter, worktree, skills }, spec) {
      if (!adapter.installSkills) {
        expect(
          spec.skillsIn,
          'skills: this adapter implements no installSkills, so it says this product reads no skill folders — then the spec must not claim a place to read them back from. Say it once: either the product reads skills and the adapter installs them, or it does not and the Employee’s drawer says so',
        ).toBeUndefined()
        return
      }
      expect(
        spec.skillsIn,
        'skills: the adapter installs skill folders and the spec does not say where to read them back, so nothing here can check that the Employee really got them. Add skillsIn to this Provider’s spec',
      ).toBeDefined()

      adapter.installSkills(worktree, [skills[0]!])

      expect(
        spec.skillsIn!(worktree),
        'skills: the boss granted this Employee a skill folder (T137) and a Session working in this worktree cannot read it, so an Employee that was told it has a runbook does not have one. Make each granted folder available where this product looks — Claude Code reads `.claude/skills/` — and leave the ungranted ones out',
      ).toEqual([skills[0]!.name])
    },
  },
  {
    contract: 'skills',
    title: 'takes a skill away when the grant goes, and starts without a folder that has moved',
    run({ adapter, worktree, skills, movedSkill }, spec) {
      if (!adapter.installSkills || !spec.skillsIn) return
      const read = () => spec.skillsIn!(worktree).sort()

      adapter.installSkills(worktree, skills)
      expect(read(), 'skills: both granted folders must be there before one of them is taken back').toEqual(
        skills.map((skill) => skill.name).sort(),
      )

      adapter.installSkills(worktree, [skills[1]!])
      expect(
        read(),
        'skills: the boss took a skill off this Employee and it is still in the worktree, so an Employee goes on being steered by instructions it was no longer given. installSkills is handed the whole grant every time: what is not in it is removed',
      ).toEqual([skills[1]!.name])

      adapter.installSkills(worktree, [])
      expect(read(), 'skills: an Employee granted nothing must be left with nothing in its worktree').toEqual([])

      expect(
        () => adapter.installSkills!(worktree, [movedSkill]),
        'skills: a folder the boss moved or deleted threw rather than being left out. A missing skill says so on the Employee and fails no spawn',
      ).not.toThrow()
      expect(
        read(),
        'skills: a skill whose folder is not on this Mac was installed anyway, so the Employee is sent to an empty folder',
      ).toEqual([])
    },
  },
  {
    contract: 'model',
    title: 'runs on the provider default when the Employee has no model, and on its own when it has one',
    run({ start }, spec) {
      const byDefault = start().process
      const chosen = start({ ...ada, model: spec.model.id }).process

      expect(
        spec.modelOn(byDefault),
        'model: an Employee with no model must run on whatever the CLI defaults to — the adapter named a model anyway',
      ).toBeNull()
      expect(
        spec.modelOn(chosen),
        `model: the Employee chose "${spec.model.id}" from this Provider's catalogue, and the CLI was not told to run "${spec.model.model}"${spec.model.effort ? ` at ${spec.model.effort} effort` : ''}. Map the catalogue's model id onto the flags the CLI takes`,
      ).toEqual({ model: spec.model.model, effort: spec.model.effort })
    },
  },
  {
    contract: 'model',
    title: 'keeps the Employee’s model on resume',
    run({ start }, spec) {
      const { process } = start({ ...ada, model: spec.model.id }, { resume: true })

      expect(
        spec.modelOn(process),
        'model: a resumed Session dropped the Employee’s model, so an Employee quietly changes model every time it restarts',
      ).toEqual({ model: spec.model.model, effort: spec.model.effort })
    },
  },
  {
    contract: 'signals',
    title: 'reads idleness from the product’s own signal',
    run({ adapter }, spec) {
      const { signals } = spec

      expect(
        {
          ready: adapter.detectIdle(signals.ready),
          busy: adapter.detectIdle(signals.busy),
          idle: adapter.detectIdle(signals.idle),
          quiet: adapter.detectIdle(signals.quiet),
        },
        'signals: detectIdle must map this Provider’s own hooks onto ready / busy / idle, and return null for a hook that says nothing about idleness. An Employee whose idleness is misread never picks up its next ticket, or is handed one while it is still typing',
      ).toEqual({ ready: 'ready', busy: 'busy', idle: 'idle', quiet: null })
    },
  },
  {
    contract: 'signals',
    title: 'says when a Session stopped to ask the boss, and clears it when the Session moves on',
    run({ adapter }, spec) {
      if (!spec.asking) return
      const { signals } = spec

      expect(
        askOf(adapter.detectIdle(spec.asking.hook)),
        'signals: this Provider claims a Session can stop in its terminal to ask the boss (T165), and its own permission signal did not map onto an ask. Nobody would know that Employee is waiting: it would look Working forever',
      ).toEqual({ kind: 'asking', what: spec.asking.what })
      expect(
        [adapter.detectIdle(signals.busy), adapter.detectIdle(signals.idle)].map(askOf),
        'signals: an adapter that claims `asking` must also say when the Session moved on — the engine clears the ask on the next busy or idle signal, so neither of those may itself be an ask. An ask that never clears leaves an Employee standing at the boss desk for good',
      ).toEqual([null, null])
    },
  },
  {
    contract: 'signals',
    title: 'reads the session a signal belongs to out of the product’s own payload',
    run({ adapter }, spec) {
      expect(
        hookSessionId(adapter, spec.signals.ready),
        `signals: a hook must name the Session it came from (${spec.signalSessionId}). Two Employees share a Company folder, so a hook the engine cannot attribute wakes the wrong one. Products that name their own conversations implement sessionIdOf`,
      ).toBe(spec.signalSessionId)
      expect(
        hookSessionId(adapter, {}),
        'signals: a hook with nothing in it must resolve to no Session at all, rather than being attributed to some default one',
      ).toBeNull()
      expect(
        isProviderSessionId(spec.signalSessionId),
        `signals: ${JSON.stringify(spec.signalSessionId)} is not a provider session id. The id a hook names is spent as a token in this CLI's argv and as the name of a file this app writes, and a Session POSTs its own hooks — so the shape is checked on the way in and anything else is refused (T199-H1). A product whose conversation ids really do not fit /^[A-Za-z0-9._-]{1,128}$/ needs that decision made in the PR, not worked around in the adapter`,
      ).toBe(true)
    },
  },
  {
    contract: 'resume',
    title: 'says whether a resumed Session really continued the previous conversation',
    run({ adapter }, spec) {
      const { continued, fresh } = spec.resumed

      expect(
        adapter.confirmsResume?.(continued) ?? true,
        'resume: confirmsResume rejected a ready signal that did say the previous conversation was continued, so the engine would restart a Session that was fine',
      ).toBe(true)
      expect(
        adapter.confirmsResume?.(fresh) ?? true,
        'resume: the adapter accepted a ready signal that started a fresh conversation as a successful resume. The Employee would carry on as if it remembered a ticket it has never seen — implement confirmsResume for a Provider whose CLI can silently start over',
      ).toBe(false)
    },
  },
  {
    contract: 'limits',
    title: 'detects the subscription limit and reads when it resets',
    run({ adapter }, spec) {
      const now = new Date(spec.limit.now)

      expect(
        adapter.detectBudgetExhausted(spec.limit.output),
        'limits: the CLI said the subscription limit was hit and the adapter did not notice. The Employee would keep being handed work it cannot do instead of parking in the coffee area',
      ).toBe(true)
      expect(
        adapter.budgetResetAt(spec.limit.output, now)?.toISOString(),
        'limits: the limit message names when it resets, and budgetResetAt did not read it — the office would have no countdown to show',
      ).toBe(spec.limit.resetsAt)
      expect(
        adapter.detectBudgetExhausted(spec.ordinary),
        'limits: ordinary output was read as a subscription limit, which parks a working Employee for no reason',
      ).toBe(false)
      expect(
        adapter.budgetResetAt(spec.ordinary, now),
        'limits: a reset time was invented out of output that names none — say null rather than guess',
      ).toBeNull()
    },
  },
  {
    contract: 'accounts',
    title: 'runs a Session as one account by pointing the CLI at that account’s own config directory',
    run({ adapter, start }) {
      const support = adapter.accounts?.()
      if (!support) {
        expect(
          adapter.configDirEnv,
          'accounts: this adapter builds a config-directory environment but never says its product holds more than one sign-in. Answer `accounts()` too, or drop `configDirEnv`: the Accounts card reads `accounts()` and would offer the boss nothing',
        ).toBeUndefined()
        return
      }
      expect(
        support.env,
        'accounts: `accounts().env` must name the variable this CLI reads its config directory from, e.g. CLAUDE_CONFIG_DIR — without it nothing can point a Session at a second sign-in',
      ).toBeTruthy()
      expect(
        support.defaultDir,
        'accounts: `accounts().defaultDir` must name where this CLI keeps its sign-in when that variable is unset — it is the account the boss already has, and the Accounts card lists it first',
      ).toBeTruthy()

      const configDir = join(tmpdir(), 'conformance-account')
      const env = adapter.configDirEnv?.(configDir) ?? {}
      expect(
        Object.values(env),
        `accounts: configDirEnv(${configDir}) did not carry the directory it was given, so every Session would run as the same sign-in whichever account the boss picked`,
      ).toContain(configDir)

      const { process } = start(undefined, { account: { id: 'acc-2', configDir } })
      expect(
        Object.entries(process.options.env)
          .filter(([, value]) => value === configDir)
          .map(([name]) => name),
        `accounts: the Session was spawned for an account in ${configDir} and nothing in its environment points there. It would sign in as whoever the CLI last signed in as, which is the wrong subscription and the wrong limit`,
      ).toContain(support.env)
    },
  },
  {
    contract: 'prompt',
    title: 'types a pushed prompt into the Session and submits it',
    run({ adapter, start }, spec) {
      vi.useFakeTimers()
      const { session, process } = start()

      adapter.pushPrompt(session, '[company] hello')
      // The text is typed at once; an adapter is free to submit it on a short timer afterwards.
      const typed = [...process.written]
      vi.advanceTimersByTime(2000)

      expect(
        typed.join(''),
        'prompt: pushPrompt typed nothing into the Session. The engine has no other way to hand an Employee its next ticket',
      ).toContain('[company] hello')
      expect(
        process.written.join(''),
        `prompt: pushPrompt must type the text and then submit it with ${JSON.stringify(spec.submit)}, and nothing else. A prompt that is typed but never submitted leaves the Employee staring at a filled-in box forever`,
      ).toBe(`[company] hello${spec.submit}`)
    },
  },
  {
    contract: 'shutdown',
    title: 'kills cleanly: the process exits once and the adapter stops touching it',
    run({ start }) {
      vi.useFakeTimers()
      const { session, process } = start()

      session.kill()
      session.kill()
      // Whatever the CLI paints on its way out must not make the adapter type into a dead terminal.
      process.output(deathRattle)
      vi.advanceTimersByTime(5000)

      expect(process.killed, 'shutdown: kill() left the CLI process running').toBe(true)
      expect(
        process.exits,
        'shutdown: killing twice must end the process once — a second exit is delivered to the engine as a crash',
      ).toEqual([0])
      expect(
        process.writtenAfterKill,
        'shutdown: the adapter answered a startup prompt the dying CLI painted on its way out, typing into a terminal that is already gone. Stop every listener and timer in kill()',
      ).toEqual([])
    },
  },
  {
    contract: 'preflight',
    title: 'asks its own CLI whether the boss is signed in, without spending a token',
    async run({ adapter, ran, processes, answer }, spec) {
      answer(spec.signIn.in)

      const check = await adapter.checkCli()

      expect(
        ran.map((call) => call.command),
        `preflight: the check must ask this Provider's own CLI ("${spec.command}") exactly once, through the runCli it was handed. An adapter that shells out on its own cannot be tested, and one that asks nothing cannot answer`,
      ).toEqual([spec.command])
      expect(
        processes,
        'preflight: the check started a Session. It must never spend the boss’s subscription — it is one status command with a timeout around it, and nothing else',
      ).toEqual([])
      expect(
        check.state,
        'preflight: the CLI said the boss is signed in on their subscription and the adapter did not read it as ready. The Launcher would hold a card in front of an app that works',
      ).toBe('ready')
      expect(preflightBlocks(check), 'preflight: a signed-in CLI must stop no Employee').toBe(false)
    },
  },
  {
    contract: 'preflight',
    title: 'says, in the product’s own words, what to do when its CLI is missing',
    async run({ adapter, answer }, _spec) {
      answer({ kind: 'missing' })

      const check = await adapter.checkCli()

      expect(
        check.state,
        'preflight: the CLI is not on this machine and the adapter did not say so. An Employee on it would fail inside a terminal with nothing anywhere saying why — which is the whole reason this part of the contract exists',
      ).toBe('missing')
      expect(
        check.title,
        'preflight: the card’s title must name this product, because the boss may be looking at two cards at once',
      ).not.toBe('')
      expect(
        check.commands.length,
        'preflight: a missing CLI needs the command that installs it — the card is a card because it tells the boss what to type',
      ).toBeGreaterThan(0)
      expect(
        check.note,
        `preflight: every state that stops an Employee carries the promise the screen keeps: ${JSON.stringify(PREFLIGHT_STILL_OPENS)}`,
      ).toBe(PREFLIGHT_STILL_OPENS)
    },
  },
  {
    contract: 'preflight',
    title: 'says, in the product’s own words, what to do when nobody is signed in',
    async run({ adapter, answer }, spec) {
      answer(spec.signIn.out)

      const check = await adapter.checkCli()

      expect(
        check.state,
        'preflight: the CLI answered that nobody is signed in and the adapter read it as something else. Take the product at its word: a signed-out CLI runs no Employee',
      ).toBe('signed-out')
      expect(
        preflightBlocks(check),
        'preflight: a signed-out CLI must refuse every Session on this Provider rather than let one fail in a terminal',
      ).toBe(true)
      expect(
        check.commands.join(' '),
        `preflight: the fix is a command the boss types, and it runs "${spec.command}" — the card must carry it`,
      ).toContain(spec.command)
    },
  },
  {
    contract: 'preflight',
    title: 'reports the account its own CLI named, and never one it did not',
    async run({ adapter, answer }, spec) {
      answer(spec.signIn.in)
      const signedIn = await adapter.checkCli()

      for (const field of ['account', 'plan'] as const) {
        expect(
          signedIn[field] === null || (typeof signedIn[field] === 'string' && signedIn[field].trim() !== ''),
          `preflight: ${field} must be what this CLI printed, or null when it printed nothing. Your profile draws it under the product name (T141), and an empty string there is a blank line where the boss expects an answer`,
        ).toBe(true)
      }

      answer(spec.signIn.out)
      const signedOut = await adapter.checkCli()

      expect(
        [signedOut.account, signedOut.plan],
        'preflight: nobody is signed in, so there is no account and no plan to name. Anything here is invented, and Your profile would show the boss an account they are not signed in as',
      ).toEqual([null, null])
    },
  },
  {
    contract: 'preflight',
    title: 'never reads a CLI that did not answer as signed in',
    async run({ adapter, answer }) {
      for (const outcome of [{ kind: 'timeout' } as const, { kind: 'failed' } as const]) {
        answer(outcome)

        expect(
          (await adapter.checkCli()).state,
          `preflight: a check that came back ${outcome.kind} was read as a login. TinyCorp knows nothing here — say so, so the boss can press Check again, rather than let an Employee start into a CLI that may not be signed in`,
        ).not.toBe('ready')
      }
    },
  },
  {
    contract: 'rewrite',
    title: 'runs this Session’s shell commands through RTK, in its own config and never the boss’s (T179)',
    run({ adapter, start, cwd, home, rtk }, spec) {
      if (!adapter.commandRewriteHook) {
        expect(
          spec.rewriteIn,
          'rewrite: this adapter implements no commandRewriteHook, so it says this product rewrites no commands — then the spec must not claim a place to read one back from. Say it once: either the product can rewrite a command and the adapter hooks it, or it cannot and the Tokens tab says "not hooked"',
        ).toBeUndefined()
        return
      }
      expect(
        spec.rewriteIn,
        'rewrite: the adapter hooks a command rewrite and the spec does not say where to read it back, so nothing here can check that a Session really got one. Add rewriteIn to this Provider’s spec',
      ).toBeDefined()

      const { process } = start(ada, { rtk })
      const written = spec.rewriteIn!(cwd)

      expect(
        written,
        'rewrite: the Company has command output compression on and this Session’s own config carries no rewrite, so every command an Employee runs prints everything it always did (T179)',
      ).not.toBeNull()
      expect(
        written,
        'rewrite: the rewrite must name the RTK the app found, not a bare `rtk` off whatever PATH the product happens to run a hook with',
      ).toSatisfy((text: string) => text.includes(rtk.path) || text.includes(JSON.stringify(rtk.path).slice(1, -1)))
      expect(
        existsSync(home),
        'rewrite: the adapter wrote into the boss’s own home. RTK is hooked per Session, into the config TinyCorp already writes for that Session — never through `rtk init -g`, and never in ~/.claude or $CODEX_HOME (T179)',
      ).toBe(false)
      expect(
        process.options.env[RTK_DB_ENV],
        `rewrite: a hooked Session must carry ${RTK_DB_ENV}, or RTK writes this Company’s savings into the boss’s own history`,
      ).toBe(rtk.dbPath)
      expect(
        process.options.env[RTK_TELEMETRY_ENV],
        `rewrite: a hooked Session must carry ${RTK_TELEMETRY_ENV} unless the boss turned RTK’s ping on. An Employee is not a person who was asked`,
      ).toBe('1')
    },
  },
  {
    contract: 'rewrite',
    title: 'starts with no rewrite at all when the Company has compression off (T179)',
    run({ adapter, start, cwd, rtk }, spec) {
      if (!adapter.commandRewriteHook || !spec.rewriteIn) return

      start(ada, { rtk })
      const { process } = start(ada)

      expect(
        spec.rewriteIn(cwd),
        'rewrite: the boss turned compression off and the Session started with the rewrite the last one wrote. The hook file lives in the Company folder and outlives the Session — off has to mean off at the next start, which is a null handed to commandRewriteHook (T179)',
      ).toBeNull()
      expect(
        process.options.env[RTK_DB_ENV],
        'rewrite: a Session that is not hooked must carry none of RTK’s environment either',
      ).toBeUndefined()
    },
  },
  {
    contract: 'rewrite',
    title: 'never widens what an Employee that asks first may do (T179)',
    run({ adapter, start, cwd, rtk }, spec) {
      if (!adapter.commandRewriteHook || !spec.rewriteIn) return
      const asking = { ...ada, permissionMode: 'interactive' as const }

      start(asking, { rtk })
      const written = spec.rewriteIn(cwd)
      const keeps = adapter.commandRewriteHook(rtk).keepsApprovals

      if (!keeps) {
        expect(
          written,
          'rewrite: this adapter says a rewritten command could skip the product’s own approval, and hooked the Employee anyway. Compressing what an Employee reads is worth nothing beside a `git push` that went out without being asked about — leave that Employee unhooked (T179)',
        ).toBeNull()
        return
      }
      expect(
        written,
        'rewrite: this adapter claims a rewritten command still stops at the product’s approval, so an Employee that asks first must be hooked like any other',
      ).not.toBeNull()
      expect(
        spec.rewriteAsk,
        'rewrite: this adapter claims keepsApprovals and the spec says nothing about what the product sends when it asks about a rewritten command. That claim is the whole of "permissions never widen" — say how it is checked, with the product’s own permission payload for a rewritten `git push`',
      ).toBeDefined()

      const signal = askOf(adapter.detectIdle(spec.rewriteAsk!.hook))

      expect(
        signal?.what,
        'rewrite: the product asked the boss about a rewritten command and the app read no ask out of it, so the Employee would sit there looking busy and the boss would never be told (T165, T179)',
      ).toBe(spec.rewriteAsk!.what)
    },
  },
  {
    contract: 'install',
    title: 'knows whether its CLI is on this machine',
    run({ adapter }) {
      expect(
        typeof adapter.installed(),
        'install: installed() must answer true or false by looking for the CLI on PATH. An Employee on a Provider that is not installed is never spawned, and the drawer says so instead of failing the Start button',
      ).toBe('boolean')
    },
  },
]

/**
 * Runs the Provider conformance suite over one adapter. Call it from that adapter's own test
 * file; whatever the adapter does on top of this belongs in tests beside the call.
 */
export function describeProviderConformance(spec: ConformanceSpec): void {
  describe(`${spec.label ?? spec.provider} adapter conformance`, () => {
    for (const check of CONFORMANCE_CHECKS) {
      it(`${check.contract}: ${check.title}`, async () => {
        const run = openConformance(spec)
        try {
          await check.run(run, spec)
        } finally {
          run.close()
        }
      })
    }
  })
}

/**
 * The same suite as a function, for the one test that has to watch it fail: the template adapter
 * in `providers/example/` is unfilled on purpose, and `example/template.test.ts` drives it both
 * ways. Returns one entry per check that did not hold, empty when the adapter is green.
 */
export async function runProviderConformance(spec: ConformanceSpec): Promise<ConformanceFailure[]> {
  const failures: ConformanceFailure[] = []
  for (const check of CONFORMANCE_CHECKS) {
    const run = openConformance(spec)
    try {
      await check.run(run, spec)
    } catch (error) {
      failures.push({ contract: check.contract, title: check.title, message: messageOf(error) })
    } finally {
      run.close()
    }
  }
  return failures
}

/**
 * A WSL spawn, recorded as what the adapter asked for.
 *
 * Every check in this suite is about the adapter's own contract — the flag that carries the
 * instructions, the file the MCP config went into — and none of them is about `wsl.exe`. So the
 * envelope is peeled off and the paths are spelled the way the adapter spelled them, and the
 * whole suite then runs unchanged against a CLI inside a distro. The envelope itself is kept on
 * `raw`, for the checks that are about it.
 */
function unwrapWsl(inner: SpawnPty, distro: string, processes: FakeProcess[]): SpawnPty {
  return (file, args, options) => {
    const session = inner(file, args, options)
    const record = processes.at(-1)
    if (record) Object.assign(record, { raw: { file: record.file, args: record.args }, ...meant(record.args, distro) })
    return session
  }
}

function unwrapWslRun(inner: RunCli, distro: string, ran: { command: string; args: string[] }[]): RunCli {
  return async (command, args, options) => {
    const outcome = await inner(command, args, options)
    const last = ran.at(-1)
    if (last) {
      const { file, args: meantArgs } = meant(last.args, distro)
      Object.assign(last, { command: file, args: meantArgs })
    }
    return outcome
  }
}

/** The command and arguments inside `wsl.exe … -e sh -lc 'exec "$0" "$@"' <command> <args…>`. */
function meant(argv: readonly string[], distro: string): { file: string; args: string[] } {
  const at = argv.indexOf(WSL_LOGIN_SCRIPT)
  if (at === -1) return { file: argv[0] ?? '', args: [...argv.slice(1)] }
  const [file, ...rest] = argv.slice(at + 1)
  return { file: file ?? '', args: rest.map((argument) => untranslatePaths(argument, { distro })) }
}

/** Whether `args` holds `run` as a run of consecutive entries. An empty `run` is always held. */
function contains(args: readonly string[], run: readonly string[]): boolean {
  if (run.length === 0) return true
  return args.some((_, at) => run.every((value, offset) => args[at + offset] === value))
}

/** The sentence an assertion failed with, without vitest's diff. */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * Every startup dialog the adapters answer, in one blob: whatever a dying CLI prints, the adapter
 * must not answer it after the kill.
 */
const deathRattle =
  '\x1b[2JQuick safety check\r\n❯ 1. No, exit\r\n  2. Yes, I trust this folder\r\n' +
  'Bypass Permissions mode\r\n❯ 1. No, exit\r\n  2. Yes, I accept\r\n' +
  'Allow Codex to work in this folder?\r\n❯ 1. No\r\n  2. Yes, allow\r\n'

function fakeProcess(
  file: string,
  args: string[],
  options: PtySpawnOptions,
): { record: FakeProcess; session: PtySession } {
  const dataListeners = new Set<(data: string) => void>()
  const exitListeners = new Set<(exit: { exitCode: number }) => void>()
  let exited = false
  const record: FakeProcess = {
    file,
    args,
    options,
    written: [],
    writtenAfterKill: [],
    killed: false,
    exits: [],
    output(data) {
      for (const listener of [...dataListeners]) listener(data)
    },
  }
  const session: PtySession = {
    write(data) {
      if (record.killed) record.writtenAfterKill.push(data)
      else record.written.push(data)
    },
    onData(listener) {
      dataListeners.add(listener)
      return () => dataListeners.delete(listener)
    },
    onExit(listener) {
      exitListeners.add(listener)
      return () => exitListeners.delete(listener)
    },
    resize() {},
    kill() {
      if (exited) return
      exited = true
      record.killed = true
      record.exits.push(0)
      for (const listener of [...exitListeners]) listener({ exitCode: 0 })
    },
  }
  return { record, session }
}

/** Every file under `root`, as `[path, contents]`. */
function filesUnder(root: string, prefix = ''): [string, string][] {
  if (!existsSync(root)) return []
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name)
    const shown = prefix ? `${prefix}/${name}` : name
    if (statSync(path).isDirectory()) return filesUnder(path, shown)
    return [[shown, readFileSync(path, 'utf8')] as [string, string]]
  })
}
