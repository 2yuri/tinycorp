import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryDatabases, inMemoryRecents, readyStack } from '../../core/testing'
import { createGitService } from '../../platform/git-service'
import { fakeProvider } from '../../providers/testing'
import { RESTORE_POINTS_FOLDER, RETENTION_DAYS } from './restore-points'
import { createRestoreGit } from './restore-points-git'

const engines: CompanyEngine[] = []
const scratch: string[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

// Signing off: the boss's own `commit.gpgsign` would ask for a passphrase no test can answer.
const IDENTITY = ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false']

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function commit(cwd: string, message: string): string {
  git(cwd, 'add', '-A')
  git(cwd, ...IDENTITY, 'commit', '-m', message)
  return git(cwd, 'rev-parse', 'HEAD')
}

/** A Company with one real repo on disk, one Employee and a ticket she holds. */
function setup({ clock }: { clock?: () => number } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'restore-points-engine-'))
  scratch.push(root)
  const repoPath = join(root, 'app')
  execFileSync('git', ['init', '--initial-branch=main', repoPath], { stdio: 'ignore' })
  writeFileSync(join(repoPath, 'README.md'), '# app\n')
  const base = commit(repoPath, 'init')
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
    ...(clock && { now: clock }),
    log: () => {},
  })
  provider.connect(engine.sessions.receiveHook)
  engines.push(engine)
  engine.createCompany({ folder, name: 'Acme' })
  const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
  const repo = engine.repos.add({ path: repoPath, name: 'app', stack: readyStack() })
  const board = engine.board()
  const ticket = board.createTicket({ title: 'Login page', assigneeId: ada.id, repos: [repo.id] })

  /** Puts the ticket in Doing, which gives it a worktree on disk. */
  function claim(): string {
    board.moveTicket(ticket.id, 'doing')
    return engine.code.of(ticket.id).worktrees[0]!.path
  }

  /** Ada's Session sends one hook, which is when the Company looks for new commits. */
  function hook(): void {
    if (engine.sessions.get(ada.id).status === 'off') engine.sessions.start(ada.id)
    provider.spawnOf(ada.id).hook('PostToolUse', { tool_name: 'Bash' })
  }

  const points = () => engine.restorePoints.of(ticket.id)
  return { engine, provider, root, repoPath, folder, ada, repo, board, ticket, base, claim, hook, points }
}

describe('Restore points', () => {
  it('takes one the moment the Employee gets its worktree, before it starts', () => {
    const { base, claim, points, ticket, repo, ada } = setup()

    claim()

    expect(points()).toEqual([
      expect.objectContaining({
        ticketId: ticket.id,
        repoId: repo.id,
        employeeId: ada.id,
        reason: 'start',
        note: 'Login page',
        commit: base,
        branch: `ticket-ac-${ticket.id}-login-page`,
        hadUncommitted: false,
      }),
    ])
  })

  it('keeps the captured work where the Company data lives, never in the repo', () => {
    const { claim, folder, repoPath, hook, points } = setup()
    const path = claim()
    writeFileSync(join(path, 'draft.ts'), 'export const draft = 1\n')
    commit(path, 'first pass')
    writeFileSync(join(path, 'draft.ts'), 'export const draft = 2\n')

    hook()

    expect(points()[0]).toMatchObject({ reason: 'commit', hadUncommitted: true })
    expect(existsSync(join(folder, RESTORE_POINTS_FOLDER))).toBe(true)
    expect(git(repoPath, 'status', '--porcelain')).toBe('')
  })

  it('takes one at each of the Employee’s own commits, saying what it was doing', () => {
    const { claim, hook, points } = setup()
    const path = claim()

    writeFileSync(join(path, 'a.ts'), 'a\n')
    commit(path, 'Add the form')
    hook()
    writeFileSync(join(path, 'b.ts'), 'b\n')
    commit(path, 'Wire the submit')
    hook()
    // A hook with no commit behind it adds nothing.
    hook()

    expect(points().map((p) => [p.reason, p.note])).toEqual([
      ['commit', 'Wire the submit'],
      ['commit', 'Add the form'],
      ['start', 'Login page'],
    ])
  })

  it('restores the working tree, the untracked files and the index of a point', () => {
    const { engine, claim, hook, points } = setup()
    const path = claim()
    writeFileSync(join(path, 'a.ts'), 'first\n')
    commit(path, 'Add the form')
    writeFileSync(join(path, 'a.ts'), 'first, half edited\n')
    writeFileSync(join(path, 'staged.ts'), 'staged\n')
    git(path, 'add', 'staged.ts')
    writeFileSync(join(path, 'scratch.txt'), 'scratch\n')
    hook()
    const at = points()[0]!

    rmSync(join(path, 'scratch.txt'))
    rmSync(join(path, 'staged.ts'))
    writeFileSync(join(path, 'a.ts'), 'ruined\n')
    commit(path, 'Ruin it')

    engine.restorePoints.goBack(at.id)

    expect(git(path, 'rev-parse', 'HEAD')).toBe(at.commit)
    expect(readFileSync(join(path, 'a.ts'), 'utf8')).toBe('first, half edited\n')
    expect(readFileSync(join(path, 'scratch.txt'), 'utf8')).toBe('scratch\n')
    expect(git(path, 'diff', '--cached', '--name-only')).toBe('staged.ts')
  })

  it('rewrites nothing of the repo’s own history', () => {
    const { engine, claim, hook, points, repoPath, base } = setup()
    const path = claim()
    writeFileSync(join(path, 'a.ts'), 'a\n')
    const first = commit(path, 'Add the form')
    hook()
    writeFileSync(join(path, 'b.ts'), 'b\n')
    const second = commit(path, 'Wire the submit')
    hook()
    const at = points().find((p) => p.reason === 'start')!

    engine.restorePoints.goBack(at.id)

    expect(git(repoPath, 'log', '--format=%H', 'main')).toBe(base)
    expect(git(path, 'log', '-1', '--format=%s', first)).toBe('Add the form')
    expect(git(path, 'log', '-1', '--format=%s', second)).toBe('Wire the submit')
    expect(git(path, 'cat-file', '-t', second)).toBe('commit')
  })

  it('stops whoever was working before it touches the worktree', () => {
    const { engine, provider, ada, claim, hook, points } = setup()
    const path = claim()
    writeFileSync(join(path, 'a.ts'), 'a\n')
    const made = commit(path, 'Add the form')
    hook()
    const at = points().find((p) => p.reason === 'start')!
    const pty = provider.spawnOf(ada.id).pty
    const kill = pty.kill
    let headWhenStopped: string | null = null
    pty.kill = () => {
      headWhenStopped = git(path, 'rev-parse', 'HEAD')
      kill()
    }
    expect(engine.sessions.get(ada.id).status).not.toBe('off')

    engine.restorePoints.goBack(at.id)

    expect(engine.sessions.get(ada.id).status).toBe('off')
    // The Session was already gone while the worktree still held the commit being undone.
    expect(headWhenStopped).toBe(made)
    expect(git(path, 'rev-parse', 'HEAD')).toBe(at.commit)
  })

  it('names what going back loses: the commits after it, the work in progress and who stops', () => {
    const { engine, claim, hook, points, ada } = setup()
    const path = claim()
    writeFileSync(join(path, 'a.ts'), 'a\n')
    commit(path, 'Add the form')
    hook()
    writeFileSync(join(path, 'b.ts'), 'b\n')
    commit(path, 'Wire the submit')
    writeFileSync(join(path, 'c.ts'), 'not saved\n')
    const at = points().find((p) => p.reason === 'start')!

    expect(engine.restorePoints.losses(at.id)).toEqual({
      commits: ['Wire the submit', 'Add the form'],
      uncommitted: true,
      stops: { employeeId: ada.id, name: 'Ada' },
    })
  })

  it('leaves a point to come back from, so going back is itself undoable', () => {
    const { engine, claim, hook, points } = setup()
    const path = claim()
    writeFileSync(join(path, 'a.ts'), 'a\n')
    commit(path, 'Add the form')
    hook()
    const at = points().find((p) => p.reason === 'start')!

    engine.restorePoints.goBack(at.id)

    // The point left behind says what the Employee last committed, so it reads like the others.
    expect(points()[0]).toMatchObject({ reason: 'going-back', note: 'Add the form' })
    expect(points()).toHaveLength(3)
  })

  it('refuses to go back in a worktree that moved to another branch', () => {
    const { engine, claim, points } = setup()
    const path = claim()
    const at = points()[0]!
    git(path, 'checkout', '-b', 'something-else')

    expect(() => engine.restorePoints.goBack(at.id)).toThrow(/is on something-else now/)
    expect(git(path, 'branch', '--show-current')).toBe('something-else')
  })

  it('drops a point older than the Company’s retention', () => {
    let clock = Date.parse('2026-09-01T09:00:00.000Z')
    const { board, ticket, claim, hook, points } = setup({ clock: () => clock })
    const path = claim()
    writeFileSync(join(path, 'a.ts'), 'a\n')
    commit(path, 'Add the form')
    hook()

    expect(points()).toHaveLength(2)

    clock += RETENTION_DAYS * 24 * 60 * 60 * 1000 + 1000
    writeFileSync(join(path, 'b.ts'), 'b\n')
    commit(path, 'Wire the submit')
    hook()
    // Any board edit is when the Company sweeps.
    board.updateTicket(ticket.id, { title: 'Login page' })

    expect(points().map((p) => p.note)).toEqual(['Wire the submit'])
  })

  it('drops a point when its ticket closes', () => {
    const { board, ticket, claim, hook, points, folder } = setup()
    const path = claim()
    writeFileSync(join(path, 'a.ts'), 'a\n')
    commit(path, 'Add the form')
    writeFileSync(join(path, 'scratch.txt'), 'scratch\n')
    hook()
    const kept = points()[0]!

    expect(kept.hadUncommitted).toBe(true)
    expect(points()).toHaveLength(2)

    board.moveTicket(ticket.id, 'done')

    expect(points()).toEqual([])
    // The captured work goes with it, so the folder cannot grow without bound.
    expect(existsSync(join(folder, RESTORE_POINTS_FOLDER, `${kept.id}.untracked`))).toBe(false)
  })
})

describe('Deleting the ticket (T275)', () => {
  it('takes its worktree, its branch and its points with it when nothing was done in them', async () => {
    const { engine, repoPath, ticket, claim, points, folder } = setup()
    const path = claim()
    const [start] = points()
    expect(start).toMatchObject({ reason: 'start' })

    await engine.ticketRemovals().deleteTicket(ticket.id)

    expect(points()).toEqual([])
    expect(existsSync(path)).toBe(false)
    expect(git(repoPath, 'branch', '--list', `ticket-ac-${ticket.id}-*`)).toBe('')
    expect(existsSync(join(folder, RESTORE_POINTS_FOLDER, `${start!.id}.untracked`))).toBe(false)
  })

  it('keeps the ticket, its worktree and its points while the branch holds work', async () => {
    const { engine, ticket, claim, points } = setup()
    const path = claim()
    writeFileSync(join(path, 'draft.ts'), 'draft\n')

    await expect(engine.ticketRemovals().deleteTicket(ticket.id)).rejects.toThrow(
      `AC-${ticket.id}’s worktree in app has changes nobody committed, and deleting it would throw them away.`,
    )
    commit(path, 'Add the draft')
    await expect(engine.ticketRemovals().deleteTicket(ticket.id)).rejects.toThrow(
      `AC-${ticket.id}’s branch in app has 1 commit nobody merged, and deleting it would throw them away.`,
    )

    expect(existsSync(path)).toBe(true)
    expect(points()).not.toEqual([])
    expect(
      engine
        .board()
        .snapshot()
        .tickets.map((t) => t.id),
    ).toEqual([ticket.id])
  })
})
