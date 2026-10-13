import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type CompanyEngine, createCompanyEngine, type McpCaller } from '../../core/engine/company-engine'
import { inMemoryDatabases, inMemoryRecents, readyStack } from '../../core/testing'
import { createGitService } from '../../platform/git-service'
import { fakeProvider } from '../../providers/testing'
import { createRestoreGit } from '../restore-points'
import { READY_DELAY_MS } from './sessions'

/**
 * An Employee starting Sessions of its own (T163), end to end through the engine, against a real
 * repo on disk: where each one works, the seat it takes, what it can reach, and what goes when its
 * parent does.
 */

const engines: CompanyEngine[] = []
const scratch: string[] = []
beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }))
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
  vi.useRealTimers()
})

const IDENTITY = ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false']

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function commit(cwd: string, message: string): string {
  git(cwd, 'add', '-A')
  git(cwd, ...IDENTITY, 'commit', '-m', message)
  return git(cwd, 'rev-parse', 'HEAD')
}

/** Ada holds a ticket in Doing, has committed on its branch, and her Session is up. */
function setup({ cap }: { cap?: number } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sub-sessions-'))
  scratch.push(root)
  const repoPath = join(root, 'app')
  execFileSync('git', ['init', '--initial-branch=main', repoPath], { stdio: 'ignore' })
  writeFileSync(join(repoPath, 'README.md'), '# app\n')
  commit(repoPath, 'init')
  const folder = join(root, 'company')
  mkdirSync(folder)

  const provider = fakeProvider()
  const engine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
    providers: { claude: provider },
    isGitRepo: () => true,
    git: createGitService(),
    restoreGit: createRestoreGit(),
    mcpUrl: () => 'http://127.0.0.1/mcp',
    log: () => {},
  })
  provider.connect(engine.sessions.receiveHook)
  engines.push(engine)
  const company = engine.createCompany({ folder, name: 'Acme' })
  if (cap !== undefined) engine.capacity.setConcurrencyCap(cap)
  const ada = engine.employees.create({ name: 'Ada', roleId: 'backend', model: 'opus-5-deep' })
  const repo = engine.repos.add({ path: repoPath, name: 'app', stack: readyStack() })
  const board = engine.board()
  const ticket = board.createTicket({ title: 'Usage chart', assigneeId: ada.id, repos: [repo.id] })
  board.moveTicket(ticket.id, 'doing')
  const worktree = engine.code.of(ticket.id).worktrees[0]!
  writeFileSync(join(worktree.path, 'chart.ts'), 'export const chart = 1\n')
  const parentHead = commit(worktree.path, 'chart')

  engine.sessions.start(ada.id)
  provider.spawnOf(ada.id).hook('SessionStart')
  vi.advanceTimersByTime(READY_DELAY_MS)

  /** Ada's own tools, as her Session's MCP token reaches them. */
  const asAda = (): McpCaller => engine.mcpCaller(company.id, provider.spawnOf(ada.id).mcp!.token)!

  /** A sub-session's Session comes up and takes its task. */
  function bringUp(name: string) {
    const spawn = provider.subSpawnOf(name)
    spawn.hook('SessionStart')
    vi.advanceTimersByTime(READY_DELAY_MS)
    return spawn
  }

  const subsOfAda = () => engine.sessions.get(ada.id).subSessions
  return { engine, provider, company, ada, repo, board, ticket, worktree, parentHead, asAda, bringUp, subsOfAda }
}

describe('An Employee’s own sub-sessions', () => {
  it('gives an `own` sub-session a new worktree and branch off the parent’s branch, not off main', () => {
    const { asAda, provider, worktree, parentHead, ada } = setup()

    const started = asAda().subSessions.start({ name: 'tests', task: 'Write the chart tests', workspace: 'own' })

    expect(started).toMatchObject({
      workspace: 'own',
      state: 'starting',
      branch: `${worktree.branch}+tests`,
      parentBranch: worktree.branch,
      worktreeKept: true,
    })
    expect(started.path).not.toBe(worktree.path)
    expect(git(started.path, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(`${worktree.branch}+tests`)
    expect(git(started.path, 'rev-parse', 'HEAD')).toBe(parentHead)
    // Spawned through the parent's own Provider adapter, as the parent, in its own worktree.
    const spawn = provider.subSpawnOf('tests')
    expect(spawn.request.employee.id).toBe(ada.id)
    expect(spawn.modelArgs).toEqual(provider.spawnOf(ada.id).modelArgs)
    expect(spawn.request.cwd).toBe(started.path)
    expect(spawn.request.sessionId).not.toBe(provider.spawnOf(ada.id).request.sessionId)
  })

  it('makes no worktree for a `shared` one: it works in the parent’s own', () => {
    const { asAda, provider, worktree } = setup()
    const before = git(worktree.path, 'worktree', 'list')

    const started = asAda().subSessions.start({
      name: 'research',
      task: 'Read how usage is queried',
      workspace: 'shared',
    })

    expect(started).toMatchObject({
      path: worktree.path,
      branch: worktree.branch,
      worktreeKept: false,
      filesChanged: null,
    })
    expect(provider.subSpawnOf('research').request.cwd).toBe(worktree.path)
    expect(git(worktree.path, 'worktree', 'list')).toBe(before)
  })

  it('hands it the task once its Session is up, with the whole task in its own instructions', () => {
    const { asAda, provider, bringUp } = setup()
    asAda().subSessions.start({
      name: 'tests',
      task: 'Write the chart tests.\nCover empty ranges too.',
      workspace: 'own',
    })

    const spawn = bringUp('tests')

    expect(spawn.pushed).toEqual([expect.stringContaining('Your task is in your instructions')])
    expect(spawn.pushed[0]).not.toContain('\n')
    expect(spawn.instructions!.text).toContain('Cover empty ranges too.')
    expect(spawn.instructions!.text).toContain('`session_report`')
    expect(provider.subSpawnOf('tests').instructions!.text).not.toContain('session_start`')
  })

  it('waits for a seat when the cap is full, and starts once one frees', () => {
    // Ada holds one of two seats; the first sub-session takes the other.
    const { asAda, provider, subsOfAda, bringUp } = setup({ cap: 2 })
    asAda().subSessions.start({ name: 'tests', task: 'Write the tests', workspace: 'shared' })

    const second = asAda().subSessions.start({ name: 'docs', task: 'Write the docs', workspace: 'shared' })

    expect(second.state).toBe('waiting')
    expect(() => provider.subSpawnOf('docs')).toThrow()

    bringUp('tests').hook('Stop')

    expect(subsOfAda().map((s) => [s.name, s.state])).toEqual([
      ['tests', 'done'],
      ['docs', 'starting'],
    ])
    expect(provider.subSpawnOf('docs').request.cwd).toBeTruthy()
  })

  it('counts against the Company’s cap, like any other Session', () => {
    const { engine, asAda } = setup({ cap: 5 })

    asAda().subSessions.start({ name: 'tests', task: 'Write the tests', workspace: 'shared' })

    expect(engine.capacity.get().running).toBe(2)
  })

  it('reports back and wakes its parent with the result when its turn ends', () => {
    const { engine, company, provider, asAda, ada, bringUp, subsOfAda } = setup()
    const { id } = asAda().subSessions.start({ name: 'tests', task: 'Write the tests', workspace: 'own' })
    const spawn = bringUp('tests')
    const asSub = engine.mcpCaller(company.id, spawn.mcp!.token)!

    asSub.subSession!.report('Added 12 tests for the range picker.')
    spawn.hook('Stop')

    expect(subsOfAda()).toEqual([
      expect.objectContaining({ id, state: 'done', result: 'Added 12 tests for the range picker.' }),
    ])
    expect(spawn.pty.killed).toBe(true)
    expect(engine.inbox.list(ada.id)).toContainEqual(
      expect.objectContaining({
        kind: 'session',
        prompt: expect.stringContaining('Added 12 tests for the range picker.'),
      }),
    )
    // Its seat is free again.
    expect(engine.capacity.get().running).toBe(1)
    expect(provider.spawnOf(ada.id).pty.killed).toBe(false)
  })

  /**
   * T199, finding H5: a sub-session's MCP config holds the token its own tools are reached with,
   * and the parent's Session is running in a worktree any Employee can read from. It goes when the
   * sub-session's turn does, like the worktree.
   */
  it('forgets what its adapter wrote for it when its turn ends, and leaves the parent’s alone', () => {
    const { provider, asAda, ada, bringUp } = setup()
    asAda().subSessions.start({ name: 'tests', task: 'Write the tests', workspace: 'own' })
    const spawn = bringUp('tests')

    spawn.hook('Stop')

    expect(provider.forgotten).toEqual([spawn.request.sessionId])
    expect(provider.mcpOf(provider.spawnOf(ada.id).request.sessionId)).toBeDefined()
  })

  it('leaves nothing behind when it finishes with nothing changed', () => {
    const { asAda, bringUp, subsOfAda, worktree } = setup()
    const started = asAda().subSessions.start({ name: 'tests', task: 'Write the tests', workspace: 'own' })

    bringUp('tests').hook('Stop')

    expect(existsSync(started.path)).toBe(false)
    expect(git(worktree.path, 'branch', '--list', started.branch)).toBe('')
    expect(subsOfAda()[0]).toMatchObject({ state: 'done', worktreeKept: false, branchKept: false })
  })

  it('keeps an own worktree that holds work when it finishes, for the parent to merge', () => {
    const { asAda, bringUp, subsOfAda } = setup()
    const started = asAda().subSessions.start({ name: 'tests', task: 'Write the tests', workspace: 'own' })
    const spawn = bringUp('tests')
    writeFileSync(join(started.path, 'chart.test.ts'), 'test\n')
    commit(started.path, 'tests')

    spawn.hook('Stop')

    expect(existsSync(started.path)).toBe(true)
    expect(subsOfAda()[0]).toMatchObject({ state: 'done', worktreeKept: true, filesChanged: 1 })
  })

  it('stops with its parent, and its worktree goes after a restore point of the uncommitted work', () => {
    const { engine, provider, asAda, ada, ticket, worktree, subsOfAda, bringUp } = setup()
    const started = asAda().subSessions.start({ name: 'tests', task: 'Write the tests', workspace: 'own' })
    const spawn = bringUp('tests')
    writeFileSync(join(started.path, 'chart.test.ts'), 'test\n')
    commit(started.path, 'tests')
    writeFileSync(join(started.path, 'wip.ts'), 'half done\n')

    engine.sessions.stop(ada.id)

    expect(spawn.pty.killed).toBe(true)
    expect(subsOfAda()[0]).toMatchObject({ state: 'stopped', worktreeKept: false, branchKept: true })
    expect(existsSync(started.path)).toBe(false)
    // The commit stays on its branch; what was not committed is in a restore point.
    expect(git(worktree.path, 'branch', '--list', started.branch)).toContain(started.branch)
    expect(engine.restorePoints.of(ticket.id)).toContainEqual(
      expect.objectContaining({ reason: 'sub-session', branch: started.branch, hadUncommitted: true }),
    )
    expect(engine.capacity.get().running).toBe(0)
    expect(provider.spawns.filter((s) => !s.pty.killed)).toEqual([])
  })

  it('drops a sub-session still waiting for a seat when its parent stops', () => {
    const { engine, provider, asAda, ada, subsOfAda } = setup({ cap: 1 })
    const waiting = asAda().subSessions.start({ name: 'tests', task: 'Write the tests', workspace: 'own' })
    expect(waiting.state).toBe('waiting')

    engine.sessions.stop(ada.id)

    expect(subsOfAda()[0]).toMatchObject({ state: 'stopped', worktreeKept: false })
    expect(existsSync(waiting.path)).toBe(false)
    expect(() => provider.subSpawnOf('tests')).toThrow()
  })

  it('stops when the ticket is done', () => {
    const { board, ticket, asAda, subsOfAda, bringUp } = setup()
    asAda().subSessions.start({ name: 'research', task: 'Read the code', workspace: 'shared' })
    const spawn = bringUp('research')

    board.moveTicket(ticket.id, 'done')

    expect(spawn.pty.killed).toBe(true)
    expect(subsOfAda()[0]).toMatchObject({ state: 'stopped' })
  })

  it('refuses a sub-session outside a ticket the parent holds in Doing', () => {
    const { engine, board, repo, asAda } = setup()
    const other = board.createTicket({ title: 'Someone else’s', repos: [repo.id] })

    expect(() => asAda().subSessions.start({ name: 'x', task: 'y', workspace: 'own', ticketId: other.id })).toThrow(
      /not a ticket you hold in Doing/,
    )
    expect(engine.capacity.get().running).toBe(1)
  })

  it('cannot start one of its own: a sub-session has no way to', () => {
    const { engine, company, asAda, bringUp } = setup()
    asAda().subSessions.start({ name: 'tests', task: 'Write the tests', workspace: 'own' })
    const asSub = engine.mcpCaller(company.id, bringUp('tests').mcp!.token)!

    expect(asSub.subSession).not.toBeNull()
    expect(() => asSub.subSessions.start({ name: 'more', task: 'Go deeper', workspace: 'shared' })).toThrow(/one level/)
  })

  it('shows on the parent’s Session, for the drawer’s strip', () => {
    const { asAda, subsOfAda, bringUp } = setup()
    asAda().subSessions.start({ name: 'tests', task: 'Write the chart tests', workspace: 'own' })
    const spawn = bringUp('tests')

    spawn.hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'pnpm vitest run chart' } })

    expect(subsOfAda()).toEqual([
      expect.objectContaining({
        name: 'tests',
        task: 'Write the chart tests',
        state: 'working',
        now: 'pnpm vitest run chart',
      }),
    ])
  })
})
