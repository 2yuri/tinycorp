import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'
import { type FakeProvider, fakeProvider } from '../../providers/testing'
import { handoff } from './sessions'

const engines: CompanyEngine[] = []
beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
  vi.useRealTimers()
})

function setup({ mcp = false }: { mcp?: boolean } = {}): { engine: CompanyEngine; provider: FakeProvider } {
  const provider = fakeProvider()
  const engine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
    providers: { claude: provider },
    // A Company whose Sessions are really given the Company MCP server, so what an adapter holds
    // — and writes — for one is worth something.
    ...(mcp && { mcpUrl: () => 'http://127.0.0.1/mcp' }),
  })
  provider.connect(engine.sessions.receiveHook)
  engines.push(engine)
  engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
  return { engine, provider }
}

function hire(engine: CompanyEngine, name = 'Ada', permissionMode?: 'interactive') {
  return engine.employees.create({ name, roleId: 'backend', ...(permissionMode !== undefined && { permissionMode }) })
}

const statusOf = (engine: CompanyEngine, employeeId: string) => engine.sessions.get(employeeId).status

describe('Sessions', () => {
  it('shows every Employee Off before anything is started', () => {
    const { engine } = setup()
    const ada = hire(engine)

    expect(engine.sessions.list()).toEqual([
      {
        employeeId: ada.id,
        status: 'off',
        providerSessionId: null,
        lastHook: null,
        lastHookAt: null,
        startedAt: null,
        providerReady: true,
        subagents: [],
        subSessions: [],
        asking: null,
        routedTo: null,
      },
    ])
  })

  it('tells when the running Session started, and forgets it once the Session is off', () => {
    const { engine, provider } = setup()
    const ada = hire(engine)
    vi.setSystemTime(new Date('2026-09-17T08:00:00.000Z'))

    engine.sessions.start(ada.id)
    vi.advanceTimersByTime(60_000)
    const running = engine.sessions.get(ada.id)
    provider.spawnOf(ada.id).pty.exit()

    expect(running.startedAt).toBe('2026-09-17T08:00:00.000Z')
    expect(engine.sessions.get(ada.id).startedAt).toBeNull()
  })

  it('spawns the Employee in the Company folder with an app-chosen session id', () => {
    const { engine, provider } = setup()
    const ada = hire(engine)

    const started = engine.sessions.start(ada.id)

    const { request } = provider.spawnOf(ada.id)
    expect(started.status).toBe('starting')
    expect(started.providerSessionId).toMatch(/^[0-9a-f-]{36}$/)
    expect(request).toMatchObject({
      employee: { id: ada.id },
      cwd: onDisk('/work/acme'),
      sessionId: started.providerSessionId,
      resume: false,
    })
    expect(request.hookToken).toEqual(expect.any(String))
  })

  it('goes idle about 1.5 s after SessionStart', () => {
    const { engine, provider } = setup()
    const ada = hire(engine)
    engine.sessions.start(ada.id)

    provider.spawnOf(ada.id).hook('SessionStart', { source: 'startup' })
    vi.advanceTimersByTime(1000)
    const early = statusOf(engine, ada.id)
    vi.advanceTimersByTime(600)

    expect(early).toBe('starting')
    expect(statusOf(engine, ada.id)).toBe('idle')
    expect(engine.sessions.get(ada.id)).toMatchObject({ lastHook: 'SessionStart' })
  })

  it('is busy while working and idle again when it stops', () => {
    const { engine, provider } = setup()
    const ada = hire(engine)
    engine.sessions.start(ada.id)
    const session = provider.spawnOf(ada.id)
    session.hook('SessionStart')
    vi.advanceTimersByTime(1500)

    const seen: string[] = []
    session.hook('UserPromptSubmit')
    seen.push(statusOf(engine, ada.id))
    session.hook('PreToolUse', { tool_name: 'Read' })
    session.hook('PostToolUse', { tool_name: 'Read' })
    seen.push(statusOf(engine, ada.id))
    session.hook('Stop')
    seen.push(statusOf(engine, ada.id))
    session.hook('PreToolUse', { tool_name: 'Bash' })
    seen.push(statusOf(engine, ada.id))

    expect(seen).toEqual(['busy', 'busy', 'idle', 'busy'])
  })

  it('does not fall back to idle from a late SessionStart timer once busy', () => {
    const { engine, provider } = setup()
    const ada = hire(engine)
    engine.sessions.start(ada.id)
    const session = provider.spawnOf(ada.id)

    session.hook('SessionStart')
    session.hook('UserPromptSubmit')
    vi.advanceTimersByTime(2000)

    expect(statusOf(engine, ada.id)).toBe('busy')
  })

  it('treats an idle_prompt notification as idle and other notifications as nothing', () => {
    const { engine, provider } = setup()
    const ada = hire(engine)
    engine.sessions.start(ada.id)
    const session = provider.spawnOf(ada.id)
    session.hook('UserPromptSubmit')

    session.hook('Notification', { notification_type: 'permission_prompt' })
    const afterOther = statusOf(engine, ada.id)
    session.hook('Notification', { notification_type: 'idle_prompt' })

    expect(afterOther).toBe('busy')
    expect(statusOf(engine, ada.id)).toBe('idle')
  })

  it('goes Off when the process exits, and ignores hooks from the dead Session', () => {
    const { engine, provider } = setup()
    const ada = hire(engine)
    engine.sessions.start(ada.id)
    const session = provider.spawnOf(ada.id)
    session.hook('SessionStart')
    vi.advanceTimersByTime(1500)

    session.pty.exit(1)
    session.hook('UserPromptSubmit')

    expect(statusOf(engine, ada.id)).toBe('off')
  })

  it('stops a Session by killing its process', () => {
    const { engine, provider } = setup()
    const ada = hire(engine)
    engine.sessions.start(ada.id)

    const stopped = engine.sessions.stop(ada.id)

    expect(provider.spawnOf(ada.id).pty.killed).toBe(true)
    expect(stopped.status).toBe('off')
  })

  /**
   * T199, finding H5. The file an adapter writes for a Session — Claude Code's MCP config —
   * holds that Session's bearer token for the Company MCP server, and every Employee is a process
   * of the same OS user as the app, so every Employee can read it. Nothing else ever deletes it:
   * before this, one `cat` in a prompt-injected Session handed it every live Session's token and
   * the whole install's worth of dead ones.
   */
  it('tells the adapter to forget a stopped Session, so nothing written for it outlives it', () => {
    const { engine, provider } = setup({ mcp: true })
    const ada = hire(engine)
    const sessionId = engine.sessions.start(ada.id).providerSessionId!
    expect(provider.mcpOf(sessionId)?.company?.token).toEqual(expect.any(String))

    engine.sessions.stop(ada.id)

    expect(provider.forgotten).toEqual([sessionId])
    expect(provider.mcpOf(sessionId)).toBeUndefined()
  })

  it('forgets a Session whose process exited on its own, not only one the boss stopped', () => {
    const { engine, provider } = setup({ mcp: true })
    const ada = hire(engine)
    const sessionId = engine.sessions.start(ada.id).providerSessionId!

    provider.spawnOf(ada.id).pty.exit()

    expect(provider.forgotten).toEqual([sessionId])
  })

  it('forgets every Session when the app closes, and no other Employee’s', () => {
    const { engine, provider } = setup({ mcp: true })
    const ada = engine.sessions.start(hire(engine, 'Ada').id).providerSessionId
    const bob = engine.sessions.start(hire(engine, 'Bob').id).providerSessionId

    engine.close()

    expect(provider.forgotten.sort()).toEqual([ada, bob].sort())
  })

  it('ignores hooks with an unknown token', () => {
    const { engine, provider } = setup()
    const ada = hire(engine)
    engine.sessions.start(ada.id)

    engine.sessions.receiveHook('not-a-token', {
      hook_event_name: 'Stop',
      session_id: provider.spawnOf(ada.id).request.sessionId,
    })

    expect(statusOf(engine, ada.id)).toBe('starting')
  })

  it('refuses to start a Session that is already running', () => {
    const { engine } = setup()
    const ada = hire(engine)
    engine.sessions.start(ada.id)

    expect(() => engine.sessions.start(ada.id)).toThrow(/already running/i)
  })

  it('starts a fresh session id on every start and tracks the one hooks report', () => {
    const { engine, provider } = setup()
    const ada = hire(engine)
    const first = engine.sessions.start(ada.id).providerSessionId
    engine.sessions.stop(ada.id)
    const second = engine.sessions.start(ada.id).providerSessionId

    provider.spawnOf(ada.id).hook('SessionStart', { session_id: 'after-clear', source: 'clear' })

    expect(second).not.toBe(first)
    expect(engine.sessions.get(ada.id).providerSessionId).toBe('after-clear')
  })

  it('tells listeners when a status changes', () => {
    const { engine, provider } = setup()
    const ada = hire(engine)
    const statuses: string[] = []
    engine.sessions.onChange(() => statuses.push(statusOf(engine, ada.id)))

    engine.sessions.start(ada.id)
    provider.spawnOf(ada.id).hook('SessionStart')
    vi.advanceTimersByTime(1500)
    provider.spawnOf(ada.id).hook('UserPromptSubmit')
    provider.spawnOf(ada.id).hook('PreToolUse')
    provider.spawnOf(ada.id).hook('Stop')
    engine.sessions.stop(ada.id)

    expect(statuses).toEqual(['starting', 'idle', 'busy', 'idle', 'off'])
  })

  it('kills every Session when the engine closes', () => {
    const { engine, provider } = setup()
    engine.sessions.start(hire(engine, 'Ada').id)
    engine.sessions.start(hire(engine, 'Bob').id)

    engine.close()

    expect(provider.spawns.map((s) => s.pty.killed)).toEqual([true, true])
  })

  it('refuses to start an unknown Employee or one whose provider has no adapter', () => {
    const engine = createCompanyEngine({
      openDatabase: inMemoryDatabases(),
      recents: inMemoryRecents(),
    })
    engines.push(engine)
    engine.createCompany({ folder: onDisk('/work/acme') })
    const ada = hire(engine)

    expect(() => engine.sessions.start('nobody')).toThrow(/unknown employee/i)
    expect(() => engine.sessions.start(ada.id)).toThrow(/no provider adapter/i)
    expect(engine.sessions.get(ada.id).status).toBe('off')
  })

  it('remembers the last session id when the Company is reopened', () => {
    const openDatabase = inMemoryDatabases()
    const provider = fakeProvider()
    const first = createCompanyEngine({ openDatabase, recents: inMemoryRecents(), providers: { claude: provider } })
    provider.connect(first.sessions.receiveHook)
    first.createCompany({ folder: onDisk('/work/acme') })
    const ada = hire(first)
    const { providerSessionId } = first.sessions.start(ada.id)
    provider.spawnOf(ada.id).hook('SessionStart')
    first.sessions.stop(ada.id)

    const second = createCompanyEngine({ openDatabase, recents: inMemoryRecents(), providers: { claude: provider } })
    engines.push(second)
    second.openCompany(onDisk('/work/acme'))

    expect(second.sessions.get(ada.id)).toMatchObject({
      status: 'off',
      providerSessionId,
      lastHook: 'SessionStart',
    })
  })
})

/**
 * The command that opens an Employee's Session in the boss's own terminal (T164). The engine only
 * finds the Session and quotes what the adapter built — it never runs anything.
 */
describe('the handoff command', () => {
  it('is nothing until the Employee has had a Session: there is none to open', () => {
    const { engine } = setup()
    const ada = hire(engine)

    expect(engine.sessions.handoffCommand(ada.id)).toBeNull()
  })

  it('names the Session the Employee last ran, and stays there once it is stopped', () => {
    const { engine, provider } = setup()
    const ada = hire(engine)
    engine.sessions.start(ada.id)
    const sessionId = provider.spawnOf(ada.id).request.sessionId

    const live = engine.sessions.handoffCommand(ada.id)
    engine.sessions.stop(ada.id)

    expect(live).toEqual({
      command: `fake-cli --resume ${sessionId} --skip-permissions`,
      shown: `fake-cli --resume ${sessionId.slice(0, 4)}\u2026 --skip-permissions`,
    })
    expect(engine.sessions.handoffCommand(ada.id)).toEqual(live)
  })

  it('is nothing for an Employee whose Provider builds none', () => {
    const provider = fakeProvider({ handoff: false })
    const engine = createCompanyEngine({
      openDatabase: inMemoryDatabases(),
      recents: inMemoryRecents(),
      providers: { claude: provider },
    })
    provider.connect(engine.sessions.receiveHook)
    engines.push(engine)
    engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
    const ada = hire(engine)
    engine.sessions.start(ada.id)

    expect(engine.sessions.handoffCommand(ada.id)).toBeNull()
  })

  it('is nothing for an unknown Employee, rather than throwing at a drawer that is closing', () => {
    const { engine } = setup()

    expect(engine.sessions.handoffCommand('nobody')).toBeNull()
  })
})

describe('quoting the handoff command', () => {
  it('leaves an ordinary argument bare, so the line reads the way the CLI is typed', () => {
    expect(handoff(['claude', '--resume', 'abc-123'], 'abc-123').command).toBe('claude --resume abc-123')
  })

  it('quotes an argument a shell would take apart, so a pasted line still runs', () => {
    expect(handoff(['cli', 'say what you mean'], 'x').command).toBe("cli 'say what you mean'")
    expect(handoff(['cli', "it's here"], 'x').command).toBe(`cli 'it'\\''s here'`)
  })

  it('shortens the session id in the line it reads back, and nowhere else', () => {
    const { command, shown } = handoff(['cli', '--resume', '3f2a91c4-77de'], '3f2a91c4-77de')

    expect(command).toBe('cli --resume 3f2a91c4-77de')
    expect(shown).toBe('cli --resume 3f2a\u2026')
  })
})
