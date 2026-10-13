import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BOSS, dmChannelId } from '../../../shared/domain/chat'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'
import { fakeProvider } from '../../providers/testing'
import { READY_DELAY_MS } from '../sessions/sessions'

const engines: CompanyEngine[] = []
beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
  vi.useRealTimers()
})

function setup() {
  const provider = fakeProvider()
  const engine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
    providers: { claude: provider },
    log: () => {},
  })
  provider.connect(engine.sessions.receiveHook)
  engines.push(engine)
  engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })

  const hire = (name: string, roleId: string) => engine.employees.create({ name, roleId })
  function startIdle(employeeId: string) {
    engine.sessions.start(employeeId)
    const session = provider.spawnOf(employeeId)
    session.hook('SessionStart', { source: 'startup' })
    vi.advanceTimersByTime(READY_DELAY_MS)
    return session
  }
  const post = (authorId: string, channelId: string, text: string) => engine.chat().post({ authorId, channelId, text })
  const inbox = (employeeId: string) => engine.inbox.list(employeeId)
  return { engine, hire, startIdle, post, inbox }
}

describe('Routing on capabilities', () => {
  it('routes targets to the first Employee hired with intake', () => {
    const { engine, hire } = setup()
    hire('Ada', 'backend')
    const pam = hire('Pam', 'pm')
    hire('Otto', 'po')

    expect(engine.routing.intake()?.id).toBe(pam.id)
  })

  it('routes targets nowhere when nobody holds intake in a team', () => {
    const { engine, hire } = setup()
    hire('Ada', 'backend')
    hire('Juno', 'backend')

    expect(engine.routing.intake()).toBeNull()
  })

  it('routes intake to the only Employee of a one-Employee Company, whatever it holds', () => {
    const { engine, hire } = setup()
    expect(engine.routing.intake()).toBeNull()

    const ada = hire('Ada', 'backend')

    expect(engine.routing.intake()?.id).toBe(ada.id)
  })

  it('follows capability edits', () => {
    const { engine, hire } = setup()
    const ada = hire('Ada', 'backend')
    const juno = hire('Juno', 'backend')

    engine.employees.update(juno.id, { capabilities: ['code', 'intake'] })

    expect(engine.routing.intake()?.id).toBe(juno.id)
    engine.employees.update(juno.id, { capabilities: ['code'] })
    engine.employees.update(ada.id, { capabilities: ['intake'] })
    expect(engine.routing.intake()?.id).toBe(ada.id)
  })

  it('routes a PR to a review holder other than its author, else to the boss', () => {
    const { engine, hire } = setup()
    const ada = hire('Ada', 'backend')
    expect(engine.routing.reviewer(ada.id)).toBe(BOSS)

    const grace = hire('Grace', 'tech-lead')
    const quinn = hire('Quinn', 'qa')

    expect(engine.routing.reviewer(ada.id)).toBe(grace.id)
    expect(engine.routing.reviewer(grace.id)).toBe(quinn.id)
    engine.employees.update(quinn.id, { capabilities: ['code'] })
    expect(engine.routing.reviewer(grace.id)).toBe(BOSS)
  })

  it('lets only hire holders request a hire', () => {
    const { engine, hire } = setup()
    const ada = hire('Ada', 'backend')
    const helen = hire('Helen', 'hr')
    const pam = hire('Pam', 'pm')

    expect(engine.routing.can(helen.id, 'hire')).toBe(true)
    expect(engine.routing.can(pam.id, 'hire')).toBe(true)
    expect(engine.routing.can(ada.id, 'hire')).toBe(false)
    expect(engine.routing.can('nobody', 'hire')).toBe(false)
    expect(() => engine.routing.require(ada.id, 'hire')).toThrow(/Ada .*hire/)
    expect(() => engine.routing.require(helen.id, 'hire')).not.toThrow()
  })

  it('does not hand hire to the only Employee unless it holds it', () => {
    const { engine, hire } = setup()
    const ada = hire('Ada', 'backend')

    expect(engine.routing.can(ada.id, 'hire')).toBe(false)
  })
})

describe('Intake wakes', () => {
  it('routes an unaddressed boss message to the intake holder', () => {
    const { hire, post, inbox } = setup()
    const ada = hire('Ada', 'backend')
    const pam = hire('Pam', 'pm')

    const message = post(BOSS, 'tech', 'magic-link login, web and api, by Friday')

    expect(inbox(pam.id)).toEqual([
      expect.objectContaining({
        kind: 'intake',
        fromId: BOSS,
        channelId: 'tech',
        messageId: message.id,
        text: 'magic-link login, web and api, by Friday',
        status: 'pending',
      }),
    ])
    expect(inbox(ada.id)).toEqual([expect.objectContaining({ kind: 'general', status: 'unread' })])
  })

  it('pushes the goal to an idle intake holder with how to structure it', () => {
    const { hire, startIdle, post } = setup()
    const pam = hire('Pam', 'pm')
    hire('Ada', 'backend')
    const session = startIdle(pam.id)

    post(BOSS, 'tech', 'magic-link login')

    expect(session.pushed).toHaveLength(1)
    const prompt = session.pushed[0]
    expect(prompt).toContain('"magic-link login"')
    expect(prompt).toMatch(/intake/)
    for (const tool of ['target_create', 'epic_create', 'ticket_create']) expect(prompt).toContain(tool)
    expect(prompt).toMatch(/not a goal/)
  })

  it('tells the intake holder how to structure a goal it was addressed directly', () => {
    const { hire, startIdle, post } = setup()
    const pam = hire('Pam', 'pm')
    const ada = hire('Ada', 'backend')
    const pamSession = startIdle(pam.id)
    const adaSession = startIdle(ada.id)

    post(BOSS, dmChannelId(BOSS, pam.id), 'magic-link login')
    post(BOSS, 'tech', '@Pam and @Ada: dark mode')

    expect(pamSession.pushed[0]).toContain('target_create')
    expect(adaSession.pushed[0]).not.toContain('target_create')
  })

  it('routes nothing when the boss addresses someone else, or talks in a thread', () => {
    const { engine, hire, post, inbox } = setup()
    const pam = hire('Pam', 'pm')
    const ada = hire('Ada', 'backend')

    post(BOSS, 'tech', '@Ada is the build green?')
    post(BOSS, 'general', '@Ada welcome aboard')
    post(BOSS, dmChannelId(BOSS, ada.id), 'status?')
    const root = post(ada.id, 'tech', 'build is red')
    engine.chat().reply({ authorId: BOSS, messageId: root.id, text: 'fix it' })

    expect(inbox(pam.id).map((i) => [i.kind, i.status])).toEqual([
      ['general', 'unread'],
      ['general', 'unread'],
    ])
  })

  it('routes a boss goal in #general to the intake holder, like any other channel', () => {
    const { hire, post, inbox } = setup()
    const pam = hire('Pam', 'pm')
    hire('Ada', 'backend')

    post(BOSS, 'general', 'magic-link login')

    expect(inbox(pam.id)).toEqual([expect.objectContaining({ kind: 'intake', fromId: BOSS, channelId: 'general' })])
  })

  it('routes nothing an Employee says', () => {
    const { hire, post, inbox } = setup()
    const pam = hire('Pam', 'pm')
    const ada = hire('Ada', 'backend')

    post(ada.id, 'tech', 'magic-link login would be nice')

    expect(inbox(pam.id)).toEqual([])
  })

  it('routes a boss message to the only Employee of a one-Employee Company', () => {
    const { hire, post, inbox } = setup()
    const ada = hire('Ada', 'backend')

    post(BOSS, 'tech', 'magic-link login')

    expect(inbox(ada.id)).toEqual([expect.objectContaining({ kind: 'intake', fromId: BOSS })])
  })

  it('routes to the first hired when a team has no intake holder (decision 41)', () => {
    const { hire, post, inbox } = setup()
    const ada = hire('Ada', 'backend')
    const juno = hire('Juno', 'backend')

    post(BOSS, 'tech', 'magic-link login')

    expect(inbox(ada.id)).toEqual([expect.objectContaining({ kind: 'intake', fromId: BOSS })])
    expect(inbox(juno.id)).toEqual([expect.objectContaining({ kind: 'general', status: 'unread' })])
  })
})
