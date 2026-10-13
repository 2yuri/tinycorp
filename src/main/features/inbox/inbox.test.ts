import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BOSS, dmChannelId } from '../../../shared/domain/chat'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'
import { fakeProvider } from '../../providers/testing'
import { READY_DELAY_MS } from '../sessions/sessions'
import { PUSH_CONFIRM_TIMEOUT_MS } from './inbox'

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
  const logged: string[] = []
  const engine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
    providers: { claude: provider },
    log: (line) => logged.push(line),
  })
  provider.connect(engine.sessions.receiveHook)
  engines.push(engine)
  engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
  const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
  const grace = engine.employees.create({ name: 'Grace Holt', roleId: 'tech-lead' })
  const juno = engine.employees.create({ name: 'Juno', roleId: 'backend' })

  /** Starts the Employee's Session and waits until it is idle. */
  function startIdle(employeeId: string) {
    engine.sessions.start(employeeId)
    const session = provider.spawnOf(employeeId)
    session.hook('SessionStart', { source: 'startup' })
    vi.advanceTimersByTime(READY_DELAY_MS)
    return session
  }

  const post = (authorId: string, channelId: string, text: string) => engine.chat().post({ authorId, channelId, text })
  const pending = (employeeId: string) => engine.inbox.list(employeeId).filter((item) => item.status === 'pending')

  return { engine, provider, logged, ada, grace, juno, startIdle, post, pending }
}

describe('Wake rules', () => {
  it('wakes the Employee a DM is for', () => {
    const { engine, ada, grace, post } = setup()

    post(BOSS, dmChannelId(BOSS, ada.id), 'can you look at the login bug?')

    expect(engine.inbox.list(ada.id)).toEqual([
      expect.objectContaining({
        employeeId: ada.id,
        kind: 'dm',
        fromId: BOSS,
        channelId: dmChannelId(BOSS, ada.id),
        text: 'can you look at the login bug?',
        status: 'pending',
      }),
    ])
    expect(engine.inbox.list(grace.id)).toEqual([])
  })

  it('wakes the other Employee of a DM between Employees, never the author', () => {
    const { engine, ada, grace, post } = setup()

    post(ada.id, dmChannelId(ada.id, grace.id), 'pairing later?')

    expect(engine.inbox.list(grace.id)).toEqual([expect.objectContaining({ kind: 'dm', fromId: ada.id })])
    expect(engine.inbox.list(ada.id)).toEqual([])
  })

  it('wakes only the Employees @mentioned in a channel', () => {
    const { engine, ada, grace, juno, post } = setup()

    post(ada.id, 'tech', '@Grace Holt can you review? cc @Ada')

    expect(engine.inbox.list(grace.id)).toEqual([expect.objectContaining({ kind: 'mention', fromId: ada.id })])
    expect(engine.inbox.list(ada.id)).toEqual([])
    expect(engine.inbox.list(juno.id)).toEqual([])
  })

  it('wakes every other Employee on @channel', () => {
    const { engine, ada, grace, juno, post } = setup()

    post(grace.id, 'prs', '@channel main is frozen, @Ada too')

    expect(engine.inbox.list(ada.id)).toEqual([expect.objectContaining({ kind: 'mention' })])
    expect(engine.inbox.list(juno.id)).toEqual([expect.objectContaining({ kind: 'channel' })])
    expect(engine.inbox.list(grace.id)).toEqual([])
  })

  it('does not wake anyone for an Employee’s channel message without a mention', () => {
    const { engine, ada, grace, juno, post } = setup()

    post(juno.id, 'tech', 'deploy went fine')

    expect(engine.inbox.list(ada.id)).toEqual([])
    expect(engine.inbox.list(grace.id)).toEqual([])
  })

  it('wakes everyone else from #general, a mention or @channel keeping its own kind', () => {
    const { engine, ada, grace, juno, post } = setup()

    post(BOSS, 'general', '@Ada @Grace Holt @channel welcome aboard')
    const root = post(ada.id, 'general', 'thanks!')
    engine.chat().reply({ authorId: BOSS, messageId: root.id, text: 'say hi, @Juno' })
    engine.chat().reply({ authorId: BOSS, messageId: root.id, text: 'no need to answer this one' })

    const kinds = (id: string) => engine.inbox.list(id).map((i) => i.kind)
    expect(kinds(ada.id)).toEqual(['mention', 'thread'])
    expect(kinds(grace.id)).toEqual(['mention', 'general'])
    expect(kinds(juno.id)).toEqual(['channel', 'general', 'mention'])
  })

  it('wakes on a mention in a thread reply, and in a DM reply', () => {
    const { engine, ada, grace, post } = setup()
    const root = post(BOSS, 'tech', 'who owns auth?')
    const dm = post(BOSS, dmChannelId(BOSS, grace.id), 'status?')

    engine.chat().reply({ authorId: BOSS, messageId: root.id, text: '@Ada do you?' })
    engine.chat().reply({ authorId: BOSS, messageId: dm.id, text: 'no rush' })

    expect(engine.inbox.list(ada.id)).toEqual([
      // The boss's unaddressed question in #tech is Grace's to answer; Ada only reads it.
      expect.objectContaining({ kind: 'general', status: 'unread' }),
      expect.objectContaining({ kind: 'mention', threadId: root.id, channelId: 'tech' }),
    ])
    expect(engine.inbox.list(grace.id).map((i) => [i.kind, i.text])).toEqual([
      // Grace is the answerer: the boss's unaddressed question in #tech is hers.
      ['intake', 'who owns auth?'],
      ['dm', 'status?'],
      ['dm', 'no rush'],
    ])
  })

  it('keeps each Company’s inbox apart', () => {
    const { engine, ada, post } = setup()
    post(BOSS, dmChannelId(BOSS, ada.id), 'hi')

    engine.createCompany({ folder: onDisk('/work/globex') })
    const other = engine.employees.create({ name: 'Ada', roleId: 'backend' })

    expect(engine.inbox.list(other.id)).toEqual([])
    expect(engine.inbox.list(ada.id)).toEqual([])
  })

  it('tells listeners when an inbox changes', () => {
    const { engine, juno, post } = setup()
    let changes = 0
    engine.inbox.onChange(() => changes++)

    post(juno.id, 'tech', 'no one')
    post(BOSS, 'tech', '@Ada you')

    expect(changes).toBe(1)
  })
})

describe('Pushing on idle', () => {
  it('pushes a DM to an idle Employee as a [company] prompt that asks for an MCP reply', () => {
    const { engine, ada, startIdle, post } = setup()
    const session = startIdle(ada.id)

    const message = post(BOSS, dmChannelId(BOSS, ada.id), 'can you look at the "login" bug?')

    expect(session.pushed).toEqual([
      '[company] DM from boss in @boss: "can you look at the \\"login\\" bug?" ' +
        `(message ${message.id}) The boss can read this → plain words, full sentences. ` +
        `Reply through the company MCP server: chat_post to "@boss", ` +
        'never a thread_reply in a DM. Never answer in plain text.',
    ])
    expect(engine.inbox.list(ada.id)).toEqual([
      expect.objectContaining({ status: 'pending', attempts: 1, prompt: session.pushed[0] }),
    ])
  })

  it('answers a DM in the DM, and a thread in a DM only where the boss replied in one (T269)', () => {
    const { engine, ada, startIdle, post } = setup()
    const session = startIdle(ada.id)
    const root = post(BOSS, dmChannelId(BOSS, ada.id), 'the deploy is red')
    session.hook('UserPromptSubmit')
    session.hook('Stop')

    engine.chat().reply({ authorId: BOSS, messageId: root.id, text: 'and staging too' })

    expect(session.pushed[0]).toContain('chat_post to "@boss", never a thread_reply in a DM')
    expect(session.pushed.at(-1)).toContain(`thread_reply to message ${root.id}`)
    expect(session.pushed.at(-1)).not.toContain('chat_post')
  })

  it('marks the item handled once the Session accepts the prompt', () => {
    const { engine, ada, startIdle, post } = setup()
    const session = startIdle(ada.id)
    post(BOSS, dmChannelId(BOSS, ada.id), 'hello')

    session.hook('UserPromptSubmit')

    expect(engine.inbox.list(ada.id)).toEqual([
      expect.objectContaining({ status: 'handled', handledAt: expect.any(String) }),
    ])
    expect(engine.sessions.get(ada.id).status).toBe('busy')
  })

  it('names the channel, the author and the thread in the prompt', () => {
    const { grace, ada, startIdle, post, engine } = setup()
    const session = startIdle(grace.id)
    const root = post(ada.id, 'tech', 'migration plan is up')

    const reply = engine.chat().reply({ authorId: ada.id, messageId: root.id, text: '@Grace Holt thoughts?' })
    session.hook('UserPromptSubmit')
    session.hook('Stop')
    post(BOSS, 'tech', '@channel standup')

    expect(session.pushed).toEqual([
      `[company] mention from Ada in #tech, thread ${root.id}: "@Grace Holt thoughts?" ` +
        `(message ${reply.id}) The boss can read this → plain words, full sentences. ` +
        `Reply through the company MCP server: thread_reply to message ${root.id}. ` +
        'Never answer in plain text.',
      expect.stringMatching(
        /^\[company\] @channel from boss in #tech: "@channel standup" .*thread_reply to message \d+, never a new chat_post in "#tech"/,
      ),
    ])
  })

  it('writes nothing while busy and drains one item per turn, oldest first', () => {
    const { engine, ada, startIdle, post } = setup()
    const session = startIdle(ada.id)
    session.hook('UserPromptSubmit')

    post(BOSS, dmChannelId(BOSS, ada.id), 'first')
    post(BOSS, 'tech', '@Ada second')
    post(BOSS, dmChannelId(BOSS, ada.id), 'third')
    const whileBusy = [...session.pushed]

    session.hook('Stop')
    const afterFirstStop = session.pushed.length
    session.hook('Notification', { notification_type: 'idle_prompt' })
    const beforeAccept = session.pushed.length
    session.hook('UserPromptSubmit')
    session.hook('Stop')
    session.hook('UserPromptSubmit')
    session.hook('Stop')
    session.hook('UserPromptSubmit')
    session.hook('Stop')

    expect(whileBusy).toEqual([])
    expect(afterFirstStop).toBe(1)
    expect(beforeAccept).toBe(1)
    expect(session.pushed.map((p) => /"(.*?)"/.exec(p)![1])).toEqual(['first', '@Ada second', 'third'])
    expect(engine.inbox.list(ada.id).map((i) => i.status)).toEqual(['handled', 'handled', 'handled'])
  })

  it('keeps items for an Employee who is off and delivers them once the Session is ready', () => {
    const { engine, ada, provider, post, pending } = setup()
    post(BOSS, dmChannelId(BOSS, ada.id), 'when you are in')

    engine.sessions.start(ada.id)
    const session = provider.spawnOf(ada.id)
    session.hook('SessionStart')
    const whileStarting = [...session.pushed]
    vi.advanceTimersByTime(READY_DELAY_MS)

    expect(whileStarting).toEqual([])
    expect(session.pushed).toEqual([expect.stringContaining('"when you are in"')])
    expect(pending(ada.id)).toHaveLength(1)
  })

  it('logs a push nobody accepted and retries it once', () => {
    const { engine, ada, startIdle, post, logged } = setup()
    const session = startIdle(ada.id)
    post(BOSS, dmChannelId(BOSS, ada.id), 'anyone there?')

    vi.advanceTimersByTime(PUSH_CONFIRM_TIMEOUT_MS)
    const retried = [...session.pushed]
    session.hook('UserPromptSubmit')

    expect(retried).toHaveLength(2)
    expect(retried[1]).toBe(retried[0])
    expect(logged).toEqual([expect.stringMatching(/Ada.*no UserPromptSubmit.*retrying/i)])
    expect(engine.inbox.list(ada.id)).toEqual([expect.objectContaining({ status: 'handled', attempts: 2 })])
  })

  it('stops pushing after the retry fails, keeping the item until the next idle signal', () => {
    const { engine, ada, startIdle, post, logged, pending } = setup()
    const session = startIdle(ada.id)
    post(BOSS, dmChannelId(BOSS, ada.id), 'anyone there?')

    vi.advanceTimersByTime(PUSH_CONFIRM_TIMEOUT_MS * 5)
    const afterGivingUp = session.pushed.length
    post(BOSS, 'tech', '@Ada still there?')
    const afterNewItem = session.pushed.length
    session.hook('Stop')

    expect(afterGivingUp).toBe(2)
    expect(afterNewItem).toBe(2)
    expect(logged).toEqual([
      expect.stringMatching(/retrying/i),
      expect.stringMatching(/Ada.*no UserPromptSubmit.*again/i),
    ])
    expect(pending(ada.id)).toHaveLength(2)
    expect(session.pushed).toHaveLength(3)
    expect(session.pushed[2]).toContain('"anyone there?"')
    expect(engine.inbox.list(ada.id)[0]).toMatchObject({ attempts: 3 })
  })

  it('forgets an unconfirmed push when the Session stops, and pushes again after a restart', () => {
    const { engine, ada, provider, startIdle, post, logged, pending } = setup()
    startIdle(ada.id)
    post(BOSS, dmChannelId(BOSS, ada.id), 'hello')

    engine.sessions.stop(ada.id)
    vi.advanceTimersByTime(PUSH_CONFIRM_TIMEOUT_MS * 3)
    const restarted = startIdle(ada.id)

    expect(logged).toEqual([])
    expect(pending(ada.id)).toHaveLength(1)
    expect(restarted).not.toBe(provider.spawns[0])
    expect(restarted.pushed).toEqual([expect.stringContaining('"hello"')])
  })
})

/**
 * Which voice a wake asks for (T180). The engine decides it from where the message is, so these
 * are the four places an Employee can be woken in, and what each one is told.
 */
describe('The voice a wake asks for', () => {
  const TERSE = 'Colleague DM → reply terse'
  const PLAIN = 'The boss can read this → plain words, full sentences.'

  it('asks for terse in a DM between two Employees', () => {
    const { engine, ada, grace, post } = setup()

    post(grace.id, dmChannelId(grace.id, ada.id), 'renamed the migration, ok?')

    expect(engine.inbox.list(ada.id)[0]!.prompt).toContain(TERSE)
    expect(engine.inbox.list(ada.id)[0]!.prompt).not.toContain(PLAIN)
  })

  it('asks for plain words in a DM with the boss, in either direction', () => {
    const { engine, ada, post } = setup()

    post(BOSS, dmChannelId(BOSS, ada.id), 'how is the login bug?')

    expect(engine.inbox.list(ada.id)[0]!.prompt).toContain(PLAIN)
    expect(engine.inbox.list(ada.id)[0]!.prompt).not.toContain('terse')
  })

  it('asks for plain words in a channel, where the boss reads', () => {
    const { engine, ada, grace, post } = setup()

    post(grace.id, 'tech', '@Ada can you take the migration?')

    expect(engine.inbox.list(ada.id)[0]!.prompt).toContain(PLAIN)
    expect(engine.inbox.list(ada.id)[0]!.prompt).not.toContain('terse')
  })

  it('asks for plain words in a thread, however the thread started', () => {
    const { engine, ada, grace, post } = setup()
    const root = post(ada.id, 'tech', 'migration plan is up')

    engine.chat().reply({ authorId: grace.id, messageId: root.id, text: 'looks right to me' })

    const prompt = engine.inbox.list(ada.id).at(-1)!.prompt
    expect(prompt).toContain(PLAIN)
    expect(prompt).not.toContain('terse')
  })

  it('drops the terse hint from the colleague DM once the Company is on Plain', () => {
    const { engine, ada, grace, post } = setup()
    engine.voice.setColleague('plain')

    post(grace.id, dmChannelId(grace.id, ada.id), 'renamed the migration, ok?')

    expect(engine.inbox.list(ada.id)[0]!.prompt).toContain(PLAIN)
    expect(engine.inbox.list(ada.id)[0]!.prompt).not.toContain('terse')
  })
})

describe('A message that opens with a skill (T264)', () => {
  /** An engine where Orion runs on Codex and Hera on Claude Code, and both hold the checklist. */
  function withSkills() {
    const engine = createCompanyEngine({
      openDatabase: inMemoryDatabases(),
      recents: inMemoryRecents(),
      providers: { claude: fakeProvider(), codex: fakeProvider() },
      folderExists: (path) => path === onDisk('/boss/skills/review-checklist'),
      log: () => {},
    })
    engines.push(engine)
    engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
    const checklist = engine.skills.create({ name: 'review-checklist', path: onDisk('/boss/skills/review-checklist') })
    const moved = engine.skills.create({ name: 'pen-handoff', path: onDisk('/boss/skills/gone') })
    const skills = [checklist.id, moved.id]
    const hera = engine.employees.create({ name: 'Hera', roleId: 'pm', provider: 'claude', skills })
    const orion = engine.employees.create({ name: 'Orion', roleId: 'tech-lead', provider: 'codex', skills })
    const juno = engine.employees.create({ name: 'Juno', roleId: 'backend', provider: 'claude' })
    const post = (channelId: string, text: string) => engine.chat().post({ authorId: BOSS, channelId, text })
    const prompt = (employeeId: string) => engine.inbox.list(employeeId).at(-1)!.prompt
    return { hera, orion, juno, post, prompt }
  }

  it('opens the prompt with the skill as each Provider invokes one', () => {
    const { hera, orion, post, prompt } = withSkills()

    post(dmChannelId(BOSS, hera.id), '/review-checklist PR 12')
    post(dmChannelId(BOSS, orion.id), '/review-checklist PR 12')

    expect(prompt(hera.id)).toMatch(/^\/review-checklist \[company\] DM from boss in @boss: "\/review-checklist PR 12"/)
    expect(prompt(orion.id)).toMatch(/^\$review-checklist \[company\] DM from boss in @boss: /)
  })

  it('invokes it for the one Employee a channel message mentions', () => {
    const { orion, post, prompt } = withSkills()

    post('tech', '/review-checklist @Orion before the merge')

    expect(prompt(orion.id)).toMatch(/^\$review-checklist \[company\] mention from boss in #tech/)
  })

  it('leaves the prompt alone for a skill the Employee does not hold, or whose folder is gone', () => {
    const { hera, juno, post, prompt } = withSkills()

    post(dmChannelId(BOSS, juno.id), '/review-checklist PR 12')
    post(dmChannelId(BOSS, hera.id), '/pen-handoff the new frame')

    expect(prompt(juno.id)).toMatch(/^\[company\] DM from boss/)
    expect(prompt(hera.id)).toMatch(/^\[company\] DM from boss/)
  })
})
