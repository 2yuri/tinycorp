import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { afterEach, describe, expect, it } from 'vitest'
import { projectOffice } from '../../../shared/office/projection'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { type CompanyMcpServer, startCompanyMcpServer } from '../../core/engine/company-mcp-server'
import { inMemoryDatabases, inMemoryRecents, mcpTransport, onDisk } from '../../core/testing'
import { fakeProvider } from '../../providers/testing'

const cleanups: (() => unknown)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

describe('Office activity over MCP', () => {
  it('makes an Employee who calls chat_post Talking, on their way to the colleague they DMed', async () => {
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
    engine.sessions.start(ada.id)
    engine.sessions.start(grace.id)
    const { url, token } = provider.spawnOf(ada.id).mcp!
    const client = new Client({ name: 'employee', version: '0.0.0' })
    await client.connect(mcpTransport(url, { authorization: `Bearer ${token}` }))
    cleanups.push(() => client.close())

    const result = await client.callTool({ name: 'chat_post', arguments: { channel: '@Grace', text: 'PR is up' } })

    expect(result.isError ?? false).toBe(false)
    const office = projectOffice({ employees: engine.employees.list(), ...engine.office.facts() })
    const sprite = office.sprites.find((s) => s.employeeId === ada.id)!
    expect(sprite).toMatchObject({ state: 'talking', away: { place: 'desk' } })
    expect(sprite.away).toMatchObject(office.layout.seats[grace.desk]!.visitor)
  })
})
