import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BOSS, dmChannelId } from '../../../shared/domain/chat'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'

const engines: CompanyEngine[] = []
const tempDirs: string[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function setup() {
  const engine = createCompanyEngine({ openDatabase: inMemoryDatabases(), recents: inMemoryRecents() })
  engines.push(engine)
  engine.createCompany({ folder: onDisk('/work/acme') })
  const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
  const grace = engine.employees.create({ name: 'Grace Holt', roleId: 'tech-lead' })
  return { engine, ada, grace }
}

describe('Chat', () => {
  it('starts every Company with #general, #tech and #prs', () => {
    const { engine } = setup()

    expect(engine.chat().channels()).toEqual([
      { id: 'general', kind: 'channel', name: 'general', members: [], topic: '' },
      { id: 'tech', kind: 'channel', name: 'tech', members: [], topic: '' },
      { id: 'prs', kind: 'channel', name: 'prs', members: [], topic: '' },
    ])
  })

  it('keeps top-level messages per channel, oldest first', () => {
    const { engine, ada } = setup()
    const chat = engine.chat()

    chat.post({ authorId: BOSS, channelId: 'general', text: 'morning all' })
    chat.post({ authorId: ada.id, channelId: 'tech', text: 'migrations are green' })
    chat.post({ authorId: BOSS, channelId: 'general', text: 'standup at 10' })

    expect(chat.read({ channelId: 'general' }).map((m) => m.text)).toEqual(['morning all', 'standup at 10'])
    expect(chat.read({ channelId: 'tech' })).toEqual([
      expect.objectContaining({ authorId: ada.id, text: 'migrations are green', threadId: null }),
    ])
  })

  it('carries the target a message announces, and refuses one that does not exist (T151)', () => {
    const { engine, ada } = setup()
    const chat = engine.chat()
    const target = engine.board().createTarget({ title: 'Billing dashboard' })

    const said = chat.post({
      authorId: ada.id,
      channelId: 'general',
      text: 'One target, two epics.',
      targetId: target.id,
    })
    expect(said.targetId).toBe(target.id)
    expect(chat.read({ channelId: 'general' })[0]?.targetId).toBe(target.id)
    expect(chat.post({ authorId: ada.id, channelId: 'general', text: 'plain' })).not.toHaveProperty('targetId')
    expect(() => chat.post({ authorId: ada.id, channelId: 'general', text: 'x', targetId: 99 })).toThrow(/no target 99/)
  })

  it('accepts a channel written as #name', () => {
    const { engine, ada } = setup()

    const message = engine.chat().post({ authorId: ada.id, channelId: '#tech', text: 'hi' })

    expect(message.channelId).toBe('tech')
  })

  it('reads only the newest messages when given a limit', () => {
    const { engine } = setup()
    const chat = engine.chat()
    for (const n of [1, 2, 3, 4]) chat.post({ authorId: BOSS, channelId: 'general', text: `m${n}` })

    expect(chat.read({ channelId: 'general', limit: 2 }).map((m) => m.text)).toEqual(['m3', 'm4'])
  })

  it('records who a message mentions, including @channel', () => {
    const { engine, ada, grace } = setup()

    const message = engine.chat().post({
      authorId: BOSS,
      channelId: 'tech',
      text: '@ada and @Grace Holt, please review. @channel heads up (mail me at x@ada.io)',
    })

    expect([...message.mentions].sort()).toEqual([ada.id, grace.id].sort())
    expect(message.mentionsChannel).toBe(true)
    expect(engine.chat().read({ channelId: 'tech' })[0]).toMatchObject({
      mentions: message.mentions,
      mentionsChannel: true,
    })
  })

  it('does not take a longer word for a name', () => {
    const { engine } = setup()

    const message = engine.chat().post({ authorId: BOSS, channelId: 'tech', text: '@adam @channels' })

    expect(message).toMatchObject({ mentions: [], mentionsChannel: false })
  })

  it('threads replies under their root and counts them', () => {
    const { engine, ada, grace } = setup()
    const chat = engine.chat()
    const root = chat.post({ authorId: BOSS, channelId: 'tech', text: 'who owns auth?' })

    const first = chat.reply({ authorId: ada.id, messageId: root.id, text: 'me' })
    const second = chat.reply({ authorId: grace.id, messageId: first.id, text: '@Ada thanks' })

    expect(second).toMatchObject({ channelId: 'tech', threadId: root.id, mentions: [ada.id] })
    expect(chat.read({ channelId: 'tech' })).toEqual([expect.objectContaining({ id: root.id, replyCount: 2 })])
    expect(chat.read({ channelId: 'tech', threadId: root.id }).map((m) => m.text)).toEqual([
      'who owns auth?',
      'me',
      '@Ada thanks',
    ])
  })

  it('opens a DM on first post and lists it with its two members', () => {
    const { engine, ada } = setup()
    const chat = engine.chat()
    const dm = dmChannelId(BOSS, ada.id)

    chat.post({ authorId: ada.id, channelId: dm, text: 'got a minute?' })

    expect(chat.channels()).toContainEqual({ id: dm, kind: 'dm', name: '', members: [BOSS, ada.id].sort(), topic: '' })
    expect(chat.read({ channelId: dmChannelId(ada.id, BOSS) }).map((m) => m.text)).toEqual(['got a minute?'])
  })

  it('reads an unopened DM as empty', () => {
    const { engine, ada } = setup()

    expect(engine.chat().read({ channelId: dmChannelId(BOSS, ada.id) })).toEqual([])
  })

  it('refuses posts it cannot place', () => {
    const { engine, ada, grace } = setup()
    const chat = engine.chat()

    expect(() => chat.post({ authorId: BOSS, channelId: 'random', text: 'hi' })).toThrow(/no channel/i)
    expect(() => chat.post({ authorId: 'nobody', channelId: 'tech', text: 'hi' })).toThrow(/unknown author/i)
    expect(() => chat.post({ authorId: BOSS, channelId: 'tech', text: '   ' })).toThrow(/empty/i)
    expect(() => chat.post({ authorId: BOSS, channelId: dmChannelId(ada.id, grace.id), text: 'hi' })).toThrow(
      /not in this dm/i,
    )
    expect(() => chat.post({ authorId: BOSS, channelId: dmChannelId(BOSS, 'nobody'), text: 'hi' })).toThrow(
      /no channel/i,
    )
    expect(() => chat.reply({ authorId: BOSS, messageId: 999, text: 'hi' })).toThrow(/no message/i)
  })

  it('tells listeners about every new message', () => {
    const { engine, ada } = setup()
    let changes = 0
    engine.onChatChange(() => changes++)

    const root = engine.chat().post({ authorId: BOSS, channelId: 'general', text: 'hello' })
    engine.chat().reply({ authorId: ada.id, messageId: root.id, text: 'hi' })

    expect(changes).toBe(2)
  })

  it('keeps each Company’s chat apart', () => {
    const engine = createCompanyEngine({ openDatabase: inMemoryDatabases(), recents: inMemoryRecents() })
    engines.push(engine)
    engine.createCompany({ folder: onDisk('/work/acme') })
    engine.chat().post({ authorId: BOSS, channelId: 'general', text: 'acme news' })
    const acme = engine.currentCompany()!

    engine.createCompany({ folder: onDisk('/work/globex') })
    const globex = engine.chat().read({ channelId: 'general' })
    engine.switchCompany(acme.id)

    expect(globex).toEqual([])
    expect(
      engine
        .chat()
        .read({ channelId: 'general' })
        .map((m) => m.text),
    ).toEqual(['acme news'])
  })

  it('keeps messages, threads and DMs across a reopen', () => {
    const folder = mkdtempSync(join(tmpdir(), 'tinycorp-'))
    tempDirs.push(folder)
    const first = createCompanyEngine({ recents: inMemoryRecents() })
    first.createCompany({ folder })
    const ada = first.employees.create({ name: 'Ada', roleId: 'backend' })
    const root = first.chat().post({ authorId: BOSS, channelId: 'tech', text: 'ship it @Ada' })
    first.chat().reply({ authorId: ada.id, messageId: root.id, text: 'on it' })
    first.chat().post({ authorId: ada.id, channelId: dmChannelId(ada.id, BOSS), text: 'done' })
    first.close()

    const second = createCompanyEngine({ recents: inMemoryRecents() })
    engines.push(second)
    second.openCompany(folder)

    expect(second.chat().read({ channelId: 'tech' })).toEqual([
      expect.objectContaining({ text: 'ship it @Ada', mentions: [ada.id], replyCount: 1 }),
    ])
    expect(
      second
        .chat()
        .channels()
        .map((c) => c.id),
    ).toEqual(['general', 'tech', 'prs', dmChannelId(BOSS, ada.id)])
  })
})
