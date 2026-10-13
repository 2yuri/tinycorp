import { afterEach, describe, expect, it } from 'vitest'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'
import { type FakeProvider, fakeProvider } from '../../providers/testing'

const engines: CompanyEngine[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
})

function setup(): { engine: CompanyEngine; provider: FakeProvider } {
  const provider = fakeProvider()
  const engine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
    providers: { claude: provider },
  })
  provider.connect(engine.sessions.receiveHook)
  engines.push(engine)
  engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
  return { engine, provider }
}

function watch(engine: CompanyEngine, employeeId: string) {
  const received: string[] = []
  const attached = engine.terminals.attach(employeeId, (data) => received.push(data))
  return { ...attached, received, text: () => attached.backlog + received.join('') }
}

describe('Terminals', () => {
  it('streams a running Session’s output to an attached terminal', () => {
    const { engine, provider } = setup()
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
    engine.sessions.start(ada.id)
    const terminal = watch(engine, ada.id)

    provider.spawnOf(ada.id).pty.output('Welcome to Claude Code')

    expect(terminal.text()).toBe('Welcome to Claude Code')
  })

  it('replays what the Session printed before the terminal was opened', () => {
    const { engine, provider } = setup()
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
    engine.sessions.start(ada.id)
    provider.spawnOf(ada.id).pty.output('line one\r\n')
    provider.spawnOf(ada.id).pty.output('line two\r\n')

    const terminal = watch(engine, ada.id)

    expect(terminal.backlog).toBe('line one\r\nline two\r\n')
    expect(terminal.received).toEqual([])
  })

  it('stops streaming once the terminal is detached', () => {
    const { engine, provider } = setup()
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
    engine.sessions.start(ada.id)
    const terminal = watch(engine, ada.id)

    terminal.detach()
    provider.spawnOf(ada.id).pty.output('after')

    expect(terminal.text()).toBe('')
  })

  it('sends keystrokes typed in the terminal to the Session', () => {
    const { engine, provider } = setup()
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
    engine.sessions.start(ada.id)

    engine.terminals.write(ada.id, 'git status\r')

    expect(provider.spawnOf(ada.id).pty.written).toEqual(['git status\r'])
  })

  it('lets the boss answer an interactive-mode Employee’s permission prompt', () => {
    const { engine, provider } = setup()
    const ada = engine.employees.create({
      name: 'Ada',
      roleId: 'backend',
      permissionMode: 'interactive',
    })
    engine.sessions.start(ada.id)
    const spawned = provider.spawnOf(ada.id)
    spawned.hook('SessionStart')
    spawned.hook('PreToolUse', { tool_name: 'Bash' })
    const terminal = watch(engine, ada.id)

    spawned.pty.output('Do you want to proceed?\r\n❯ 1. Yes\r\n  2. No\r\n')
    engine.terminals.write(ada.id, '\r')

    expect(spawned.request.employee.permissionMode).toBe('interactive')
    expect(terminal.text()).toContain('Do you want to proceed?')
    expect(spawned.pty.written).toEqual(['\r'])
    expect(engine.sessions.get(ada.id).status).toBe('busy')
  })

  it('resizes the Session’s PTY to the terminal’s size', () => {
    const { engine, provider } = setup()
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
    engine.sessions.start(ada.id)

    engine.terminals.resize(ada.id, 90, 30)

    expect(provider.spawnOf(ada.id).pty.size).toEqual({ cols: 90, rows: 30 })
  })

  it('starts a restarted Session at the size the terminal last had', () => {
    const { engine, provider } = setup()
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
    engine.sessions.start(ada.id)
    engine.terminals.resize(ada.id, 100, 25)
    engine.sessions.stop(ada.id)

    engine.sessions.start(ada.id)

    expect(provider.spawnOf(ada.id).pty.size).toEqual({ cols: 100, rows: 25 })
  })

  it('clears the terminal when the Employee’s Session is restarted', () => {
    const { engine, provider } = setup()
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
    engine.sessions.start(ada.id)
    provider.spawnOf(ada.id).pty.output('old session')
    const terminal = watch(engine, ada.id)
    engine.sessions.stop(ada.id)

    engine.sessions.start(ada.id)
    provider.spawnOf(ada.id).pty.output('new session')

    expect(terminal.received.join('')).toMatch(/\x1bcnew session$/)
    expect(watch(engine, ada.id).backlog).toBe('new session')
  })

  it('keeps the last output of a Session that ended', () => {
    const { engine, provider } = setup()
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
    engine.sessions.start(ada.id)
    provider.spawnOf(ada.id).pty.output('Goodbye')
    provider.spawnOf(ada.id).pty.exit(0)

    expect(watch(engine, ada.id).backlog).toBe('Goodbye')
  })

  it('ignores input and resizes for an Employee without a running Session', () => {
    const { engine } = setup()
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })

    expect(() => engine.terminals.write(ada.id, 'x')).not.toThrow()
    expect(() => engine.terminals.resize(ada.id, 80, 24)).not.toThrow()
    expect(watch(engine, ada.id).backlog).toBe('')
  })

  it('rejects a terminal size that is not a positive whole number', () => {
    const { engine } = setup()
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
    engine.sessions.start(ada.id)

    expect(() => engine.terminals.resize(ada.id, 0, 24)).toThrow(/size/i)
    expect(() => engine.terminals.resize(ada.id, 80, 2.5)).toThrow(/size/i)
  })

  it('keeps only the most recent output in the replay', () => {
    const { engine, provider } = setup()
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
    engine.sessions.start(ada.id)
    const chunk = 'x'.repeat(64 * 1024)
    for (let i = 0; i < 10; i++) provider.spawnOf(ada.id).pty.output(chunk)
    provider.spawnOf(ada.id).pty.output('tail')

    const { backlog } = watch(engine, ada.id)

    expect(backlog.length).toBeLessThan(10 * chunk.length)
    expect(backlog.endsWith('tail')).toBe(true)
  })
})
