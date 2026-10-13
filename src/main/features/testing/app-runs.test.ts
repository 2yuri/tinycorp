import { afterEach, describe, expect, it, vi } from 'vitest'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryDatabases, inMemoryRecents, onDisk, readyStack } from '../../core/testing'
import { fakeGit } from '../../platform/testing'
import { fakeProvider } from '../../providers/testing'
import type { SpawnRun } from './app-runs'

const engines: CompanyEngine[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
})

/** Every `Run it` the engine asked for, without ever starting a process. */
function fakeCommands() {
  const started: {
    command: string
    cwd: string
    runtime: { kind: string } | null
    killed: boolean
    say(line: string): void
    leave(code: number | null): void
  }[] = []
  const spawnRun: SpawnRun = ({ command, cwd, runtime }) => {
    let output: (chunk: string) => void = () => {}
    let exit: (code: number | null) => void = () => {}
    const entry = {
      command,
      cwd,
      runtime: runtime ?? null,
      killed: false,
      say: (line: string) => output(`${line}\n`),
      leave: (code: number | null) => exit(code),
    }
    started.push(entry)
    return {
      onOutput: (listener) => {
        output = listener
      },
      onExit: (listener) => {
        exit = listener
      },
      kill: () => {
        entry.killed = true
        exit(null)
      },
    }
  }
  return { started, spawnRun }
}

/** A Company with a ticket in Testing, its web app runnable on 5173. */
async function setup(teamRuntime?: () => { kind: 'wsl'; distro: string }) {
  const commands = fakeCommands()
  const provider = fakeProvider()
  const git = fakeGit()
  const engine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
    providers: { claude: provider },
    isGitRepo: () => true,
    git,
    mcpUrl: () => 'http://127.0.0.1/mcp',
    spawnRun: commands.spawnRun,
    // Where the team runs, which is what `Run it` starts in (T259). Every other test here leaves it
    // out and gets this machine, which is what a Mac and a Windows with the team on Windows have.
    ...(teamRuntime && { teamRuntime }),
    log: () => {},
  })
  provider.connect(engine.sessions.receiveHook)
  engines.push(engine)
  engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
  const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
  const web = engine.repos.add({ path: onDisk('/code/web'), name: 'web', stack: readyStack() })
  const api = engine.repos.add({ path: onDisk('/code/api'), name: 'api', stack: readyStack() })
  engine.tests.setMode('you')
  engine.tests.setRepo(web.id, { runCommand: 'pnpm dev', port: 5173 })
  const board = () => engine.board()

  async function inTesting(repos: string[] = [web.id]) {
    const ticket = board().createTicket({ title: 'Usage chart', assigneeId: ada.id, repos })
    board().moveTicket(ticket.id, 'doing')
    board().moveTicket(ticket.id, 'review')
    await vi.waitFor(() => expect(engine.reviews.of(ticket.id)).not.toBeNull())
    engine.reviews.approve(ticket.id)
    return ticket
  }

  return { engine, commands, web, api, board, inTesting }
}

describe('Run it', () => {
  it('starts nothing by itself: a ticket enters Testing with its app not running', async () => {
    const { engine, commands, inTesting } = await setup()

    const ticket = await inTesting()

    expect(commands.started).toEqual([])
    expect(engine.appRuns.runnable(ticket.id)).toEqual([
      expect.objectContaining({ command: 'pnpm dev', port: 5173, url: 'http://localhost:5173', run: null }),
    ])
  })

  it('runs the repo’s command in the ticket’s worktree, and keeps its output', async () => {
    const { engine, commands, web, inTesting } = await setup()
    const ticket = await inTesting()

    const run = engine.appRuns.start({ ticketId: ticket.id, repoId: web.id, actorId: 'boss' })

    expect(run).toMatchObject({ command: 'pnpm dev', state: 'running', url: 'http://localhost:5173' })
    expect(run.cwd).toBe(engine.code.of(ticket.id).worktrees[0]!.path)
    expect(commands.started[0]).toMatchObject({ command: 'pnpm dev', cwd: run.cwd })

    commands.started[0]!.say('VITE v5.4 ready in 412 ms')
    commands.started[0]!.say('  Local: http://localhost:5173/billing')

    // The log keeps the line as the command wrote it, indentation and all.
    expect(engine.appRuns.log(ticket.id, web.id)).toEqual([
      'VITE v5.4 ready in 412 ms',
      '  Local: http://localhost:5173/billing',
    ])
    expect(engine.appRuns.of(ticket.id)[0]).toMatchObject({
      lines: 2,
      lastLine: '  Local: http://localhost:5173/billing',
    })
  })

  it('kills it on Stop', async () => {
    const { engine, commands, web, inTesting } = await setup()
    const ticket = await inTesting()
    engine.appRuns.start({ ticketId: ticket.id, repoId: web.id, actorId: 'boss' })

    expect(engine.appRuns.stop(ticket.id, web.id)).toMatchObject({ state: 'exited' })

    expect(commands.started[0]!.killed).toBe(true)
  })

  it('shows a command that left on its own as exited, with its code', async () => {
    const { engine, web, commands, inTesting } = await setup()
    const ticket = await inTesting()
    engine.appRuns.start({ ticketId: ticket.id, repoId: web.id, actorId: 'boss' })

    commands.started[0]!.leave(1)

    expect(engine.appRuns.of(ticket.id)[0]).toMatchObject({ state: 'exited', exitCode: 1 })
  })

  it('refuses a repo with no run command, and says where to set one', async () => {
    const { engine, api, inTesting } = await setup()
    const ticket = await inTesting([api.id])

    expect(() => engine.appRuns.start({ ticketId: ticket.id, repoId: api.id, actorId: 'boss' })).toThrow(
      /no run command/i,
    )
  })

  it('refuses a second app on a port another ticket is already answering on', async () => {
    const { engine, commands, web, api, inTesting } = await setup()
    // Both repos serve on 5173, which is the mistake this refusal is for.
    engine.tests.setRepo(api.id, { runCommand: 'pnpm start', port: 5173 })
    const first = await inTesting([web.id])
    const second = await inTesting([api.id])
    engine.appRuns.start({ ticketId: first.id, repoId: web.id, actorId: 'boss' })

    expect(() => engine.appRuns.start({ ticketId: second.id, repoId: api.id, actorId: 'boss' })).toThrow(
      /Port 5173 is already taken by web/i,
    )
    expect(commands.started).toHaveLength(1)

    // Stopping the first frees the port, and the second starts.
    engine.appRuns.stop(first.id, web.id)
    expect(engine.appRuns.start({ ticketId: second.id, repoId: api.id, actorId: 'boss' })).toMatchObject({
      state: 'running',
    })
  })

  it('refuses to start the same app twice', async () => {
    const { engine, web, inTesting } = await setup()
    const ticket = await inTesting()
    engine.appRuns.start({ ticketId: ticket.id, repoId: web.id, actorId: 'boss' })

    expect(() => engine.appRuns.start({ ticketId: ticket.id, repoId: web.id, actorId: 'boss' })).toThrow(
      /already running/i,
    )
  })

  it('kills it when the ticket leaves Testing', async () => {
    const { engine, commands, web, board, inTesting } = await setup()
    const ticket = await inTesting()
    engine.appRuns.start({ ticketId: ticket.id, repoId: web.id, actorId: 'boss' })

    board().moveTicket(ticket.id, 'doing')

    expect(commands.started[0]!.killed).toBe(true)
    expect(engine.appRuns.of(ticket.id)).toEqual([])
  })

  it('kills it when testing fails, and when the app closes', async () => {
    const { engine, commands, web, inTesting } = await setup()
    const failing = await inTesting()
    engine.appRuns.start({ ticketId: failing.id, repoId: web.id, actorId: 'boss' })
    engine.tests.reportBug({ ticketId: failing.id, note: 'It does not load' })
    expect(commands.started[0]!.killed).toBe(true)

    const other = await inTesting()
    engine.appRuns.start({ ticketId: other.id, repoId: web.id, actorId: 'boss' })
    engines.splice(0).forEach((engine) => {
      engine.close()
    })

    expect(commands.started[1]!.killed).toBe(true)
  })

  it('kills it when the Company closes, not only when the app quits (T201)', async () => {
    const { engine, commands, web, inTesting } = await setup()
    const ticket = await inTesting()
    engine.appRuns.start({ ticketId: ticket.id, repoId: web.id, actorId: 'boss' })

    // Remove from launcher, a move and a delete all close the Company the same way. A dev server
    // it started is a child process of this app, so nothing else is going to stop it.
    engine.forgetCompany(engine.listCompanies()[0]!.id)

    expect(commands.started[0]!.killed).toBe(true)
  })
})

/**
 * Where a run command starts (T259). `spawnRunCommand` has taken a runtime since T167 and
 * `createAppRuns` has had the option, but nothing ever handed one in: a boss whose team is in a distro
 * pressed **Run it** and got a Windows shell in a worktree on a WSL share, where `pnpm dev` is the
 * wrong `node_modules` — installed against the distro's libc — and often no `pnpm` at all.
 */
describe('where Run it starts the command', () => {
  it('is where the team runs', async () => {
    const { engine, commands, inTesting } = await setup(() => ({ kind: 'wsl', distro: 'Arch' }))
    const ticket = await inTesting()

    engine.appRuns.start({ ticketId: ticket.id, repoId: engine.repos.list()[0]!.id, actorId: 'boss' })

    expect(commands.started.at(-1)?.runtime).toEqual({ kind: 'wsl', distro: 'Arch' })
  })

  it('is this machine when the boss has chosen nothing, which is every Mac', async () => {
    const { engine, commands, web, inTesting } = await setup()
    const ticket = await inTesting()

    engine.appRuns.start({ ticketId: ticket.id, repoId: web.id, actorId: 'boss' })

    expect(commands.started.at(-1)?.runtime).toBeNull()
  })
})
