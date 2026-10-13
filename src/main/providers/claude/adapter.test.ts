import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Employee } from '../../../shared/domain/staff'
import type { ProviderPlacement } from '../../../shared/platform/wsl'
import { EMPTY_STACK } from '../../../shared/repos/repo'
import { ASK_WHAT_MAX, GENERATED_INSTRUCTIONS_MARKER } from '../../../shared/session'
import { onDisk } from '../../core/testing'
import { type CompanyBrief, renderInstructions } from '../../features/sessions/instructions'
import { askOf, type PtySession } from '../provider-adapter'
import {
  type ConformanceSpec,
  describeProviderConformance,
  type FakeProcess,
  hookCommandFor,
  type JsonServer,
  readBackJsonServer,
} from '../provider-conformance'
import { hookCommand, hookPlatform, rtkHookCommand } from '../provider-hooks'
import {
  CLAUDE_HOOK_EVENTS,
  CLAUDE_PERMISSION_ASK,
  CLAUDE_RTK_AGENT,
  CLAUDE_SKILLS_FOLDER,
  claudeConfirmsResume,
  claudeHookHandler,
  claudeHookSignal,
  createClaudeAdapter,
  HOOK_TOKEN_ENV,
  type PtySpawnOptions,
} from './adapter'

/** What a spawn put after `flag`, or null when it did not pass it. */
const after = (process: FakeProcess, flag: string) =>
  process.args.includes(flag) ? (process.args[process.args.indexOf(flag) + 1] ?? null) : null

const CONFORMANCE: ConformanceSpec = {
  provider: 'claude',
  command: 'claude',
  create: ({ spawnPty, dataDir, hookUrl, env, runCli }) =>
    createClaudeAdapter({ hookUrl, dataDir, spawnPty, env, runCli, installed: () => true }),
  instructionsOn: (process) => after(process, '--append-system-prompt'),
  continues: (process, sessionId) => after(process, '--resume') === sessionId,
  startsFresh: (process) => !process.args.includes('--resume'),
  mcpOn(process) {
    const file = after(process, '--mcp-config')
    if (!file) return null
    const config = JSON.parse(readFileSync(file, 'utf8')) as {
      mcpServers: { company: { url: string; headers: { authorization: string } } }
    }
    const { url, headers } = config.mcpServers.company
    return { url, token: headers.authorization.replace(/^Bearer /, '') }
  },
  // Every granted server is in the same file, beside `company`, with its secret inside it.
  grantedOn(process) {
    const file = after(process, '--mcp-config')
    if (!file) return []
    const config = JSON.parse(readFileSync(file, 'utf8')) as { mcpServers: Record<string, JsonServer> }
    return Object.entries(config.mcpServers)
      .filter(([name]) => name !== 'company')
      .map(([name, entry]) => readBackJsonServer(name, entry))
  },
  // Claude Code reads every folder in `.claude/skills/`, whatever put it there.
  skillsIn: (worktree) => {
    const dir = join(worktree, CLAUDE_SKILLS_FOLDER)
    return existsSync(dir) ? readdirSync(dir).filter((name) => !name.startsWith('.')) : []
  },
  // The rewrite is one more `PreToolUse` entry in the Session's own settings, matched to `Bash`.
  rewriteIn: (cwd) => hookCommandFor(join(cwd, '.claude', 'settings.json'), 'PreToolUse', /hook claude\b/),
  // A rewritten `git push`: Claude Code's own permission hook still fires on it, because RTK
  // answers `ask` for anything the settings do not explicitly allow — and TinyCorp writes no
  // `permissions` into that file at all.
  rewriteAsk: {
    hook: {
      hook_event_name: 'PermissionRequest',
      session_id: 'sess-1',
      cwd: onDisk('/work/acme'),
      tool_name: 'Bash',
      tool_input: { command: 'rtk git push' },
    },
    what: 'rtk git push',
  },
  modelOn(process) {
    const model = after(process, '--model')
    return model === null ? null : { model, effort: after(process, '--effort') }
  },
  model: { id: 'opus-5-balanced', model: 'claude-opus-5', effort: 'medium' },
  signals: {
    ready: { hook_event_name: 'SessionStart', session_id: 'sess-1' },
    busy: { hook_event_name: 'PreToolUse', session_id: 'sess-1' },
    idle: { hook_event_name: 'Stop', session_id: 'sess-1' },
    quiet: { hook_event_name: 'SessionEnd', session_id: 'sess-1' },
  },
  asking: {
    hook: {
      hook_event_name: 'PermissionRequest',
      session_id: 'sess-1',
      cwd: onDisk('/work/acme'),
      tool_name: 'Write',
      tool_input: { file_path: onDisk('/work/acme/src/api/usage.ts'), content: 'hello' },
    },
    what: `Write ${join('src', 'api', 'usage.ts')}`,
  },
  resumed: {
    continued: { hook_event_name: 'SessionStart', source: 'resume', session_id: 'sess-1' },
    fresh: { hook_event_name: 'SessionStart', source: 'startup', session_id: 'sess-1' },
  },
  signalSessionId: 'sess-1',
  // `claude auth status` answers as JSON, and only a `claude.ai` login is the subscription.
  signIn: {
    in: { kind: 'output', code: 0, output: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' }) },
    out: { kind: 'output', code: 1, output: JSON.stringify({ loggedIn: false }) },
  },
  limit: {
    output: 'Claude usage limit reached ∙ resets 3pm (UTC)',
    now: '2026-09-17T12:00:00.000Z',
    resetsAt: '2026-09-17T15:00:00.000Z',
  },
  ordinary: 'Wrote 3 files, all tests pass',
  submit: '\r',
}

describeProviderConformance(CONFORMANCE)

/**
 * The same contract with the CLI inside a WSL distro (T167). Not a second adapter and not a
 * second set of expectations: the runtime layer wraps the seams the adapter already takes, so
 * every check above has to hold word for word with the process started through `wsl.exe`. The
 * day one of them does not, it is this line that says so.
 */
describeProviderConformance({ ...CONFORMANCE, label: 'Claude Code in WSL', runtime: { distro: 'Ubuntu' } })

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'claude-adapter-'))
})
afterEach(() => {
  vi.useRealTimers()
  rmSync(dir, { recursive: true, force: true })
})

const ada: Employee = {
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

const acme: CompanyBrief = {
  name: 'Acme',
  key: 'AC',
  repos: [
    { name: 'api', stack: { ...EMPTY_STACK, language: 'TypeScript', framework: 'Fastify', packageManager: 'pnpm' } },
  ],
  columns: [{ id: 'todo', wipLimit: null }],
  autonomy: 'managed',
  notesFile: onDisk('/work/acme/memory/emp-1/log'),
}

interface Spawned {
  file: string
  args: string[]
  options: PtySpawnOptions
  written: string[]
  output(data: string): void
}

/** The environment an Employee's Session is spawned into in these tests. */
const SESSION_ENV: NodeJS.ProcessEnv = { PATH: '/usr/bin', HOME: onDisk('/home/ada') }

function setup(env: NodeJS.ProcessEnv = SESSION_ENV, placement: ProviderPlacement | null = null) {
  const spawned: Spawned[] = []
  const adapter = createClaudeAdapter({
    hookUrl: 'http://127.0.0.1:4555/hook',
    dataDir: join(dir, 'data'),
    env,
    placement,
    spawnPty(file, args, options) {
      const listeners: ((data: string) => void)[] = []
      const record: Spawned = {
        file,
        args,
        options,
        written: [],
        output: (data) => {
          for (const listener of listeners) listener(data)
        },
      }
      spawned.push(record)
      const pty: PtySession = {
        write: (data) => void record.written.push(data),
        onData: (listener) => {
          listeners.push(listener)
          return () => {}
        },
        onExit: () => () => {},
        kill() {},
        resize() {},
      }
      return pty
    },
  })
  const cwd = join(dir, 'company')
  mkdirSync(cwd)
  return { adapter, spawned, cwd }
}

const request = (cwd: string, employee: Employee = ada, company?: CompanyBrief) => ({
  employee,
  cwd,
  // The engine renders the prompt and the adapter carries it (T184); this is the same text a real
  // spawn would be handed.
  ...(company && { instructions: renderInstructions(employee, company) }),
  sessionId: '11111111-2222-3333-4444-555555555555',
  hookToken: 'tok-123',
})

/** What a spawn put on `--append-system-prompt`. */
const systemPrompt = (spawned: Spawned) => spawned.args[spawned.args.indexOf('--append-system-prompt') + 1]!

describe('Claude adapter', () => {
  it('runs claude with the app-chosen session id and skip-permissions', () => {
    const { adapter, spawned, cwd } = setup()

    adapter.spawn(request(cwd))

    const [{ file, args, options }] = spawned as [Spawned]
    expect(file).toBe('claude')
    expect(args.slice(0, 5)).toEqual([
      '--session-id',
      '11111111-2222-3333-4444-555555555555',
      '--setting-sources',
      'project,local',
      '--dangerously-skip-permissions',
    ])
    expect(args[5]).toBe('--append-system-prompt')
    expect(args[6]).toContain('You are Ada, Backend')
    expect(options.cwd).toBe(cwd)
  })

  it('loads the folder’s settings and never the boss’s own (T234)', () => {
    // The bug: the boss drives other orchestrators, each of which writes its hooks into
    // `~/.claude/settings.json`, so every Employee's `claude` loaded them and the boss got an Orca
    // notification when an Employee replied. `user` is that file; `project` is the one the app
    // writes itself, so leaving `user` out costs the app nothing.
    const { adapter, spawned, cwd } = setup()

    adapter.spawn(request(cwd))

    const { args } = spawned[0]!
    const sources = args[args.indexOf('--setting-sources') + 1]!.split(',')
    expect(sources).not.toContain('user')
    expect(sources, 'the app writes the Session’s own hooks into the folder’s settings.json').toContain('project')
  })

  it('spawns a Session with no other orchestrator’s environment on it (T234)', () => {
    // The other half of the same leak, and the half no flag covers: a global hook reads these to
    // decide whose pane the event belongs to, and `ORCA_AGENT_HOOK_TOKEN` is another app's bearer
    // token that nothing in this Company has any business holding.
    const { adapter, spawned, cwd } = setup({
      ...SESSION_ENV,
      ORCA_PANE_KEY: 'pane-7',
      ORCA_AGENT_HOOK_TOKEN: 'another-app-s-bearer-token',
      CONDUCTOR_WORKSPACE_NAME: 'the-boss-s-other-workspace',
    })

    adapter.spawn(request(cwd))

    const { env } = spawned[0]!.options
    expect(env['ORCA_PANE_KEY']).toBeUndefined()
    expect(env['ORCA_AGENT_HOOK_TOKEN']).toBeUndefined()
    expect(env['CONDUCTOR_WORKSPACE_NAME']).toBeUndefined()
    expect(env['PATH'], 'the strip takes another orchestrator’s variables, not the machine’s').toBe('/usr/bin')
  })

  it('runs on the provider default when the Employee has no model', () => {
    const { adapter, spawned, cwd } = setup()

    adapter.spawn(request(cwd))

    expect(spawned[0]!.args).not.toContain('--model')
    expect(spawned[0]!.args).not.toContain('--effort')
  })

  it('passes the Employee’s model and its effort to claude', () => {
    const { adapter, spawned, cwd } = setup()

    adapter.spawn(request(cwd, { ...ada, model: 'opus-5-balanced' }))

    const { args } = spawned[0]!
    expect(args.slice(args.indexOf('--model'), args.indexOf('--model') + 2)).toEqual(['--model', 'claude-opus-5'])
    expect(args.slice(args.indexOf('--effort'), args.indexOf('--effort') + 2)).toEqual(['--effort', 'medium'])
    expect(args.at(-2)).toBe('--append-system-prompt')
  })

  it('passes no effort when the model option names none', () => {
    const { adapter, spawned, cwd } = setup()

    adapter.spawn(request(cwd, { ...ada, model: 'haiku-4-5-fast' }))

    expect(spawned[0]!.args).toContain('claude-haiku-4-5-20251001')
    expect(spawned[0]!.args).not.toContain('--effort')
  })

  it('keeps the model on resume', () => {
    const { adapter, spawned, cwd } = setup()

    adapter.spawn({ ...request(cwd, { ...ada, model: 'sonnet-5-fast' }), resume: true })

    expect(spawned[0]!.args).toEqual(expect.arrayContaining(['--model', 'claude-sonnet-5', '--effort', 'low']))
  })

  it('leaves permissions interactive when the Employee says so', () => {
    const { adapter, spawned, cwd } = setup()

    adapter.spawn(request(cwd, { ...ada, permissionMode: 'interactive' }))

    expect(spawned[0]!.args).not.toContain('--dangerously-skip-permissions')
  })

  it('resumes with --resume instead of --session-id', () => {
    const { adapter, spawned, cwd } = setup()

    adapter.spawn({ ...request(cwd), resume: true })

    expect(adapter.resumeCommand('abc')).toEqual(['--resume', 'abc'])
    expect(spawned[0]!.args.slice(0, 2)).toEqual(['--resume', '11111111-2222-3333-4444-555555555555'])
    expect(spawned[0]!.args).not.toContain('--session-id')
  })

  it('strips every inherited CLAUDE* variable and passes the hook token', () => {
    const { adapter, spawned, cwd } = setup({
      PATH: '/usr/bin',
      CLAUDECODE: '1',
      CLAUDE_CODE_CHILD_SESSION: '1',
      CLAUDE_CONFIG_DIR: '/x',
      MY_CLAUDE_THING: 'kept',
    })

    adapter.spawn(request(cwd))

    expect(spawned[0]!.options.env).toEqual({
      PATH: '/usr/bin',
      MY_CLAUDE_THING: 'kept',
      [HOOK_TOKEN_ENV]: 'tok-123',
    })
  })

  it('keeps the long-lived subscription token from `claude setup-token`', () => {
    const { adapter, spawned, cwd } = setup({
      PATH: '/usr/bin',
      CLAUDECODE: '1',
      CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat-123',
    })

    adapter.spawn(request(cwd))

    expect(spawned[0]!.options.env).toEqual({
      PATH: '/usr/bin',
      CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat-123',
      [HOOK_TOKEN_ENV]: 'tok-123',
    })
  })

  it('never lets a Session see an API key: it would bill someone else (T129)', () => {
    const { adapter, spawned, cwd } = setup({
      PATH: '/usr/bin',
      ANTHROPIC_API_KEY: 'sk-ant-api-1',
      ANTHROPIC_AUTH_TOKEN: 'sk-ant-auth-1',
      ANTHROPIC_BASE_URL: '/kept',
    })

    adapter.spawn(request(cwd))

    expect(spawned[0]!.options.env).toEqual({
      PATH: '/usr/bin',
      ANTHROPIC_BASE_URL: '/kept',
      [HOOK_TOKEN_ENV]: 'tok-123',
    })
  })

  it('writes the status hooks into the cwd’s project settings', () => {
    const { adapter, cwd } = setup()

    adapter.spawn(request(cwd))

    const settings = JSON.parse(readFileSync(join(cwd, '.claude', 'settings.json'), 'utf8'))
    expect(Object.keys(settings.hooks)).toEqual([...CLAUDE_HOOK_EVENTS])
    for (const event of CLAUDE_HOOK_EVENTS) {
      const [entry] = settings.hooks[event]
      // The command is whichever shell this platform's Claude Code runs a hook in (T166), and on
      // Windows the entry names that shell too; every form POSTs to the one receiver.
      expect(entry.hooks).toEqual([claudeHookHandler('http://127.0.0.1:4555/hook', SESSION_ENV)])
      expect(entry.hooks[0].command).toContain('http://127.0.0.1:4555/hook')
    }
    // No matcher anywhere: a `Notification` matcher of `idle_prompt` was what kept the Session's
    // own `permission_prompt` — it stopping to ask the boss — out of the app entirely (T165).
    for (const event of CLAUDE_HOOK_EVENTS) expect(settings.hooks[event][0].matcher).toBeUndefined()
  })

  it('hooks PermissionRequest, so a Session that stops to ask the boss is heard', () => {
    const { adapter, cwd } = setup()

    adapter.spawn(request(cwd))

    const settings = JSON.parse(readFileSync(join(cwd, '.claude', 'settings.json'), 'utf8'))
    expect(Object.keys(settings.hooks)).toContain('PermissionRequest')
    expect(settings.hooks.PermissionRequest[0].hooks).toEqual([
      claudeHookHandler('http://127.0.0.1:4555/hook', SESSION_ENV),
    ])
  })

  it('keeps the user’s own settings and hooks, and replaces its own on respawn', () => {
    const { adapter, cwd } = setup()
    mkdirSync(join(cwd, '.claude'))
    const userHook = { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine' }] }
    writeFileSync(
      join(cwd, '.claude', 'settings.json'),
      JSON.stringify({ model: 'opus', hooks: { PreToolUse: [userHook] } }),
    )

    adapter.spawn(request(cwd))
    adapter.spawn(request(cwd))

    const settings = JSON.parse(readFileSync(join(cwd, '.claude', 'settings.json'), 'utf8'))
    expect(settings.model).toBe('opus')
    expect(settings.hooks.PreToolUse).toHaveLength(2)
    expect(settings.hooks.PreToolUse[0]).toEqual(userHook)
    expect(settings.hooks.Stop).toHaveLength(1)
  })

  it('refuses to overwrite a settings file it cannot read', () => {
    const { adapter, spawned, cwd } = setup()
    mkdirSync(join(cwd, '.claude'))
    writeFileSync(join(cwd, '.claude', 'settings.json'), '{ nope')

    expect(() => adapter.spawn(request(cwd))).toThrow(/not valid JSON/)
    expect(readFileSync(join(cwd, '.claude', 'settings.json'), 'utf8')).toBe('{ nope')
    expect(spawned).toEqual([])
  })

  it('keeps injected files out of git when the cwd is a repo', () => {
    const { adapter, cwd } = setup()
    execFileSync('git', ['init', '-q'], { cwd })

    adapter.spawn(request(cwd))
    adapter.spawn(request(cwd))

    const exclude = readFileSync(join(cwd, '.git', 'info', 'exclude'), 'utf8')
    expect(exclude.split('\n').filter((l) => l === '.claude/')).toHaveLength(1)
    const status = execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' })
    expect(status).toBe('')
  })

  it('gives the Employee’s instructions to its own process, and writes no file for them', () => {
    const { adapter, spawned, cwd } = setup()

    adapter.spawn(request(cwd, ada, acme))

    const text = systemPrompt(spawned[0]!)
    expect(text).toContain('You are Ada, Backend at Acme')
    expect(text).toContain('You build APIs.')
    expect(text).toContain('**api** (yours): TypeScript, Fastify, pnpm')
    expect(text).toContain('through the `company` MCP server')
    expect(existsSync(join(cwd, 'CLAUDE.md'))).toBe(false)
  })

  it('gives two Employees sharing a folder their own instructions and nobody else’s', () => {
    const { adapter, spawned, cwd } = setup()
    const grace: Employee = { ...ada, id: 'emp-2', name: 'Grace', title: 'Tech Lead', persona: 'You plan.' }

    adapter.spawn(request(cwd, ada, acme))
    adapter.spawn(request(cwd, grace, acme))

    expect(systemPrompt(spawned[0]!)).toContain('You are Ada, Backend at Acme')
    expect(systemPrompt(spawned[0]!)).not.toContain('Grace')
    expect(systemPrompt(spawned[1]!)).toContain('You are Grace, Tech Lead at Acme')
    expect(systemPrompt(spawned[1]!)).not.toContain('Ada')
  })

  it('deletes the CLAUDE.md an earlier build wrote into the Company folder', () => {
    const { adapter, cwd } = setup()
    writeFileSync(
      join(cwd, 'CLAUDE.md'),
      `# You are Ada, Backend at Acme\n\n${GENERATED_INSTRUCTIONS_MARKER} Do not edit it.\n`,
    )

    adapter.spawn(request(cwd, { ...ada, id: 'emp-2', name: 'Grace' }, acme))

    expect(existsSync(join(cwd, 'CLAUDE.md'))).toBe(false)
  })

  it('leaves a CLAUDE.md the boss wrote where it is', () => {
    const { adapter, cwd } = setup()
    writeFileSync(join(cwd, 'CLAUDE.md'), '# Acme\n\nDeploy on Fridays.\n')

    adapter.spawn(request(cwd, ada, acme))

    expect(readFileSync(join(cwd, 'CLAUDE.md'), 'utf8')).toBe('# Acme\n\nDeploy on Fridays.\n')
  })

  it('tells an intake holder, and only them, to structure the boss’s goals', () => {
    const { adapter, spawned, cwd } = setup()

    adapter.spawn(request(cwd, ada, acme))
    expect(systemPrompt(spawned[0]!)).not.toContain('target_create')

    adapter.spawn(request(cwd, { ...ada, capabilities: ['intake', 'plan'] }, acme))
    const text = systemPrompt(spawned[1]!)
    expect(text).toContain('target_create')
    expect(text).toContain('epic_create')
    expect(text).toContain('ticket_create')
  })

  it('answers the folder-trust dialog with Down+Enter when No is selected', () => {
    vi.useFakeTimers()
    const { adapter, spawned, cwd } = setup()
    adapter.spawn(request(cwd))
    const [pty] = spawned as [Spawned]

    pty.output('\x1b[2JQuick safety check\r\n\x1b[1m❯ 1. No, exit\x1b[0m\r\n  2. Yes,\x1b[1CI\x1b[1Ctrust')
    pty.output('\x1b[1Cthis\x1b[1Cfolder\r\n')
    vi.advanceTimersByTime(1000)
    pty.output('Yes, I trust this folder')
    vi.advanceTimersByTime(1000)

    expect(pty.written).toEqual(['\x1b[B', '\r'])
  })

  it('answers with Enter alone when Yes is already selected', () => {
    vi.useFakeTimers()
    const { adapter, spawned, cwd } = setup()
    adapter.spawn(request(cwd))
    const [pty] = spawned as [Spawned]

    pty.output('❯ 1. Yes, I trust this folder\r\n  2. No, exit\r\n')
    vi.advanceTimersByTime(1000)

    expect(pty.written).toEqual(['\r'])
  })

  it('answers the bypass-permissions warning once', () => {
    vi.useFakeTimers()
    const { adapter, spawned, cwd } = setup()
    adapter.spawn(request(cwd))
    const [pty] = spawned as [Spawned]

    pty.output('Bypass Permissions mode\r\n❯ 1. No, exit\r\n  2. Yes, I accept\r\n')
    vi.advanceTimersByTime(1000)
    pty.output('  2. Yes, I accept\r\n')
    vi.advanceTimersByTime(1000)

    expect(pty.written).toEqual(['\x1b[B', '\r'])
  })

  it('pushes a prompt as text, a pause, then Enter', () => {
    vi.useFakeTimers()
    const { adapter, spawned, cwd } = setup()
    const pty = adapter.spawn(request(cwd))

    adapter.pushPrompt(pty, '[company] hello')
    const before = [...spawned[0]!.written]
    vi.advanceTimersByTime(250)

    expect(before).toEqual(['[company] hello'])
    expect(spawned[0]!.written).toEqual(['[company] hello', '\r'])
  })

  it('writes an MCP config for the Session and loads it strictly at spawn', () => {
    const { adapter, spawned, cwd } = setup()
    const { sessionId } = request(cwd)

    const args = adapter.injectMcp(sessionId, {
      company: { url: 'http://127.0.0.1:9000/mcp', token: 'secret' },
      granted: [],
    })
    adapter.spawn(request(cwd))

    expect(args).toEqual(['--mcp-config', expect.any(String), '--strict-mcp-config'])
    expect(JSON.parse(readFileSync(args[1]!, 'utf8'))).toEqual({
      mcpServers: {
        company: {
          type: 'http',
          url: 'http://127.0.0.1:9000/mcp',
          headers: { authorization: 'Bearer secret' },
        },
      },
    })
    expect(existsSync(join(cwd, '.mcp.json'))).toBe(false)
    expect(spawned[0]!.args.join(' ')).toContain(args.join(' '))
  })

  /**
   * T199, finding H5. Claude Code reads this file once, at start-up; what is left after that is a
   * live bearer token in a folder every other Employee of this Mac can read, and nothing used to
   * delete it — not when the Session ended, not ever.
   */
  it('deletes the Session’s MCP config when the Session ends, and no other Session’s', () => {
    const { adapter, cwd } = setup()
    const server = { company: { url: 'http://127.0.0.1:9000/mcp', token: 'bearer-6b7c8d' }, granted: [] }
    const mine = adapter.injectMcp('session-a', server)[1]!
    const theirs = adapter.injectMcp('session-b', server)[1]!

    adapter.forgetSession!('session-a')

    expect(existsSync(mine)).toBe(false)
    expect(readFileSync(theirs, 'utf8')).toContain('bearer-6b7c8d')
    expect(existsSync(join(cwd, '.mcp.json'))).toBe(false)
  })

  it('refuses to write the MCP config for a session id that is also a path', () => {
    // The id can have come back from a hook the Session POSTed itself (T199-H1), and this file is
    // written 0600 over whatever was at that path.
    const { adapter } = setup()
    const outside = join(dir, 'outside')
    mkdirSync(outside)
    const target = join(outside, 'claude.json')
    writeFileSync(target, '{"boss":"file"}')
    const traversal = ['..', '..', 'outside', 'claude'].join(sep)

    expect(() => adapter.injectMcp(traversal, { company: null, granted: [] })).toThrow(/provider session id/)

    expect(readFileSync(target, 'utf8'), 'the boss’s own file was written over').toBe('{"boss":"file"}')
    // Refused before anything is made, so the app's own folder is not there either.
    expect(existsSync(join(dir, 'data', 'mcp'))).toBe(false)
  })

  it('refuses to write the MCP config for a session id a CLI would read as a flag', () => {
    const { adapter } = setup()

    expect(() => adapter.injectMcp('--dangerously-skip-permissions', { company: null, granted: [] })).toThrow(
      /provider session id/,
    )
  })

  it('maps hooks to status signals', () => {
    const signal = (hook_event_name: string, extra = {}) => claudeHookSignal({ hook_event_name, ...extra })

    expect({
      SessionStart: signal('SessionStart'),
      UserPromptSubmit: signal('UserPromptSubmit'),
      PreToolUse: signal('PreToolUse'),
      PostToolUse: signal('PostToolUse'),
      Stop: signal('Stop'),
      idle_prompt: signal('Notification', { notification_type: 'idle_prompt' }),
      permission_prompt: signal('Notification', {
        notification_type: 'permission_prompt',
        message: 'Claude needs your permission',
      }),
      bare_permission_prompt: signal('Notification', { notification_type: 'permission_prompt' }),
      SessionEnd: signal('SessionEnd'),
    }).toEqual({
      SessionStart: 'ready',
      UserPromptSubmit: 'busy',
      PreToolUse: 'busy',
      PostToolUse: 'busy',
      Stop: 'idle',
      idle_prompt: 'idle',
      permission_prompt: { kind: 'asking', what: 'Claude needs your permission' },
      bare_permission_prompt: { kind: 'asking', what: CLAUDE_PERMISSION_ASK },
      SessionEnd: null,
    })
  })

  it('reads a PermissionRequest as the Session asking, and names the tool and its target', () => {
    const ask = (tool_name: string, tool_input: Record<string, unknown>) =>
      claudeHookSignal({ hook_event_name: 'PermissionRequest', cwd: onDisk('/work/acme'), tool_name, tool_input })

    expect(ask('Write', { file_path: onDisk('/work/acme/src/api/usage.ts'), content: 'hello' })).toEqual({
      kind: 'asking',
      what: `Write ${join('src', 'api', 'usage.ts')}`,
    })
    expect(ask('Bash', { command: 'rm -rf build\nmake' })).toEqual({ kind: 'asking', what: 'rm -rf build' })
    // A hook that names no tool still says the Session is stopped: the boss is told, in fewer words.
    expect(claudeHookSignal({ hook_event_name: 'PermissionRequest' })).toEqual({
      kind: 'asking',
      what: CLAUDE_PERMISSION_ASK,
    })
  })

  it('clips an ask to a line a notification can carry, whatever the tool input holds', () => {
    const signal = claudeHookSignal({
      hook_event_name: 'PermissionRequest',
      tool_name: 'Bash',
      tool_input: { command: `echo ${'x'.repeat(400)}` },
    })

    expect(askOf(signal)!.what.length).toBeLessThanOrEqual(ASK_WHAT_MAX)
    expect(askOf(signal)!.what.endsWith('…')).toBe(true)
  })

  it('says nothing about asking for the notification types it does not know', () => {
    expect(claudeHookSignal({ hook_event_name: 'Notification', notification_type: 'auth_success' })).toBeNull()
  })

  it('detects the subscription usage limit in terminal output', () => {
    const { adapter } = setup()

    expect(adapter.detectBudgetExhausted('Claude usage limit reached. Your limit will reset at 5pm')).toBe(true)
    expect(adapter.detectBudgetExhausted("\x1b[31mYou've hit your limit\x1b[0m · resets 3am")).toBe(true)
    expect(adapter.detectBudgetExhausted('Wrote 3 files, all tests pass')).toBe(false)
  })
})

describe('Claude usage-limit reset time', () => {
  const now = new Date('2026-09-17T12:00:00.000Z')
  let adapter: ReturnType<typeof setup>['adapter']
  beforeEach(() => {
    adapter = setup().adapter
  })
  const resetAt = (output: string) => adapter.budgetResetAt(output, now)?.toISOString() ?? null

  it('reads a clock time in the named time zone as its next occurrence', () => {
    expect(resetAt('5-hour limit reached ∙ resets 3pm (America/Sao_Paulo)')).toBe('2026-09-17T18:00:00.000Z')
    expect(resetAt("You've hit your limit · resets 7:30am (UTC)")).toBe('2026-09-18T07:30:00.000Z')
    expect(resetAt('Your limit will reset at 12pm (UTC)')).toBe('2026-09-18T12:00:00.000Z')
  })

  it('reads a clock time from stripped TUI output, where spaces are lost', () => {
    expect(resetAt('\x1b[2mYou’vehityourlimit·resets11pm(Europe/London)\x1b[0m')).toBe('2026-09-17T22:00:00.000Z')
  })

  it('reads a clock time without a zone in local time', () => {
    const expected = new Date(now)
    expected.setHours(17, 0, 0, 0)
    if (expected <= now) expected.setDate(expected.getDate() + 1)

    expect(resetAt('Claude usage limit reached. Your limit will reset at 5pm')).toBe(expected.toISOString())
  })

  it('reads a dated reset such as a weekly limit', () => {
    expect(resetAt('Weekly limit reached ∙ resets Sep 20, 4pm (UTC)')).toBe('2026-09-20T16:00:00.000Z')
    expect(resetAt('Weekly limit reached ∙ resets Jan 2 at 9am (UTC)')).toBe('2027-01-02T09:00:00.000Z')
  })

  it('reads the epoch seconds of the older limit message', () => {
    expect(resetAt('Claude AI usage limit reached|1789660800')).toBe('2026-09-17T16:00:00.000Z')
  })

  it('is null when the output names no reset time', () => {
    expect(resetAt('Claude usage limit reached.')).toBeNull()
    expect(resetAt('Wrote 3 files at 5pm')).toBeNull()
  })
})

describe('Claude resume confirmation', () => {
  it('is SessionStart with source "resume" and nothing else', () => {
    expect(claudeConfirmsResume({ hook_event_name: 'SessionStart', source: 'resume' })).toBe(true)
    expect(claudeConfirmsResume({ hook_event_name: 'SessionStart', source: 'startup' })).toBe(false)
    expect(claudeConfirmsResume({ hook_event_name: 'SessionStart' })).toBe(false)
    expect(claudeConfirmsResume({ hook_event_name: 'Stop', source: 'resume' })).toBe(false)
  })
})

describe('What Claude Code answers the preflight (T129, T135)', () => {
  const adapter = (env: NodeJS.ProcessEnv, output: string) =>
    createClaudeAdapter({
      hookUrl: 'http://127.0.0.1:4555/hook',
      dataDir: '/tmp/tinycorp-claude-preflight',
      command: 'claude',
      name: 'Claude Code',
      env,
      installed: () => true,
      runCli: async () => ({ kind: 'output', code: 0, output }),
    })

  const signedIn = JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' })

  it('says nothing is wrong when the command is signed in on a subscription', async () => {
    expect((await adapter({ PATH: '/usr/bin' }, signedIn).checkCli()).state).toBe('ready')
  })

  it('says it is not signed in when the command answers with no subscription login', async () => {
    const check = await adapter({ PATH: '/usr/bin' }, JSON.stringify({ loggedIn: false })).checkCli()

    expect(check.state).toBe('signed-out')
    expect(check.commands).toEqual(['claude /login', 'claude auth status'])
  })

  it('reads a login that is not the subscription as a key that gets billed', async () => {
    const output = JSON.stringify({ loggedIn: true, authMethod: 'apiKey' })

    const check = await adapter({ PATH: '/usr/bin' }, output).checkCli()

    expect(check.state, 'a key that gets billed is not the subscription the boss pays for').toBe('warning')
    expect(check.title).toContain('API key')
  })

  it('takes the long-lived token from `claude setup-token` as a login (decision 29)', async () => {
    const env = { PATH: '/usr/bin', CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat-1' }

    expect((await adapter(env, 'not json').checkCli()).state).toBe('ready')
  })

  it('reads an unreadable answer as signed out rather than hanging the app', async () => {
    expect((await adapter({ PATH: '/usr/bin' }, 'not json').checkCli()).state).toBe('signed-out')
  })

  it('names the API-key variables it found, and says the key is not what will be billed', async () => {
    const env = { PATH: '/usr/bin', ANTHROPIC_API_KEY: 'sk-1', ANTHROPIC_AUTH_TOKEN: 'tok-1' }

    const check = await adapter(env, signedIn).checkCli()

    expect(check.state, 'an API key around TinyCorp is a warning and not a wall').toBe('warning')
    expect(check.title).toBe('Claude Code is using an API key')
    expect(check.body).toContain('ANTHROPIC_API_KEY and ANTHROPIC_AUTH_TOKEN are set')
    expect(check.body).toContain('not what will be billed')
    expect(check.commands[0]).toBe('unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN')
  })

  /**
   * `claude auth status` prints the account and the plan beside the verdict, out of the same JSON,
   * so Your profile's Providers card (T141) costs no second subprocess. Both fields are optional
   * in that answer and an older CLI prints neither, which is a null and not a blank line.
   */
  describe('the account it names', () => {
    const full = JSON.stringify({
      loggedIn: true,
      authMethod: 'claude.ai',
      email: 'boss@example.com',
      subscriptionType: 'max',
    })

    it('is the email and the plan the CLI printed, out of the answer it already gave', async () => {
      const check = await adapter({ PATH: '/usr/bin' }, full).checkCli()

      expect([check.account, check.plan]).toEqual(['boss@example.com', 'Max'])
    })

    it('is nothing at all when the CLI named neither', async () => {
      const check = await adapter({ PATH: '/usr/bin' }, signedIn).checkCli()

      expect([check.account, check.plan]).toEqual([null, null])
    })

    it('survives the API-key warning, which is the same login said differently', async () => {
      const env = { PATH: '/usr/bin', ANTHROPIC_API_KEY: 'sk-1' }

      const check = await adapter(env, full).checkCli()

      expect(check.state).toBe('warning')
      expect([check.account, check.plan]).toEqual(['boss@example.com', 'Max'])
    })

    it('is nothing when nobody is signed in', async () => {
      const check = await adapter({ PATH: '/usr/bin' }, JSON.stringify({ loggedIn: false })).checkCli()

      expect([check.account, check.plan]).toEqual([null, null])
    })
  })

  it('asks in the environment a Session is spawned with: no API key, no inherited session state', async () => {
    const ran: NodeJS.ProcessEnv[] = []
    const check = createClaudeAdapter({
      hookUrl: 'http://127.0.0.1:4555/hook',
      dataDir: '/tmp/tinycorp-claude-preflight',
      command: 'claude',
      name: 'Claude Code',
      env: { PATH: '/usr/bin', ANTHROPIC_API_KEY: 'sk-1', CLAUDE_CODE_SSE_PORT: '1', CLAUDE_CODE_OAUTH_TOKEN: 'oat' },
      installed: () => true,
      runCli: async (_command, _args, options) => {
        ran.push(options?.env ?? {})
        return { kind: 'output', code: 0, output: signedIn }
      },
    })

    await check.checkCli()

    expect(ran[0]!['ANTHROPIC_API_KEY'], 'a key must not reach the command that answers the card').toBeUndefined()
    expect(ran[0]!['CLAUDE_CODE_SSE_PORT']).toBeUndefined()
    expect(ran[0]!['CLAUDE_CODE_OAUTH_TOKEN'], 'the subscription token is a credential, not session state').toBe('oat')
  })
})

/**
 * The command the boss opens this Session with in their own terminal (T164). The bug behind it:
 * `claude --resume <id>` typed by hand runs without the skip flag the Employee is spawned with, so
 * the Session the boss gets stops to ask where the drawer's does not.
 */
describe('the handoff command', () => {
  const SESSION = '3f2a91c4-77de-4a0b-9d13-5f0c2e8ab614'
  const build = (employee: Employee) => setup().adapter.handoffCommand!(employee, SESSION)

  it('resumes this Session with the same skip flag the Session runs with', () => {
    expect(build(ada)).toEqual(['claude', '--resume', SESSION, '--dangerously-skip-permissions'])
  })

  it('leaves the flag off for an Employee that asks first, as the spawn does', () => {
    expect(build({ ...ada, permissionMode: 'interactive' })).toEqual(['claude', '--resume', SESSION])
  })

  it('carries the Employee’s model, so the terminal thinks as hard as the drawer', () => {
    expect(build({ ...ada, model: 'opus-5-balanced' })).toEqual([
      'claude',
      '--resume',
      SESSION,
      '--dangerously-skip-permissions',
      '--model',
      'claude-opus-5',
      '--effort',
      'medium',
    ])
  })

  it('carries none of the app’s own Session: no MCP config, no hook token, no instructions', () => {
    const { adapter } = setup()
    adapter.injectMcp(SESSION, { company: { url: 'http://127.0.0.1:7391/mcp', token: 'mcp-token' }, granted: [] })

    const command = adapter.handoffCommand!(ada, SESSION)!

    expect(command).not.toContain('--mcp-config')
    expect(command).not.toContain('--strict-mcp-config')
    expect(command).not.toContain('--append-system-prompt')
    expect(command.join(' ')).not.toContain('mcp-token')
  })
})

/**
 * A Session inside a WSL distro runs its hooks in there (T258).
 *
 * Claude Code runs a hook command where it runs itself, so the form was chosen by the *host* and a
 * `claude` in Arch on a Windows without Git Bash was handed a PowerShell command line: a hook that
 * fires and does nothing, so the Session never reports ready. The boss watches a terminal that works
 * and a card that says it does not.
 */
describe('the hooks a Session inside a distro is given', () => {
  const inArch: ProviderPlacement = {
    windows: false,
    distros: ['Arch'],
    stopped: [],
    chosen: { kind: 'wsl', distro: 'Arch' },
    missingAt: null,
    lookedIn: ['Windows PATH', 'WSL: Arch'],
    reach: 'ok',
  }

  /** A Windows with no Git for Windows: the machine that used to get PowerShell hooks. */
  const noGitBash = () => ({ ...SESSION_ENV, ProgramFiles: join(dir, 'nowhere') })

  /**
   * The decision itself, said on a Windows: this is the runner the bug needs, and the Mac this suite
   * usually runs on would pass the two below whether or not the fix were there.
   */
  it('is Linux for a Session in a distro, on a Windows host', () => {
    expect(hookPlatform(inArch, 'win32')).toBe('linux')
    expect(hookPlatform({ chosen: { kind: 'windows' } }, 'win32')).toBe('win32')
    expect(hookPlatform(null, 'win32')).toBe('win32')
    // Which is the POSIX command, with no shell pinned: a distro has neither PowerShell nor Git Bash.
    expect(claudeHookHandler('http://127.0.0.1:4555/hook', {}, hookPlatform(inArch, 'win32'))).toEqual({
      type: 'command',
      command: hookCommand('http://127.0.0.1:4555/hook'),
    })
  })

  it('is the POSIX form, because the distro is Linux whatever Windows has installed', () => {
    const { adapter, cwd } = setup(noGitBash(), inArch)

    adapter.spawn(request(cwd))

    const settings = JSON.parse(readFileSync(join(cwd, '.claude', 'settings.json'), 'utf8'))
    for (const event of CLAUDE_HOOK_EVENTS) {
      const [handler] = settings.hooks[event][0].hooks
      expect(handler).toEqual({ type: 'command', command: hookCommand('http://127.0.0.1:4555/hook') })
      expect(handler.shell, 'a Linux claude has no PowerShell and no Git Bash to be pinned to').toBeUndefined()
      expect(handler.command).not.toContain('Invoke-RestMethod')
    }
  })

  it('and so is its command rewrite, which runs through the same shell', () => {
    const { adapter, cwd } = setup(noGitBash(), inArch)

    adapter.spawn({
      ...request(cwd),
      rtk: { path: '/home/b/.local/bin/rtk', dbPath: '/home/b/.rtk/h.db', ping: false },
    })

    const settings = JSON.parse(readFileSync(join(cwd, '.claude', 'settings.json'), 'utf8'))
    const [rewrite] = settings.hooks.PreToolUse.at(-1).hooks
    expect(rewrite.shell).toBeUndefined()
    expect(rewrite.command).toBe(rtkHookCommand('/home/b/.local/bin/rtk', CLAUDE_RTK_AGENT))
  })
})
