import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UNKNOWN_RESET_RETRY_MS } from '../../../shared/capacity'
import { clockTime } from '../../../shared/platform/clock-time'
import { ROTATION_WARNING, unknownResetBackoffMs } from '../../../shared/usage/usage-routing'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'
import { FAKE_CONFIG_DIR_ENV, FAKE_DEFAULT_CONFIG_DIR, type FakeProvider, fakeProvider } from '../../providers/testing'
import { READY_DELAY_MS } from '../sessions/sessions'
import { type AccountStore, memoryAccounts, primaryId } from './provider-accounts'
import { memoryOutages, type OutageStore, SYSTEM_LINE_BATCH_MS } from './usage-limits'

/** Claude Code's own words, which the fake Provider reads with the real adapter's matcher. */
const LIMIT = "\x1b[31mYou've hit your limit\x1b[0m · resets 3pm (UTC)"
const LIMIT_NO_TIME = 'Claude usage limit reached.'
const NOW = new Date('2026-09-17T12:00:00.000Z')
const RESET = new Date('2026-09-17T15:00:00.000Z')

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
  outageStore = memoryOutages(),
  accountStore = memoryAccounts(),
  claude = fakeProvider({ accounts: true }),
  codex = fakeProvider({ accounts: true }),
  readReset,
}: {
  openDatabase?: ReturnType<typeof inMemoryDatabases>
  outageStore?: OutageStore
  accountStore?: AccountStore
  claude?: FakeProvider
  codex?: FakeProvider
  readReset?: (provider: string, accountId: string | null) => Promise<Date | null>
} = {}) {
  const engine = createCompanyEngine({
    openDatabase,
    recents: inMemoryRecents(),
    providers: { claude, codex },
    outageStore,
    accountStore,
    accountsDir: onDisk('/app/accounts'),
    makeAccountDir: () => {},
    ...(readReset && { readReset }),
    log: () => {},
  })
  claude.connect(engine.sessions.receiveHook)
  codex.connect(engine.sessions.receiveHook)
  engines.push(engine)
  return { engine, claude, codex, openDatabase, outageStore, accountStore }
}

/** A Company with a working team, every Session up and idle. */
function teamAt(names: string[], options?: Parameters<typeof setup>[0]) {
  const context = setup(options)
  context.engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
  const team = names.map((name) => context.engine.employees.create({ name, roleId: 'backend' }))
  for (const employee of team) {
    context.engine.sessions.start(employee.id)
    context.claude.spawnOf(employee.id).hook('SessionStart')
  }
  vi.advanceTimersByTime(READY_DELAY_MS)
  const general = () => context.engine.chat().read({ channelId: 'general' })
  return { ...context, team, general }
}

const statusOf = (engine: CompanyEngine, employeeId: string) => engine.sessions.get(employeeId).status

describe('Resuming at the reset', () => {
  it('schedules the resume when the limit is hit and keeps it across a restart', () => {
    const openDatabase = inMemoryDatabases()
    const outageStore = memoryOutages()
    const first = teamAt(['Ada', 'Grace'], { openDatabase, outageStore })
    first.claude.spawnOf(first.team[0]!.id).pty.output(LIMIT)
    expect(statusOf(first.engine, first.team[0]!.id)).toBe('out_of_budget')

    // The app goes away with the limit still on, which is what an overnight limit looks like. Only
    // its schedule is closed: `engine.close()` would close the in-memory databases the next run reopens.
    first.engine.sessions.stopAll()
    first.engine.limits.close()
    engines.splice(engines.indexOf(first.engine), 1)
    const second = setup({ openDatabase, outageStore })
    second.engine.openCompany(onDisk('/work/acme'))
    const employees = second.engine.employees.list()
    const beforeReset = second.engine.capacity.get().outages

    vi.advanceTimersByTime(RESET.getTime() - Date.now())

    expect(beforeReset).toEqual([expect.objectContaining({ provider: 'claude', resetsAt: RESET.toISOString() })])
    expect(second.engine.capacity.get().outages).toEqual([])
    // Whoever was stopped by the limit is back at a desk, without the boss pressing anything.
    expect(second.claude.spawns.map((spawn) => spawn.request.employee.name)).toEqual(['Ada', 'Grace'])
    expect(statusOf(second.engine, employees[0]!.id)).toBe('starting')
  })

  it('puts parked Employees back in queue order, under the concurrency cap', () => {
    const openDatabase = inMemoryDatabases()
    const outageStore = memoryOutages()
    const first = teamAt(['Ada', 'Grace', 'Juno'], { openDatabase, outageStore })
    first.claude.spawnOf(first.team[1]!.id).pty.output(LIMIT)
    first.engine.sessions.stopAll()
    first.engine.limits.close()
    engines.splice(engines.indexOf(first.engine), 1)

    const second = setup({ openDatabase, outageStore })
    second.engine.openCompany(onDisk('/work/acme'))
    second.engine.capacity.setConcurrencyCap(2)
    vi.advanceTimersByTime(RESET.getTime() - Date.now())

    expect(second.claude.spawns.map((spawn) => spawn.request.employee.name)).toEqual(['Ada', 'Grace'])
    expect(second.engine.capacity.get()).toMatchObject({ running: 2, parked: [second.engine.employees.list()[2]!.id] })
  })

  it('re-checks a limit that named no reset time on a backoff, without spending any usage', async () => {
    const asked: string[] = []
    const { engine, claude, team } = teamAt(['Ada'], {
      readReset: (provider) => {
        asked.push(provider)
        return Promise.resolve(asked.length < 3 ? null : RESET)
      },
    })
    claude.spawnOf(team[0]!.id).pty.output(LIMIT_NO_TIME)

    await vi.advanceTimersByTimeAsync(unknownResetBackoffMs(1))
    const afterFirst = [...asked]
    await vi.advanceTimersByTimeAsync(unknownResetBackoffMs(2))
    await vi.advanceTimersByTimeAsync(unknownResetBackoffMs(3))

    expect(afterFirst).toEqual(['claude'])
    expect(asked).toEqual(['claude', 'claude', 'claude'])
    // The re-check is a status read: nothing was typed into any Session.
    expect(claude.spawnOf(team[0]!.id).pushed).toEqual([])
    expect(engine.capacity.get().outages).toEqual([
      expect.objectContaining({ provider: 'claude', resetsAt: RESET.toISOString() }),
    ])
  })

  it('gives up asking and lets the team try again once the retry window is over', () => {
    const { engine, claude, team } = teamAt(['Ada'])
    claude.spawnOf(team[0]!.id).pty.output(LIMIT_NO_TIME)

    vi.advanceTimersByTime(UNKNOWN_RESET_RETRY_MS)

    expect(engine.capacity.get().outages).toEqual([])
    expect(statusOf(engine, team[0]!.id)).toBe('idle')
  })
})

describe('Routing to another Provider', () => {
  /** A Company whose rule is "continue on Codex" when Claude runs out. */
  function routedTeam(names: string[], options?: Parameters<typeof setup>[0]) {
    const context = teamAt(names, options)
    context.engine.usageRouting.setRule('claude', { kind: 'continue', provider: 'codex', model: 'gpt-6-sol' })
    return context
  }

  it('moves an idle Employee to the fallback and tells it where it is', () => {
    const { engine, claude, codex, team } = routedTeam(['Vega'])

    claude.spawnOf(team[0]!.id).pty.output(LIMIT)

    const spawn = codex.spawnOf(team[0]!.id)
    expect(spawn.request.employee.provider).toBe('codex')
    expect(spawn.request.employee.model).toBe('gpt-6-sol')
    expect(engine.sessions.get(team[0]!.id).routedTo).toEqual({
      provider: 'codex',
      model: 'gpt-6-sol',
      from: 'claude',
      resetsAt: RESET.toISOString(),
      movesBack: true,
    })
    // It is not out of budget: it is working, somewhere else.
    expect(statusOf(engine, team[0]!.id)).toBe('starting')
  })

  it('waits for the turn to end rather than stopping an Employee in the middle of an edit', () => {
    const { engine, claude, codex, team } = routedTeam(['Vega'])
    const session = claude.spawnOf(team[0]!.id)
    session.hook('UserPromptSubmit')

    session.pty.output(LIMIT)
    const duringTheTurn = codex.spawns.length

    session.hook('Stop')

    expect(duringTheTurn).toBe(0)
    expect(codex.spawns).toHaveLength(1)
    expect(engine.sessions.get(team[0]!.id).routedTo?.provider).toBe('codex')
  })

  it('hands the fallback Session the ticket, the worktree and everything else it knew', () => {
    const { engine, claude, codex, team } = routedTeam(['Vega'])
    const ticket = engine.board().createTicket({ title: 'Usage chart', description: 'Draw the 5h window.' })
    engine.board().updateTicket(ticket.id, { assigneeId: team[0]!.id })
    engine.board().moveTicket(ticket.id, 'doing')
    engine.chat().post({ authorId: team[0]!.id, channelId: 'general', text: 'Starting on the chart.' })

    claude.spawnOf(team[0]!.id).pty.output(LIMIT)
    codex.spawnOf(team[0]!.id).hook('SessionStart')
    vi.advanceTimersByTime(READY_DELAY_MS)

    const prompt = codex.spawnOf(team[0]!.id).pushed.find((text) => text.includes('## Ticket')) ?? ''
    expect(prompt).toContain('Claude hit its usage limit, so this Session continues on Codex.')
    expect(prompt).toContain('AC-1 — Usage chart')
    expect(prompt).toContain('Draw the 5h window.')
    expect(prompt).toContain('Starting on the chart.')
    expect(prompt).toContain('same worktree and on the same branch')
  })

  it('moves back at the next turn boundary when the Provider resets, keeping the ticket', () => {
    const { engine, claude, codex, team } = routedTeam(['Vega'])
    claude.spawnOf(team[0]!.id).pty.output(LIMIT)
    const moved = codex.spawnOf(team[0]!.id)
    moved.hook('SessionStart')
    vi.advanceTimersByTime(READY_DELAY_MS)
    moved.hook('UserPromptSubmit')

    vi.advanceTimersByTime(RESET.getTime() - Date.now())
    const midTurn = engine.sessions.get(team[0]!.id).routedTo
    moved.hook('Stop')

    expect(midTurn?.provider).toBe('codex')
    expect(engine.sessions.get(team[0]!.id).routedTo).toBeNull()
    expect(claude.spawns).toHaveLength(2)
    expect(claude.spawns.at(-1)!.request.employee.provider).toBe('claude')
  })

  it('leaves an Employee where it is when the Company said not to move it back', () => {
    const { engine, claude, codex, team } = routedTeam(['Vega'])
    engine.usageRouting.setMoveBack('claude', false)
    claude.spawnOf(team[0]!.id).pty.output(LIMIT)

    vi.advanceTimersByTime(RESET.getTime() - Date.now())

    expect(codex.spawns).toHaveLength(1)
    expect(claude.spawns).toHaveLength(1)
    expect(engine.sessions.get(team[0]!.id).routedTo).toMatchObject({ provider: 'codex', movesBack: false })
  })

  it('says in #general who switched and who waited, in one line each, batched per minute', () => {
    const { engine, claude, team, general } = routedTeam(['Vega', 'Iris'])
    engine.usageRouting.setEmployeeRule(team[1]!.id, { kind: 'wait' })

    claude.spawnOf(team[0]!.id).pty.output(LIMIT)
    const beforeTheBatch = general().length
    vi.advanceTimersByTime(SYSTEM_LINE_BATCH_MS)

    const posted = general().map((message) => message.text)
    expect(beforeTheBatch).toBe(0)
    expect(posted).toEqual([
      `Claude hit its limit · Vega continued on Codex · back to Claude at ${clockTime(RESET, NOW)}`,
      `Iris waits for the reset in the coffee area · back at ${clockTime(RESET, NOW)}`,
    ])
  })
})

describe('Per-Employee overrides', () => {
  it('lets one Employee wait while the Company continues elsewhere', () => {
    const { engine, claude, codex, team } = teamAt(['Vega', 'Iris'])
    engine.usageRouting.setRule('claude', { kind: 'continue', provider: 'codex', model: null })
    engine.usageRouting.setEmployeeRule(team[1]!.id, { kind: 'wait' })

    claude.spawnOf(team[0]!.id).pty.output(LIMIT)

    expect(codex.spawns.map((spawn) => spawn.request.employee.name)).toEqual(['Vega'])
    expect(statusOf(engine, team[1]!.id)).toBe('out_of_budget')
    expect(engine.usageRouting.overrides()).toEqual([
      { employeeId: team[1]!.id, routing: { rule: { kind: 'wait' }, pinnedAccount: {} } },
    ])
  })

  it('lets one Employee continue while the Company waits', () => {
    const { engine, claude, codex, team } = teamAt(['Vega', 'Iris'])
    engine.usageRouting.setEmployeeRule(team[0]!.id, { kind: 'continue', provider: 'codex', model: null })

    claude.spawnOf(team[1]!.id).pty.output(LIMIT)

    expect(codex.spawns.map((spawn) => spawn.request.employee.name)).toEqual(['Vega'])
    expect(statusOf(engine, team[1]!.id)).toBe('out_of_budget')
  })

  it('forgets an override when it is set back to following the Company', () => {
    const { engine, team } = teamAt(['Vega'])
    engine.usageRouting.setEmployeeRule(team[0]!.id, { kind: 'wait' })

    engine.usageRouting.setEmployeeRule(team[0]!.id, null)

    expect(engine.usageRouting.overrides()).toEqual([])
  })
})

describe('Accounts', () => {
  it('spawns a Session in the account’s own config directory', () => {
    const { engine, claude, team, accountStore } = teamAt(['Ada'])
    const work = engine.accounts.add('claude', 'Work')
    engine.usageRouting.setPinnedAccount('claude', work.id)

    engine.sessions.stop(team[0]!.id)
    engine.sessions.start(team[0]!.id)

    expect(claude.spawnOf(team[0]!.id).request.account).toEqual({ id: work.id, configDir: work.configDir })
    expect(claude.spawnOf(team[0]!.id).env).toEqual({ [FAKE_CONFIG_DIR_ENV]: work.configDir })
    // Nothing about the sign-in itself is stored: a label and a directory, and no credential.
    expect(accountStore.read()).toEqual([
      { id: work.id, provider: 'claude', label: 'Work', configDir: work.configDir, isDefault: false },
    ])
  })

  it('runs on the product’s own directory until the boss adds a second sign-in', () => {
    const { claude, team } = teamAt(['Ada'])

    // The product's own directory is the variable left unset, not set to its default: Claude Code
    // on macOS reads a different keychain entry once CLAUDE_CONFIG_DIR is set at all.
    expect(claude.spawnOf(team[0]!.id).request.account?.configDir).toBe(FAKE_DEFAULT_CONFIG_DIR)
    expect(claude.spawnOf(team[0]!.id).env).toEqual({})
  })

  it('passes no account for a Provider whose CLI keeps one sign-in', () => {
    const { claude, team } = teamAt(['Ada'], { claude: fakeProvider({ accounts: false }) })

    expect(claude.spawnOf(team[0]!.id).request.account).toBeUndefined()
    expect(claude.spawnOf(team[0]!.id).env).toEqual({})
  })

  it('takes one Employee’s own pin over the Company’s', () => {
    const { engine, claude, team } = teamAt(['Ada', 'Grace'])
    const work = engine.accounts.add('claude', 'Work')
    engine.usageRouting.setPinnedAccount('claude', work.id)
    engine.usageRouting.setEmployeePin(team[1]!.id, 'claude', primaryId('claude'))

    for (const employee of team) {
      engine.sessions.stop(employee.id)
      engine.sessions.start(employee.id)
    }

    expect(claude.spawnOf(team[0]!.id).env).toEqual({ [FAKE_CONFIG_DIR_ENV]: work.configDir })
    expect(claude.spawnOf(team[1]!.id).env).toEqual({})
  })
})

describe('Rotation between accounts of one Provider', () => {
  it('is off by default, so an account at its limit follows the routing rule instead', () => {
    const { engine, claude, codex, team } = teamAt(['Ada'])
    engine.accounts.add('claude', 'Work')
    engine.usageRouting.setRule('claude', { kind: 'continue', provider: 'codex', model: null })

    expect(engine.usageRouting.get().rotateAccounts).toBe(false)
    claude.spawnOf(team[0]!.id).pty.output(LIMIT)

    expect(claude.spawns).toHaveLength(1)
    expect(codex.spawns.map((spawn) => spawn.request.employee.name)).toEqual(['Ada'])
  })

  it('moves to another account of the same Provider once the boss turns it on', () => {
    const { engine, claude, codex, team } = teamAt(['Ada'])
    const work = engine.accounts.add('claude', 'Work')
    engine.usageRouting.setRule('claude', { kind: 'continue', provider: 'codex', model: null })
    engine.usageRouting.setRotateAccounts(true)

    claude.spawnOf(team[0]!.id).pty.output(LIMIT)

    expect(codex.spawns).toEqual([])
    expect(claude.spawns).toHaveLength(2)
    expect(claude.spawns.at(-1)!.env).toEqual({ [FAKE_CONFIG_DIR_ENV]: work.configDir })
  })

  it('warns in the boss’s own words, which the frame fixes', () => {
    expect(ROTATION_WARNING.title).toBe('Off by default')
    expect(ROTATION_WARNING.body).toContain('may break that provider’s terms')
  })
})
