import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { afterEach, describe, expect, it } from 'vitest'
import { BOSS, dmChannelId } from '../../../shared/domain/chat'
import { fakeProvider } from '../../providers/testing'
import { inMemoryDatabases, inMemoryRecents, mcpTransport, onDisk } from '../testing'
import { type CompanyEngine, createCompanyEngine } from './company-engine'
import { type CompanyMcpServer, startCompanyMcpServer } from './company-mcp-server'

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
  })
  cleanups.push(() => engine.close())
  server = await startCompanyMcpServer(engine)
  cleanups.push(() => server!.close())
  engine.createCompany({ folder: onDisk('/work/acme') })
  const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
  const grace = engine.employees.create({ name: 'Grace', roleId: 'tech-lead' })

  /** Starts an Employee's Session and connects to MCP with what the Session was given. */
  async function connectAs(employeeId: string) {
    engine.sessions.start(employeeId)
    const { url, token } = provider.spawnOf(employeeId).mcp!
    return connect(url, token)
  }
  return { engine, server, provider, ada, grace, connectAs }
}

async function connect(url: string, token?: string) {
  const client = new Client({ name: 'employee', version: '0.0.0' })
  const transport = mcpTransport(url, token ? { authorization: `Bearer ${token}` } : {})
  await client.connect(transport)
  cleanups.push(() => client.close())
  return {
    client,
    async call(name: string, args: Record<string, unknown>) {
      const result = (await client.callTool({ name, arguments: args })) as {
        isError?: boolean
        content: { type: string; text: string }[]
      }
      const text = result.content.map((c) => c.text).join('')
      return { isError: result.isError ?? false, text, json: () => JSON.parse(text) as unknown }
    },
  }
}

const unauthorized = { code: 401, message: expect.stringMatching(/unknown or expired employee token/i) }

describe('Company MCP server', () => {
  it('lists the chat tools', async () => {
    const { ada, connectAs } = await setup()
    const { client } = await connectAs(ada.id)

    const { tools } = await client.listTools()

    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(['chat_post', 'chat_read', 'thread_reply']))
  })

  it('posts in a channel as the Employee whose token is used', async () => {
    const { engine, ada, grace, connectAs } = await setup()
    const employee = await connectAs(ada.id)

    const result = await employee.call('chat_post', { channel: '#tech', text: 'API is up, @Grace please review' })

    expect(result.isError).toBe(false)
    expect(result.json()).toMatchObject({ id: expect.any(Number), channel: '#tech' })
    expect(engine.chat().read({ channelId: 'tech' })).toEqual([
      expect.objectContaining({ authorId: ada.id, text: 'API is up, @Grace please review', mentions: [grace.id] }),
    ])
  })

  it('DMs the boss or a colleague when the channel is @name', async () => {
    const { engine, ada, grace, connectAs } = await setup()
    const employee = await connectAs(ada.id)

    await employee.call('chat_post', { channel: '@boss', text: 'blocked on keys' })
    await employee.call('chat_post', { channel: '@grace', text: 'pair later?' })

    expect(engine.chat().read({ channelId: dmChannelId(BOSS, ada.id) })).toEqual([
      expect.objectContaining({ authorId: ada.id, text: 'blocked on keys' }),
    ])
    expect(engine.chat().read({ channelId: dmChannelId(grace.id, ada.id) })).toEqual([
      expect.objectContaining({ authorId: ada.id, text: 'pair later?' }),
    ])
  })

  it('reads a channel with author names and thread sizes', async () => {
    const { engine, ada, connectAs } = await setup()
    const root = engine.chat().post({ authorId: BOSS, channelId: 'general', text: 'welcome @Ada' })
    engine.chat().reply({ authorId: BOSS, messageId: root.id, text: 'say hi' })
    const employee = await connectAs(ada.id)

    const result = await employee.call('chat_read', { channel: 'general' })

    expect(result.json()).toEqual({
      channel: '#general',
      messages: [
        {
          id: root.id,
          author: 'boss',
          text: 'welcome @Ada',
          mentions: ['Ada'],
          replies: 1,
          at: expect.any(String),
        },
      ],
    })
  })

  it('reads and replies in a thread', async () => {
    const { engine, ada, connectAs } = await setup()
    const root = engine.chat().post({ authorId: BOSS, channelId: 'tech', text: 'who takes #12?' })
    const employee = await connectAs(ada.id)

    const reply = await employee.call('thread_reply', { message_id: root.id, text: 'I will' })
    const thread = await employee.call('chat_read', { channel: '#tech', thread_id: root.id })

    expect(reply.json()).toMatchObject({ id: expect.any(Number), thread_id: root.id, channel: '#tech' })
    expect((thread.json() as { messages: { author: string; text: string }[] }).messages).toEqual([
      expect.objectContaining({ author: 'boss', text: 'who takes #12?' }),
      expect.objectContaining({ author: 'Ada', text: 'I will', thread_id: root.id }),
    ])
    expect(engine.chat().read({ channelId: 'tech' })[0]).toMatchObject({ replyCount: 1 })
  })

  it('reports bad calls as tool errors', async () => {
    const { ada, connectAs } = await setup()
    const employee = await connectAs(ada.id)

    const nowhere = await employee.call('chat_post', { channel: '#random', text: 'hi' })
    const nobody = await employee.call('chat_post', { channel: '@nobody', text: 'hi' })
    const missing = await employee.call('thread_reply', { message_id: 404, text: 'hi' })

    expect(nowhere).toMatchObject({ isError: true, text: expect.stringMatching(/no channel/i) })
    expect(nobody).toMatchObject({ isError: true, text: expect.stringMatching(/nobody/i) })
    expect(missing).toMatchObject({ isError: true, text: expect.stringMatching(/no message/i) })
  })

  it('answers only POST on a Company route', async () => {
    const { engine, server } = await setup()
    const url = server.urlFor(engine.currentCompany()!.id)

    expect((await fetch(url)).status).toBe(405)
    expect((await fetch(url.replace('/mcp', '/other'), { method: 'POST' })).status).toBe(404)
  })

  it('refuses callers without a live Session token', async () => {
    const { engine, provider, ada } = await setup()
    engine.sessions.start(ada.id)
    const { url, token } = provider.spawnOf(ada.id).mcp!
    engine.sessions.stop(ada.id)

    await expect(connect(url)).rejects.toMatchObject(unauthorized)
    await expect(connect(url, 'forged')).rejects.toMatchObject(unauthorized)
    await expect(connect(url, token)).rejects.toMatchObject(unauthorized)
  })

  it('binds a token to its own Company’s server, whichever Company is current', async () => {
    const { engine, server, provider, ada } = await setup()
    engine.sessions.start(ada.id)
    const { url, token } = provider.spawnOf(ada.id).mcp!
    const globex = engine.createCompany({ folder: onDisk('/work/globex') })

    const employee = await connect(url, token)
    const posted = await employee.call('chat_post', { channel: '#general', text: 'still at acme' })

    expect(url).not.toBe(server.urlFor(globex.id))
    await expect(connect(server.urlFor(globex.id), token)).rejects.toMatchObject(unauthorized)
    expect(posted.isError).toBe(false)
    expect(engine.chat().read({ channelId: 'general' })).toEqual([])
  })
})
