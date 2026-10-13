import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createRedactor } from '../../../shared/platform/redaction'
import { COMPANY_FILE, type OpenDatabase, openDatabaseFile } from '../../core/database'
import { type CompanyEngine, type CompanyEngineOptions, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryDatabases, inMemoryRecents, onDisk, readyStack, removeFolder } from '../../core/testing'
import { memorySecrets } from '../../platform/secrets'
import { fakeGit } from '../../platform/testing'
import { type FakeProvider, fakeProvider } from '../../providers/testing'
import { secretAccount } from './environments'

/**
 * Environments end to end (T176): what is stored, what an Employee can reach, and what the boss is
 * asked before prod runs.
 *
 * The tests that matter most are the ones about what is *not* here: no value in the database, no
 * value in the output, no variable an Employee's repo was not scoped to.
 */

const engines: CompanyEngine[] = []
const folders: string[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
  for (const folder of folders.splice(0)) removeFolder(folder)
})

const DATABASE_URL = 'postgres://app:h7fs8@db.internal:5432/billing'
const STRIPE_KEY = 'sk_live_9f2b7c1d4a'

function setup({
  openDatabase = inMemoryDatabases(),
  folder = onDisk('/work/acme'),
  output = 'done\n',
  providerRuntime,
  spawnRun,
  secretBackend,
}: {
  openDatabase?: OpenDatabase
  folder?: string
  output?: string
  providerRuntime?: CompanyEngineOptions['providerRuntime']
  spawnRun?: CompanyEngineOptions['spawnRun']
  secretBackend?: CompanyEngineOptions['secretBackend']
} = {}) {
  const secrets = memorySecrets()
  const provider: FakeProvider = fakeProvider()
  const ran: {
    command: string
    cwd: string
    runtime: { kind: string; distro?: string } | null
    values: { name: string; value: string }[]
  }[] = []
  const engine = createCompanyEngine({
    openDatabase,
    recents: inMemoryRecents(),
    providers: { claude: provider },
    isGitRepo: () => true,
    git: fakeGit(),
    secrets,
    mcpUrl: () => 'http://127.0.0.1/mcp',
    log: () => {},
    ...(providerRuntime && { providerRuntime }),
    ...(spawnRun && { spawnRun }),
    ...(secretBackend && { secretBackend }),
    // The runner is the seam: no test here spawns anything, and the values it was handed are what
    // the assertions are about.
    async runCommand({ command, cwd, values, runtime }) {
      ran.push({ command, cwd, runtime: runtime ?? null, values: values.map((value) => ({ ...value })) })
      // The real runner redacts what the command printed; this one does the same to fixed output,
      // so the assertion is about what reaches the Employee rather than about a spawn.
      const redactor = createRedactor(values)
      const stdout = redactor.redact(output)
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
  provider.connect(engine.sessions.receiveHook)
  engines.push(engine)
  const acme = engine.createCompany({ folder, name: 'Acme' })
  const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
  const billing = engine.repos.add({ path: onDisk('/code/billing'), name: 'billing-api', stack: readyStack() })
  const web = engine.repos.add({ path: onDisk('/code/web'), name: 'web-app', stack: readyStack() })

  function callerForAda() {
    if (engine.sessions.get(ada.id).status === 'off') engine.sessions.start(ada.id)
    const caller = engine.mcpCaller(acme.id, provider.spawnOf(ada.id).mcp!.token)
    if (!caller) throw new Error('Ada has no MCP caller')
    return caller
  }

  /** Ada on a ticket in `repos`, in Doing, so she has a worktree to run in. */
  function ticketInDoing(repos: string[] = [billing.id]) {
    const ticket = engine.board().createTicket({ title: 'Migration', assigneeId: ada.id, repos })
    engine.board().moveTicket(ticket.id, 'doing')
    return ticket
  }

  return { engine, secrets, acme, ada, billing, web, callerForAda, ticketInDoing, ran }
}

describe('Where a value lives', () => {
  it('never writes a value to the Company database, whatever the table holds', () => {
    const folder = mkdtempSync(join(tmpdir(), 'tinycorp-env-'))
    folders.push(folder)
    const { engine, billing } = setup({ openDatabase: openDatabaseFile, folder })

    engine.environments.add({ environment: 'prod', name: 'DATABASE_URL', value: DATABASE_URL, repoIds: [billing.id] })
    engine.environments.add({ environment: 'staging', name: 'STRIPE_SECRET_KEY', value: STRIPE_KEY })
    engine.environments.setAskEveryUse('staging', true)

    const bytes = readFileSync(join(folder, COMPANY_FILE))
    expect(bytes.includes(Buffer.from(DATABASE_URL))).toBe(false)
    expect(bytes.includes(Buffer.from(STRIPE_KEY))).toBe(false)
    // The name is in there, which is the point: the row says what exists, never what it is.
    expect(bytes.includes(Buffer.from('DATABASE_URL'))).toBe(true)
  })

  it('keeps the value in the secret store, under the Company and the environment', () => {
    const { engine, secrets, acme } = setup()

    engine.environments.add({ environment: 'prod', name: 'DATABASE_URL', value: DATABASE_URL })

    expect(secrets.read(acme.id, 'env:prod:DATABASE_URL')).toBe(DATABASE_URL)
    expect(JSON.stringify(engine.environments.variables())).not.toContain('postgres://')
  })

  it('keeps a short value, which the output then carries unredacted', () => {
    const { engine } = setup()

    engine.environments.add({ environment: 'dev', name: 'PORT', value: '3000' })

    expect(engine.environments.variables('dev').map((v) => v.name)).toEqual(['PORT'])
  })

  it('moves the value with the name when a variable is renamed, and leaves nothing behind', () => {
    const { engine, secrets, acme } = setup()
    const variable = engine.environments.add({ environment: 'prod', name: 'OLD_NAME', value: DATABASE_URL })

    engine.environments.update(variable.id, { name: 'DATABASE_URL' })

    expect(secrets.read(acme.id, 'env:prod:OLD_NAME')).toBeNull()
    expect(secrets.read(acme.id, 'env:prod:DATABASE_URL')).toBe(DATABASE_URL)
  })

  it('forgets the value when the variable is deleted', () => {
    const { engine, secrets, acme } = setup()
    const variable = engine.environments.add({ environment: 'prod', name: 'DATABASE_URL', value: DATABASE_URL })

    engine.environments.remove(variable.id)

    expect(secrets.read(acme.id, 'env:prod:DATABASE_URL')).toBeNull()
    expect(engine.environments.variables('prod')).toEqual([])
  })
})

describe('Which variables a run gets', () => {
  it('leaves out a variable the repo is not allowed to use', () => {
    const { engine, billing, web } = setup()
    engine.environments.add({ environment: 'dev', name: 'DATABASE_URL', value: DATABASE_URL, repoIds: [billing.id] })
    engine.environments.add({
      environment: 'dev',
      name: 'SENTRY_DSN',
      value: 'https://abc@sentry.io/42',
      repoIds: [web.id],
    })
    engine.environments.add({ environment: 'dev', name: 'SHARED_TOKEN', value: 'shared-value-1234' })

    const forBilling = engine.environments.valuesFor({ environment: 'dev', repoId: billing.id })

    expect(forBilling.map((value) => value.name)).toEqual(['DATABASE_URL', 'SHARED_TOKEN'])
  })

  it('gives a run outside any repo only the variables scoped to every repo', () => {
    const { engine, billing } = setup()
    engine.environments.add({ environment: 'dev', name: 'DATABASE_URL', value: DATABASE_URL, repoIds: [billing.id] })
    engine.environments.add({ environment: 'dev', name: 'SHARED_TOKEN', value: 'shared-value-1234' })

    expect(engine.environments.valuesFor({ environment: 'dev', repoId: null }).map((v) => v.name)).toEqual([
      'SHARED_TOKEN',
    ])
  })
})

describe('env_run', () => {
  it('runs in the Employee’s worktree with the environment’s values, and redacts the output', async () => {
    const { engine, billing, callerForAda, ticketInDoing, ran } = setup({
      output: `connecting with DATABASE_URL=${DATABASE_URL}\n✓ done\n`,
    })
    engine.environments.add({ environment: 'dev', name: 'DATABASE_URL', value: DATABASE_URL, repoIds: [billing.id] })
    const ticket = ticketInDoing()

    const result = await callerForAda().envRun({ command: 'pnpm db:migrate', environment: 'dev' })

    expect(result.status).toBe('ran')
    expect(result.stdout).toBe('connecting with DATABASE_URL=‹DATABASE_URL›\n✓ done\n')
    expect(result.stdout).not.toContain('postgres://')
    expect(result.redacted).toBe(1)
    expect(result.variables).toEqual(['DATABASE_URL'])
    expect(ran[0]!.cwd).toBe(engine.code.of(ticket.id).worktrees[0]!.path)
    expect(ran[0]!.values).toEqual([{ name: 'DATABASE_URL', value: DATABASE_URL }])
  })

  it('records who used the variable and when', async () => {
    const { engine, ada, billing, callerForAda, ticketInDoing } = setup()
    engine.environments.add({ environment: 'dev', name: 'DATABASE_URL', value: DATABASE_URL, repoIds: [billing.id] })
    ticketInDoing()

    await callerForAda().envRun({ command: 'pnpm db:migrate', environment: 'dev' })

    expect(engine.environments.variables('dev')[0]!.lastUsed).toMatchObject({ employeeId: ada.id })
  })

  it('takes the repo’s default environment when the Employee names none', async () => {
    const { engine, billing, callerForAda, ticketInDoing, ran } = setup()
    engine.environments.add({ environment: 'staging', name: 'DATABASE_URL', value: DATABASE_URL })
    engine.environments.setRepoDefault(billing.id, 'staging')
    ticketInDoing()

    const result = await callerForAda().envRun({ command: 'pnpm test:e2e' })

    expect(result.variables).toEqual(['DATABASE_URL'])
    expect(ran).toHaveLength(1)
  })

  it('runs inside the distro when the Employee’s Provider lives in WSL (T167)', async () => {
    const { engine, billing, callerForAda, ticketInDoing, ran } = setup({
      providerRuntime: () => ({ kind: 'wsl', distro: 'Ubuntu' }),
    })
    engine.environments.add({ environment: 'dev', name: 'DATABASE_URL', value: DATABASE_URL, repoIds: [billing.id] })
    ticketInDoing()

    await callerForAda().envRun({ command: 'pnpm db:migrate', environment: 'dev' })

    expect(ran[0]!.runtime).toEqual({ kind: 'wsl', distro: 'Ubuntu' })
  })

  it('runs on the host when the Provider is on it', async () => {
    const { engine, billing, callerForAda, ticketInDoing, ran } = setup()
    engine.environments.add({ environment: 'dev', name: 'DATABASE_URL', value: DATABASE_URL, repoIds: [billing.id] })
    ticketInDoing()

    await callerForAda().envRun({ command: 'pnpm db:migrate', environment: 'dev' })

    expect(ran[0]!.runtime).toBeNull()
  })

  it('refuses a cwd outside the Employee’s own worktrees', async () => {
    const { engine, billing, callerForAda, ticketInDoing } = setup()
    engine.environments.add({ environment: 'dev', name: 'DATABASE_URL', value: DATABASE_URL, repoIds: [billing.id] })
    ticketInDoing()

    await expect(
      callerForAda().envRun({ command: 'cat .env', environment: 'dev', cwd: onDisk('/code/billing') }),
    ).rejects.toThrow(/not inside one of your worktrees/)
  })

  it('says which worktree to name when the Employee has more than one', async () => {
    const { engine, billing, web, callerForAda } = setup()
    engine.environments.add({ environment: 'dev', name: 'DATABASE_URL', value: DATABASE_URL })
    const ticket = engine
      .board()
      .createTicket({ title: 'Both', assigneeId: engine.employees.list()[0]!.id, repos: [billing.id, web.id] })
    engine.board().moveTicket(ticket.id, 'doing')

    await expect(callerForAda().envRun({ command: 'pnpm build', environment: 'dev' })).rejects.toThrow(
      /you have 2 worktrees, so name cwd/i,
    )
  })
})

describe('env_run with an environment that asks first', () => {
  it('raises an approval card naming the command and the variables, and runs nothing yet', async () => {
    const { engine, billing, ada, callerForAda, ticketInDoing, ran } = setup()
    engine.environments.add({ environment: 'prod', name: 'DATABASE_URL', value: DATABASE_URL, repoIds: [billing.id] })
    ticketInDoing()

    const result = await callerForAda().envRun({ command: 'pnpm db:migrate', environment: 'prod' })

    expect(result.status).toBe('pending')
    expect(ran).toHaveLength(0)
    const approval = engine.approvals.list({ status: 'pending' }).at(-1)!
    expect(approval).toMatchObject({ action: 'env_run', requesterId: ada.id, subject: 'pnpm db:migrate with prod' })
    expect(approval.reason).toContain('DATABASE_URL')
  })

  it('runs the command once the boss approves, and asks again for the next one', async () => {
    const { engine, billing, callerForAda, ticketInDoing, ran } = setup()
    engine.environments.add({ environment: 'prod', name: 'DATABASE_URL', value: DATABASE_URL, repoIds: [billing.id] })
    ticketInDoing()
    await callerForAda().envRun({ command: 'pnpm db:migrate', environment: 'prod' })
    const approval = engine.approvals.list({ status: 'pending' }).at(-1)!

    engine.approvals.decide(approval.id, { approve: true })
    const after = await callerForAda().envRun({ command: 'pnpm db:migrate', environment: 'prod' })
    const again = await callerForAda().envRun({ command: 'pnpm db:migrate', environment: 'prod' })

    expect(after.status).toBe('ran')
    expect(ran).toHaveLength(1)
    expect(again.status).toBe('pending')
    expect(engine.approvals.list({ status: 'pending' })).toHaveLength(1)
  })

  it('tells the Employee why when the boss says no, and runs nothing', async () => {
    const { engine, billing, callerForAda, ticketInDoing, ran } = setup()
    engine.environments.add({ environment: 'prod', name: 'DATABASE_URL', value: DATABASE_URL, repoIds: [billing.id] })
    ticketInDoing()
    await callerForAda().envRun({ command: 'pnpm db:migrate', environment: 'prod' })
    const approval = engine.approvals.list({ status: 'pending' }).at(-1)!

    engine.approvals.decide(approval.id, { approve: false, reason: 'Not before the release.' })
    const denied = await callerForAda().envRun({ command: 'pnpm db:migrate', environment: 'prod' })

    expect(denied.status).toBe('denied')
    expect(denied.stderr).toContain('Not before the release.')
    expect(ran).toHaveLength(0)
  })

  it('asks once while the boss has not answered, however many times the Employee tries', async () => {
    const { engine, billing, callerForAda, ticketInDoing } = setup()
    engine.environments.add({ environment: 'prod', name: 'DATABASE_URL', value: DATABASE_URL, repoIds: [billing.id] })
    ticketInDoing()

    await callerForAda().envRun({ command: 'pnpm db:migrate', environment: 'prod' })
    await callerForAda().envRun({ command: 'pnpm db:migrate', environment: 'prod' })

    expect(engine.approvals.list({ status: 'pending' })).toHaveLength(1)
  })

  it('does not ask at all for an environment the boss turned the switch off for', async () => {
    const { engine, billing, callerForAda, ticketInDoing, ran } = setup()
    engine.environments.add({ environment: 'prod', name: 'DATABASE_URL', value: DATABASE_URL, repoIds: [billing.id] })
    engine.environments.setAskEveryUse('prod', false)
    ticketInDoing()

    const result = await callerForAda().envRun({ command: 'pnpm db:migrate', environment: 'prod' })

    expect(result.status).toBe('ran')
    expect(ran).toHaveLength(1)
    expect(engine.approvals.list({ status: 'pending' })).toHaveLength(0)
  })
})

describe('Import .env', () => {
  it('previews the keys, names none of the values, and unticks the public ones', () => {
    const { engine } = setup()
    engine.environments.add({ environment: 'staging', name: 'STRIPE_SECRET_KEY', value: 'sk_test_old_00000' })

    const preview = engine.environments.preview(
      'web-app/.env.local',
      'staging',
      [`DATABASE_URL=${DATABASE_URL}`, `STRIPE_SECRET_KEY=${STRIPE_KEY}`, 'NEXT_PUBLIC_APP_URL=https://x.example'].join(
        '\n',
      ),
    )

    expect(preview.keys.map((key) => [key.name, key.chosen, key.note])).toEqual([
      ['DATABASE_URL', true, 'new'],
      ['STRIPE_SECRET_KEY', true, 'replaces staging’s'],
      ['NEXT_PUBLIC_APP_URL', false, 'new'],
    ])
    expect(JSON.stringify(preview)).not.toContain(STRIPE_KEY)
  })

  it('imports only the chosen keys, straight into the secret store', () => {
    const { engine, secrets, acme } = setup()

    engine.environments.importKeys('staging', [
      { name: 'DATABASE_URL', value: DATABASE_URL },
      { name: 'STRIPE_SECRET_KEY', value: STRIPE_KEY },
    ])

    expect(engine.environments.variables('staging').map((v) => v.name)).toEqual(['DATABASE_URL', 'STRIPE_SECRET_KEY'])
    expect(secrets.read(acme.id, 'env:staging:DATABASE_URL')).toBe(DATABASE_URL)
  })

  it('replaces the value of a key the environment already holds, and keeps its scope', () => {
    const { engine, secrets, acme, billing } = setup()
    engine.environments.add({
      environment: 'staging',
      name: 'DATABASE_URL',
      value: 'postgres://old:pass@db/x',
      repoIds: [billing.id],
    })

    engine.environments.importKeys('staging', [{ name: 'DATABASE_URL', value: DATABASE_URL }])

    expect(engine.environments.variables('staging')).toHaveLength(1)
    expect(engine.environments.variables('staging')[0]!.repoIds).toEqual([billing.id])
    expect(secrets.read(acme.id, 'env:staging:DATABASE_URL')).toBe(DATABASE_URL)
  })
})

describe('Testing and checks', () => {
  it('hands Run it the repo’s values, and redacts them out of the Log pane', async () => {
    const started: { command: string; values: { name: string; value: string }[] }[] = []
    let printed: ((chunk: string) => void) | null = null
    let ended: ((code: number | null) => void) | null = null
    const { engine, billing, ada } = setup({
      spawnRun({ command, values = [] }) {
        started.push({ command, values: values.map((value) => ({ ...value })) })
        return {
          onOutput: (listener) => {
            printed = listener
          },
          onExit: (listener) => {
            ended = listener
          },
          kill: () => {},
        }
      },
    })
    engine.environments.add({
      environment: 'staging',
      name: 'DATABASE_URL',
      value: DATABASE_URL,
      repoIds: [billing.id],
    })
    engine.environments.setRepoDefault(billing.id, 'staging')
    engine.tests.setRepo(billing.id, { runCommand: 'pnpm dev', port: 3000 })
    const ticket = engine.board().createTicket({ title: 'Migration', assigneeId: ada.id, repos: [billing.id] })
    engine.board().moveTicket(ticket.id, 'doing')

    engine.appRuns.start({ ticketId: ticket.id, repoId: billing.id, actorId: ada.id })
    printed!(`listening with DATABASE_URL=${DATABASE_URL}\n`)
    ended!(0)

    expect(started[0]!.values).toEqual([{ name: 'DATABASE_URL', value: DATABASE_URL }])
    const log = engine.appRuns.log(ticket.id, billing.id).join('\n')
    expect(log).toBe('listening with DATABASE_URL=\u2039DATABASE_URL\u203a')
    expect(log).not.toContain('h7fs8')
  })

  it('hands Run it nothing when the environment is not available to checks', () => {
    const started: { values: { name: string; value: string }[] }[] = []
    const { engine, billing, ada } = setup({
      spawnRun({ values = [] }) {
        started.push({ values: values.map((value) => ({ ...value })) })
        return { onOutput: () => {}, onExit: () => {}, kill: () => {} }
      },
    })
    engine.environments.add({ environment: 'prod', name: 'DATABASE_URL', value: DATABASE_URL })
    engine.environments.setRepoDefault(billing.id, 'prod')
    engine.environments.setAvailableToChecks('prod', false)
    engine.tests.setRepo(billing.id, { runCommand: 'pnpm dev', port: 3000 })
    const ticket = engine.board().createTicket({ title: 'Migration', assigneeId: ada.id, repos: [billing.id] })
    engine.board().moveTicket(ticket.id, 'doing')

    engine.appRuns.start({ ticketId: ticket.id, repoId: billing.id, actorId: ada.id })

    expect(started[0]!.values).toEqual([])
  })

  it('hands a repo’s default environment to them when it is available to checks', () => {
    const { engine, billing } = setup()
    engine.environments.setRepoDefault(billing.id, 'staging')

    expect(engine.environments.forChecks(billing.id)).toEqual({ environment: 'staging', repoId: billing.id })
  })

  it('hands them nothing when the environment is not available to checks', () => {
    const { engine, billing } = setup()
    engine.environments.setRepoDefault(billing.id, 'prod')
    engine.environments.setAvailableToChecks('prod', false)

    expect(engine.environments.forChecks(billing.id)).toBeNull()
  })

  it('hands them nothing when the repo has no default environment', () => {
    const { engine, web } = setup()

    expect(engine.environments.forChecks(web.id)).toBeNull()
  })
})

describe('What the boss is told when a value has gone', () => {
  /**
   * The sentence named a Mac's keychain on every platform (T218): a boss on Windows was told to
   * look in a store their machine does not have, and a Linux desktop keeps this in a keyring.
   * The words come from the backend the app really picked, so there is one of these per store.
   */
  const stores = [
    ['keychain', 'the macOS keychain'],
    ['dpapi', 'this Windows account’s encrypted store'],
    ['libsecret', 'this desktop’s keyring'],
  ] as const

  for (const [backend, named] of stores) {
    it(`names ${named} on a machine whose store is ${backend}`, () => {
      const { engine, secrets, acme } = setup({ secretBackend: () => backend })
      const added = engine.environments.add({ environment: 'prod', name: 'DATABASE_URL', value: DATABASE_URL })
      // The value was set on another machine, or the item was removed from under the app.
      secrets.forget(acme.id, secretAccount('prod', 'DATABASE_URL'))

      expect(() => engine.environments.reveal(added.id)).toThrowError(named)
      for (const [, other] of stores.filter(([id]) => id !== backend)) {
        expect(() => engine.environments.reveal(added.id)).not.toThrowError(other)
      }
    })
  }

  it('names the Mac’s keychain when nothing said which store this is', () => {
    const { engine, secrets, acme } = setup()
    const added = engine.environments.add({ environment: 'prod', name: 'DATABASE_URL', value: DATABASE_URL })
    secrets.forget(acme.id, secretAccount('prod', 'DATABASE_URL'))

    expect(() => engine.environments.reveal(added.id)).toThrowError('the macOS keychain')
  })
})
