import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { afterEach, describe, expect, it } from 'vitest'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { type CompanyMcpServer, startCompanyMcpServer, toolGroupsFor } from '../../core/engine/company-mcp-server'
import { inMemoryDatabases, inMemoryNotesFiles, inMemoryRecents, mcpTransport, onDisk } from '../../core/testing'
import { fakeProvider } from '../../providers/testing'

/**
 * An Employee's own notes over MCP (T193): the five tools, as the Employee really reaches them.
 *
 * The one that matters most is the refusal — a note over 280 bytes is turned away with the limit
 * in it — because that is where T73 went wrong in the other direction: its cap was on the whole
 * file, so hitting it meant deleting something. Here the cap is on one line and the answer is
 * *write two*.
 */

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
    notesFiles: inMemoryNotesFiles(),
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

  return { engine, ada, grace, connectAs }
}

describe('note', () => {
  it('appends a line and answers with the id the log gave it', async () => {
    const { ada, connectAs } = await setup()
    const call = await connectAs(ada.id)

    expect((await call('note', { text: 'billing-api migrations are named <area>-<what>' })).json()).toMatchObject({
      status: 'noted',
      id: 0,
    })
    expect((await call('note', { text: 'web-app vitest needs --pool=threads here' })).json()).toMatchObject({ id: 1 })
  })

  it('refuses a note over 280 bytes, with the limit and what to do instead', async () => {
    const { ada, connectAs } = await setup()
    const call = await connectAs(ada.id)

    const refused = await call('note', { text: 'x'.repeat(281) })

    expect(refused.isError).toBe(true)
    expect(refused.text).toContain('at most 280 bytes and that one is 281')
    expect(refused.text).toContain('Split it into two notes')
  })

  it('names the summary that is due, one at a time, and says when to write it', async () => {
    const { ada, connectAs } = await setup()
    const call = await connectAs(ada.id)

    for (let at = 0; at < 7; at++) await call('note', { text: `note ${at}` })
    expect((await call('note', { text: 'note 7' })).json()['due']).toContain('#0–7')
    expect((await call('note', { text: 'note 7' })).json()['due']).toContain('at your next turn boundary')
  })

  it('is one Employee’s own: what Ada writes, Grace cannot recall', async () => {
    const { ada, grace, connectAs } = await setup()
    const asAda = await connectAs(ada.id)
    const asGrace = await connectAs(grace.id)

    await asAda('note', { text: 'the e2e seed is flaky on Mondays' })

    expect((await asGrace('recall', { pattern: 'flaky' })).json()).toMatchObject({ total: 0 })
    expect((await asAda('recall', { pattern: 'flaky' })).json()).toMatchObject({ total: 1 })
  })
})

describe('recall', () => {
  it('searches every note word for word, and takes a regular expression', async () => {
    const { ada, connectAs } = await setup()
    const call = await connectAs(ada.id)
    await call('note', { text: 'web-app vitest needs --pool=threads' })
    await call('note', { text: 'billing-api uses its own runner' })

    const found = (await call('recall', { pattern: 'vitest|runner' })).json()

    expect(found['total']).toBe(2)
  })

  it('says what the regular expression engine said rather than answering nothing', async () => {
    const { ada, connectAs } = await setup()
    const call = await connectAs(ada.id)

    const refused = await call('recall', { pattern: '(' })

    expect(refused.isError).toBe(true)
    expect(refused.text).toContain('not a regular expression')
  })
})

describe('zoom, nap and forget', () => {
  it('writes a summary, and stops naming it as due', async () => {
    const { ada, connectAs } = await setup()
    const call = await connectAs(ada.id)
    for (let at = 0; at < 8; at++) await call('note', { text: `note ${at}` })

    const napped = (await call('nap', { range: '#0-7', summary: 'the first eight notes' })).json()

    expect(napped).toMatchObject({ status: 'summarised', range: '#0–7' })
    expect(napped['due']).toBeUndefined()
  })

  it('refuses a range that is not one a summary covers, and says what one looks like', async () => {
    const { ada, connectAs } = await setup()
    const call = await connectAs(ada.id)
    for (let at = 0; at < 8; at++) await call('note', { text: `note ${at}` })

    const refused = await call('nap', { range: '#1-8', summary: 'eight of them' })

    expect(refused.isError).toBe(true)
    expect(refused.text).toContain('starts on its own multiple')
  })

  it('opens a range into the notes themselves at the leaf, and into halves above it', async () => {
    const { ada, connectAs } = await setup()
    const call = await connectAs(ada.id)
    for (let at = 0; at < 16; at++) await call('note', { text: `note ${at}` })

    const leaf = (await call('zoom', { range: '#0-7' })).json()
    const above = (await call('zoom', { range: '#0-15' })).json()

    expect(leaf['notes']).toHaveLength(8)
    expect(above['halves']).toEqual([
      { range: '#0–7', summary: null },
      { range: '#8–15', summary: null },
    ])
  })

  it('forgets a summary and not one note under it', async () => {
    const { ada, connectAs } = await setup()
    const call = await connectAs(ada.id)
    for (let at = 0; at < 8; at++) await call('note', { text: `note ${at}` })
    await call('nap', { range: '#0-7', summary: 'the first eight notes' })

    expect((await call('forget', { range: '#0-7' })).json()).toMatchObject({ status: 'forgotten' })
    expect((await call('zoom', { range: '#0-7' })).json()['notes']).toHaveLength(8)
    expect((await call('forget', { range: '#0-7' })).json()).toMatchObject({ status: 'nothing to forget' })
  })
})

describe('what a sub-session may do', () => {
  /**
   * A Session an Employee started of its own writes no notes — the same rule that keeps a model
   * out of the Company memory. It is enforced by what its token reaches, not by asking it nicely,
   * so the check is on the tool groups rather than on a sentence in a prompt.
   */
  it('is its report and nothing else: it has no note, recall, zoom, nap or forget', () => {
    const registered = (groups: ReturnType<typeof toolGroupsFor>) => {
      const names: string[] = []
      for (const group of groups) {
        group(
          {
            registerTool(name: string) {
              names.push(name)
            },
            // The recorder is a stand-in for the server: registering touches neither it nor the caller.
          } as never,
          {} as never,
        )
      }
      return names
    }

    const sub = registered(toolGroupsFor({ subSession: { id: 'sub-1', report: () => ({}) as never } }))
    const employee = registered(toolGroupsFor({ subSession: null }))

    expect(sub).toEqual(['session_report'])
    for (const tool of ['note', 'recall', 'zoom', 'nap', 'forget']) {
      expect(sub).not.toContain(tool)
      expect(employee).toContain(tool)
    }
  })

  it('leaves `notes_write` behind: the file it wrote is gone, and so is the tool', async () => {
    const { ada, connectAs } = await setup()
    const call = await connectAs(ada.id)

    const gone = await call('notes_write', { content: 'everything I know' })

    expect(gone.isError).toBe(true)
  })
})
