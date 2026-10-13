import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { BOSS, type BossUnread, dmChannelId } from '../../../shared/domain/chat'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { migrate } from '../../core/engine/migrations'
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
  const grace = engine.employees.create({ name: 'Grace', roleId: 'tech-lead' })
  return { engine, chat: engine.chat(), ada, grace }
}

/** The counts alone, which is what most of these are about; the marks have their own test. */
const unread = (chat: { bossUnread(): BossUnread }) => chat.bossUnread().counts

describe('the boss’s unread chat', () => {
  it('starts with nothing unread', () => {
    const { chat } = setup()

    expect(chat.bossUnread()).toEqual({ counts: {}, readMarks: {} })
  })

  it('counts messages and replies from others in named channels and the boss’s DMs', () => {
    const { chat, ada, grace } = setup()
    const root = chat.post({ authorId: ada.id, channelId: 'tech', text: 'migrations are green' })
    chat.reply({ authorId: grace.id, messageId: root.id, text: 'nice' })
    chat.post({ authorId: ada.id, channelId: dmChannelId(BOSS, ada.id), text: 'got a minute?' })

    expect(unread(chat)).toEqual({ tech: 2, [dmChannelId(BOSS, ada.id)]: 1 })
  })

  it('ignores the boss’s own messages and DMs between Employees', () => {
    const { chat, ada, grace } = setup()
    chat.post({ authorId: BOSS, channelId: 'general', text: 'standup at 10' })
    chat.post({ authorId: ada.id, channelId: dmChannelId(ada.id, grace.id), text: 'pairing?' })

    expect(unread(chat)).toEqual({})
  })

  it('clears a channel once the boss reads it, and counts only what comes after', () => {
    const { chat, ada } = setup()
    chat.post({ authorId: ada.id, channelId: 'tech', text: 'one' })
    chat.post({ authorId: ada.id, channelId: 'general', text: 'two' })

    expect(chat.markReadByBoss('tech')).toBe(true)
    expect(unread(chat)).toEqual({ general: 1 })

    chat.post({ authorId: ada.id, channelId: '#tech', text: 'three' })
    expect(unread(chat)).toEqual({ general: 1, tech: 1 })
  })

  it('reports whether marking read changed anything', () => {
    const { chat, ada } = setup()
    chat.post({ authorId: ada.id, channelId: 'tech', text: 'one' })

    expect(chat.markReadByBoss('#tech')).toBe(true)
    expect(chat.markReadByBoss('tech')).toBe(false)
    expect(chat.markReadByBoss('general')).toBe(false)
  })

  it('rejects a channel that does not exist', () => {
    const { chat } = setup()

    expect(() => chat.markReadByBoss('nowhere')).toThrow(/no channel/)
  })

  it('keeps read marks with the Company', () => {
    const { engine, chat, ada } = setup()
    chat.post({ authorId: ada.id, channelId: 'tech', text: 'one' })
    chat.markReadByBoss('tech')
    const company = engine.currentCompany()!

    engine.createCompany({ folder: onDisk('/work/other') })
    engine.switchCompany(company.id)

    expect(unread(engine.chat())).toEqual({})
  })

  // T251: the Inbox's New divider is placed from the mark, so it travels with the counts.
  it('says where each channel\u2019s read mark stands, beside what is unread', () => {
    const { chat, ada } = setup()
    const first = chat.post({ authorId: ada.id, channelId: 'tech', text: 'one' })
    chat.markReadByBoss('tech')
    chat.post({ authorId: ada.id, channelId: 'tech', text: 'two' })

    expect(chat.bossUnread()).toEqual({ counts: { tech: 1 }, readMarks: { tech: first.id } })
  })

  it('treats history from before read marks existed as read', () => {
    const db = new DatabaseSync(':memory:')
    // Migrate, undo the read marks as if they never shipped, post, then migrate again.
    migrate(db)
    db.exec(`DROP TABLE chat_read_mark; DELETE FROM schema_migration WHERE name = 'chat-boss-read-marks'`)
    db.prepare(
      `INSERT INTO message (channel_id, author_id, text, mentions, mentions_channel, created_at)
       VALUES ('tech', 'someone', 'old news', '[]', 0, '2026-01-01T00:00:00.000Z')`,
    ).run()

    migrate(db)

    expect(db.prepare('SELECT channel_id, last_read_id FROM chat_read_mark').all()).toEqual([
      { channel_id: 'tech', last_read_id: 1 },
    ])
  })
})
