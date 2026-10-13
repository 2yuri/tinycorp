import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BOSS, dmChannelId } from '../../../shared/domain/chat'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'
import { fakeProvider } from '../../providers/testing'
import { READY_DELAY_MS } from './sessions'
import { THREAD_CONTEXT_REPLIES } from './thread-wakes'

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
  const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
  const grace = engine.employees.create({ name: 'Grace', roleId: 'tech-lead' })
  const juno = engine.employees.create({ name: 'Juno', roleId: 'backend' })

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
  const threadItems = (employeeId: string) => engine.inbox.list(employeeId).filter((i) => i.kind === 'thread')

  return { engine, ada, grace, juno, startIdle, post, reply, threadItems }
}

describe('Thread wakes', () => {
  it('wakes the root author on a boss reply in its thread, without a mention', () => {
    const { ada, grace, juno, post, reply, threadItems } = setup()
    const root = post(ada.id, 'tech', 'migrations are slow, any idea?')

    const answer = reply(BOSS, root.id, 'try batching them')

    expect(threadItems(ada.id)).toEqual([
      expect.objectContaining({
        kind: 'thread',
        fromId: BOSS,
        channelId: 'tech',
        threadId: root.id,
        messageId: answer.id,
        text: 'try batching them',
        status: 'pending',
      }),
    ])
    expect(threadItems(grace.id)).toEqual([])
    expect(threadItems(juno.id)).toEqual([])
  })

  it('wakes only the Employee whose message is being answered, not every participant', () => {
    const { ada, grace, juno, post, reply, threadItems } = setup()
    const root = post(BOSS, 'tech', 'who can take the flaky test?')
    reply(ada.id, root.id, 'I can')
    reply(grace.id, root.id, 'I looked at it yesterday')
    const before = threadItems(ada.id).length

    reply(ada.id, root.id, 'thanks, taking it')

    expect(threadItems(grace.id).map((i) => i.text)).toEqual(['thanks, taking it'])
    expect(threadItems(ada.id)).toHaveLength(before)
    expect(threadItems(ada.id).map((i) => i.fromId)).toEqual([grace.id])
    expect(threadItems(juno.id)).toEqual([])
  })

  it('sends a boss reply to the Employee who last spoke to the boss, not to one answering a colleague (T270)', () => {
    const { ada, grace, juno, post, reply, threadItems } = setup()
    // Ada asks the boss and pulls Grace in; Grace answers Ada, not the boss.
    const root = post(ada.id, 'tech', '@boss the resize frames are up. @Grace can you set the default width?')
    reply(grace.id, root.id, '@Ada switched the default to 380px')

    reply(BOSS, root.id, 'love the collapse, only the notification should move up')

    expect(threadItems(ada.id).map((i) => i.text)).toEqual(['love the collapse, only the notification should move up'])
    expect(threadItems(grace.id)).toEqual([])
    expect(threadItems(juno.id)).toEqual([])
  })

  it('still answers whoever spoke last when they spoke to nobody in particular', () => {
    const { ada, grace, post, reply, threadItems } = setup()
    const root = post(BOSS, 'tech', 'who can take the flaky test?')
    reply(ada.id, root.id, 'I can take it')
    reply(grace.id, root.id, 'I looked at it yesterday, it is the clock')

    reply(BOSS, root.id, 'good, then do it together')

    expect(threadItems(grace.id).map((i) => i.text)).toEqual(['good, then do it together'])
    // Ada heard Grace's reply to her, and not the boss's answer to Grace.
    expect(threadItems(ada.id).map((i) => i.text)).not.toContain('good, then do it together')
  })

  it('wakes a participant in any channel, and keeps a mention as a mention', () => {
    const { engine, ada, grace, post, reply } = setup()
    const root = post(ada.id, 'prs', 'PR is up')

    reply(grace.id, root.id, '@Ada one nit')

    expect(engine.inbox.list(ada.id).map((i) => i.kind)).toEqual(['mention'])
  })

  it('pushes a prompt with the root and the recent replies that says to answer with thread_reply', () => {
    const { ada, grace, startIdle, post, reply } = setup()
    const root = post(ada.id, 'tech', 'which queue should we use?')
    const earlier = Array.from({ length: THREAD_CONTEXT_REPLIES + 2 }, (_, i) => reply(grace.id, root.id, `idea ${i}`))
    const session = startIdle(ada.id)
    session.hook('UserPromptSubmit')
    session.hook('Stop')

    const answer = reply(grace.id, root.id, 'or SQS?')

    const prompt = session.pushed.at(-1)!
    expect(prompt).toMatch(/^\[company\] thread reply from Grace in #tech, thread \d+/)
    expect(prompt).toContain(`from Ada (message ${root.id}): "which queue should we use?"`)
    for (const m of earlier.slice(-THREAD_CONTEXT_REPLIES)) expect(prompt).toContain(`(message ${m.id}): "${m.text}"`)
    expect(prompt).not.toContain('"idea 0"')
    expect(prompt).toContain(`from Grace (message ${answer.id}): "or SQS?"`)
    expect(prompt).toContain(`thread_reply to message ${root.id}`)
    expect(prompt).toMatch(/company MCP server/)
    expect(prompt).not.toContain('\n')
  })

  it('leaves a DM thread to the dm wake', () => {
    const { engine, ada, post, reply } = setup()
    const root = post(ada.id, dmChannelId(BOSS, ada.id), 'status: done')

    reply(BOSS, root.id, 'great')

    expect(engine.inbox.list(ada.id).map((i) => [i.kind, i.text])).toEqual([['dm', 'great']])
  })
})

describe('Thread coalescing', () => {
  it('folds replies that arrive while an Employee is busy into one item per thread, oldest first', () => {
    const { ada, grace, startIdle, post, reply, threadItems, engine } = setup()
    const root = post(ada.id, 'tech', 'RFC: drop Redis')
    const other = post(ada.id, 'tech', 'RFC: move to pnpm')
    const session = startIdle(ada.id)
    post(BOSS, dmChannelId(BOSS, ada.id), 'fix the login bug')
    session.hook('UserPromptSubmit')

    const first = reply(grace.id, root.id, 'agree')
    const second = reply(grace.id, root.id, 'fine by me')
    const third = reply(grace.id, root.id, 'we need it for sessions')
    reply(grace.id, other.id, 'yes please')

    const pending = threadItems(ada.id).filter((i) => i.status === 'pending')
    expect(pending.map((i) => i.threadId)).toEqual([root.id, other.id])
    const item = pending[0]!
    expect(item).toMatchObject({ fromId: grace.id, messageId: first.id })
    expect(item.text).toBe('agree\nfine by me\nwe need it for sessions')
    const lines = [
      `1. from Grace (message ${first.id}): "agree"`,
      `2. from Grace (message ${second.id}): "fine by me"`,
      `3. from Grace (message ${third.id}): "we need it for sessions"`,
    ]
    const at = lines.map((line) => item.prompt.indexOf(line))
    expect(at.every((i) => i >= 0)).toBe(true)
    expect(at).toEqual([...at].sort((a, b) => a - b))
    expect(item.prompt).toMatch(/3 replies/)
    expect(item.prompt).not.toContain('yes please')

    session.hook('Stop')
    expect(session.pushed.at(-1)).toBe(item.prompt)
    session.hook('UserPromptSubmit')
    expect(engine.inbox.list(ada.id).find((i) => i.id === item.id)).toMatchObject({ status: 'handled' })
  })

  it('never folds into an item already pushed', () => {
    const { ada, grace, startIdle, post, reply, threadItems } = setup()
    const root = post(ada.id, 'tech', 'RFC')
    const session = startIdle(ada.id)

    reply(grace.id, root.id, 'one')
    expect(session.pushed.at(-1)).toContain('"one"')
    reply(grace.id, root.id, 'two')

    expect(threadItems(ada.id).map((i) => i.text)).toEqual(['one', 'two'])
    expect(threadItems(ada.id)[1]!.prompt).toContain('Earlier replies: from Grace')
  })
})

describe('Thread wakes in approval threads', () => {
  it('delivers the boss reply in an approval thread to the requester', () => {
    const { engine, ada, grace, startIdle, reply, threadItems } = setup()
    engine.approvals.setLevel('supervised')
    const outcome = engine.approvals.request({ requesterId: ada.id, action: 'start', subject: '#12 Login page' })
    if (outcome.gate !== 'ask') throw new Error('expected an approval')
    const session = startIdle(ada.id)

    reply(BOSS, outcome.approval.messageId, 'why now, and not after the release?')

    expect(threadItems(ada.id)).toEqual([
      expect.objectContaining({ fromId: BOSS, threadId: outcome.approval.messageId }),
    ])
    expect(session.pushed.at(-1)).toContain('"why now, and not after the release?"')
    expect(session.pushed.at(-1)).toContain("I'd like to start work on")
    expect(threadItems(grace.id)).toEqual([])
  })

  it('files the decision once, as an approval, not also as a thread reply', () => {
    const { engine, ada, reply } = setup()
    engine.approvals.setLevel('supervised')
    const outcome = engine.approvals.request({ requesterId: ada.id, action: 'start', subject: '#12 Login page' })
    if (outcome.gate !== 'ask') throw new Error('expected an approval')

    engine.approvals.decide(outcome.approval.id, { approve: false, reason: 'after the release' })
    reply(BOSS, outcome.approval.messageId, 'ping me when it ships')

    expect(engine.inbox.list(ada.id).map((i) => i.kind)).toEqual(['approval', 'thread'])
  })
})
