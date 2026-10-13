import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { afterEach, describe, expect, it } from 'vitest'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { type CompanyMcpServer, startCompanyMcpServer } from '../../core/engine/company-mcp-server'
import { inMemoryDatabases, inMemoryRecents, mcpTransport } from '../../core/testing'
import { fakeGit } from '../../platform/testing'
import { fakeProvider } from '../../providers/testing'

const cleanups: (() => unknown)[] = []
const scratch: string[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A Company on disk, so an Employee attaching over MCP has a real folder to copy into. */
async function setup() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'mcp-attachments-')))
  scratch.push(base)
  const folder = join(base, 'acme')
  mkdirSync(folder)
  let server: CompanyMcpServer | undefined
  const provider = fakeProvider()
  const engine: CompanyEngine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
    providers: { claude: provider },
    isGitRepo: () => true,
    git: fakeGit(),
    mcpUrl: (companyId) => server!.urlFor(companyId),
    log: () => {},
  })
  cleanups.push(() => engine.close())
  server = await startCompanyMcpServer(engine)
  cleanups.push(() => server!.close())
  engine.createCompany({ folder })
  const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })

  async function connectAs(employeeId: string) {
    engine.sessions.start(employeeId)
    const { url, token } = provider.spawnOf(employeeId).mcp!
    const client = new Client({ name: 'employee', version: '0.0.0' })
    await client.connect(mcpTransport(url, { authorization: `Bearer ${token}` }))
    cleanups.push(() => client.close())
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = (await client.callTool({ name, arguments: args })) as {
        isError?: boolean
        content: { type: string; text: string }[]
      }
      const text = result.content.map((c) => c.text).join('')
      return { isError: result.isError ?? false, text, json: () => JSON.parse(text) as never }
    }
    return Object.assign(call, { client })
  }
  return { engine, folder, base, ada, connectAs }
}

describe('An Employee attaching a file over MCP', () => {
  it('sends a file from inside the Company folder with its message', async () => {
    const { engine, folder, ada, connectAs } = await setup()
    const call = await connectAs(ada.id)
    const shot = join(folder, 'shot.png')
    writeFileSync(shot, 'png-bytes')

    const result = await call('chat_post', {
      channel: '#tech',
      text: 'this is the broken header',
      attachments: [shot],
    })

    expect(result.isError).toBe(false)
    expect(result.json()).toMatchObject({
      channel: '#tech',
      attachments: [{ name: 'shot.png', size: 9 }],
    })
    const [message] = engine.chat().read({ channelId: 'tech' })
    expect(readFileSync(join(folder, 'attachments', String(message!.id), 'shot.png'), 'utf8')).toBe('png-bytes')
  })

  it('lists what a message carries, with the path to read it at', async () => {
    const { folder, ada, connectAs } = await setup()
    const call = await connectAs(ada.id)
    writeFileSync(join(folder, 'run.log'), 'two failures\n')
    await call('chat_post', { channel: '#tech', text: 'the run', attachments: [join(folder, 'run.log')] })

    const read = (await call('chat_read', { channel: '#tech' })).json() as {
      messages: { text: string; attachments?: { name: string; path: string; size: number }[] }[]
    }

    const [attachment] = read.messages[0]!.attachments!
    expect(attachment).toMatchObject({ name: 'run.log', size: 13 })
    expect(readFileSync(attachment!.path, 'utf8')).toBe('two failures\n')
  })

  it('takes one from a worktree that is not inside the Company folder', async () => {
    const { engine, base, ada, connectAs } = await setup()
    // The repo holds the Company folder, so its worktrees are made beside it (decision 45).
    const repo = engine.repos.add({ path: base, name: 'app' })
    const ticket = engine.board().createTicket({ title: 'Header', assigneeId: ada.id, repos: [repo.id] })
    engine.board().moveTicket(ticket.id, 'doing')
    const [worktree] = engine.code.of(ticket.id).worktrees
    mkdirSync(worktree!.path, { recursive: true })
    writeFileSync(join(worktree!.path, 'after.png'), 'png')
    const call = await connectAs(ada.id)

    const result = await call('chat_post', {
      channel: '#tech',
      text: 'after the fix',
      attachments: [join(worktree!.path, 'after.png')],
    })

    expect(result.isError).toBe(false)
    expect(result.json()).toMatchObject({ attachments: [{ name: 'after.png' }] })
  })

  it('refuses a path outside the Company folder and its worktrees', async () => {
    const { base, ada, connectAs } = await setup()
    const call = await connectAs(ada.id)
    const elsewhere = join(base, 'secrets.txt')
    writeFileSync(elsewhere, 'nope')

    const result = await call('chat_post', { channel: '#tech', text: 'have a look', attachments: [elsewhere] })

    expect(result.isError).toBe(true)
    expect(result.text).toMatch(/is outside the Company/)
  })

  it('refuses a kind of file that is not allowed, and posts nothing', async () => {
    const { engine, folder, ada, connectAs } = await setup()
    const call = await connectAs(ada.id)
    writeFileSync(join(folder, 'run.sh'), '#!/bin/sh\n')

    const result = await call('chat_post', {
      channel: '#tech',
      text: 'run this',
      attachments: [join(folder, 'run.sh')],
    })

    expect(result.isError).toBe(true)
    expect(result.text).toMatch(/run\.sh is not a kind of file you can attach/)
    expect(engine.chat().read({ channelId: 'tech' })).toEqual([])
  })

  it('attaches on a thread reply as well', async () => {
    const { engine, folder, ada, connectAs } = await setup()
    const call = await connectAs(ada.id)
    const root = engine.chat().post({ authorId: 'boss', channelId: 'tech', text: 'what does it look like?' })
    writeFileSync(join(folder, 'after.png'), 'png')

    const result = await call('thread_reply', {
      message_id: root.id,
      text: 'like this',
      attachments: [join(folder, 'after.png')],
    })

    expect(result.isError).toBe(false)
    expect(result.json()).toMatchObject({ thread_id: root.id, attachments: [{ name: 'after.png' }] })
  })

  it('offers attachments on chat_post and thread_reply, and leaves a message without them alone', async () => {
    const { ada, connectAs } = await setup()
    const call = await connectAs(ada.id)

    const { tools } = await call.client.listTools()
    const takes = (name: string) =>
      Object.keys((tools.find((t) => t.name === name)!.inputSchema.properties ?? {}) as object)

    expect(takes('chat_post')).toContain('attachments')
    expect(takes('thread_reply')).toContain('attachments')
    const posted = await call('chat_post', { channel: '#tech', text: 'no files here' })
    expect(posted.json()).not.toHaveProperty('attachments')
  })
})
