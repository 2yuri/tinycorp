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

describe('the DMs between two Employees', () => {
  it('are none before anyone speaks', () => {
    const { chat } = setup()

    expect(chat.agentPairs()).toEqual([])
  })

  it('list a pair once, with its two members and its newest message', () => {
    const { chat, nova, vega } = setup()
    const channelId = dmChannelId(nova.id, vega.id)
    chat.post({ authorId: nova.id, channelId, text: 'hold the switcher' })
    const last = chat.post({ authorId: vega.id, channelId, text: 'on it' })

    expect(chat.agentPairs()).toEqual([
      { channelId, members: [nova.id, vega.id].sort(), lastAt: last.createdAt, unread: 2 },
    ])
  })

  it('leave out the boss’s own DMs and the named channels', () => {
    const { chat, nova, vega } = setup()
    chat.post({ authorId: nova.id, channelId: 'tech', text: 'migrations are green' })
    chat.post({ authorId: BOSS, channelId: dmChannelId(BOSS, nova.id), text: 'nice work' })
    const between = dmChannelId(nova.id, vega.id)
    chat.post({ authorId: nova.id, channelId: between, text: 'hold the switcher' })

    expect(chat.agentPairs().map((p) => p.channelId)).toEqual([between])
  })

  it('order the pairs by their newest message, newest first', () => {
    const { chat, nova, vega, iris } = setup()
    const novaVega = dmChannelId(nova.id, vega.id)
    const irisNova = dmChannelId(iris.id, nova.id)
    chat.post({ authorId: nova.id, channelId: novaVega, text: 'hold the switcher' })
    chat.post({ authorId: iris.id, channelId: irisNova, text: 'suite is red' })

    expect(chat.agentPairs().map((p) => p.channelId)).toEqual([irisNova, novaVega])

    chat.post({ authorId: vega.id, channelId: novaVega, text: 'held' })

    expect(chat.agentPairs().map((p) => p.channelId)).toEqual([novaVega, irisNova])
  })

  it('count what the boss has not read, and nothing once they have looked', () => {
    const { chat, nova, vega } = setup()
    const channelId = dmChannelId(nova.id, vega.id)
    chat.post({ authorId: nova.id, channelId, text: 'hold the switcher' })
    chat.markReadByBoss(channelId)

    expect(chat.agentPairs()).toEqual([expect.objectContaining({ unread: 0 })])

    chat.post({ authorId: vega.id, channelId, text: 'on it' })

    expect(chat.agentPairs()).toEqual([expect.objectContaining({ unread: 1 })])
  })
})
