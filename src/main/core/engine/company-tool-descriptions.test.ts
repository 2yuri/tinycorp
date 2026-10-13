import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { afterEach, describe, expect, it } from 'vitest'
import { fakeProvider } from '../../providers/testing'
import { inMemoryDatabases, inMemoryRecents, mcpTransport, onDisk } from '../testing'
import { type CompanyEngine, createCompanyEngine } from './company-engine'
import { type CompanyMcpServer, startCompanyMcpServer } from './company-mcp-server'

/**
 * What a Session is really told about the Company's tools (T195). The instructions used to list
 * every tool with the first sentence of its description, which the MCP client already sends with
 * the name and the schema; the list is gone, so the description on the server is the only place a
 * tool says what it is for, and a tool registered without one is a tool nobody can use on purpose.
 */

const cleanups: (() => unknown)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

describe('Every Company tool the MCP server serves', () => {
  it('carries a description, because that is the only place it says what it is for', async () => {
    const { tools } = await served()

    expect(tools.length).toBeGreaterThan(20)
    for (const tool of tools) {
      const description = (tool.description ?? '').trim()
      expect(description, `\`${tool.name}\` is registered without a description`).not.toBe('')
      // A first sentence a model can act on: it ends, and it says more than the name already does.
      expect(description, `\`${tool.name}\` has no sentence to read`).toMatch(/\.$/)
      expect(firstSentence(description), `\`${tool.name}\` says nothing its name does not`).not.toBe(
        tool.name.replace(/_/g, ' '),
      )
      expect(tool.inputSchema, `\`${tool.name}\` is registered without an input schema`).toBeDefined()
    }
  })

  it('has a tool for every family the instructions send an Employee to (T195)', async () => {
    const { tools, instructions } = await served()
    const names = tools.map((tool) => tool.name)

    const families = [...instructions.matchAll(/`(\w+_)`/g)].map((match) => match[1] as string)

    expect(families).toEqual(expect.arrayContaining(['chat_', 'plan_', 'review_', 'test_', 'session_', 'memory_']))
    for (const family of families) {
      expect(
        names.some((name) => name.startsWith(family)),
        `no tool is called \`${family}…\``,
      ).toBe(true)
    }
    // And the tools the section names in full, including the Employee's own notes (T193).
    for (const name of ['thread_reply', 'board_list', 'note', 'recall', 'zoom', 'nap', 'approval_request']) {
      expect(names, `the instructions name \`${name}\``).toContain(name)
    }
  })
})

/** The first sentence of a description, flattened onto one line. */
function firstSentence(description: string | undefined): string {
  const flat = (description ?? '').replace(/\s+/g, ' ').trim()
  const end = flat.search(/\.(\s|$)/)
  return end === -1 ? flat : flat.slice(0, end + 1)
}

/** The tools an Employee's own token reaches, and the instructions that Session was started on. */
async function served() {
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
  engine.sessions.start(ada.id)
  const spawn = provider.spawnOf(ada.id)
  const client = new Client({ name: 'employee', version: '0.0.0' })
  await client.connect(mcpTransport(spawn.mcp!.url, { authorization: `Bearer ${spawn.mcp!.token}` }))
  cleanups.push(() => client.close())
  return { tools: (await client.listTools()).tools, instructions: spawn.instructions?.text ?? '' }
}
