import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Employee } from '../../../shared/domain/staff'
import { EMPTY_STACK } from '../../../shared/repos/repo'
import { onDisk } from '../../core/testing'
import { type CompanyBrief, renderInstructions } from '../../features/sessions/instructions'
import type { PtySession, PtySpawnOptions } from '../provider-adapter'
import {
  type ConformanceSpec,
  describeProviderConformance,
  type FakeProcess,
  hookCommandFor,
  namedSecretsIn,
  secretIn,
} from '../provider-conformance'
import { HOOK_TOKEN_ENV } from '../provider-hooks'
import {
  CODEX_HOOK_EVENTS,
  CODEX_MCP_TOKEN_ENV,
  CODEX_SKILLS_FOLDER,
  codexBudgetResetAt,
  codexConfirmsResume,
  codexHookSignal,
  codexThreadId,
  createCodexAdapter,
  tomlString,
} from './adapter'

/** What is in a folder, hidden entries left out; empty when the folder is not there. */
function namesIn(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir).filter((name) => !name.startsWith('.')) : []
}

/** The value of the first `-c key=…` override whose key is `key`, unquoted; null when absent. */
function override(process: { args: string[] }, key: string): string | null {
  for (const [index, arg] of process.args.entries()) {
    if (arg !== '-c') continue
    const setting = process.args[index + 1] ?? ''
    if (setting.startsWith(`${key}=`)) return fromToml(setting.slice(key.length + 1))
  }
  return null
}

/**
 * Every `-c <prefix>.<name>=…` override, by the name after the prefix. How the headers of one
 * granted server are read back: Codex keeps them in two tables, one for plain values and one that
 * names the variable each secret value is in.
 */
function table(process: FakeProcess, prefix: string): Record<string, string> {
  const found: Record<string, string> = {}
  for (const [index, arg] of process.args.entries()) {
    if (arg !== '-c') continue
    const setting = process.args[index + 1] ?? ''
    if (!setting.startsWith(`${prefix}.`)) continue
    const [key = '', ...rest] = setting.slice(prefix.length + 1).split('=')
    found[key] = fromToml(rest.join('='))
  }
  return found
}

/** Every MCP server named in a spawn's `-c` overrides, in the order it first appears. */
function names(process: FakeProcess): string[] {
  const found: string[] = []
  for (const arg of process.args) {
    const match = /^mcp_servers\.([^.]+)\./.exec(arg)
    if (match && !found.includes(match[1]!)) found.push(match[1]!)
  }
  return found
}

/** The other side of {@link tomlString}, for reading an override back. */
function fromToml(value: string): string {
  if (!value.startsWith('"')) return value
  return JSON.parse(value) as string
}

const CONFORMANCE: ConformanceSpec = {
  provider: 'codex',
  command: 'codex',
  create: ({ spawnPty, dataDir, hookUrl, env, runCli }) =>
    createCodexAdapter({ hookUrl, dataDir, spawnPty, env, runCli, installed: () => true }),
  instructionsOn: (process) => override(process, 'additional_developer_instructions'),
  continues: (process, sessionId) => process.args[0] === 'resume' && process.args[1] === sessionId,
  startsFresh: (process) => !process.args.includes('resume'),
  mcpOn(process: FakeProcess) {
    const url = override(process, 'mcp_servers.company.url')
    if (!url) return null
    const variable = override(process, 'mcp_servers.company.bearer_token_env_var')!
    return { url, token: process.options.env[variable]! }
  },
  /**
   * Codex takes every server as `-c` overrides, so a granted one is read back off the command
   * line — and its secret out of the environment those overrides point at, because a token on
   * the command line is a token `ps` can read.
   */
  grantedOn(process: FakeProcess) {
    return names(process)
      .filter((name) => name !== 'company')
      .map((name) => {
        const url = override(process, `mcp_servers.${name}.url`)
        if (url !== null) {
          const variable = override(process, `mcp_servers.${name}.bearer_token_env_var`)
          // A plain header is in `http_headers`; a secret one is in `env_http_headers`, which names
          // the variable its value rides in, so the value is read out of the environment (T245).
          const named = Object.entries(table(process, `mcp_servers.${name}.env_http_headers`)).map(
            ([header, held]): [string, string] => [header, process.options.env[held] ?? ''],
          )
          return {
            name,
            transport: 'http' as const,
            target: url,
            secret: variable ? (process.options.env[variable] ?? null) : null,
            secrets: {},
            headers: { ...table(process, `mcp_servers.${name}.http_headers`), ...Object.fromEntries(named) },
          }
        }
        const command = override(process, `mcp_servers.${name}.command`) ?? ''
        const args = override(process, `mcp_servers.${name}.args`)
        return {
          name,
          transport: 'stdio' as const,
          target: [command, ...(args ? (JSON.parse(args) as string[]) : [])].filter(Boolean).join(' '),
          secret: secretIn(name, process.options.env),
          secrets: namedSecretsIn(name, process.options.env),
          headers: {},
        }
      })
  },
  // `.codex/skills/` is one of the two roots Codex reads inside a working directory, confirmed
  // against the installed CLI's own rendered prompt rather than guessed (T253).
  skillsIn: (worktree) => namesIn(join(worktree, CODEX_SKILLS_FOLDER)),
  // The rewrite is a `PreToolUse` entry matched to `Bash`, in the project hook file — never in
  // `$CODEX_HOME/hooks.json`, which is the boss's own.
  rewriteIn: (cwd) => hookCommandFor(join(cwd, '.codex', 'hooks.json'), 'PreToolUse', /hook codex\b/),
  // Codex applies `updatedInput` before its own approval and sandbox checks, so a rewritten
  // `git push` still stops at the approval and still reaches the boss as an ask.
  rewriteAsk: {
    hook: {
      hook_event_name: 'PermissionRequest',
      threadId: 'thread-1',
      tool_name: 'shell',
      tool_input: { command: ['bash', '-lc', 'rtk git push'] },
    },
    what: 'shell bash -lc rtk git push',
  },
  modelOn(process) {
    const model = process.args.includes('-m') ? (process.args[process.args.indexOf('-m') + 1] ?? null) : null
    return model === null ? null : { model, effort: override(process, 'model_reasoning_effort') }
  },
  model: { id: 'gpt-6-astra-deep', model: 'gpt-6-astra', effort: 'high' },
  signals: {
    ready: { hookEventName: 'SessionStart', threadId: 'thread-1' },
    busy: { hookEventName: 'PreToolUse', threadId: 'thread-1' },
    idle: { hookEventName: 'Stop', threadId: 'thread-1' },
    quiet: { hookEventName: 'SessionEnd', threadId: 'thread-1' },
  },
  asking: {
    hook: {
      hook_event_name: 'PermissionRequest',
      threadId: 'thread-1',
      tool_name: 'shell',
      tool_input: { command: ['bash', '-lc', 'rm -rf build'] },
    },
    what: 'shell bash -lc rm -rf build',
  },
  resumed: {
    continued: { hookEventName: 'SessionStart', source: 'resume', threadId: 'thread-1' },
    fresh: { hookEventName: 'SessionStart', source: 'startup', threadId: 'thread-1' },
  },
  signalSessionId: 'thread-1',
  // `codex login status` answers in one sentence, and exits non-zero when nobody is signed in.
  signIn: {
    in: { kind: 'output', code: 0, output: 'Logged in using ChatGPT\n' },
    out: { kind: 'output', code: 1, output: 'Not logged in\n' },
  },
  limit: {
    output: "You've hit your usage limit. Try again in 2h 15m.",
    now: '2026-09-17T12:00:00.000Z',
    resetsAt: '2026-09-17T14:15:00.000Z',
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
describeProviderConformance({ ...CONFORMANCE, label: 'Codex in WSL', runtime: { distro: 'Ubuntu' } })

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'codex-adapter-'))
})
afterEach(() => {
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
  provider: 'codex',
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
  repos: [{ name: 'api', stack: { ...EMPTY_STACK, language: 'TypeScript' } }],
  columns: [{ id: 'todo', wipLimit: null }],
  autonomy: 'managed',
  notesFile: onDisk('/work/acme/memory/emp-1/log'),
}

interface Spawned {
  file: string
  args: string[]
  options: PtySpawnOptions
  written: string[]
}

function setup(env: NodeJS.ProcessEnv = { PATH: '/usr/bin', HOME: onDisk('/home/ada') }) {
  const spawned: Spawned[] = []
  const adapter = createCodexAdapter({
    hookUrl: 'http://127.0.0.1:4555/hook',
    dataDir: join(dir, 'data'),
    env,
    installed: () => true,
    spawnPty(file, args, options) {
      const record: Spawned = { file, args, options, written: [] }
      spawned.push(record)
      const pty: PtySession = {
        write: (data) => void record.written.push(data),
        onData: () => () => {},
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

describe('Codex adapter', () => {
  it('runs codex with the app’s hooks trusted and the Employee’s instructions as config', () => {
    const { adapter, spawned, cwd } = setup()

    adapter.spawn(request(cwd, ada, acme))

    const [{ file, args, options }] = spawned as [Spawned]
    expect(file).toBe('codex')
    expect(args).toContain('--dangerously-bypass-hook-trust')
    expect(args).toContain('--dangerously-bypass-approvals-and-sandbox')
    expect(override({ args }, 'additional_developer_instructions')).toContain('You are Ada, Backend at Acme')
    expect(options.cwd).toBe(cwd)
  })

  it('leaves approvals on and the sandbox up when the Employee says interactive', () => {
    const { adapter, spawned, cwd } = setup()

    adapter.spawn(request(cwd, { ...ada, permissionMode: 'interactive' }))

    const { args } = spawned[0]!
    expect(args).not.toContain('--dangerously-bypass-approvals-and-sandbox')
    expect(args.join(' ')).toContain('--ask-for-approval on-request')
    expect(args.join(' ')).toContain('--sandbox workspace-write')
  })

  it('resumes with the `resume` subcommand, naming the thread Codex chose', () => {
    const { adapter, spawned, cwd } = setup()

    expect(adapter.resumeCommand('thread-9')).toEqual(['resume', 'thread-9'])
    adapter.spawn({ ...request(cwd), resume: true })

    expect(spawned[0]!.args.slice(0, 2)).toEqual(['resume', '11111111-2222-3333-4444-555555555555'])
  })

  it('keeps the MCP bearer token out of the command line', () => {
    const { adapter, spawned, cwd } = setup()
    const { sessionId } = request(cwd)

    const args = adapter.injectMcp(sessionId, {
      company: { url: 'http://127.0.0.1:9000/mcp', token: 'secret' },
      granted: [],
    })
    adapter.spawn(request(cwd))

    expect(args.join(' ')).toContain('mcp_servers.company.url="http://127.0.0.1:9000/mcp"')
    expect(spawned[0]!.args.join(' ')).not.toContain('secret')
    expect(spawned[0]!.options.env[CODEX_MCP_TOKEN_ENV]).toBe('secret')
  })

  /**
   * Codex reads its whole configuration off the command line, so a header value written as `-c`
   * would sit in `argv` where `ps` reads it (T245). A plain header goes in `http_headers`; a secret
   * one goes in `env_http_headers`, which names the variable the value rides in.
   */
  it('names a secret header’s variable in the config and carries the value in the environment', () => {
    const { adapter, spawned, cwd } = setup()
    const { sessionId } = request(cwd)

    adapter.injectMcp(sessionId, {
      company: { url: 'http://127.0.0.1:9000/mcp', token: 'company-token' },
      granted: [
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
          headers: { 'X-SigNoz-URL': 'https://acme.us.signoz.cloud' },
          headerSecrets: { 'SIGNOZ-API-KEY': 'key-supersecret' },
        },
      ],
    })
    adapter.spawn(request(cwd))

    const line = spawned[0]!.args.join(' ')
    expect(line).toContain('mcp_servers.signoz.http_headers.X-SigNoz-URL="https://acme.us.signoz.cloud"')
    expect(line).toContain(
      'mcp_servers.signoz.env_http_headers.SIGNOZ-API-KEY="TINYCORP_MCP_HEADER_SIGNOZ_SIGNOZ_API_KEY"',
    )
    expect(line).not.toContain('key-supersecret')
    expect(spawned[0]!.options.env['TINYCORP_MCP_HEADER_SIGNOZ_SIGNOZ_API_KEY']).toBe('key-supersecret')
  })

  it('strips the inherited CODEX* session markers, keeps the boss’s home, passes the hook token', () => {
    const { adapter, spawned, cwd } = setup({
      PATH: '/usr/bin',
      // The boss's own setting: stripping it would sign the Session out of its login.
      CODEX_HOME: onDisk('/home/ada/.codex'),
      CODEX_SANDBOX: 'seatbelt',
      CODEX_ESCALATE_SOCKET: '/tmp/sock',
      MY_CODEX_THING: 'kept',
    })

    adapter.spawn(request(cwd))

    expect(spawned[0]!.options.env).toEqual({
      PATH: '/usr/bin',
      CODEX_HOME: onDisk('/home/ada/.codex'),
      MY_CODEX_THING: 'kept',
      [HOOK_TOKEN_ENV]: 'tok-123',
    })
  })

  it('writes Codex’s own hook file, keeps the boss’s hooks, and keeps it out of git', () => {
    const { adapter, cwd } = setup()
    execFileSync('git', ['init', '-q'], { cwd })
    mkdirSync(join(cwd, '.codex'))
    const mine = { hooks: [{ type: 'command', command: 'echo mine' }] }
    writeFileSync(join(cwd, '.codex', 'hooks.json'), JSON.stringify({ hooks: { SessionStart: [mine] } }))

    adapter.spawn(request(cwd))
    adapter.spawn(request(cwd))

    const written = JSON.parse(readFileSync(join(cwd, '.codex', 'hooks.json'), 'utf8'))
    expect(Object.keys(written.hooks)).toEqual([...CODEX_HOOK_EVENTS])
    expect(written.hooks.SessionStart[0]).toEqual(mine)
    expect(written.hooks.SessionStart).toHaveLength(2)
    expect(written.hooks.Stop[0].hooks[0].command).toContain('http://127.0.0.1:4555/hook')
    expect(existsSync(join(cwd, '.claude'))).toBe(false)
    expect(execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' })).toBe('')
  })

  it('maps Codex’s hooks to status signals, whichever spelling they name the event in', () => {
    expect({
      start: codexHookSignal({ hookEventName: 'SessionStart' }),
      prompt: codexHookSignal({ hookEventName: 'UserPromptSubmit' }),
      pre: codexHookSignal({ hookEventName: 'PreToolUse' }),
      post: codexHookSignal({ event_name: 'PostToolUse' }),
      stop: codexHookSignal({ hookEventName: 'Stop' }),
      end: codexHookSignal({ hookEventName: 'SessionEnd' }),
      permission: codexHookSignal({
        hook_event_name: 'PermissionRequest',
        tool_name: 'shell',
        tool_input: { command: ['bash', '-lc', 'rm -rf build'] },
      }),
      claude: codexHookSignal({ hook_event_name: 'Stop' }),
    }).toEqual({
      start: 'ready',
      prompt: 'busy',
      pre: 'busy',
      post: 'busy',
      stop: 'idle',
      end: null,
      permission: { kind: 'asking', what: 'shell bash -lc rm -rf build' },
      claude: 'idle',
    })
  })

  it('learns the thread id Codex chose, because Codex names its own conversations', () => {
    expect(codexThreadId({ hookEventName: 'SessionStart', threadId: 'thr-1' })).toBe('thr-1')
    expect(codexThreadId({ 'thread-id': 'thr-2' })).toBe('thr-2')
    expect(codexThreadId({ hookEventName: 'Stop' })).toBeNull()
  })

  it('takes a SessionStart that does not say "startup" as a continued conversation', () => {
    expect(codexConfirmsResume({ hookEventName: 'SessionStart', source: 'resume' })).toBe(true)
    expect(codexConfirmsResume({ hookEventName: 'SessionStart' })).toBe(true)
    expect(codexConfirmsResume({ hookEventName: 'SessionStart', source: 'startup' })).toBe(false)
    expect(codexConfirmsResume({ hookEventName: 'Stop', source: 'resume' })).toBe(false)
  })

  it('detects the usage limit in ChatGPT’s words', () => {
    const { adapter } = setup()

    expect(adapter.detectBudgetExhausted("You've hit your usage limit.")).toBe(true)
    expect(adapter.detectBudgetExhausted('\x1b[31mYou’ve reached your usage limit\x1b[0m')).toBe(true)
    expect(adapter.detectBudgetExhausted('Your workspace is out of credits. Add credits to continue.')).toBe(true)
    expect(adapter.detectBudgetExhausted('rate limit exceeded: retrying')).toBe(true)
    expect(adapter.detectBudgetExhausted('Wrote 3 files, all tests pass')).toBe(false)
  })
})

describe('Codex usage-limit reset time', () => {
  const now = new Date('2026-09-17T12:00:00.000Z')
  const resetAt = (output: string) => codexBudgetResetAt(output, now)?.toISOString() ?? null

  it('counts a duration forward from now, the way Codex reports it', () => {
    expect(resetAt("You've hit your usage limit. Try again in 2h 15m.")).toBe('2026-09-17T14:15:00.000Z')
    expect(resetAt('Usage limit reached · resets in 45m')).toBe('2026-09-17T12:45:00.000Z')
    expect(resetAt('Usage limit reached · available again in 3 hours')).toBe('2026-09-17T15:00:00.000Z')
    expect(resetAt('\x1b[2mUsagelimitreached·tryagainin90s\x1b[0m')).toBe('2026-09-17T12:01:30.000Z')
  })

  it('reads the absolute reset the rate-limit snapshot carries', () => {
    expect(resetAt('usage limit reached {"resets_at": "2026-09-18T08:30:00Z"}')).toBe('2026-09-18T08:30:00.000Z')
  })

  it('is null when Codex names no reset', () => {
    expect(resetAt("You've hit your usage limit.")).toBeNull()
    expect(resetAt('Finished in 2h 15m')).toBeNull()
  })
})

describe('TOML config values', () => {
  it('survives the quotes, backslashes and newlines an Employee’s instructions carry', () => {
    const text = 'You are "Ada".\nUse C:\\work\tand `chat_post`.'

    expect(JSON.parse(tomlString(text))).toBe(text)
    expect(tomlString(text)).not.toContain('\n')
  })
})

describe('What Codex answers the preflight (T135)', () => {
  const adapter = (output: string) =>
    createCodexAdapter({
      hookUrl: 'http://127.0.0.1:4555/hook',
      command: 'codex',
      name: 'Codex',
      env: { PATH: '/usr/bin' },
      installed: () => true,
      runCli: async () => ({ kind: 'output', code: 0, output }),
    })

  it('says nothing is wrong when Codex is signed in on the boss’s ChatGPT subscription', async () => {
    expect((await adapter('Logged in using ChatGPT\n').checkCli()).state).toBe('ready')
  })

  it('says it is not signed in, in Codex’s own commands and not Claude Code’s', async () => {
    const check = await adapter('Not logged in\n').checkCli()

    expect(check.state).toBe('signed-out')
    expect(check.title).toBe('Codex is not signed in')
    expect(check.commands).toEqual(['codex login', 'codex login status'])
  })

  it('reads a login on a billed key as a warning rather than a subscription', async () => {
    const check = await adapter('Logged in using an API key\n').checkCli()

    expect(check.state).toBe('warning')
    expect(check.title).toContain('API key')
  })

  /**
   * `codex login status` names the subscription it is logged in with and nothing else — no email,
   * no tier — and there is no way to have one without spending the subscription. So Your profile's
   * Providers card (T141) draws the plan and the badge, and no account line at all.
   */
  it('names the subscription it is logged in with, and no account, because Codex names none', async () => {
    const check = await adapter('Logged in using ChatGPT\n').checkCli()

    expect([check.account, check.plan]).toEqual([null, 'ChatGPT'])
  })

  it('does not read `an API key` as a plan', async () => {
    const check = await adapter('Logged in using an API key\n').checkCli()

    expect([check.account, check.plan]).toEqual([null, null])
  })

  it('says Codex is missing when the command is not on this machine, with the command to install it', async () => {
    const check = await createCodexAdapter({
      hookUrl: 'http://127.0.0.1:4555/hook',
      command: 'codex',
      name: 'Codex',
      env: { PATH: '/usr/bin' },
      installed: () => false,
      runCli: async () => {
        throw new Error('a CLI that is not on this machine is never run')
      },
    }).checkCli()

    expect(check.state).toBe('missing')
    expect(check.body).toContain('codex command')
    expect(check.commands[0]).toContain('install')
  })

  it('never reads a command that did not answer as a login', async () => {
    for (const outcome of [{ kind: 'timeout' } as const, { kind: 'failed' } as const]) {
      const check = await createCodexAdapter({
        hookUrl: 'http://127.0.0.1:4555/hook',
        command: 'codex',
        name: 'Codex',
        env: { PATH: '/usr/bin' },
        installed: () => true,
        runCli: async () => outcome,
      }).checkCli()

      expect(check.state).toBe('signed-out')
    }
  })
})

/**
 * The command the boss opens this Session with in their own terminal (T164): `codex resume <id>`
 * with the approval and sandbox flags the Session runs with, and nothing of the app's own half.
 */
describe('the handoff command', () => {
  const THREAD = '01999f3c-9c42-7cb1-9d3d-0f2c9e2b8a11'
  const build = (employee: Employee) => setup().adapter.handoffCommand!(employee, THREAD)

  it('resumes the thread with the same bypass the Session runs with', () => {
    expect(build(ada)).toEqual(['codex', 'resume', THREAD, '--dangerously-bypass-approvals-and-sandbox'])
  })

  it('asks for approval instead, for an Employee that asks first, exactly as the spawn does', () => {
    expect(build({ ...ada, permissionMode: 'interactive' })).toEqual([
      'codex',
      'resume',
      THREAD,
      '--ask-for-approval',
      'on-request',
      '--sandbox',
      'workspace-write',
    ])
  })

  it('carries none of the app’s own Session: no MCP override, no developer instructions', () => {
    const { adapter } = setup()
    adapter.injectMcp(THREAD, { company: { url: 'http://127.0.0.1:7391/mcp', token: 'mcp-token' }, granted: [] })

    const command = adapter.handoffCommand!(ada, THREAD)!.join(' ')

    expect(command).not.toContain('mcp_servers')
    expect(command).not.toContain('additional_developer_instructions')
    expect(command).not.toContain('--dangerously-bypass-hook-trust')
  })
})
