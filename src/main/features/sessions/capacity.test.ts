import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BOSS, dmChannelId } from '../../../shared/domain/chat'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'
import { type FakeProvider, fakeProvider } from '../../providers/testing'
import { DEFAULT_CONCURRENCY_CAP, formatResetTime, UNKNOWN_RESET_RETRY_MS } from './capacity'
import { READY_DELAY_MS } from './sessions'

const NOW = new Date('2026-09-17T12:00:00.000Z')
const engines: CompanyEngine[] = []
beforeEach(() => {
  vi.useFakeTimers({ now: NOW })
})
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
  vi.useRealTimers()
})

function setup({
  openDatabase = inMemoryDatabases(),
  provider = fakeProvider(),
}: {
  openDatabase?: ReturnType<typeof inMemoryDatabases>
  provider?: FakeProvider
} = {}) {
  const engine = createCompanyEngine({
    openDatabase,
    recents: inMemoryRecents(),
    providers: { claude: provider },
    log: () => {},
  })
  provider.connect(engine.sessions.receiveHook)
  engines.push(engine)
  return { engine, provider, openDatabase }
}

function companyWith(names: string[], options?: Parameters<typeof setup>[0]) {
  const context = setup(options)
  context.engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
  const team = names.map((name) => context.engine.employees.create({ name, roleId: 'backend' }))
  return { ...context, team }
}

const NAMES = ['Ada', 'Grace', 'Juno', 'Ken', 'Barbara', 'Dennis', 'Margaret']

const statuses = (engine: CompanyEngine) =>
  Object.fromEntries(
    engine.sessions.list().map((s) => [engine.employees.list().find((e) => e.id === s.employeeId)!.name, s.status]),
  )

const spawnedNames = (provider: FakeProvider) => provider.spawns.map((s) => s.request.employee.name)

describe('Concurrency cap', () => {
  it('runs at most five Sessions by default and parks the rest without a Session', () => {
    const { engine, provider, team } = companyWith(NAMES.slice(0, 7))

    const started = team.map((employee) => engine.sessions.start(employee.id))

    expect(engine.capacity.get()).toMatchObject({ concurrencyCap: DEFAULT_CONCURRENCY_CAP, running: 5 })
    expect(DEFAULT_CONCURRENCY_CAP).toBe(5)
    expect(spawnedNames(provider)).toEqual(['Ada', 'Grace', 'Juno', 'Ken', 'Barbara'])
    expect(started.map((s) => s.status)).toEqual([
      'starting',
      'starting',
      'starting',
      'starting',
      'starting',
      'parked',
      'parked',
    ])
    expect(statuses(engine)).toMatchObject({ Dennis: 'parked', Margaret: 'parked' })
    expect(engine.capacity.get().parked).toEqual([team[5]!.id, team[6]!.id])
  })

  it('starts the longest-parked Employee when a slot frees', () => {
    const { engine, provider, team } = companyWith(NAMES.slice(0, 7))
    for (const employee of team) engine.sessions.start(employee.id)

    engine.sessions.stop(team[0]!.id)
    provider.spawnOf(team[1]!.id).pty.exit(1)

    expect(spawnedNames(provider).slice(5)).toEqual(['Dennis', 'Margaret'])
    expect(statuses(engine)).toMatchObject({ Ada: 'off', Grace: 'off', Dennis: 'starting', Margaret: 'starting' })
    expect(engine.capacity.get()).toMatchObject({ running: 5, parked: [] })
  })

  it('lets the boss raise the cap, which starts parked Employees at once', () => {
    const { engine, provider, team } = companyWith(NAMES.slice(0, 7))
    for (const employee of team) engine.sessions.start(employee.id)

    const info = engine.capacity.setConcurrencyCap(6)

    expect(info).toMatchObject({ concurrencyCap: 6, running: 6, parked: [team[6]!.id] })
    expect(spawnedNames(provider)).toHaveLength(6)
    expect(statuses(engine)).toMatchObject({ Dennis: 'starting', Margaret: 'parked' })
  })

  it('keeps running Sessions when the cap is lowered, and parks new starts until below it', () => {
    const { engine, provider, team } = companyWith(NAMES.slice(0, 4))
    for (const employee of team.slice(0, 3)) engine.sessions.start(employee.id)

    engine.capacity.setConcurrencyCap(2)
    const ken = engine.sessions.start(team[3]!.id)
    engine.sessions.stop(team[0]!.id)
    const whileAtCap = statuses(engine)['Ken']
    engine.sessions.stop(team[1]!.id)

    expect(ken.status).toBe('parked')
    expect(whileAtCap).toBe('parked')
    expect(statuses(engine)).toMatchObject({ Ada: 'off', Grace: 'off', Juno: 'starting', Ken: 'starting' })
    expect(spawnedNames(provider)).toEqual(['Ada', 'Grace', 'Juno', 'Ken'])
  })

  it('unparks an Employee when the boss stops it, so it never starts', () => {
    const { engine, provider, team } = companyWith(NAMES.slice(0, 2))
    engine.capacity.setConcurrencyCap(1)
    engine.sessions.start(team[0]!.id)
    engine.sessions.start(team[1]!.id)

    const stopped = engine.sessions.stop(team[1]!.id)
    engine.sessions.stop(team[0]!.id)

    expect(stopped.status).toBe('off')
    expect(spawnedNames(provider)).toEqual(['Ada'])
    expect(engine.capacity.get().parked).toEqual([])
  })

  it('refuses to park an Employee twice or to park a stranger', () => {
    const { engine, team } = companyWith(NAMES.slice(0, 2))
    engine.capacity.setConcurrencyCap(1)
    engine.sessions.start(team[0]!.id)
    engine.sessions.start(team[1]!.id)

    expect(() => engine.sessions.start(team[1]!.id)).toThrow(/already/i)
    expect(() => engine.sessions.start('nobody')).toThrow(/unknown employee/i)
    expect(engine.capacity.get().parked).toEqual([team[1]!.id])
  })

  it('rejects a cap that is not a whole number of at least one', () => {
    const { engine } = companyWith([])

    for (const bad of [0, -1, 2.5, Number.NaN]) {
      expect(() => engine.capacity.setConcurrencyCap(bad)).toThrow(/concurrency cap/i)
    }
    expect(engine.capacity.get().concurrencyCap).toBe(5)
  })

  it('keeps the cap per Company across a reopen', () => {
    const openDatabase = inMemoryDatabases()
    const first = companyWith([], { openDatabase }).engine
    engines.splice(engines.indexOf(first), 1) // shares its databases with `second`, which closes them
    first.capacity.setConcurrencyCap(2)
    first.createCompany({ folder: onDisk('/work/globex') })
    const globexCap = first.capacity.get().concurrencyCap

    const second = setup({ openDatabase }).engine
    second.openCompany(onDisk('/work/acme'))

    expect(globexCap).toBe(5)
    expect(second.capacity.get().concurrencyCap).toBe(2)
  })

  it('fills a freed slot in a Company that is no longer current', () => {
    const { engine, provider, team } = companyWith(NAMES.slice(0, 2))
    engine.capacity.setConcurrencyCap(1)
    engine.sessions.start(team[0]!.id)
    engine.sessions.start(team[1]!.id)
    engine.createCompany({ folder: onDisk('/work/globex') })

    provider.spawnOf(team[0]!.id).pty.exit(0)

    expect(provider.spawnOf(team[1]!.id).request.cwd).toBe(onDisk('/work/acme'))
    engine.openCompany(onDisk('/work/acme'))
    expect(statuses(engine)).toMatchObject({ Ada: 'off', Grace: 'starting' })
  })
})

const LIMIT_OUTPUT = "\x1b[31mYou've hit your limit\x1b[0m · resets 3pm (UTC)"
const RESET = new Date('2026-09-17T15:00:00.000Z')

describe('Budget exhausted', () => {
  function runningTeam() {
    const context = companyWith(NAMES.slice(0, 3))
    const sessions = context.team.map((employee) => {
      context.engine.sessions.start(employee.id)
      const session = context.provider.spawnOf(employee.id)
      session.hook('SessionStart')
      return session
    })
    vi.advanceTimersByTime(READY_DELAY_MS)
    const general = () => context.engine.chat().read({ channelId: 'general' })
    return { ...context, sessions, general }
  }

  it('marks every Session out of budget and says once in #general when they are back', () => {
    const { engine, sessions, general } = runningTeam()
    sessions[0]!.hook('UserPromptSubmit')
    const now = new Date().toISOString()

    sessions[0]!.pty.output(LIMIT_OUTPUT)
    sessions[1]!.pty.output('Claude usage limit reached. Your limit will reset at 3pm (UTC)')

    expect(statuses(engine)).toEqual({ Ada: 'out_of_budget', Grace: 'out_of_budget', Juno: 'out_of_budget' })
    expect(engine.capacity.get().budget).toEqual({
      exhaustedAt: now,
      resetsAt: RESET.toISOString(),
    })
    expect(general()).toEqual([
      expect.objectContaining({
        authorId: 'company',
        text: expect.stringContaining(`back at ${formatResetTime(RESET)}`),
      }),
    ])
  })

  it('detects the limit in hook output too', () => {
    const { engine, sessions, general } = runningTeam()

    sessions[2]!.hook('Stop', { last_assistant_message: 'Claude usage limit reached|1789660800' })

    expect(statuses(engine)).toMatchObject({ Ada: 'out_of_budget', Juno: 'out_of_budget' })
    expect(engine.capacity.get().budget?.resetsAt).toBe('2026-09-17T16:00:00.000Z')
    expect(general()).toHaveLength(1)
  })

  it('ignores the limit message inside tool input, tool output or a prompt', () => {
    const { engine, sessions, general } = runningTeam()
    const text = 'Claude usage limit reached. Your limit will reset at 5pm'

    sessions[0]!.hook('UserPromptSubmit', { prompt: text })
    sessions[0]!.hook('PreToolUse', { tool_name: 'Write', tool_input: { content: text } })
    sessions[0]!.hook('PostToolUse', { tool_name: 'Read', tool_response: { file: { content: text } } })

    expect(engine.capacity.get().budget).toBeNull()
    expect(statuses(engine)).toMatchObject({ Ada: 'busy' })
    expect(general()).toEqual([])
  })

  it('pushes no prompts until the reset time, then drains the waiting inbox', () => {
    const { engine, team, sessions } = runningTeam()
    sessions[0]!.pty.output(LIMIT_OUTPUT)

    engine.chat().post({ authorId: BOSS, channelId: dmChannelId(BOSS, team[1]!.id), text: 'ping' })
    sessions[1]!.hook('Stop')
    vi.advanceTimersByTime(RESET.getTime() - Date.now() - 1000)
    const pushedBefore = sessions.flatMap((s) => s.pushed)
    const inboxBefore = engine.inbox.list(team[1]!.id).map((i) => i.status)
    vi.advanceTimersByTime(1000)

    expect(pushedBefore).toEqual([])
    expect(inboxBefore).toEqual(['pending'])
    expect(sessions[1]!.pushed).toEqual([expect.stringContaining('"ping"')])
    expect(engine.capacity.get().budget).toBeNull()
    expect(statuses(engine)).toEqual({ Ada: 'idle', Grace: 'idle', Juno: 'idle' })
  })

  it('also holds Sessions started while out of budget', () => {
    const { engine, provider, team, sessions } = runningTeam()
    const dennis = engine.employees.create({ name: 'Dennis', roleId: 'backend' })
    sessions[0]!.pty.output(LIMIT_OUTPUT)

    engine.sessions.start(dennis.id)
    provider.spawnOf(dennis.id).hook('SessionStart')
    vi.advanceTimersByTime(READY_DELAY_MS)
    engine.chat().post({ authorId: BOSS, channelId: dmChannelId(BOSS, dennis.id), text: 'hi' })

    expect(engine.sessions.get(dennis.id).status).toBe('out_of_budget')
    expect(provider.spawnOf(dennis.id).pushed).toEqual([])
    expect(team).toHaveLength(3)
  })

  it('retries after an hour when the output names no reset time', () => {
    const { engine, sessions, general } = runningTeam()
    const now = new Date().toISOString()

    sessions[0]!.pty.output('Claude usage limit reached.')
    const budget = engine.capacity.get().budget
    vi.advanceTimersByTime(UNKNOWN_RESET_RETRY_MS)

    expect(budget).toEqual({ exhaustedAt: now, resetsAt: null })
    expect(general()).toEqual([expect.objectContaining({ text: expect.stringMatching(/reset time is unknown/i) })])
    expect(engine.capacity.get().budget).toBeNull()
    expect(statuses(engine)).toMatchObject({ Ada: 'idle' })
  })

  it('ignores the old limit message redrawn after the reset, until a new prompt hits it again', () => {
    const { engine, sessions, general } = runningTeam()
    sessions[0]!.pty.output(LIMIT_OUTPUT)
    vi.advanceTimersByTime(RESET.getTime() - Date.now())

    sessions[0]!.pty.output(LIMIT_OUTPUT)
    const afterRedraw = engine.capacity.get().budget
    sessions[0]!.hook('UserPromptSubmit')
    sessions[0]!.pty.output('Claude usage limit reached. Your limit will reset at 8pm (UTC)')

    expect(afterRedraw).toBeNull()
    expect(engine.capacity.get().budget?.resetsAt).toBe('2026-09-17T20:00:00.000Z')
    expect(general()).toHaveLength(2)
  })

  it('leaves Employees parked and out of budget apart: a parked one still waits for a slot', () => {
    const { engine, team, sessions } = runningTeam()
    engine.capacity.setConcurrencyCap(3)
    const dennis = engine.employees.create({ name: 'Dennis', roleId: 'backend' })
    engine.sessions.start(dennis.id)
    sessions[0]!.pty.output(LIMIT_OUTPUT)

    expect(statuses(engine)).toMatchObject({ Dennis: 'parked', Ada: 'out_of_budget' })
    expect(team).toHaveLength(3)
  })
})
