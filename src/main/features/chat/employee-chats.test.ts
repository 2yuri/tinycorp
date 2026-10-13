import { afterEach, describe, expect, it } from 'vitest'
import { BOSS, dmChannelId } from '../../../shared/domain/chat'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'

const engines: CompanyEngine[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
})

function setup() {
  const engine = createCompanyEngine({ openDatabase: inMemoryDatabases(), recents: inMemoryRecents() })
  engines.push(engine)
  engine.createCompany({ folder: onDisk('/work/acme') })
  const nova = engine.employees.create({ name: 'Nova', roleId: 'tech-lead' })
  const vega = engine.employees.create({ name: 'Vega', roleId: 'frontend' })
  const iris = engine.employees.create({ name: 'Iris', roleId: 'qa' })
  return { engine, chat: engine.chat(), nova, vega, iris }
}

describe('an Employee’s conversations', () => {
  it('has none before anyone speaks', () => {
    const { chat, nova } = setup()

    expect(chat.employeeConversations(nova.id)).toEqual([])
  })

  it('lists the channels they post in, their DM with the boss and their DMs with teammates', () => {
    const { chat, nova, vega, iris } = setup()
    const withBoss = dmChannelId(BOSS, nova.id)
    const withVega = dmChannelId(nova.id, vega.id)
    chat.post({ authorId: nova.id, channelId: 'tech', text: 'migrations are green' })
    chat.post({ authorId: BOSS, channelId: withBoss, text: 'nice work' })
    chat.post({ authorId: nova.id, channelId: withVega, text: 'hold the switcher' })
    // Not Nova's: a channel she never posts in and a DM she is not in.
    chat.post({ authorId: iris.id, channelId: 'general', text: 'suite is red' })
    chat.post({ authorId: vega.id, channelId: dmChannelId(vega.id, iris.id), text: 'pairing?' })

    expect(
      chat
        .employeeConversations(nova.id)
        .map((c) => c.channelId)
        .sort(),
    ).toEqual([withVega, withBoss, 'tech'].sort())
  })

  it('includes an epic channel they belong to, even before they post in it', () => {
    const { engine, chat, nova, vega } = setup()
    const epic = engine.board().createEpic({ title: 'Usage invoices' })
    const channelId = `epic-${epic.id}-usage-invoices`
    engine.board().createTicket({ title: 'Plan tiers', epicId: epic.id, assigneeId: nova.id })
    chat.post({ authorId: vega.id, channelId, text: 'kicking this off' })

    expect(chat.employeeConversations(nova.id)).toEqual([
      expect.objectContaining({ channelId, kind: 'channel', counterpartId: null, postable: true }),
    ])
  })

  it('orders them by their newest message, newest first', () => {
    const { chat, nova, vega } = setup()
    const withBoss = dmChannelId(BOSS, nova.id)
    const withVega = dmChannelId(nova.id, vega.id)
    chat.post({ authorId: nova.id, channelId: withVega, text: 'hold the switcher' })
    chat.post({ authorId: nova.id, channelId: 'tech', text: 'migrations are green' })
    chat.post({ authorId: BOSS, channelId: withBoss, text: 'nice work' })
    chat.post({ authorId: vega.id, channelId: withVega, text: 'pushing the locale guard' })

    expect(chat.employeeConversations(nova.id).map((c) => c.channelId)).toEqual([withVega, withBoss, 'tech'])
  })

  it('previews the newest message of each conversation', () => {
    const { chat, nova, vega } = setup()
    const withVega = dmChannelId(nova.id, vega.id)
    chat.post({ authorId: nova.id, channelId: withVega, text: 'hold the switcher' })
    const last = chat.post({ authorId: vega.id, channelId: withVega, text: 'pushing the locale guard' })

    expect(chat.employeeConversations(nova.id)[0]).toMatchObject({
      kind: 'dm',
      counterpartId: vega.id,
      last: { id: last.id, authorId: vega.id, text: 'pushing the locale guard', createdAt: last.createdAt },
    })
  })

  it('names the boss as the counterpart of their own DM, and nobody on a channel', () => {
    const { chat, nova } = setup()
    chat.post({ authorId: nova.id, channelId: dmChannelId(BOSS, nova.id), text: 'got a minute?' })
    chat.post({ authorId: nova.id, channelId: 'tech', text: 'migrations are green' })

    const [channel, dm] = chat.employeeConversations(nova.id)
    expect(dm).toMatchObject({ kind: 'dm', counterpartId: BOSS, postable: true })
    expect(channel).toMatchObject({ kind: 'channel', name: 'tech', counterpartId: null, postable: true })
  })

  it('marks a DM between two Employees as not postable, the boss being no member', () => {
    const { chat, nova, vega } = setup()
    chat.post({ authorId: nova.id, channelId: dmChannelId(nova.id, vega.id), text: 'hold the switcher' })

    expect(chat.employeeConversations(nova.id)[0]).toMatchObject({
      kind: 'dm',
      counterpartId: vega.id,
      postable: false,
    })
  })

  it('counts what the boss has not read, their own messages left out', () => {
    const { chat, nova, vega } = setup()
    const withVega = dmChannelId(nova.id, vega.id)
    chat.post({ authorId: nova.id, channelId: withVega, text: 'hold the switcher' })
    chat.post({ authorId: vega.id, channelId: withVega, text: 'pushing the locale guard' })
    chat.post({ authorId: BOSS, channelId: dmChannelId(BOSS, nova.id), text: 'nice work' })

    const counts = Object.fromEntries(chat.employeeConversations(nova.id).map((c) => [c.channelId, c.unread]))
    expect(counts).toEqual({ [withVega]: 2, [dmChannelId(BOSS, nova.id)]: 0 })
  })

  it('counts replies too, and clears once the boss reads the conversation', () => {
    const { chat, nova, vega } = setup()
    const withVega = dmChannelId(nova.id, vega.id)
    const root = chat.post({ authorId: nova.id, channelId: withVega, text: 'hold the switcher' })
    chat.reply({ authorId: vega.id, messageId: root.id, text: 'on it' })
    expect(chat.employeeConversations(nova.id)[0]!.unread).toBe(2)

    chat.markReadByBoss(withVega)

    expect(chat.employeeConversations(nova.id)[0]!.unread).toBe(0)
  })

  it('refuses a conversation query for someone who is not an Employee', () => {
    const { chat } = setup()

    expect(() => chat.employeeConversations('nobody')).toThrow('Unknown employee: nobody')
  })
})

describe('reading along a DM the boss is not in', () => {
  it('lets the boss read it', () => {
    const { chat, nova, vega } = setup()
    const withVega = dmChannelId(nova.id, vega.id)
    chat.post({ authorId: nova.id, channelId: withVega, text: 'hold the switcher' })

    expect(chat.read({ channelId: withVega }).map((m) => m.text)).toEqual(['hold the switcher'])
  })

  it('refuses a post from the boss', () => {
    const { chat, nova, vega } = setup()
    const withVega = dmChannelId(nova.id, vega.id)
    const root = chat.post({ authorId: nova.id, channelId: withVega, text: 'hold the switcher' })

    expect(() => chat.post({ authorId: BOSS, channelId: withVega, text: 'me too' })).toThrow('You are not in this DM')
    expect(() => chat.reply({ authorId: BOSS, messageId: root.id, text: 'me too' })).toThrow('You are not in this DM')
  })
})
