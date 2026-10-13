import { afterEach, describe, expect, it } from 'vitest'
import { BOSS, COMPANY_AUTHOR, dmChannelId } from '../../../shared/domain/chat'
import { CAPACITY_NOTICE } from '../../../shared/inbox/boss-inbox'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'
import { waitingLine } from './answerer'

const engines: CompanyEngine[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
})

function setup() {
  const engine = createCompanyEngine({ openDatabase: inMemoryDatabases(), recents: inMemoryRecents() })
  engines.push(engine)
  engine.createCompany({ folder: onDisk('/work/acme') })
  const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
  const grace = engine.employees.create({ name: 'Grace', roleId: 'tech-lead' })
  return { engine, chat: engine.chat(), approvals: engine.approvals, ada, grace }
}

/** Asks and expects an Approval to be created. */
function pendingApproval(outcome: ReturnType<CompanyEngine['approvals']['request']>) {
  if (outcome.gate !== 'ask') throw new Error(`Expected an Approval, got ${outcome.gate}`)
  return outcome.approval
}

/** `kind:text` per row, so order and kind read together. */
const rows = (engine: CompanyEngine) =>
  engine
    .chat()
    .bossInbox()
    .map((i) => `${i.kind}:${i.text}`)

describe('the boss’s Inbox', () => {
  it('starts empty', () => {
    const { engine } = setup()

    expect(engine.chat().bossInbox()).toEqual([])
  })

  it('takes an @boss mention in a named channel', () => {
    const { engine, chat, ada } = setup()
    chat.post({ authorId: ada.id, channelId: 'tech', text: '@boss can you confirm the three plan tiers?' })

    expect(rows(engine)).toEqual(['mention:@boss can you confirm the three plan tiers?'])
  })

  it('leaves out channel chatter that names nobody, and the boss’s own messages', () => {
    const { engine, chat, ada } = setup()
    chat.post({ authorId: ada.id, channelId: 'tech', text: 'migrations are green' })
    chat.post({ authorId: BOSS, channelId: 'tech', text: 'nice work' })

    expect(engine.chat().bossInbox()).toEqual([])
  })

  it('takes a reply by someone else in a thread the boss started or posted in', () => {
    const { engine, chat, ada, grace } = setup()
    const own = chat.post({ authorId: BOSS, channelId: 'tech', text: 'how is the switcher?' })
    chat.reply({ authorId: ada.id, messageId: own.id, text: 'ready tomorrow' })
    const theirs = chat.post({ authorId: ada.id, channelId: 'tech', text: 'pagination edges covered' })
    chat.reply({ authorId: BOSS, messageId: theirs.id, text: 'thanks' })
    chat.reply({ authorId: grace.id, messageId: theirs.id, text: 'safe to merge' })

    expect(rows(engine)).toEqual(['thread:safe to merge', 'thread:ready tomorrow'])
  })

  it('leaves out a thread the boss never took part in', () => {
    const { engine, chat, ada, grace } = setup()
    const root = chat.post({ authorId: ada.id, channelId: 'tech', text: 'rolling the release' })
    chat.reply({ authorId: grace.id, messageId: root.id, text: 'ship it' })

    expect(engine.chat().bossInbox()).toEqual([])
  })

  it('takes a DM to the boss, but not one between Employees', () => {
    const { engine, chat, ada, grace } = setup()
    chat.post({ authorId: ada.id, channelId: dmChannelId(BOSS, ada.id), text: 'are refunds in scope?' })
    chat.post({ authorId: ada.id, channelId: dmChannelId(ada.id, grace.id), text: 'pairing?' })

    expect(rows(engine)).toEqual(['dm:are refunds in scope?'])
  })

  it('takes an Approval as one row with its id, ahead of the @boss it mentions', () => {
    const { engine, approvals, ada } = setup()
    const approval = pendingApproval(
      approvals.request({ requesterId: ada.id, action: 'hire', subject: 'a QA engineer', reason: 'the billing epic' }),
    )

    const [row, ...rest] = engine.chat().bossInbox()
    expect(rest).toEqual([])
    expect(row!.kind).toBe('approval')
    expect(row!.approvalId).toBe(approval.id)
    expect(row!.channelId).toBe('general')
  })

  it('keeps a decided Approval in the Inbox', () => {
    const { engine, approvals, ada } = setup()
    const approval = pendingApproval(
      approvals.request({ requesterId: ada.id, action: 'hire', subject: 'a QA engineer', reason: '' }),
    )
    approvals.decide(approval.id, { approve: true })

    expect(
      engine
        .chat()
        .bossInbox()
        .map((i) => i.kind),
    ).toEqual(['approval'])
  })

  it('takes the Company’s waiting-for-capacity notice, as the answerer writes it (decision 41)', () => {
    const { engine, chat } = setup()
    const notice = waitingLine('Grace')
    chat.post({ authorId: COMPANY_AUTHOR, channelId: 'tech', text: notice })
    chat.post({ authorId: COMPANY_AUTHOR, channelId: 'tech', text: 'Build failed on main.' })

    expect(notice.startsWith(CAPACITY_NOTICE)).toBe(true)
    expect(rows(engine)).toEqual([`waiting:${notice}`])
  })

  it('keeps a pending Approval however far back it fell', () => {
    const { engine, chat, approvals, ada } = setup()
    const approval = pendingApproval(
      approvals.request({ requesterId: ada.id, action: 'hire', subject: 'a QA engineer', reason: '' }),
    )
    for (let i = 0; i < 60; i++) chat.post({ authorId: ada.id, channelId: 'tech', text: `@boss note ${i}` })

    const rows = engine.chat().bossInbox()
    expect(rows).toHaveLength(51)
    expect(rows.at(-1)).toMatchObject({ kind: 'approval', approvalId: approval.id })
  })

  it('answers newest first and points each row at its thread', () => {
    const { engine, chat, ada } = setup()
    const root = chat.post({ authorId: BOSS, channelId: 'tech', text: 'how is the switcher?' })
    const reply = chat.reply({ authorId: ada.id, messageId: root.id, text: 'ready tomorrow' })
    const dm = chat.post({ authorId: ada.id, channelId: dmChannelId(BOSS, ada.id), text: 'one more thing' })

    expect(
      engine
        .chat()
        .bossInbox()
        .map((i) => [i.messageId, i.threadId]),
    ).toEqual([
      [dm.id, dm.id],
      [reply.id, root.id],
    ])
  })
})

describe('the boss’s Inbox read state', () => {
  it('starts unread and clears when the row’s channel is read', () => {
    const { engine, chat, ada } = setup()
    chat.post({ authorId: ada.id, channelId: 'tech', text: '@boss ping' })
    chat.post({ authorId: ada.id, channelId: dmChannelId(BOSS, ada.id), text: 'hi' })

    expect(
      engine
        .chat()
        .bossInbox()
        .map((i) => i.unread),
    ).toEqual([true, true])

    chat.markReadByBoss('tech')
    expect(
      engine
        .chat()
        .bossInbox()
        .map((i) => [i.channelId, i.unread]),
    ).toEqual([
      [dmChannelId(BOSS, ada.id), true],
      ['tech', false],
    ])
  })

  it('marks every row read at once, and says whether anything changed', () => {
    const { engine, chat, ada } = setup()
    chat.post({ authorId: ada.id, channelId: 'tech', text: '@boss ping' })
    chat.post({ authorId: ada.id, channelId: dmChannelId(BOSS, ada.id), text: 'hi' })

    expect(engine.chat().markAllReadByBoss()).toBe(true)
    expect(
      engine
        .chat()
        .bossInbox()
        .every((i) => !i.unread),
    ).toBe(true)
    expect(engine.chat().markAllReadByBoss()).toBe(false)
  })

  it('leaves DMs between Employees out of mark all read', () => {
    const { engine, chat, ada, grace } = setup()
    chat.post({ authorId: ada.id, channelId: dmChannelId(ada.id, grace.id), text: 'pairing?' })

    expect(engine.chat().markAllReadByBoss()).toBe(false)
  })
})
