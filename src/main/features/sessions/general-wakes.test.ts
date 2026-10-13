import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BOSS, COMPANY_AUTHOR } from '../../../shared/domain/chat'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'
import { fakeProvider } from '../../providers/testing'
import { READY_DELAY_MS } from './sessions'

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
  const pending = (employeeId: string) => inbox(employeeId).filter((item) => item.status === 'pending')

  return { engine, provider, hire, startIdle, post, inbox, pending }
}

describe('#general', () => {
  it('files an unread item for everyone but the answerer on a top-level message', () => {
    const { hire, post, inbox } = setup()
    const pam = hire('Pam', 'pm')
    const ada = hire('Ada', 'backend')
    const juno = hire('Juno', 'backend')

    post(ada.id, 'general', 'Hi team! I am Ada.')

    expect(inbox(pam.id)).toEqual([
      expect.objectContaining({
        kind: 'general',
        status: 'unread',
        fromId: ada.id,
        channelId: 'general',
        text: 'Hi team! I am Ada.',
      }),
    ])
    expect(inbox(juno.id)).toEqual([expect.objectContaining({ kind: 'general', status: 'unread' })])
    expect(inbox(ada.id)).toEqual([])
  })

  it('keeps the more specific kind for a mention, @channel or ticket reference in #general', () => {
    const { engine, hire, post, inbox } = setup()
    const ada = hire('Ada', 'backend')
    const grace = hire('Grace', 'tech-lead')
    const juno = hire('Juno', 'backend')
    const ticket = engine.board().createTicket({ title: 'Signup', assigneeId: juno.id })

    post(BOSS, 'general', `@Ada welcome, and thanks for #${ticket.id}`)

    expect(inbox(ada.id).map((i) => i.kind)).toEqual(['mention'])
    expect(inbox(juno.id).map((i) => i.kind)).toEqual(['assigned', 'ticket'])
    // Grace holds `plan`, so the new ticket waits in Planning for her too (T171).
    expect(inbox(grace.id).map((i) => [i.kind, i.status])).toEqual([
      ['planning', 'pending'],
      ['general', 'unread'],
    ])
  })

  it('wakes only a mentioned Employee and the one being answered for a thread reply in #general', () => {
    const { engine, hire, post, inbox } = setup()
    const ada = hire('Ada', 'backend')
    const grace = hire('Grace', 'tech-lead')
    const root = post(ada.id, 'general', 'lunch?')
    const before = inbox(grace.id).length

    engine.chat().reply({ authorId: BOSS, messageId: root.id, text: 'sure' })
    engine.chat().reply({ authorId: BOSS, messageId: root.id, text: '@Grace you too' })

    expect(
      inbox(grace.id)
        .slice(before)
        .map((i) => i.kind),
    ).toEqual(['mention'])
    expect(inbox(ada.id).map((i) => i.kind)).toEqual(['thread'])
  })

  it('does not wake anyone for a company notice in #general', () => {
    const { hire, post, inbox } = setup()
    const ada = hire('Ada', 'backend')

    post(COMPANY_AUTHOR, 'general', 'Out of budget.')

    expect(inbox(ada.id)).toEqual([])
  })

  it('never pushes an unread item, whose prompt says someone else answers', () => {
    const { hire, startIdle, post, inbox } = setup()
    const pam = hire('Pam', 'pm')
    const ada = hire('Ada', 'backend')
    startIdle(pam.id)
    const session = startIdle(ada.id)
    const pushedBefore = session.pushed.length

    const message = post(BOSS, 'general', 'We ship on Friday.')

    expect(session.pushed).toHaveLength(pushedBefore)
    const item = inbox(ada.id).at(-1)!
    expect(item.status).toBe('unread')
    expect(item.prompt).toMatch(/^\[company\] #general/)
    expect(item.prompt).toContain(`from boss (message ${message.id}): "We ship on Friday."`)
    expect(item.prompt).toMatch(/someone else answers this/i)
    expect(item.prompt).not.toContain('\n')
  })

  it('files one unread item per message, never folding them', () => {
    const { hire, post, inbox } = setup()
    const ada = hire('Ada', 'backend')
    const grace = hire('Grace', 'tech-lead')

    post(grace.id, 'general', 'one')
    post(grace.id, 'general', 'two')

    expect(inbox(ada.id).map((i) => [i.kind, i.text, i.status])).toEqual([
      ['general', 'one', 'unread'],
      ['general', 'two', 'unread'],
    ])
  })
})

describe('#general and the answerer', () => {
  it('routes a boss goal in #general to the answerer, and the rest only read it', () => {
    const { hire, startIdle, post, inbox } = setup()
    const pam = hire('Pam', 'pm')
    const ada = hire('Ada', 'backend')
    const pamSession = startIdle(pam.id)

    post(BOSS, 'general', 'magic-link login')

    expect(inbox(pam.id)).toEqual([expect.objectContaining({ kind: 'intake', fromId: BOSS, status: 'pending' })])
    expect(pamSession.pushed.at(-1)).toContain('target_create')
    expect(pamSession.pushed.at(-1)).toMatch(/you answer the boss/i)
    expect(inbox(ada.id)).toEqual([expect.objectContaining({ kind: 'general', status: 'unread' })])
  })

  it('files one item per goal for the answerer', () => {
    const { hire, post, pending } = setup()
    const pam = hire('Pam', 'pm')
    hire('Ada', 'backend')

    post(BOSS, 'general', 'magic-link login')
    post(BOSS, 'general', 'dark mode')

    expect(pending(pam.id).map((i) => [i.kind, i.text])).toEqual([
      ['intake', 'magic-link login'],
      ['intake', 'dark mode'],
    ])
  })
})
