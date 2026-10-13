import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BOSS, COMPANY_AUTHOR, dmChannelId } from '../../../shared/domain/chat'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'
import { fakeProvider } from '../../providers/testing'
import { READY_DELAY_MS } from '../sessions/sessions'
import { waitingLine } from './answerer'

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
  /** Starts the Employee's Session and waits until it is idle, so they can answer. */
  function startIdle(employeeId: string) {
    engine.sessions.start(employeeId)
    const session = provider.spawnOf(employeeId)
    session.hook('SessionStart', { source: 'startup' })
    vi.advanceTimersByTime(READY_DELAY_MS)
    return session
  }
  const post = (authorId: string, channelId: string, text: string) => engine.chat().post({ authorId, channelId, text })
  const reply = (authorId: string, messageId: number, text: string) =>
    engine.chat().reply({ authorId, messageId, text })
  const kinds = (employeeId: string) => engine.inbox.list(employeeId).map((i) => [i.kind, i.status])
  const texts = (channelId: string) =>
    engine
      .chat()
      .read({ channelId })
      .map((m) => m.text)

  return { engine, provider, hire, startIdle, post, reply, kinds, texts }
}

describe('One answerer per boss message', () => {
  it('wakes only the answerer in a named channel, and leaves the rest an unread item', () => {
    const { engine, hire, startIdle, post, kinds } = setup()
    const pam = hire('Pam', 'pm')
    const ada = hire('Ada', 'backend')
    startIdle(pam.id)
    startIdle(ada.id)

    post(BOSS, 'general', 'how is the login going?')

    expect(kinds(pam.id)).toEqual([['intake', 'pending']])
    expect(kinds(ada.id)).toEqual([['general', 'unread']])
    expect(engine.inbox.list(ada.id)[0]!.prompt).toMatch(/someone else answers this/i)
  })

  it('wakes only the named on an @mention, never the answerer as well', () => {
    const { hire, startIdle, post, kinds } = setup()
    const pam = hire('Pam', 'pm')
    const ada = hire('Ada', 'backend')
    startIdle(pam.id)

    post(BOSS, 'general', '@Ada can you look?')

    expect(kinds(ada.id)).toEqual([['mention', 'pending']])
    expect(kinds(pam.id)).toEqual([['general', 'unread']])
  })

  it('wakes everyone on @channel', () => {
    const { hire, startIdle, post, kinds } = setup()
    const pam = hire('Pam', 'pm')
    const ada = hire('Ada', 'backend')
    startIdle(pam.id)

    post(BOSS, 'general', '@channel standup in five')

    expect(kinds(pam.id)).toEqual([['channel', 'pending']])
    expect(kinds(ada.id)).toEqual([['channel', 'pending']])
  })

  it('sends a ticket reference to its assignee, and to the answerer when it has none', () => {
    const { engine, hire, startIdle, post, kinds } = setup()
    const pam = hire('Pam', 'pm')
    const ada = hire('Ada', 'backend')
    startIdle(pam.id)
    const held = engine.board().createTicket({ title: 'Login', assigneeId: ada.id })
    const loose = engine.board().createTicket({ title: 'Signup' })

    post(BOSS, 'general', `how is #${held.id}?`)
    post(BOSS, 'general', `and #${loose.id}?`)

    expect(kinds(ada.id)).toEqual([
      ['assigned', 'pending'],
      ['ticket', 'pending'],
      ['general', 'unread'],
    ])
    // Pam holds `plan`, so both new tickets wait in Planning for her as well (T171).
    expect(kinds(pam.id)).toEqual([
      ['planning', 'pending'],
      ['planning', 'pending'],
      ['general', 'unread'],
      ['intake', 'pending'],
    ])
  })

  it('wakes only the recipient of a DM', () => {
    const { hire, startIdle, post, kinds } = setup()
    const pam = hire('Pam', 'pm')
    const ada = hire('Ada', 'backend')
    startIdle(pam.id)

    post(BOSS, dmChannelId(BOSS, ada.id), 'quick one')

    expect(kinds(ada.id)).toEqual([['dm', 'pending']])
    expect(kinds(pam.id)).toEqual([])
  })

  it('wakes one Employee on a boss reply in a thread, not every participant', () => {
    const { hire, startIdle, post, reply, kinds } = setup()
    const pam = hire('Pam', 'pm')
    const ada = hire('Ada', 'backend')
    const juno = hire('Juno', 'backend')
    startIdle(pam.id)
    const root = post(BOSS, 'general', 'how is the login going?')
    reply(pam.id, root.id, 'Ada is on it')
    reply(juno.id, root.id, 'I helped with the schema')

    const before = [pam, ada, juno].map((e) => kinds(e.id).length)

    reply(BOSS, root.id, 'thanks, when is it done?')

    expect(kinds(juno.id).slice(before[2])).toEqual([['thread', 'pending']])
    expect(kinds(pam.id).slice(before[0])).toEqual([])
    expect(kinds(ada.id).slice(before[1])).toEqual([])
  })

  it('keeps the answerer a thread started with when the setting changes', () => {
    const { engine, hire, startIdle, post, reply, kinds } = setup()
    const pam = hire('Pam', 'pm')
    const ada = hire('Ada', 'backend')
    startIdle(pam.id)
    startIdle(ada.id)
    const root = post(BOSS, 'general', 'how is the login going?')

    engine.answerer.set(ada.id)
    reply(BOSS, root.id, 'still there?')

    expect(kinds(pam.id)).toEqual([
      ['intake', 'pending'],
      ['thread', 'pending'],
    ])
    expect(kinds(ada.id).filter(([kind]) => kind === 'thread')).toEqual([])
  })
})

describe('The answerer chain in a Company', () => {
  it('passes a parked answerer over to the next available Employee, and says so in the prompt', () => {
    const { engine, hire, startIdle, post, kinds } = setup()
    engine.capacity.setConcurrencyCap(1)
    const ada = hire('Ada', 'backend')
    startIdle(ada.id)
    const pam = hire('Pam', 'pm')
    engine.sessions.start(pam.id)

    post(BOSS, 'general', 'how is the login going?')

    expect(engine.sessions.get(pam.id).status).toBe('parked')
    expect(kinds(ada.id)).toEqual([['intake', 'pending']])
    expect(engine.inbox.list(ada.id)[0]!.prompt).toContain('Pam is parked')
  })

  it('queues the message and says it waits when nobody has capacity', () => {
    const { engine, hire, startIdle, post, texts, kinds } = setup()
    const pam = hire('Pam', 'pm')
    const ada = hire('Ada', 'backend')
    startIdle(pam.id)
    startIdle(ada.id)
    // Pause all: nobody can take a prompt until the boss resumes the Company.
    engine.sessions.stopAll()

    post(BOSS, 'general', 'how is the login going?')

    expect(texts('general').at(-1)).toBe(waitingLine('Pam'))
    expect(engine.chat().read({ channelId: 'general' }).at(-1)!.authorId).toBe(COMPANY_AUTHOR)
    expect(kinds(pam.id)).toEqual([['intake', 'pending']])
  })

  it('keeps a boss message for the first hire when the Company has nobody', () => {
    const { engine, hire, post } = setup()

    const message = post(BOSS, 'general', 'magic-link login, please')
    const ada = hire('Ada', 'backend')

    expect(engine.inbox.list(ada.id)).toEqual([
      expect.objectContaining({ kind: 'intake', messageId: message.id, text: 'magic-link login, please' }),
    ])
    expect(engine.inbox.list(ada.id)[0]!.prompt).toMatch(/before you were hired/i)
  })

  it('hands the open threads of a fired answerer to the next in the chain', () => {
    const { engine, hire, startIdle, post, reply } = setup()
    const pam = hire('Pam', 'pm')
    const ada = hire('Ada', 'backend')
    startIdle(pam.id)
    startIdle(ada.id)
    const root = post(BOSS, 'general', 'how is the login going?')
    reply(pam.id, root.id, 'looking into it')
    reply(BOSS, root.id, 'any news?')

    engine.hiring.fire(pam.id, 'not working out')

    const inherited = engine.inbox.list(ada.id).filter((i) => i.kind === 'thread')
    expect(inherited).toHaveLength(1)
    expect(inherited[0]!.prompt).toContain('taking over from Pam')
    expect(inherited[0]!.prompt).toContain('how is the login going?')
    expect(inherited[0]!.threadId).toBe(root.id)
  })
})

describe('The "Who answers you" setting', () => {
  it('starts on Automatic, naming the Employee the chain picks', () => {
    const { engine, hire, startIdle } = setup()
    const pam = hire('Pam', 'pm')
    startIdle(pam.id)
    hire('Ada', 'backend')

    expect(engine.answerer.get()).toMatchObject({ overrideId: null, automaticId: pam.id, answererId: pam.id })
  })

  it('routes to the Employee the boss picks', () => {
    const { engine, hire, startIdle, post, kinds } = setup()
    const pam = hire('Pam', 'pm')
    const ada = hire('Ada', 'backend')
    startIdle(pam.id)
    startIdle(ada.id)

    engine.answerer.set(ada.id)
    post(BOSS, 'general', 'how is the login going?')

    expect(engine.answerer.get()).toMatchObject({ overrideId: ada.id, answererId: ada.id, stale: null })
    expect(kinds(ada.id)).toEqual([['intake', 'pending']])
    expect(kinds(pam.id)).toEqual([['general', 'unread']])
  })

  it('falls back to the chain when the chosen Employee is fired, and says it is stale', () => {
    const { engine, hire, startIdle, post, kinds } = setup()
    const pam = hire('Pam', 'pm')
    const ada = hire('Ada', 'backend')
    startIdle(pam.id)
    startIdle(ada.id)
    engine.answerer.set(ada.id)

    engine.hiring.fire(ada.id)
    post(BOSS, 'general', 'how is the login going?')

    expect(engine.answerer.get()).toMatchObject({ overrideId: ada.id, stale: 'fired', answererId: pam.id })
    expect(kinds(pam.id).filter(([kind]) => kind === 'intake')).toEqual([['intake', 'pending']])
  })

  it('falls back while the chosen Employee is parked, and says why', () => {
    const { engine, hire, startIdle } = setup()
    engine.capacity.setConcurrencyCap(1)
    const pam = hire('Pam', 'pm')
    const ada = hire('Ada', 'backend')
    startIdle(pam.id)
    engine.sessions.start(ada.id)

    engine.answerer.set(ada.id)

    expect(engine.answerer.get()).toMatchObject({
      overrideId: ada.id,
      stale: 'unavailable',
      answererId: pam.id,
      skipped: [{ employeeId: ada.id, reason: 'parked' }],
    })
  })

  it('goes back to Automatic and refuses an Employee it does not know', () => {
    const { engine, hire, startIdle } = setup()
    const pam = hire('Pam', 'pm')
    const ada = hire('Ada', 'backend')
    startIdle(pam.id)
    engine.answerer.set(ada.id)

    expect(engine.answerer.set(null)).toMatchObject({ overrideId: null, automaticId: pam.id })
    expect(() => engine.answerer.set('nobody')).toThrow(/unknown employee/i)
  })
})
