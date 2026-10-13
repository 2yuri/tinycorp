import { afterEach, describe, expect, it } from 'vitest'
import { TOPIC_MAX } from '../../../shared/channel-extras'
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
  const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
  const grace = engine.employees.create({ name: 'Grace Holt', roleId: 'tech-lead' })
  return { engine, chat: engine.chat(), ada, grace }
}

describe('A channel’s topic', () => {
  it('starts empty and keeps what the boss writes', () => {
    const { chat } = setup()

    expect(chat.channels().map((c) => c.topic)).toEqual(['', '', ''])

    const tech = chat.setChannelTopic({ channelId: '#tech', topic: '  How we build it.  ' })

    expect(tech.topic).toBe('How we build it.')
    expect(chat.channels().find((c) => c.id === 'tech')?.topic).toBe('How we build it.')
  })

  it('collapses line breaks and cuts a topic that would not fit the subtitle', () => {
    const { chat } = setup()

    const topic = chat.setChannelTopic({ channelId: 'general', topic: `one\n\ntwo   ${'x'.repeat(400)}` }).topic

    expect(topic.startsWith('one two x')).toBe(true)
    expect(topic.length).toBeLessThanOrEqual(TOPIC_MAX)
  })

  it('clears the topic when the boss empties it', () => {
    const { chat } = setup()
    chat.setChannelTopic({ channelId: 'tech', topic: 'How we build it.' })

    expect(chat.setChannelTopic({ channelId: 'tech', topic: '   ' }).topic).toBe('')
  })

  it('refuses a direct message and a channel that is not there', () => {
    const { chat, ada } = setup()

    expect(() => chat.setChannelTopic({ channelId: dmChannelId(BOSS, ada.id), topic: 'hi' })).toThrow(
      /no topic or member list/,
    )
    expect(() => chat.setChannelTopic({ channelId: 'design', topic: 'hi' })).toThrow(/no channel/)
  })

  it('tells the views something changed, without a message', () => {
    const { engine, chat } = setup()
    let changes = 0
    engine.onChatChange(() => changes++)

    chat.setChannelTopic({ channelId: 'tech', topic: 'How we build it.' })

    expect(changes).toBe(1)
    expect(chat.read({ channelId: 'tech' })).toEqual([])
  })
})

describe('A channel’s member list', () => {
  it('starts empty, meaning the whole Company', () => {
    const { chat } = setup()

    expect(chat.channels().map((c) => c.members)).toEqual([[], [], []])
  })

  it('keeps the Employees the boss puts in it', () => {
    const { chat, ada } = setup()

    expect(chat.setChannelMembers({ channelId: '#tech', memberIds: [ada.id, ada.id] }).members).toEqual([ada.id])
    expect(chat.channels().find((c) => c.id === 'tech')?.members).toEqual([ada.id])
  })

  it('goes back to the whole Company when the list is emptied', () => {
    const { chat, ada } = setup()
    chat.setChannelMembers({ channelId: 'tech', memberIds: [ada.id] })

    expect(chat.setChannelMembers({ channelId: 'tech', memberIds: [] }).members).toEqual([])
  })

  it('refuses somebody who does not work here, and someone who was fired', () => {
    const { engine, chat, ada, grace } = setup()
    engine.hiring.fire(ada.id, 'moved on')

    expect(() => chat.setChannelMembers({ channelId: 'tech', memberIds: ['nobody'] })).toThrow(/not an Employee/)
    expect(() => chat.setChannelMembers({ channelId: 'tech', memberIds: [grace.id, ada.id] })).toThrow(
      /not an Employee/,
    )
    expect(chat.channels().find((c) => c.id === 'tech')?.members).toEqual([])
  })
})

describe('Pinning a message', () => {
  it('pins and unpins, and says who pinned it', () => {
    const { chat, ada } = setup()
    const message = chat.post({ authorId: ada.id, channelId: 'tech', text: 'the migration is named' })

    const pinned = chat.pinMessage({ messageId: message.id, byId: ada.id })

    expect(pinned).toMatchObject({ id: message.id, text: 'the migration is named', pinnedBy: ada.id })
    expect(chat.pins('tech').map((p) => p.id)).toEqual([message.id])

    chat.unpinMessage({ messageId: message.id })

    expect(chat.pins('tech')).toEqual([])
  })

  it('lists a channel’s pins newest first and leaves other channels alone', () => {
    const { chat, ada } = setup()
    const first = chat.post({ authorId: BOSS, channelId: 'tech', text: 'one' })
    const second = chat.post({ authorId: ada.id, channelId: 'tech', text: 'two' })
    const elsewhere = chat.post({ authorId: BOSS, channelId: 'general', text: 'three' })
    chat.pinMessage({ messageId: first.id, byId: BOSS })
    chat.pinMessage({ messageId: second.id, byId: ada.id })
    chat.pinMessage({ messageId: elsewhere.id, byId: BOSS })

    expect(chat.pins('tech').map((p) => p.text)).toEqual(['two', 'one'])
    expect(chat.pins('general').map((p) => p.text)).toEqual(['three'])
  })

  it('pins a reply, which keeps the thread it belongs to', () => {
    const { chat, ada } = setup()
    const root = chat.post({ authorId: BOSS, channelId: 'tech', text: 'what did we decide?' })
    const reply = chat.reply({ authorId: ada.id, messageId: root.id, text: 'named migrations, always' })

    expect(chat.pinMessage({ messageId: reply.id, byId: ada.id })).toMatchObject({ threadId: root.id })
    expect(chat.pins('tech').map((p) => p.id)).toEqual([reply.id])
  })

  it('keeps the first pin when the same message is pinned twice', () => {
    const { chat, ada } = setup()
    const message = chat.post({ authorId: BOSS, channelId: 'tech', text: 'one' })
    const first = chat.pinMessage({ messageId: message.id, byId: BOSS })

    const again = chat.pinMessage({ messageId: message.id, byId: ada.id })

    expect(again.pinnedBy).toBe(BOSS)
    expect(again.pinnedAt).toBe(first.pinnedAt)
    expect(chat.pins('tech')).toHaveLength(1)
  })

  it('refuses a message that is not there, an unknown pinner and unpinning what is not pinned', () => {
    const { chat } = setup()
    const message = chat.post({ authorId: BOSS, channelId: 'tech', text: 'one' })

    expect(() => chat.pinMessage({ messageId: 9999, byId: BOSS })).toThrow(/no message 9999/)
    expect(() => chat.pinMessage({ messageId: message.id, byId: 'ghost' })).toThrow(/Unknown author/)
    expect(() => chat.unpinMessage({ messageId: message.id })).toThrow(/not pinned/)
  })

  it('lets a pin go with the channel the boss deletes', () => {
    const { engine, chat, ada } = setup()
    const epic = engine.board().createEpic({ title: 'Checkout' })
    const channelId = `epic-${epic.id}-checkout`
    const message = chat.post({ authorId: ada.id, channelId, text: 'the plan' })
    chat.pinMessage({ messageId: message.id, byId: ada.id })

    chat.deleteChannel(channelId)

    expect(chat.pins('general')).toEqual([])
  })
})

describe('Searching a channel', () => {
  it('finds message bodies whatever the case, newest first', () => {
    const { chat, ada } = setup()
    chat.post({ authorId: BOSS, channelId: 'tech', text: 'the Migration is named' })
    chat.post({ authorId: ada.id, channelId: 'tech', text: 'no migration yet' })
    chat.post({ authorId: ada.id, channelId: 'general', text: 'migration elsewhere' })

    expect(chat.searchMessages({ channelId: '#tech', text: 'MIGRATION' }).map((m) => m.text)).toEqual([
      'no migration yet',
      'the Migration is named',
    ])
  })

  it('finds replies as well as top-level messages', () => {
    const { chat, ada } = setup()
    const root = chat.post({ authorId: BOSS, channelId: 'tech', text: 'what about the index?' })
    chat.reply({ authorId: ada.id, messageId: root.id, text: 'the index is on channel_id' })

    expect(chat.searchMessages({ channelId: 'tech', text: 'index' }).map((m) => m.threadId)).toEqual([root.id, null])
  })

  it('takes `%` and `_` as text, not as wildcards, and matches nothing on an empty search', () => {
    const { chat } = setup()
    chat.post({ authorId: BOSS, channelId: 'tech', text: 'coverage is 90% today' })
    chat.post({ authorId: BOSS, channelId: 'tech', text: 'coverage is fine' })

    expect(chat.searchMessages({ channelId: 'tech', text: '90%' }).map((m) => m.text)).toEqual([
      'coverage is 90% today',
    ])
    // `%` is the text of one message, not a wildcard over both.
    expect(chat.searchMessages({ channelId: 'tech', text: '%' }).map((m) => m.text)).toEqual(['coverage is 90% today'])
    expect(chat.searchMessages({ channelId: 'tech', text: '   ' })).toEqual([])
  })

  it('returns only the newest matches when given a limit', () => {
    const { chat } = setup()
    for (let i = 1; i <= 5; i++) chat.post({ authorId: BOSS, channelId: 'tech', text: `note ${i}` })

    expect(chat.searchMessages({ channelId: 'tech', text: 'note', limit: 2 }).map((m) => m.text)).toEqual([
      'note 5',
      'note 4',
    ])
  })
})
