import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { afterEach, describe, expect, it } from 'vitest'
import { BOSS, dmChannelId } from '../../../shared/domain/chat'
import type { CompanyNotification } from '../../../shared/notifications'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { type CompanyMcpServer, startCompanyMcpServer } from '../../core/engine/company-mcp-server'
import { inMemoryDatabases, inMemoryRecents, mcpTransport, onDisk } from '../../core/testing'
import { fakeProvider } from '../../providers/testing'

const cleanups: (() => unknown)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

/** Lets a notification that waits for the rest of the posting action come out. */
const settle = () => new Promise<void>((resolve) => queueMicrotask(resolve))

async function setup() {
  let server: CompanyMcpServer | undefined
  const provider = fakeProvider()
  const engine: CompanyEngine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
    providers: { claude: provider },
    mcpUrl: (companyId) => server!.urlFor(companyId),
    log: () => {},
  })
  cleanups.push(() => engine.close())
  server = await startCompanyMcpServer(engine)
  cleanups.push(() => server!.close())
  engine.createCompany({ folder: onDisk('/work/acme') })
  const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
  const grace = engine.employees.create({ name: 'Grace', roleId: 'tech-lead' })
  const sent: CompanyNotification[] = []
  engine.notifications.onNotify((notification) => void sent.push(notification))

  async function connectAs(employeeId: string) {
    engine.sessions.start(employeeId)
    const { url, token } = provider.spawnOf(employeeId).mcp!
    const client = new Client({ name: 'employee', version: '0.0.0' })
    await client.connect(mcpTransport(url, { authorization: `Bearer ${token}` }))
    cleanups.push(() => client.close())
    return async function call(name: string, args: Record<string, unknown>) {
      const result = (await client.callTool({ name, arguments: args })) as { isError?: boolean }
      return { isError: result.isError ?? false }
    }
  }
  return { engine, chat: engine.chat(), ada, grace, sent, connectAs }
}

/**
 * TI-5: an Employee speaking to the boss in a channel is silence unless the message mentions them,
 * so the app writes the mention instead of trusting the Employee to. The banner and the Inbox row
 * are what the boss actually notices, which is what these check.
 */
describe('An Employee addressing the boss in a channel', () => {
  it('is @mentioned and notified when the post says it is for the boss', async () => {
    const { chat, ada, sent, connectAs } = await setup()
    const call = await connectAs(ada.id)

    const posted = await call('chat_post', { channel: '#tech', text: 'the keys expired, I cannot deploy', to: 'boss' })
    await settle()

    expect(posted.isError).toBe(false)
    expect(chat.read({ channelId: 'tech' })).toEqual([
      expect.objectContaining({ text: '@boss the keys expired, I cannot deploy', mentions: [BOSS] }),
    ])
    expect(sent).toEqual([
      expect.objectContaining({ kind: 'mention', title: 'Ada mentioned you', body: expect.stringContaining('#tech') }),
    ])
    expect(chat.bossInbox()).toEqual([expect.objectContaining({ kind: 'mention' })])
  })

  it('is left alone when the post was not addressed to the boss', async () => {
    const { chat, ada, grace, sent, connectAs } = await setup()
    const call = await connectAs(ada.id)

    await call('chat_post', { channel: '#general', text: 'Welcome, team! First up: checkout.' })
    await call('chat_post', { channel: '#general', text: '@Grace welcome aboard' })
    await settle()

    expect(chat.read({ channelId: 'general' })).toEqual([
      expect.objectContaining({ text: 'Welcome, team! First up: checkout.', mentions: [] }),
      expect.objectContaining({ text: '@Grace welcome aboard', mentions: [grace.id] }),
    ])
    expect(sent).toEqual([])
  })

  it('is @mentioned once when the post already names the boss', async () => {
    const { chat, ada, sent, connectAs } = await setup()
    const call = await connectAs(ada.id)

    await call('chat_post', { channel: '#tech', text: '@boss the staging keys expired', to: 'boss' })
    await settle()

    expect(chat.read({ channelId: 'tech' })).toEqual([
      expect.objectContaining({ text: '@boss the staging keys expired', mentions: [BOSS] }),
    ])
    expect(sent).toEqual([expect.objectContaining({ kind: 'mention' })])
  })

  it('writes no mention into a DM to the boss, which notifies on its own', async () => {
    const { chat, ada, sent, connectAs } = await setup()
    const call = await connectAs(ada.id)

    await call('chat_post', { channel: '@boss', text: 'blocked on keys', to: 'boss' })
    await settle()

    expect(chat.read({ channelId: dmChannelId(BOSS, ada.id) })).toEqual([
      expect.objectContaining({ text: 'blocked on keys', mentions: [] }),
    ])
    expect(sent).toEqual([expect.objectContaining({ kind: 'mention', title: 'Ada sent you a message' })])
  })
})
