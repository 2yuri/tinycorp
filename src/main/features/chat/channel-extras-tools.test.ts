import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { afterEach, describe, expect, it } from 'vitest'
import { BOSS, dmChannelId } from '../../../shared/domain/chat'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { type CompanyMcpServer, startCompanyMcpServer } from '../../core/engine/company-mcp-server'
import { inMemoryDatabases, inMemoryRecents, mcpTransport, onDisk } from '../../core/testing'
import { fakeProvider } from '../../providers/testing'

const cleanups: (() => unknown)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

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
  const grace = engine.employees.create({ name: 'Grace Holt', roleId: 'tech-lead' })

  async function connectAs(employeeId: string) {
    engine.sessions.start(employeeId)
    const { url, token } = provider.spawnOf(employeeId).mcp!
    const client = new Client({ name: 'employee', version: '0.0.0' })
    await client.connect(mcpTransport(url, { authorization: `Bearer ${token}` }))
    cleanups.push(() => client.close())
    return {
      client,
      async call(name: string, args: Record<string, unknown> = {}) {
        const result = (await client.callTool({ name, arguments: args })) as {
          isError?: boolean
          content: { type: string; text: string }[]
        }
        const text = result.content.map((c) => c.text).join('')
        // biome-ignore lint/suspicious/noExplicitAny: an MCP tool answers JSON with no static shape; the assertions below are the check
        return { isError: result.isError ?? false, text, json: () => JSON.parse(text) as any }
      },
    }
  }
  return { engine, chat: engine.chat(), ada, grace, connectAs }
}

describe('Channel extras over MCP', () => {
  it('gives chat_read the channel’s topic', async () => {
    const { chat, ada, connectAs } = await setup()
    chat.post({ authorId: BOSS, channelId: 'tech', text: 'morning' })
    const employee = await connectAs(ada.id)

    const before = (await employee.call('chat_read', { channel: '#tech' })).json()
    chat.setChannelTopic({ channelId: 'tech', topic: 'How we build it.' })
    const after = (await employee.call('chat_read', { channel: '#tech' })).json()

    expect(before.topic).toBeUndefined()
    expect(after).toMatchObject({ channel: '#tech', topic: 'How we build it.' })
  })

  it('pins a message, which comes back with every chat_read of that channel', async () => {
    const { chat, ada, grace, connectAs } = await setup()
    const message = chat.post({ authorId: BOSS, channelId: 'tech', text: 'we use named migrations' })
    const employee = await connectAs(ada.id)
    const colleague = await connectAs(grace.id)

    const pinned = (await employee.call('chat_pin', { message_id: message.id })).json()
    const read = (await colleague.call('chat_read', { channel: '#tech' })).json()

    expect(pinned).toEqual({ id: message.id, channel: '#tech', pinned: true, pins: 1 })
    expect(read.pinned).toEqual([
      expect.objectContaining({ id: message.id, text: 'we use named migrations', pinned_by: 'Ada' }),
    ])
    expect(read.messages).toEqual([expect.objectContaining({ id: message.id, pinned: true })])
    expect(chat.pins('tech').map((p) => p.pinnedBy)).toEqual([ada.id])
  })

  it('unpins with pinned: false, and the pin stops coming back', async () => {
    const { chat, ada, connectAs } = await setup()
    const message = chat.post({ authorId: BOSS, channelId: 'tech', text: 'we use named migrations' })
    chat.pinMessage({ messageId: message.id, byId: BOSS })
    const employee = await connectAs(ada.id)

    const result = (await employee.call('chat_pin', { message_id: message.id, pinned: false })).json()
    const read = (await employee.call('chat_read', { channel: '#tech' })).json()

    expect(result).toEqual({ id: message.id, channel: '#tech', pinned: false, pins: 0 })
    expect(read.pinned).toBeUndefined()
    expect(read.messages[0].pinned).toBeUndefined()
    expect(chat.pins('tech')).toEqual([])
  })

  it('pins a message in a DM and names the channel as the Employee writes it', async () => {
    const { chat, ada, connectAs } = await setup()
    const employee = await connectAs(ada.id)
    const posted = (await employee.call('chat_post', { channel: '@boss', text: 'the plan is in #12' })).json()

    const pinned = (await employee.call('chat_pin', { message_id: posted.id })).json()

    expect(pinned).toMatchObject({ channel: '@boss', pinned: true, pins: 1 })
    expect(chat.pins(dmChannelId(BOSS, ada.id)).map((p) => p.text)).toEqual(['the plan is in #12'])
  })

  it('says so when the message is not there', async () => {
    const { ada, connectAs } = await setup()
    const employee = await connectAs(ada.id)

    const result = await employee.call('chat_pin', { message_id: 4242 })

    expect(result.isError).toBe(true)
    expect(result.text).toMatch(/no message 4242/)
  })

  it('lists chat_pin among the tools an Employee is given', async () => {
    const { ada, connectAs } = await setup()
    const employee = await connectAs(ada.id)

    const { tools } = await employee.client.listTools()

    expect(tools.map((t) => t.name)).toContain('chat_pin')
  })
})
