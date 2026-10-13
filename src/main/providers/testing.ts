/**
 * `providers`' test kit: one fake adapter per catalogue entry, spawning nothing.
 *
 * It is what `TINYCORP_E2E` swaps the real adapters for, and what a test asks for when it needs an
 * Employee to have a Session without spending the boss's subscription. It is not part of
 * `providers/index.ts`: the fakes are named as this file, so nothing that wants a real Provider
 * carries them.
 */

import { PROVIDERS } from '../../shared/domain/providers'
import type { Employee } from '../../shared/domain/staff'
import { type RtkHook, rtkEnv } from '../../shared/rtk'
import {
  claudeBudgetExhausted,
  claudeBudgetResetAt,
  claudeConfirmsResume,
  claudeHookSignal,
  claudeModelArgs,
  claudeSubagentSignal,
} from './claude/adapter'
import type {
  GrantedMcpServer,
  GrantedSkill,
  HookPayload,
  ProviderAdapter,
  ProviderAdapters,
  PtySession,
  SessionMcp,
  SpawnRequest,
} from './provider-adapter'
import { accountEnv, sessionRtk } from './provider-adapter'

/** Delivers a hook to the engine, as the hook receiver does. */
export type HookSink = (token: string, payload: HookPayload) => void

export interface FakePty extends PtySession {
  /** Everything written to the terminal, in order. */
  written: string[]
  killed: boolean
  /** The size last set by `resize`; null until then. */
  size: { cols: number; rows: number } | null
  /** Simulates the CLI printing `data`. */
  output(data: string): void
  /** Simulates the CLI exiting on its own. */
  exit(exitCode?: number): void
}

export interface FakeSpawn {
  request: SpawnRequest
  pty: FakePty
  /** The Company MCP server this Session was given, if any. */
  mcp?: { url: string; token: string }
  /** The servers the boss granted this Employee, as the engine resolved them (T136). */
  granted: readonly GrantedMcpServer[]
  /** Every prompt pushed into this Session, in order. */
  pushed: string[]
  /** The model args the Claude adapter would pass for this spawn's Employee, e.g. `['--model', …]`. */
  modelArgs: string[]
  /**
   * The environment this spawn would run with, as far as an account is concerned (T173): what
   * `configDirEnv` put on it, and nothing else. Empty for a Provider that keeps one sign-in.
   */
  env: Record<string, string>
  /** The instructions this Session's own process was given, if any. */
  instructions?: SpawnInstructions
  /** Emits a hook from this Session, e.g. `hook('SessionStart')`. */
  hook(event: string, fields?: HookPayload): void
}

/** What one spawn put on its own process: who it was for, where it ran, and the prompt it carried. */
export interface SpawnInstructions {
  employee: Employee
  cwd: string
  text: string
}

export interface FakeProvider extends ProviderAdapter {
  spawns: FakeSpawn[]
  /**
   * Every `installSkills` call, in order (T137). A fake made with `{ skills: false }` implements
   * none, which is a Provider whose product reads no skill folders — the drawer says so.
   */
  skillInstalls: { worktree: string; skills: readonly GrantedSkill[] }[]
  /** What each worktree holds now, as the last call for it left it. */
  skillsIn(worktree: string): string[]
  /** Pretends the provider's CLI is missing from this machine. */
  uninstall(): void
  /** The instructions every spawn was given, in order. */
  instructions: SpawnInstructions[]
  /** The most recent spawn of an Employee's own Session; never one of its sub-sessions'. */
  spawnOf(employeeId: string): FakeSpawn
  /** The most recent spawn of a sub-session an Employee started (T163), by the name it was given. */
  subSpawnOf(name: string): FakeSpawn
  /** Where emitted hooks go; usually `engine.sessions.receiveHook`. */
  connect(sink: HookSink): void
  /**
   * Every provider session id the engine has ended, in order (T199, finding H5). A real adapter
   * deletes the file holding that Session's bearer token here; a Session whose id never arrives
   * is one whose token outlives it.
   */
  forgotten: string[]
  /** The MCP servers a Session still holds, or undefined once the engine has ended it. */
  mcpOf(sessionId: string): SessionMcp | undefined
}

/** The variable a fake Provider with accounts reads its config directory from. */
export const FAKE_CONFIG_DIR_ENV = 'FAKE_CONFIG_DIR'

/** Where a fake Provider with accounts keeps its own sign-in. */
export const FAKE_DEFAULT_CONFIG_DIR = '/home/boss/.fake'

/**
 * A fake for every Provider in the catalogue, ready for `createCompanyEngine({ providers })`. What
 * an end-to-end run is given in place of the real adapters (T189, `src/main/e2e-mode.ts`), so no
 * screen it drives ever starts a CLI.
 */
export function fakeProviderAdapters(): ProviderAdapters {
  const adapters: ProviderAdapters = {}
  for (const provider of PROVIDERS) adapters[provider] = fakeProvider()
  return adapters
}

/** A ProviderAdapter for tests: records spawns and lets the test emit hooks. */
export function fakeProvider({
  skills = true,
  subagents = true,
  handoff = true,
  accounts = false,
}: {
  skills?: boolean
  /** Whether it reports subagents, as Claude Code does; `false` is a Provider that has none (T162). */
  subagents?: boolean
  /**
   * Whether it builds a command the boss can open a Session with (T164); `false` is a Provider
   * that cannot be handed over, and whose drawer draws no button.
   */
  handoff?: boolean
  /**
   * Whether its CLI holds more than one sign-in, each in its own config directory (T173). `false`
   * is a Provider that keeps one, which is what the Accounts card says of it.
   */
  accounts?: boolean
} = {}): FakeProvider {
  let sink: HookSink = () => {
    throw new Error('fakeProvider is not connected to an engine')
  }
  const spawns: FakeSpawn[] = []
  /** Every RTK a spawn's rewrite was installed with, in order; a null is one that took it out. */
  const rewritten: (RtkHook | null)[] = []
  let installed = true
  const instructions: SpawnInstructions[] = []
  const mcpBySession = new Map<string, SessionMcp>()
  const forgotten: string[] = []
  const skillInstalls: { worktree: string; skills: readonly GrantedSkill[] }[] = []
  const skillsByWorktree = new Map<string, string[]>()

  const adapter: FakeProvider = {
    spawns,
    instructions,
    forgotten,
    mcpOf: (sessionId) => mcpBySession.get(sessionId),
    skillInstalls,
    skillsIn: (worktree) => skillsByWorktree.get(worktree) ?? [],
    ...(skills && {
      installSkills(worktree: string, granted: readonly GrantedSkill[]) {
        skillInstalls.push({ worktree, skills: granted })
        skillsByWorktree.set(
          worktree,
          granted.filter((skill) => !skill.missing).map((skill) => skill.name),
        )
      },
    }),
    uninstall() {
      installed = false
    },
    spawnOf(employeeId) {
      const found = spawns.findLast((s) => s.request.employee.id === employeeId && !s.request.subSession)
      if (!found) throw new Error(`No spawn for ${employeeId}`)
      return found
    },
    subSpawnOf(name) {
      const found = spawns.findLast((s) => s.request.subSession?.name === name)
      if (!found) throw new Error(`No sub-session spawn named ${name}`)
      return found
    },
    connect(next) {
      sink = next
    },
    spawn(request) {
      const pty = fakePty()
      const given: SpawnInstructions | undefined =
        request.instructions === undefined
          ? undefined
          : { employee: request.employee, cwd: request.cwd, text: request.instructions }
      if (given) instructions.push(given)
      const injected = mcpBySession.get(request.sessionId)
      spawns.push({
        request,
        pty,
        pushed: [],
        modelArgs: claudeModelArgs(request.employee),
        env: { ...accountEnv(adapter, request.account), ...rtkEnv(sessionRtk(adapter, request)) },
        ...(injected?.company && { mcp: injected.company }),
        granted: injected?.granted ?? [],
        ...(given !== undefined && { instructions: given }),
        hook: (event, fields = {}) =>
          sink(request.hookToken, {
            hook_event_name: event,
            session_id: request.sessionId,
            ...fields,
          }),
      })
      return pty
    },
    injectMcp(sessionId, servers) {
      mcpBySession.set(sessionId, servers)
      return []
    },

    // The real adapters take a file off the disk here (T199, finding H5); a fake writes none, so
    // what it keeps is the record that the engine asked — and the servers it was holding go.
    forgetSession(sessionId) {
      mcpBySession.delete(sessionId)
      forgotten.push(sessionId)
    },

    // A product that can rewrite a command (T179). It writes nothing: what the real adapters write
    // is checked by the conformance suite, and what the engine hands them is checked through this.
    commandRewriteHook: (rtk) => ({
      how: 'Bash hook · rewrites commands',
      keepsApprovals: true,
      install: () => rewritten.push(rtk),
    }),
    resumeCommand: (sessionId) => ['--resume', sessionId],
    ...(accounts && {
      accounts: () => ({
        env: FAKE_CONFIG_DIR_ENV,
        defaultDir: FAKE_DEFAULT_CONFIG_DIR,
      }),
      configDirEnv: (configDir: string) => ({ [FAKE_CONFIG_DIR_ENV]: configDir }),
    }),
    ...(handoff && {
      handoffCommand: (employee: Employee, providerSessionId: string) => [
        'fake-cli',
        '--resume',
        providerSessionId,
        ...(employee.permissionMode === 'skip-permissions' ? ['--skip-permissions'] : []),
        ...claudeModelArgs(employee),
      ],
    }),
    confirmsResume: claudeConfirmsResume,
    detectIdle: claudeHookSignal,
    ...(subagents && { subagentOf: claudeSubagentSignal }),
    detectBudgetExhausted: claudeBudgetExhausted,
    budgetResetAt: claudeBudgetResetAt,
    pushPrompt(session, text) {
      spawns.find((s) => s.pty === session)?.pushed.push(text)
      session.write(text)
      session.write('\r')
    },
    installed: () => installed,

    /**
     * The engine never asks this: the preflight does, in the main process, and it hands the engine
     * the sentence through `refuseSession`. A fake that is installed is signed in.
     */
    checkCli: () =>
      Promise.resolve(
        installed
          ? {
              state: 'ready' as const,
              title: 'Signed in',
              body: '',
              lead: '',
              commands: [],
              note: '',
              account: 'boss@example.com',
              plan: 'Plus',
            }
          : {
              state: 'missing' as const,
              title: 'Not installed',
              body: '',
              lead: '',
              commands: [],
              note: '',
              account: null,
              plan: null,
            },
      ),
  }
  return adapter
}

function fakePty(): FakePty {
  const dataListeners = new Set<(data: string) => void>()
  const exitListeners = new Set<(exit: { exitCode: number }) => void>()
  let exited = false
  const pty: FakePty = {
    written: [],
    killed: false,
    size: null,
    write(data) {
      pty.written.push(data)
    },
    onData(listener) {
      dataListeners.add(listener)
      return () => dataListeners.delete(listener)
    },
    onExit(listener) {
      exitListeners.add(listener)
      return () => exitListeners.delete(listener)
    },
    resize(cols, rows) {
      pty.size = { cols, rows }
    },
    output(data) {
      for (const listener of dataListeners) listener(data)
    },
    kill() {
      pty.killed = true
      pty.exit(0)
    },
    exit(exitCode = 0) {
      if (exited) return
      exited = true
      for (const listener of exitListeners) listener({ exitCode })
    },
  }
  return pty
}
