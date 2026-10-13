import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BOSS, dmChannelId } from '../../../shared/domain/chat'
import { visitorSpot } from '../../../shared/office/layout'
import { EXCHANGE_MS, TAIL_MS } from '../../../shared/office/movement'
import { projectOffice } from '../../../shared/office/projection'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'
import { type FakeProvider, fakeProvider } from '../../providers/testing'
import { READY_DELAY_MS } from '../sessions/sessions'

const engines: CompanyEngine[] = []
beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-09-17T12:00:00.000Z') })
})
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
  vi.useRealTimers()
})

function setup() {
  const provider: FakeProvider = fakeProvider()
  const engine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
    providers: { claude: provider },
    log: () => {},
  })
  provider.connect(engine.sessions.receiveHook)
  engines.push(engine)
  engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
  const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
  const bob = engine.employees.create({ name: 'Bob', roleId: 'frontend' })

  /** Starts an Employee's Session and brings it to its prompt. */
  function ready(employeeId: string) {
    engine.sessions.start(employeeId)
    provider.spawnOf(employeeId).hook('SessionStart', { source: 'startup' })
    vi.advanceTimersByTime(READY_DELAY_MS)
    return provider.spawnOf(employeeId)
  }

  /** The office as the renderer projects it now. */
  function office() {
    return projectOffice({ employees: engine.employees.list(), ...engine.office.facts(), now: Date.now() })
  }
  const spriteOf = (employeeId: string) => office().sprites.find((s) => s.employeeId === employeeId)!

  return { engine, provider, ada, bob, ready, office, spriteOf }
}

describe('Office facts', () => {
  it('walks in the character the hire modal picked', () => {
    const { engine, office } = setup()
    const lyra = engine.employees.create({ name: 'Lyra', roleId: 'frontend', sprite: 4 })

    expect(office().sprites.find((s) => s.employeeId === lyra.id)?.sprite).toBe(4)
  })

  it('shows every Employee Off before any Session starts', () => {
    const { office } = setup()

    expect(office().sprites.map((s) => s.state)).toEqual(['off', 'off'])
  })

  it('tells Reading from Working by the tool the Session runs', () => {
    const { ada, ready, spriteOf } = setup()
    const session = ready(ada.id)
    expect(spriteOf(ada.id).state).toBe('idle')

    session.hook('UserPromptSubmit', { prompt: 'go' })
    expect(spriteOf(ada.id).state).toBe('working')

    session.hook('PreToolUse', { tool_name: 'Read', tool_input: { file_path: 'a.ts' } })
    expect(spriteOf(ada.id).state).toBe('reading')

    session.hook('PostToolUse', { tool_name: 'Read' })
    session.hook('PreToolUse', { tool_name: 'Edit' })
    expect(spriteOf(ada.id).state).toBe('working')

    session.hook('PreToolUse', { tool_name: 'mcp__company__board_list' })
    expect(spriteOf(ada.id).state).toBe('reading')

    session.hook('Stop')
    expect(spriteOf(ada.id).state).toBe('idle')
  })

  it('forgets the last turn’s tool when a new turn starts', () => {
    const { ada, ready, spriteOf } = setup()
    const session = ready(ada.id)
    session.hook('UserPromptSubmit')
    session.hook('PreToolUse', { tool_name: 'Grep' })
    session.hook('Stop')

    session.hook('UserPromptSubmit')

    expect(spriteOf(ada.id).state).toBe('working')
  })

  it('forgets the tool when the Session ends', () => {
    const { engine, ada, ready, spriteOf } = setup()
    const session = ready(ada.id)
    session.hook('PreToolUse', { tool_name: 'Read' })
    expect(engine.office.facts().activity[ada.id]).toMatchObject({ tool: 'Read' })

    engine.sessions.stop(ada.id)

    expect(spriteOf(ada.id).state).toBe('off')
    expect(engine.office.facts().activity[ada.id]).toBeUndefined()
  })

  it('walks an Employee who DMs a colleague to that colleague’s desk, then back', () => {
    const { engine, ada, bob, ready, office, spriteOf } = setup()
    ready(ada.id).hook('UserPromptSubmit')
    ready(bob.id)

    engine.chat().post({ authorId: ada.id, channelId: dmChannelId(ada.id, bob.id), text: 'can you review #1?' })

    const trip = EXCHANGE_MS + TAIL_MS
    const scene = office()
    expect(spriteOf(ada.id)).toMatchObject({
      state: 'talking',
      reason: 'Talking to Bob',
      away: { ...visitorSpot(scene.layout.seats[bob.desk]!), place: 'desk' },
    })
    expect(scene.nextChangeAt).toBe(Date.now() + trip)

    vi.advanceTimersByTime(trip)
    expect(spriteOf(ada.id)).toMatchObject({ state: 'working' })
    expect(spriteOf(ada.id).away).toBeUndefined()
  })

  it('walks an Employee who DMs the boss to the boss desk', () => {
    const { engine, ada, ready, spriteOf } = setup()
    ready(ada.id)

    engine.chat().post({ authorId: ada.id, channelId: dmChannelId(BOSS, ada.id), text: 'done with #1' })

    expect(spriteOf(ada.id)).toMatchObject({ state: 'talking', reason: 'Talking to you', away: { place: 'boss' } })
  })

  it('keeps one Employee posting in a channel at their desk, and meets them when a second answers (T74)', () => {
    const { engine, ada, bob, ready, spriteOf } = setup()
    ready(ada.id)
    ready(bob.id)

    engine.chat().post({ authorId: ada.id, channelId: 'tech', text: 'who owns the API?' })
    expect(spriteOf(ada.id).away).toBeUndefined()
    expect(spriteOf(ada.id).reason).toBe('Idle')

    vi.advanceTimersByTime(2_000)
    engine.chat().post({ authorId: bob.id, channelId: 'tech', text: 'I do' })

    expect(spriteOf(ada.id)).toMatchObject({ reason: 'In a meeting with Bob', away: { place: 'meeting' } })
    expect(spriteOf(bob.id)).toMatchObject({ reason: 'In a meeting with Ada', away: { place: 'meeting' } })
  })

  it('keeps the boss’s own posts from making anyone talk', () => {
    const { engine, ada, ready, spriteOf } = setup()
    ready(ada.id)

    engine.chat().post({ authorId: BOSS, channelId: dmChannelId(BOSS, ada.id), text: 'hi' })

    expect(spriteOf(ada.id).state).toBe('idle')
  })

  it('shows "!" while the Employee waits on an approval, and clears it on the decision', () => {
    const { engine, ada, ready, spriteOf } = setup()
    ready(ada.id)
    engine.approvals.setLevel('supervised')
    const outcome = engine.approvals.request({ requesterId: ada.id, action: 'start', subject: '#1' })
    if (outcome.gate !== 'ask') throw new Error('expected an approval')

    expect(spriteOf(ada.id)).toMatchObject({ state: 'waiting', bubble: '!' })

    engine.approvals.decide(outcome.approval.id, { approve: true })

    expect(spriteOf(ada.id).state).not.toBe('waiting')
    expect(spriteOf(ada.id).bubble).toBeUndefined()
  })

  it('sends an Employee to the coffee area with "?" while their ticket is blocked', () => {
    const { engine, ada, ready, spriteOf } = setup()
    ready(ada.id)
    const ticket = engine.board().createTicket({ title: 'Login page', assigneeId: ada.id, column: 'doing' })

    engine.board().updateTicket(ticket.id, { blocked: true, blockedReason: 'waiting for the API' })
    expect(spriteOf(ada.id)).toMatchObject({ state: 'blocked', bubble: '?', away: { place: 'coffee' } })

    engine.board().updateTicket(ticket.id, { blocked: false })
    expect(spriteOf(ada.id).state).toBe('idle')
  })

  it('announces every change the office shows', () => {
    const { engine, ada, ready } = setup()
    let changes = 0
    engine.office.onChange(() => changes++)

    const session = ready(ada.id)
    const afterStart = changes
    session.hook('PreToolUse', { tool_name: 'Read' })
    expect(changes).toBeGreaterThan(afterStart)

    const afterTool = changes
    engine.chat().post({ authorId: ada.id, channelId: 'tech', text: 'hello' })
    expect(changes).toBeGreaterThan(afterTool)

    const afterPost = changes
    const ticket = engine.board().createTicket({ title: 'x', assigneeId: ada.id })
    expect(changes).toBeGreaterThan(afterPost)

    const afterBoard = changes
    engine.approvals.request({ requesterId: ada.id, action: 'merge', ticketId: ticket.id })
    expect(changes).toBeGreaterThan(afterBoard)
  })

  it('has no facts while no Company is open', () => {
    const engine = createCompanyEngine({ openDatabase: inMemoryDatabases(), recents: inMemoryRecents() })
    engines.push(engine)

    expect(() => engine.office.facts()).toThrow(/no company is open/i)
  })
})
