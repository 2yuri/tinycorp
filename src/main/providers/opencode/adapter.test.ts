import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { providerEntry } from '../../../shared/domain/providers'
import { onDisk } from '../../core/testing'
import type { CliOutcome } from '../../platform/run-cli'
import {
  CONFORMANCE_EMPLOYEE,
  CONFORMANCE_HOOK_TOKEN,
  CONFORMANCE_SESSION_ID,
  type ConformanceSpec,
  describeProviderConformance,
  type FakeProcess,
  openConformance,
  readBackJsonServer,
} from '../provider-conformance'
import {
  AGENT_NAME,
  CONFIG_ENV,
  createOpencodeAdapter,
  detectIdle,
  OPENCODE_SKILLS_FOLDER,
  resetAt,
  subscriptionEnv,
} from './adapter'
import { opencodePluginSource, PLUGIN_PATH, READY_EVENT, RESUME_ENV } from './plugin'

/**
 * OpenCode against the Provider conformance suite.
 *
 * Every payload below is one OpenCode really sends: they were read off a plugin that wrote its own
 * event stream to a file while `opencode` 1.18.4 ran. Nothing here spends the boss's subscription
 * — the suite runs against a fake process, and the real CLI is checked in
 * `real-opencode-loop.itest.ts`, which `pnpm test` does not run.
 */

const entry = providerEntry('opencode')
/** A model the catalogue claims a level for, so the suite's model check covers the variant too. */
const model = entry.models.find((option) => option.effort !== null)!
/** A model with no level at all: OpenCode's own default, and no `variant` in its config. */
const modelWithoutVariant = entry.models.find((option) => option.effort === null)!

/** An OpenCode conversation id, in OpenCode's own spelling: it names its own conversations. */
const CONVERSATION = 'ses_f3ac8c8fbffeB7CaAO41EHVBFi'

const SPEC: ConformanceSpec = {
  provider: 'opencode',
  command: entry.command,
  create: (setup) => createOpencodeAdapter({ ...setup, command: entry.command, installed: () => true }),

  // OpenCode has no `--append-system-prompt` and no `--mcp-config`: both ride in a config file
  // this Session owns, named on the process by OPENCODE_CONFIG.
  instructionsOn: (process) => sessionConfig(process)?.agent[AGENT_NAME]?.prompt ?? null,
  continues: (process, sessionId) => after(process, '--session') === sessionId,
  startsFresh: (process) => after(process, '--session') === null,
  mcpOn(process) {
    const company = sessionConfig(process)?.mcp?.company
    if (!company) return null
    return { url: company.url, token: company.headers.Authorization.replace('Bearer ', '') }
  },
  // OpenCode keeps every server in the same per-Session config file the instructions ride in.
  grantedOn(process) {
    const servers: Record<string, OpencodeMcpServer | undefined> = sessionConfig(process)?.mcp ?? {}
    return Object.entries(servers)
      .filter(([name]) => name !== 'company')
      .map(([name, entry]) =>
        readBackJsonServer(name, {
          ...(entry?.url !== undefined && { url: entry.url }),
          ...(entry?.headers !== undefined && { headers: entry.headers }),
          ...(entry?.command?.[0] !== undefined && { command: entry.command[0] }),
          ...(entry?.command !== undefined && { args: entry.command.slice(1) }),
          ...(entry?.environment !== undefined && { env: entry.environment }),
        }),
      )
  },
  modelOn(process) {
    const chosen = after(process, '--model')
    // The model is on the command line and the effort is not: `--variant` belongs to `opencode
    // run`, and the TUI this adapter spawns takes it as the agent's `variant` in the config.
    return chosen === null
      ? null
      : { model: chosen, effort: sessionConfig(process)?.agent[AGENT_NAME]?.variant ?? null }
  },
  model: { id: model.id, model: model.model, effort: model.effort },

  signals: {
    // OpenCode's stream says nothing at all at start-up, so `ready` is the plugin's own signal.
    ready: { type: READY_EVENT, properties: { sessionID: CONVERSATION, resumed: true } },
    busy: { type: 'session.status', properties: { sessionID: CONVERSATION, status: { type: 'busy' } } },
    idle: { type: 'session.idle', properties: { sessionID: CONVERSATION } },
    quiet: { type: 'session.updated', properties: { sessionID: CONVERSATION, info: { id: CONVERSATION } } },
  },
  // `.opencode/skills/` is where OpenCode loads a project's own skills from, confirmed against the
  // installed CLI's own `debug skill` listing rather than guessed (T253).
  skillsIn: (worktree) => namesIn(join(worktree, OPENCODE_SKILLS_FOLDER)),
  // OpenCode has no hook file: the rewrite is the RTK the plugin was written with, and the plugin
  // is the one TinyCorp already writes for the status events.
  rewriteIn: (cwd) => rtkInPlugin(join(cwd, PLUGIN_PATH)),
  // The plugin mutates the command OpenCode is about to run and answers nothing about permission,
  // so OpenCode's own approval fires on the rewritten command exactly as it would on the original.
  rewriteAsk: {
    hook: {
      type: 'permission.asked',
      properties: { sessionID: CONVERSATION, id: 'per-2', action: 'bash', resources: ['rtk git push'] },
    },
    what: 'bash rtk git push',
  },
  asking: {
    hook: {
      type: 'permission.asked',
      properties: { sessionID: CONVERSATION, id: 'per-1', action: 'edit', resources: ['src/api/usage.ts'] },
    },
    what: 'edit src/api/usage.ts',
  },
  resumed: {
    continued: { type: READY_EVENT, properties: { sessionID: CONVERSATION, resumed: true } },
    fresh: { type: READY_EVENT, properties: { sessionID: null, resumed: false } },
  },
  signalSessionId: CONVERSATION,
  // OpenCode fronts other products: `opencode auth list` prints the accounts it is signed in to.
  signIn: {
    in: { kind: 'output', code: 0, output: 'Credentials\n  anthropic  oauth\n  github-copilot  oauth\n' },
    out: { kind: 'output', code: 0, output: 'Credentials\n  No credentials found\n' },
  },

  // OpenCode's own words for a spent allowance, from its usage-exceeded copy. The sentence that
  // names the reset is the signed-in account's rather than OpenCode's, which is why the adapter
  // reads both shapes of one.
  limit: {
    output: 'Usage limit reached. To continue using this model now, try again in 2h 15m.',
    now: '2026-01-01T10:00:00.000Z',
    resetsAt: '2026-01-01T12:15:00.000Z',
  },
  ordinary: 'Reading src/index.ts',
  submit: '\r',
}

describeProviderConformance(SPEC)

/**
 * The same contract with the CLI inside a WSL distro (T167). Not a second adapter and not a second
 * set of expectations: the runtime layer wraps the seams the adapter already takes, so every check
 * above has to hold word for word with the process started through `wsl.exe`.
 */
describeProviderConformance({ ...SPEC, label: 'OpenCode in WSL', runtime: { distro: 'Ubuntu' } })

/**
 * What OpenCode does that no other Provider does. It lives beside the suite rather than inside it:
 * the contract is the same for every Provider, and these are OpenCode's own answers to it.
 */
describe('opencode adapter', () => {
  it('runs the Employee as an agent of its own, defined in that Session’s config alone', () => {
    const run = openConformance(SPEC)
    try {
      const { process } = run.start()
      const config = sessionConfig(process)!

      expect(after(process, '--agent')).toBe(AGENT_NAME)
      expect(config.agent[AGENT_NAME]!.mode).toBe('primary')
      // The config is the app's own file, never the Company folder two Employees share.
      expect(process.options.env[CONFIG_ENV]!.startsWith(run.cwd)).toBe(false)
    } finally {
      run.close()
    }
  })

  it('hands OpenCode the Employee’s effort as this agent’s variant, because the TUI takes no flag', () => {
    const run = openConformance(SPEC)
    try {
      const { process } = run.start({ ...CONFORMANCE_EMPLOYEE, model: model.id })

      // `--variant` is an option of `opencode run` alone. An adapter that reached for it here
      // would spawn a TUI that refuses the argument, so the level rides in the config instead.
      expect(process.args).not.toContain('--variant')
      expect(sessionConfig(process)?.agent[AGENT_NAME]?.variant).toBe(model.effort)
    } finally {
      run.close()
    }
  })

  it('claims no variant for a model the catalogue knows no level for, rather than inventing one', () => {
    const run = openConformance(SPEC)
    try {
      const chosen = run.start({ ...CONFORMANCE_EMPLOYEE, model: modelWithoutVariant.id }).process
      const none = run.start().process

      // OpenCode types `variant` as a free-form string and validates it nowhere at all — it runs
      // an invented one at its default, silently. A guess here is not an error anyone sees, it is
      // an Employee thinking less hard than the catalogue promised. Write nothing.
      for (const process of [chosen, none]) {
        expect(sessionConfig(process)!.agent[AGENT_NAME]).not.toHaveProperty('variant')
      }
    } finally {
      run.close()
    }
  })

  it('keeps the Employee’s variant on a resume, so a restart never quietly lowers the effort', () => {
    const run = openConformance(SPEC)
    try {
      const { process } = run.start({ ...CONFORMANCE_EMPLOYEE, model: model.id }, { resume: true })

      expect(sessionConfig(process)?.agent[AGENT_NAME]?.variant).toBe(model.effort)
    } finally {
      run.close()
    }
  })

  it('installs its status plugin in the Company folder, with the receiver’s URL and no Employee', () => {
    const run = openConformance(SPEC)
    try {
      run.start()
      const file = join(run.cwd, PLUGIN_PATH)

      expect(existsSync(file)).toBe(true)
      const plugin = readFileSync(file, 'utf8')
      expect(plugin).toContain('http://127.0.0.1:4555/hook')
      expect(plugin).toContain('TINYCORP_HOOK_TOKEN')
      // One file serves every Employee in the folder, so it names none of them (decision 48).
      expect(plugin).not.toContain('Ada')
    } finally {
      run.close()
    }
  })

  it('tells the plugin which conversation it asked OpenCode to continue, and only then', () => {
    const run = openConformance(SPEC)
    try {
      const fresh = run.start().process
      const resumed = run.start(undefined, { resume: true }).process

      expect(fresh.options.env[RESUME_ENV]).toBeUndefined()
      expect(resumed.options.env[RESUME_ENV]).toBe(CONFORMANCE_SESSION_ID)
      expect(resumed.options.env['TINYCORP_HOOK_TOKEN']).toBe(CONFORMANCE_HOOK_TOKEN)
    } finally {
      run.close()
    }
  })

  it('reads a conversation OpenCode opened itself as a resume that did not take', () => {
    const run = openConformance(SPEC)
    try {
      const created = { type: 'session.created', properties: { sessionID: 'ses_somethingelse' } }

      // A conversation of OpenCode's own is both the start-up signal and the denial: the Session
      // it was told to continue is not the one it is in.
      expect(run.adapter.detectIdle(created)).toBe('ready')
      expect(run.adapter.confirmsResume!(created)).toBe(false)
      expect(run.adapter.sessionIdOf!(created)).toBe('ses_somethingelse')
    } finally {
      run.close()
    }
  })

  it('reads the turn out of OpenCode’s own status event, and nothing out of the rest', () => {
    expect(detectIdle({ type: 'session.status', properties: { status: { type: 'idle' } } })).toBe('idle')
    expect(detectIdle({ type: 'session.status', properties: { status: { type: 'retrying' } } })).toBeNull()
    expect(detectIdle({ type: 'message.part.delta', properties: {} })).toBeNull()
    expect(detectIdle({ type: 'session.error', properties: {} })).toBeNull()
  })

  /**
   * T199, finding H5. OpenCode's config file is the whole of this Session — its agent, the
   * Employee's instructions and every MCP token it was granted — and it stays readable by every
   * other Employee of this machine for as long as it is on the disk.
   */
  it('deletes the Session’s whole config when the Session ends, and no other Session’s', () => {
    const run = openConformance(SPEC)
    try {
      run.adapter.injectMcp(CONFORMANCE_SESSION_ID, {
        company: { url: 'http://127.0.0.1:9000/mcp', token: 'bearer-6b7c8d' },
        granted: [],
      })
      const mine = run.start().process.options.env[CONFIG_ENV]!
      const theirs = run.start(CONFORMANCE_EMPLOYEE, { sessionId: 'another-session' }).process.options.env[CONFIG_ENV]!
      expect(readFileSync(mine, 'utf8')).toContain('bearer-6b7c8d')

      run.adapter.forgetSession!(CONFORMANCE_SESSION_ID)

      expect(existsSync(mine)).toBe(false)
      expect(existsSync(theirs)).toBe(true)
    } finally {
      run.close()
    }
  })

  it('never hands a Session an API key, its own config, or a parent Session’s server', () => {
    const stripped = subscriptionEnv({
      PATH: '/usr/bin',
      HOME: onDisk('/Users/boss'),
      OPENCODE_API_KEY: 'sk-nope',
      OPENCODE_AUTH_CONTENT: '{"anthropic":{}}',
      OPENCODE_CONFIG: '/somebody/elses.json',
      OPENCODE_PID: '4242',
      ANTHROPIC_API_KEY: 'sk-also-nope',
    })

    // The boss's OpenCode login is in its XDG data folder, which no OPENCODE_* variable names.
    expect(stripped).toEqual({ PATH: '/usr/bin', HOME: onDisk('/Users/boss'), ANTHROPIC_API_KEY: 'sk-also-nope' })
  })

  it('parks a team on a spent allowance, and never on a throttle that will clear itself', () => {
    const run = openConformance(SPEC)
    try {
      const spent = [
        'Usage limit reached. To continue using this model now, enable usage from your available balance.',
        'Free usage exceeded',
        'You have exceeded your premium request allowance for this month.',
        'Quota exceeded for this account.',
      ]
      const passing = [
        'AI_APICallError: 429 Too Many Requests',
        'Rate limit exceeded — retrying in 5s',
        'Reading src/index.ts',
      ]

      for (const output of spent) expect(run.adapter.detectBudgetExhausted(output), output).toBe(true)
      for (const output of passing) expect(run.adapter.detectBudgetExhausted(output), output).toBe(false)
    } finally {
      run.close()
    }
  })

  it('reads a reset OpenCode relays as a clock time, as a duration, or not at all', () => {
    const now = new Date('2026-01-01T10:00:00.000Z')

    expect(resetAt('Usage limit reached. Try again in 45m.', now)?.toISOString()).toBe('2026-01-01T10:45:00.000Z')
    expect(resetAt('Rate limit exceeded — resets in 1h 30m', now)?.toISOString()).toBe('2026-01-01T11:30:00.000Z')
    expect(resetAt('Quota exceeded. Resets at 2026-01-02T09:00:00.000Z.', now)?.toISOString()).toBe(
      '2026-01-02T09:00:00.000Z',
    )
    // A limit that names no time at all gets no countdown rather than an invented one.
    expect(resetAt('Usage limit reached.', now)).toBeNull()
    expect(resetAt('Reading src/index.ts', now)).toBeNull()
  })

  it('writes a plugin that says nothing at all without a Session token', () => {
    const source = opencodePluginSource('http://127.0.0.1:4555/hook')

    expect(source).toContain('if (!TOKEN) return {}')
    expect(source).toContain('x-tinycorp-token')
  })
})

/**
 * What `opencode auth list` really prints, and what TinyCorp reads out of it.
 *
 * The CLI draws a box: a heading with the path of `auth.json`, a bullet per credential, and a
 * count at the foot. An earlier reader took everything after the *last* `credentials` in the
 * output, which on a real machine is that count — so a signed-in OpenCode read as signed out and
 * every Employee on it would have been refused. These are the CLI's own bytes, with the escapes
 * it wraps them in.
 */
describe('What OpenCode answers the preflight', () => {
  const entry = providerEntry('opencode')
  const adapter = (outcome: CliOutcome) =>
    createOpencodeAdapter({
      hookUrl: 'http://127.0.0.1:4555/hook',
      dataDir: join(tmpdir(), 'tinycorp-opencode-preflight'),
      command: entry.command,
      name: entry.name,
      env: { PATH: '/usr/bin' },
      installed: () => true,
      runCli: async () => outcome,
    })

  const output = (text: string): CliOutcome => ({ kind: 'output', code: 0, output: text })

  /** One credential, boxed and bulleted the way the CLI draws it. */
  const boxed =
    '\u001b[0m\n┌  Credentials \u001b[90m~/.local/share/opencode/auth.json\n│\n' +
    '●  GitHub Copilot \u001b[90moauth\n│\n└  1 credentials\n'

  /** The same box with nothing in it. */
  const empty = '\u001b[0m\n┌  Credentials \u001b[90m~/.local/share/opencode/auth.json\n│\n└  No credentials found\n'

  it('reads the boxed output of the real CLI as signed in', async () => {
    const check = await adapter(output(boxed)).checkCli()

    expect(check.state, 'a signed-in OpenCode read as signed out refuses every Employee on it').toBe('ready')
  })

  it('names the accounts OpenCode is signed in as, because it holds no subscription of its own', async () => {
    const check = await adapter(output(boxed)).checkCli()

    expect(check.account).toBe('GitHub Copilot')
    expect(check.plan, 'OpenCode runs on accounts the boss already has; it names no plan').toBeNull()
  })

  it('names every account when there is more than one', async () => {
    const two =
      '┌  Credentials ~/.local/share/opencode/auth.json\n│\n●  Anthropic oauth\n│\n●  GitHub Copilot oauth\n│\n└  2 credentials\n'

    expect((await adapter(output(two)).checkCli()).account).toBe('Anthropic and GitHub Copilot')
  })

  it('does not read the count at the foot, or the heading, as a credential', async () => {
    expect((await adapter(output(empty)).checkCli()).state).toBe('signed-out')
    expect((await adapter(output(empty)).checkCli()).account).toBeNull()
  })

  it('never names an account out of a command that did not answer', async () => {
    for (const outcome of [{ kind: 'timeout' } as const, { kind: 'failed' } as const]) {
      const check = await adapter(outcome).checkCli()

      expect([check.state, check.account]).toEqual(['signed-out', null])
    }
  })
})

/** This Session's OpenCode config, read back off the process the way OpenCode reads it. */
function sessionConfig(process: FakeProcess): OpencodeConfig | null {
  const path = process.options.env[CONFIG_ENV]
  if (!path || !existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf8')) as OpencodeConfig
}

interface OpencodeConfig {
  agent: Record<string, { prompt: string; mode: string; variant?: string } | undefined>
  mcp?: Record<string, OpencodeMcpServer | undefined> & {
    company?: { url: string; headers: { Authorization: string } }
  }
}

/** A server in OpenCode's config: `remote` carries a URL, `local` a command and its environment. */
interface OpencodeMcpServer {
  url?: string
  headers?: Record<string, string>
  command?: string[]
  environment?: Record<string, string>
}

/** The value after `flag` on the command line, or null when the flag is not there. */
function after(process: FakeProcess, flag: string): string | null {
  const at = process.args.indexOf(flag)
  return at === -1 ? null : (process.args[at + 1] ?? null)
}

/**
 * The command the boss opens this Session with in their own terminal (T164). OpenCode carries no
 * permission flag at all — it is the one Provider whose spawn says nothing about the mode — so
 * there is none to reproduce here and none that can be dropped.
 */
describe('the handoff command', () => {
  const run = () => openConformance(SPEC)
  /** The suite's Employee, on this Provider: the model ids belong to its own catalogue entry. */
  const nova = { ...CONFORMANCE_EMPLOYEE, provider: 'opencode' as const }

  it('resumes this conversation, on the Employee’s own model', () => {
    const open = run()
    try {
      const command = open.adapter.handoffCommand!({ ...nova, model: model.id }, CONVERSATION)

      expect(command).toEqual([entry.command, '--session', CONVERSATION, '--model', model.model])
    } finally {
      open.close()
    }
  })

  it('reads the same for either permission mode, because OpenCode takes neither on the command line', () => {
    const open = run()
    try {
      const skips = { ...nova, permissionMode: 'skip-permissions' as const }
      const asks = { ...nova, permissionMode: 'interactive' as const }

      expect(open.adapter.handoffCommand!(skips, CONVERSATION)).toEqual(
        open.adapter.handoffCommand!(asks, CONVERSATION),
      )
    } finally {
      open.close()
    }
  })

  it('leaves the app’s own config behind: the agent and its instructions are TinyCorp’s half', () => {
    const open = run()
    try {
      const command = open.adapter.handoffCommand!(nova, CONVERSATION)!

      expect(command).not.toContain('--agent')
      expect(command).not.toContain(AGENT_NAME)
    } finally {
      open.close()
    }
  })
})

/**
 * The RTK the plugin in `file` was written with, or null when it was written with none. The plugin
 * carries it as one constant, so this is the whole of what a Session was given (T179).
 */
function rtkInPlugin(file: string): string | null {
  if (!existsSync(file)) return null
  const found = /^const RTK = "(.*)"$/m.exec(readFileSync(file, 'utf8'))
  return found?.[1] ? found[1] : null
}

/** What is in a folder, hidden entries left out; empty when the folder is not there. */
function namesIn(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir).filter((name) => !name.startsWith('.')) : []
}
