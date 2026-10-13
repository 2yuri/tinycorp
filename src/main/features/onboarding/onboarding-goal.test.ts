import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BOSS } from '../../../shared/domain/chat'
import { rosterFromPreset, rosterHires } from '../../../shared/staff/roster-draft'
import { teamPreset } from '../../../shared/staff/team-presets'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { type CompanyMcpServer, startCompanyMcpServer } from '../../core/engine/company-mcp-server'
import { inMemoryDatabases, inMemoryRecents, mcpTransport, onDisk, readyStack } from '../../core/testing'
import { fakeProvider } from '../../providers/testing'
import { READY_DELAY_MS } from '../sessions/sessions'

const cleanups: (() => unknown)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  vi.useRealTimers()
})

async function setup() {
  let server: CompanyMcpServer | undefined
  const provider = fakeProvider()
  const engine: CompanyEngine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
    providers: { claude: provider },
    isGitRepo: () => true,
    mcpUrl: (companyId) => server!.urlFor(companyId),
    log: () => {},
  })
  provider.connect(engine.sessions.receiveHook)
  cleanups.push(() => engine.close())
  server = await startCompanyMcpServer(engine)
  cleanups.push(() => server!.close())
  engine.createCompany({ folder: onDisk('/work/tiny'), name: 'Tiny Corp' })
  engine.repos.add({ path: onDisk('/code/web-app'), stack: readyStack() })
  return { engine, provider }
}

async function connectAs(url: string, token: string) {
  const client = new Client({ name: 'employee', version: '0.0.0' })
  await client.connect(mcpTransport(url, { authorization: `Bearer ${token}` }))
  cleanups.push(() => client.close())
  return async (name: string, args: Record<string, unknown>) => {
    const result = (await client.callTool({ name, arguments: args })) as {
      isError?: boolean
      content: { text: string }[]
    }
    const text = result.content.map((c) => c.text).join('')
    if (result.isError) throw new Error(text)
    // biome-ignore lint/suspicious/noExplicitAny: an MCP tool answers JSON with no static shape; the assertions below are the check
    return JSON.parse(text) as any
  }
}

describe('The setup goal, as the intake holder sees it', () => {
  it('reaches the intake holder once its Session is idle, and plans into the board over MCP', async () => {
    const { engine, provider } = await setup()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    const outcome = engine.onboarding.finish({
      hires: rosterHires(rosterFromPreset(teamPreset('product-squad'), 'claude')),
      goal: 'Ship a checkout page that takes a card',
    })

    const hera = outcome.hired.find((e) => e.name === 'Hera')!
    const orion = outcome.hired.find((e) => e.name === 'Orion')!
    for (const employee of outcome.hired) provider.spawnOf(employee.id).hook('SessionStart', { source: 'startup' })
    vi.advanceTimersByTime(READY_DELAY_MS)
    vi.useRealTimers()

    const session = provider.spawnOf(hera.id)
    expect(session.pushed).toEqual([expect.stringContaining('Ship a checkout page that takes a card')])
    expect(session.pushed[0]).toContain('#general')
    expect(provider.spawnOf(orion.id).pushed).toEqual([])

    const call = await connectAs(session.mcp!.url, session.mcp!.token)
    session.hook('UserPromptSubmit')
    const dm = await call('chat_read', { channel: '@boss' })
    expect(dm.messages).toEqual([
      expect.objectContaining({ author: BOSS, text: expect.stringContaining('target, epics and tickets') }),
    ])

    await call('chat_post', { channel: '#general', text: 'Welcome, team! First up: checkout.' })
    const target = await call('target_create', { title: 'Checkout' })
    const epic = await call('epic_create', { title: 'Card payments', target_id: target.id })
    await call('ticket_create', { title: 'Card form', epic_id: epic.id, assignee: 'Ada', repos: ['web-app'] })

    expect(engine.chat().read({ channelId: 'general' })).toEqual([
      expect.objectContaining({ authorId: hera.id, text: 'Welcome, team! First up: checkout.' }),
    ])
    expect(engine.board().snapshot()).toMatchObject({
      targets: [{ title: 'Checkout' }],
      epics: [{ title: 'Card payments' }],
      tickets: [{ title: 'Card form', column: 'planning' }],
    })
  })
})
