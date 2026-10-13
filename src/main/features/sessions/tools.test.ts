import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { afterEach, describe, expect, it } from 'vitest'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { type CompanyMcpServer, startCompanyMcpServer } from '../../core/engine/company-mcp-server'
import { inMemoryDatabases, inMemoryRecents, mcpTransport, readyStack } from '../../core/testing'
import { createGitService } from '../../platform/git-service'
import { fakeProvider } from '../../providers/testing'

/**
 * The session tools over the real Company MCP server (T163): an Employee starts a Session of its
 * own with `session_start`, and that Session's token reaches `session_report` and nothing else —
 * one level deep is what the token can reach, not what the instructions ask.
 */

const cleanups: (() => unknown)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function setup() {
  const root = mkdtempSync(join(tmpdir(), 'session-tools-'))
  cleanups.push(() => rmSync(root, { recursive: true, force: true }))
  const repoPath = join(root, 'app')
  execFileSync('git', ['init', '--initial-branch=main', repoPath], { stdio: 'ignore' })
  writeFileSync(join(repoPath, 'README.md'), '# app\n')
  execFileSync('git', ['add', '-A'], { cwd: repoPath })
  execFileSync(
    'git',
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', 'commit', '-m', 'init'],
    { cwd: repoPath, stdio: 'ignore' },
  )
  const folder = join(root, 'company')
  mkdirSync(folder)

  let server: CompanyMcpServer | undefined
  const provider = fakeProvider()
  const engine: CompanyEngine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
    providers: { claude: provider },
    isGitRepo: () => true,
    git: createGitService(),
    mcpUrl: (companyId) => server!.urlFor(companyId),
    log: () => {},
  })
  cleanups.push(() => engine.close())
  server = await startCompanyMcpServer(engine)
  cleanups.push(() => server!.close())
  engine.createCompany({ folder, name: 'Acme' })
  const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
  const repo = engine.repos.add({ path: repoPath, name: 'app', stack: readyStack() })
  const board = engine.board()
  const ticket = board.createTicket({ title: 'Usage chart', assigneeId: ada.id, repos: [repo.id] })
  board.moveTicket(ticket.id, 'doing')
  engine.sessions.start(ada.id)
  const { url, token } = provider.spawnOf(ada.id).mcp!
  return { engine, provider, ada, ticket, asAda: await connect(url, token) }
}

async function connect(url: string, token: string) {
  const client = new Client({ name: 'employee', version: '0.0.0' })
  const transport = mcpTransport(url, { authorization: `Bearer ${token}` })
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
      return { isError: result.isError ?? false, text, json: () => JSON.parse(text) as Record<string, unknown> }
    },
  }
}

describe('Session tools', () => {
  it('lets an Employee start a Session of its own, in its own worktree', async () => {
    const { asAda, provider, ticket } = await setup()

    const started = await asAda.call('session_start', {
      name: 'tests',
      task: 'Write the chart tests',
      workspace: 'own',
      ticket_id: `#${ticket.id}`,
    })

    expect(started.isError).toBe(false)
    expect(started.json()).toMatchObject({ name: 'tests', state: 'starting', workspace: 'own', worktree_kept: true })
    expect(provider.subSpawnOf('tests').request.cwd).toBe(started.json()['path'])
  })

  it('gives a sub-session no tool that starts a Session, or chats, or touches the board', async () => {
    const { asAda, provider } = await setup()
    await asAda.call('session_start', { name: 'tests', task: 'Write the chart tests', workspace: 'shared' })
    const { url, token } = provider.subSpawnOf('tests').mcp!
    const asSub = await connect(url, token)

    const { tools } = await asSub.client.listTools()

    expect(tools.map((t) => t.name)).toEqual(['session_report'])
    const deeper = await asSub.call('session_start', { name: 'more', task: 'Go deeper', workspace: 'shared' })
    expect(deeper.isError).toBe(true)
    expect(provider.spawns).toHaveLength(2)
  })

  it('hands what a sub-session reports back to the Employee that started it', async () => {
    const { asAda, provider } = await setup()
    const { id } = (
      await asAda.call('session_start', { name: 'tests', task: 'Write tests', workspace: 'shared' })
    ).json()
    const { url, token } = provider.subSpawnOf('tests').mcp!
    const asSub = await connect(url, token)

    await asSub.call('session_report', { result: 'Added 12 tests.' })

    expect((await asAda.call('session_read', { id })).json()).toMatchObject({ id, result: 'Added 12 tests.' })
  })

  it('says why a sub-session cannot start, rather than starting one somewhere else', async () => {
    const { asAda } = await setup()

    const refused = await asAda.call('session_start', { name: 'x', task: 'y', workspace: 'own', ticket_id: 999 })

    expect(refused.isError).toBe(true)
    expect(refused.text).toMatch(/not a ticket you hold in Doing/)
  })

  it('serves the session tools to an Employee, and never session_report', async () => {
    const { asAda } = await setup()

    const names = (await asAda.client.listTools()).tools.map((tool) => tool.name)

    expect(names).toEqual(expect.arrayContaining(['session_start', 'session_read', 'session_stop']))
    expect(names).not.toContain('session_report')
  })
})
