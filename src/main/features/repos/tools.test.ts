import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { afterEach, describe, expect, it } from 'vitest'
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
    isGitRepo: () => true,
    mcpUrl: (companyId) => server!.urlFor(companyId),
  })
  cleanups.push(() => engine.close())
  server = await startCompanyMcpServer(engine)
  cleanups.push(() => server!.close())
  engine.createCompany({ folder: onDisk('/work/acme') })
  const web = engine.repos.add({
    path: onDisk('/code/web'),
    name: 'web',
    brief: 'A new storefront; you pick the stack.',
    stack: { language: 'TypeScript', lint: 'eslint .' },
  })
  const ada = engine.employees.create({ name: 'Ada', roleId: 'frontend' })

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
      return { isError: result.isError ?? false, text: result.content.map((c) => c.text).join('') }
    }
  }

  return { engine, provider, web, ada, connectAs }
}

describe('repo_set_checks over MCP', () => {
  it('sets only the fields given, keeps the rest and the brief, and posts a note in #tech', async () => {
    const { engine, web, ada, connectAs } = await setup()
    const changed: number[] = []
    engine.onRepoChecksSet(() => changed.push(1))
    const call = await connectAs(ada.id)

    const result = await call('repo_set_checks', {
      repo: 'web',
      packageManager: 'pnpm',
      install: 'pnpm install',
      test: 'pnpm vitest run',
    })

    expect(result.isError).toBe(false)
    expect(engine.repos.list()).toEqual([
      {
        ...web,
        stack: {
          ...web.stack,
          packageManager: 'pnpm',
          install: 'pnpm install',
          test: 'pnpm vitest run',
        },
      },
    ])
    expect(engine.repos.list()[0]).toMatchObject({
      brief: 'A new storefront; you pick the stack.',
      stack: { language: 'TypeScript', lint: 'eslint .', build: '' },
    })
    const note = engine.chat().read({ channelId: 'tech' }).at(-1)
    expect(note).toMatchObject({ authorId: ada.id })
    expect(note!.text).toContain('web')
    expect(note!.text).toContain('test `pnpm vitest run`')
    expect(changed).toHaveLength(1)
  })

  it('turns the No checks yet line into the checks in the next instructions', async () => {
    const { engine, provider, web, ada, connectAs } = await setup()
    engine.repos.update(web.id, { stack: { lint: '' } })
    const call = await connectAs(ada.id)
    expect(provider.spawnOf(ada.id).instructions!.text).toContain('No checks yet')

    await call('repo_set_checks', { repo: 'web', build: 'pnpm build' })
    engine.sessions.stop(ada.id)
    engine.sessions.start(ada.id)

    const text = provider.spawnOf(ada.id).instructions!.text
    expect(text).toContain(
      '**web** (yours): TypeScript. Checks, run inside the worktree before opening a PR: build `pnpm build`.',
    )
    expect(text).toContain('> A new storefront; you pick the stack.')
  })

  it('refuses an unknown repo and an empty change, and changes nothing', async () => {
    const { engine, web, ada, connectAs } = await setup()
    const call = await connectAs(ada.id)

    const unknown = await call('repo_set_checks', { repo: 'api', test: 'go test' })
    const empty = await call('repo_set_checks', { repo: 'web' })

    expect(unknown).toMatchObject({ isError: true, text: expect.stringMatching(/No repo is called api/) })
    expect(empty).toMatchObject({ isError: true, text: expect.stringMatching(/at least one/) })
    expect(engine.repos.list()).toEqual([web])
  })
})
