import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { afterEach, describe, expect, it } from 'vitest'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { type CompanyMcpServer, startCompanyMcpServer } from '../../core/engine/company-mcp-server'
import { inMemoryDatabases, inMemoryNotesFiles, inMemoryRecents, mcpTransport, onDisk } from '../../core/testing'
import { fakeProvider } from '../../providers/testing'
import { inMemoryPageFiles } from './company-memory-files'

const cleanups: (() => unknown)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

/** An engine whose Company memory is a folder in this process, and its MCP server over HTTP. */
async function setup() {
  let server: CompanyMcpServer | undefined
  const provider = fakeProvider()
  const pages = inMemoryPageFiles()
  const engine: CompanyEngine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
    providers: { claude: provider },
    mcpUrl: (companyId) => server!.urlFor(companyId),
    notesFiles: inMemoryNotesFiles(),
    memoryPages: () => pages,
  })
  cleanups.push(() => engine.close())
  server = await startCompanyMcpServer(engine)
  cleanups.push(() => server!.close())
  engine.createCompany({ folder: onDisk('/work/acme') })
  const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
  const grace = engine.employees.create({ name: 'Grace', roleId: 'frontend' })

  async function connectAs(employeeId: string) {
    engine.sessions.start(employeeId)
    const { url, token } = provider.spawnOf(employeeId).mcp!
    const client = new Client({ name: 'employee', version: '0.0.0' })
    await client.connect(mcpTransport(url, { authorization: `Bearer ${token}` }))
    cleanups.push(() => client.close())
    return async (name: string, args: Record<string, unknown>) => {
      const result = (await client.callTool({ name, arguments: args })) as {
        isError?: boolean
        content: { type: string; text: string }[]
      }
      const text = result.content.map((part) => part.text).join('')
      return { isError: result.isError ?? false, text, json: () => JSON.parse(text) as Record<string, unknown> }
    }
  }

  return { engine, provider, pages, ada, grace, connectAs }
}

describe('the Company memory over MCP', () => {
  it('is one memory: what Ada writes, Grace searches and reads', async () => {
    const { ada, grace, connectAs } = await setup()
    const asAda = await connectAs(ada.id)
    const asGrace = await connectAs(grace.id)

    const written = await asAda('memory_write', {
      kind: 'decision',
      title: 'Locale handling in billing',
      body: 'Money is stored in minor units and formatted once, at the edge.',
      sources: ['ticket:TC-142', 'pr:billing-api#88'],
      repos: ['billing-api'],
    })
    expect(written.isError).toBe(false)
    expect(written.json()).toMatchObject({
      status: 'saved',
      slug: 'locale-handling-in-billing',
      path: 'memory/company/decisions/locale-handling-in-billing.md',
    })

    const found = await asGrace('memory_search', { query: 'minor units' })
    expect(found.json()['pages']).toEqual([
      expect.objectContaining({ slug: 'locale-handling-in-billing', kind: 'decision', updated_by: 'Ada' }),
    ])
    // A search returns titles, never bodies: a Session reads only what it asks for.
    expect(found.text).not.toContain('minor units and formatted')

    const read = await asGrace('memory_read', { slug: 'locale-handling-in-billing' })
    expect(read.json()).toMatchObject({
      body: 'Money is stored in minor units and formatted once, at the edge.',
      sources: ['ticket:TC-142', 'pr:billing-api#88'],
    })
  })

  it('appends by default and replaces when asked', async () => {
    const { ada, connectAs } = await setup()
    const call = await connectAs(ada.id)
    await call('memory_write', { kind: 'gotcha', title: 'Vitest hangs', body: 'First.' })
    await call('memory_write', { kind: 'gotcha', title: 'Vitest hangs', body: 'Second.' })
    expect((await call('memory_read', { slug: 'vitest-hangs' })).json()['body']).toBe('First.\n\nSecond.')

    await call('memory_write', { kind: 'gotcha', title: 'Vitest hangs', body: 'Only this.', mode: 'replace' })
    expect((await call('memory_read', { slug: 'vitest-hangs' })).json()['body']).toBe('Only this.')
  })

  it('links two pages both ways', async () => {
    const { ada, connectAs } = await setup()
    const call = await connectAs(ada.id)
    await call('memory_write', { kind: 'decision', title: 'Locale handling', body: 'A.' })
    await call('memory_write', { kind: 'convention', title: 'Currency defaults', body: 'B.' })
    expect((await call('memory_link', { a: 'locale-handling', b: 'currency-defaults' })).isError).toBe(false)
    expect((await call('memory_read', { slug: 'currency-defaults' })).json()['links']).toEqual(['locale-handling'])
  })

  it('answers an unknown page and a bad write with a message, not a crash', async () => {
    const { ada, connectAs } = await setup()
    const call = await connectAs(ada.id)
    const missing = await call('memory_read', { slug: 'nothing-here' })
    expect(missing.isError).toBe(true)
    expect(missing.text).toContain('no memory page')

    const empty = await call('memory_write', { kind: 'decision', title: 'Fine', body: '   ' })
    expect(empty.isError).toBe(true)
    expect(empty.text).toContain('needs a body')
  })

  it('refuses to let an Employee compose a Handoff: the app writes those', async () => {
    const { ada, connectAs } = await setup()
    const call = await connectAs(ada.id)
    const refused = await call('memory_write', { kind: 'handoff', title: 'Ada to Codex', body: 'Mine now.' })
    expect(refused.isError).toBe(true)
    expect(refused.text).toContain('written by the app')
  })

  it('puts the shared pages in the next Session’s instructions as titles, not bodies', async () => {
    const { engine, provider, ada, connectAs } = await setup()
    const call = await connectAs(ada.id)
    await call('memory_write', {
      kind: 'decision',
      title: 'Locale handling in billing',
      body: 'A very long body nobody should have to carry at spawn.',
    })

    engine.sessions.stop(ada.id)
    engine.sessions.start(ada.id)
    const text = provider.spawnOf(ada.id).instructions!.text
    expect(text).toContain('## The Company memory')
    expect(text).toContain('`locale-handling-in-billing` — Locale handling in billing (decision)')
    expect(text).not.toContain('A very long body nobody should have to carry')
    expect(text).toMatch(/Search it before you start a ticket/)
  })

  it('tells a Company with nothing written yet that it is first', async () => {
    const { engine, provider, ada } = await setup()
    engine.sessions.start(ada.id)
    expect(provider.spawnOf(ada.id).instructions!.text).toContain('Nothing is written yet. You may be the first.')
  })
})
