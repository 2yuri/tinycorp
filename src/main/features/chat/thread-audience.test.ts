import { afterEach, describe, expect, it } from 'vitest'
import { BOSS } from '../../../shared/domain/chat'
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
  return { chat: engine.chat(), nova, vega }
}

describe('a thread’s audience', () => {
  it('is nobody at all when there is no such message', () => {
    const { chat } = setup()

    expect(chat.threadAudience(404)).toBeNull()
  })

  it('names who started the thread, even when the root mentions no one', () => {
    const { chat } = setup()
    const root = chat.post({ authorId: BOSS, channelId: 'tech', text: 'How is the login page?' })

    expect(chat.threadAudience(root.id)).toEqual({ authorId: BOSS, mentioned: [] })
  })

  it('gathers everyone mentioned in the root and in every reply', () => {
    const { chat, nova, vega } = setup()
    const root = chat.post({ authorId: nova.id, channelId: 'tech', text: 'Which database, @boss?' })
    chat.reply({ authorId: vega.id, messageId: root.id, text: 'Ask @Nova' })

    expect(chat.threadAudience(root.id)).toEqual({ authorId: nova.id, mentioned: [BOSS, nova.id] })
  })

  it('is the thread rooted at the id it is given, and nothing above it', () => {
    const { chat, nova, vega } = setup()
    const root = chat.post({ authorId: nova.id, channelId: 'tech', text: 'Standup' })
    const reply = chat.reply({ authorId: vega.id, messageId: root.id, text: 'nothing to report' })

    expect(chat.threadAudience(reply.id)).toEqual({ authorId: vega.id, mentioned: [] })
  })

  it('leaves out a mention in another thread of the same channel', () => {
    const { chat, nova, vega } = setup()
    const root = chat.post({ authorId: nova.id, channelId: 'tech', text: 'Standup' })
    chat.post({ authorId: vega.id, channelId: 'tech', text: '@boss the build is red' })

    expect(chat.threadAudience(root.id)).toEqual({ authorId: nova.id, mentioned: [] })
  })
})
