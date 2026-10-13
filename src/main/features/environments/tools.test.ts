import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { afterEach, describe, expect, it } from 'vitest'
import { createRedactor } from '../../../shared/platform/redaction'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { type CompanyMcpServer, startCompanyMcpServer } from '../../core/engine/company-mcp-server'
import { inMemoryDatabases, inMemoryRecents, mcpTransport, onDisk, readyStack } from '../../core/testing'
import { memorySecrets } from '../../platform/secrets'
import { fakeGit } from '../../platform/testing'
import { fakeProvider } from '../../providers/testing'

/**
 * `env_run` as an Employee really reaches it (T176): over the Company's MCP server, on HTTP, with
 * the token its Session was given.
 *
 * What is asserted is what crosses the wire. A value must not be in the answer, in any form, ever
 * — not in the output, not in the variable list, not in the error when the boss says no.
 */

const cleanups: (() => unknown)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

const DATABASE_URL = 'postgres://app:h7fs8@db.internal:5432/billing'

async function setup() {
  let server: CompanyMcpServer | undefined
  const provider = fakeProvider()
  const engine: CompanyEngine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
    providers: { claude: provider },
    isGitRepo: () => true,
    git: fakeGit(),
    secrets: memorySecrets(),
    mcpUrl: (companyId) => server!.urlFor(companyId),
    log: () => {},
    async runCommand({ values }) {
      const redactor = createRedactor(values)
      const stdout = redactor.redact(`connecting with DATABASE_URL=${DATABASE_URL}\napplied 1 migration\n`)
      return {
        exitCode: 0,
        stdout,
        stderr: '',
        redacted: redactor.count,
        timedOut: false,
        cancelled: false,
        truncated: false,
      }
    },
  })
  cleanups.push(() => engine.close())
  server = await startCompanyMcpServer(engine)
  cleanups.push(() => server!.close())
  engine.createCompany({ folder: onDisk('/work/acme') })
  const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
  const billing = engine.repos.add({ path: onDisk('/code/billing'), name: 'billing-api', stack: readyStack() })
  const ticket = engine.board().createTicket({ title: 'Migration', assigneeId: ada.id, repos: [billing.id] })
  engine.board().moveTicket(ticket.id, 'doing')

  engine.sessions.start(ada.id)
  const { url, token } = provider.spawnOf(ada.id).mcp!
  const client = new Client({ name: 'employee', version: '0.0.0' })
  await client.connect(mcpTransport(url, { authorization: `Bearer ${token}` }))
  cleanups.push(() => client.close())

  async function call(name: string, args: Record<string, unknown>) {
    const result = (await client.callTool({ name, arguments: args })) as {
      isError?: boolean
      content: { type: string; text: string }[]
    }
    const text = result.content.map((part) => part.text).join('')
    return { isError: result.isError ?? false, text, json: () => JSON.parse(text) as Record<string, unknown> }
  }

  return { engine, client, call, ada, billing }
}

describe('env_run over the Company MCP server', () => {
  it('is one of the tools an Employee is given', async () => {
    const { client } = await setup()

    const { tools } = await client.listTools()

    expect(tools.map((tool) => tool.name)).toContain('env_run')
    expect(tools.find((tool) => tool.name === 'env_run')!.description).toMatch(/never see a value/i)
  })

  it('runs the command and answers with redacted output, never a value', async () => {
    const { engine, billing, call } = await setup()
    engine.environments.add({ environment: 'dev', name: 'DATABASE_URL', value: DATABASE_URL, repoIds: [billing.id] })

    const answer = await call('env_run', { command: 'pnpm db:migrate', environment: 'dev' })

    expect(answer.isError).toBe(false)
    expect(answer.text).not.toContain('h7fs8')
    expect(answer.json()).toMatchObject({
      status: 'ran',
      exit_code: 0,
      stdout: 'connecting with DATABASE_URL=‹DATABASE_URL›\napplied 1 migration\n',
      variables: ['DATABASE_URL'],
      redacted: 1,
    })
  })

  it('answers pending, with no output at all, when prod asks the boss first', async () => {
    const { engine, billing, call } = await setup()
    engine.environments.add({ environment: 'prod', name: 'DATABASE_URL', value: DATABASE_URL, repoIds: [billing.id] })

    const answer = await call('env_run', { command: 'pnpm db:migrate', environment: 'prod' })

    expect(answer.json()).toMatchObject({ status: 'pending', stdout: '' })
    expect(answer.text).not.toContain('h7fs8')
    expect(engine.approvals.list({ status: 'pending' }).at(-1)).toMatchObject({ action: 'env_run' })
  })

  it('runs it after the boss approves, and asks again for the next run', async () => {
    const { engine, billing, call } = await setup()
    engine.environments.add({ environment: 'prod', name: 'DATABASE_URL', value: DATABASE_URL, repoIds: [billing.id] })
    await call('env_run', { command: 'pnpm db:migrate', environment: 'prod' })
    engine.approvals.decide(engine.approvals.list({ status: 'pending' }).at(-1)!.id, { approve: true })

    const first = await call('env_run', { command: 'pnpm db:migrate', environment: 'prod' })
    const second = await call('env_run', { command: 'pnpm db:migrate', environment: 'prod' })

    expect(first.json()).toMatchObject({ status: 'ran' })
    expect(second.json()).toMatchObject({ status: 'pending' })
  })

  it('refuses a cwd outside the Employee’s worktrees, and says where it may run', async () => {
    const { engine, call } = await setup()
    engine.environments.add({ environment: 'dev', name: 'DATABASE_URL', value: DATABASE_URL })

    const answer = await call('env_run', { command: 'pnpm build', environment: 'dev', cwd: onDisk('/etc') })

    expect(answer.isError).toBe(true)
    expect(answer.text).toMatch(/not inside one of your worktrees/)
  })
})
