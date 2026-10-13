import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createRestoreGit } from './restore-points-git'

const scratch: string[] = []
afterEach(() => {
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

/** A repo on `main` with one commit, a ticket worktree of it, and a folder for restore points. */
function scratchWorktree() {
  const root = mkdtempSync(join(tmpdir(), 'restore-points-'))
  scratch.push(root)
  const repo = join(root, 'app')
  execFileSync('git', ['init', '--initial-branch=main', repo], { stdio: 'ignore' })
  writeFileSync(join(repo, 'README.md'), '# app\n')
  writeFileSync(join(repo, '.gitignore'), 'ignored/\n')
  const base = commit(repo, 'init')
  const path = join(root, 'worktrees', 'ticket-1')
  git(repo, 'worktree', 'add', '--no-track', '-b', 'ticket-1-login', path, 'main')
  const folder = join(root, 'company', 'restore-points')
  mkdirSync(folder, { recursive: true })
  return { root, repo, path, folder, base }
}

describe('Restore-point git', () => {
  it('reads the commit, its subject, the branch and whether anything is uncommitted', () => {
    const { path, base } = scratchWorktree()
    const service = createRestoreGit()

    expect(service.state(path)).toEqual({ commit: base, subject: 'init', branch: 'ticket-1-login', dirty: false })

    writeFileSync(join(path, 'README.md'), '# app\nedited\n')
    expect(service.state(path)?.dirty).toBe(true)
    expect(service.state(join(path, 'nowhere'))).toBeNull()
  })

  it('puts the tree and the index back as they were, untracked files included', () => {
    const { path, folder } = scratchWorktree()
    const service = createRestoreGit()
    writeFileSync(join(path, 'staged.ts'), 'export const a = 1\n')
    git(path, 'add', 'staged.ts')
    writeFileSync(join(path, 'README.md'), '# app\nhalf done\n')
    writeFileSync(join(path, 'notes.txt'), 'thinking\n')

    const at = service.state(path)!
    const work = service.capture({ path, folder, id: 'p1' })

    // The Employee then makes a mess: commits, deletes and rewrites.
    commit(path, 'wip')
    writeFileSync(join(path, 'README.md'), 'gone\n')
    rmSync(join(path, 'staged.ts'))
    writeFileSync(join(path, 'junk.txt'), 'junk\n')

    service.restore({ path, folder, id: 'p1', commit: at.commit, work })

    expect(git(path, 'rev-parse', 'HEAD')).toBe(at.commit)
    expect(readFileSync(join(path, 'README.md'), 'utf8')).toBe('# app\nhalf done\n')
    expect(readFileSync(join(path, 'notes.txt'), 'utf8')).toBe('thinking\n')
    expect(readFileSync(join(path, 'staged.ts'), 'utf8')).toBe('export const a = 1\n')
    expect(existsSync(join(path, 'junk.txt'))).toBe(false)
    // `staged.ts` was staged and nothing else was, exactly as at the point.
    expect(git(path, 'diff', '--cached', '--name-only')).toBe('staged.ts')
    expect(git(path, 'diff', '--name-only')).toBe('README.md')
  })

  it('keeps an ignored folder, which the point never captured, out of the way', () => {
    const { path, folder } = scratchWorktree()
    const service = createRestoreGit()
    mkdirSync(join(path, 'ignored'))
    writeFileSync(join(path, 'ignored', 'node_modules.txt'), 'expensive\n')

    const at = service.state(path)!
    const work = service.capture({ path, folder, id: 'p1' })

    expect(at.dirty).toBe(false)
    expect(work).toEqual({ indexPatch: null, treePatch: null, untracked: null })

    writeFileSync(join(path, 'README.md'), 'changed\n')
    service.restore({ path, folder, id: 'p1', commit: at.commit, work })

    expect(readFileSync(join(path, 'ignored', 'node_modules.txt'), 'utf8')).toBe('expensive\n')
    expect(git(path, 'status', '--porcelain')).toBe('')
  })

  it('rewrites no commit: every commit keeps its id and the base branch does not move', () => {
    const { repo, path, folder, base } = scratchWorktree()
    const service = createRestoreGit()
    const at = service.state(path)!
    const work = service.capture({ path, folder, id: 'p1' })
    writeFileSync(join(path, 'a.txt'), 'a\n')
    const first = commit(path, 'first step')
    writeFileSync(join(path, 'b.txt'), 'b\n')
    const second = commit(path, 'second step')

    service.restore({ path, folder, id: 'p1', commit: at.commit, work })

    expect(git(repo, 'rev-parse', 'main')).toBe(base)
    expect(git(repo, 'log', '--format=%H', 'main')).toBe(base)
    // The commits themselves are untouched: same ids, same subjects, still in the object store.
    expect(git(path, 'log', '-1', '--format=%s', first)).toBe('first step')
    expect(git(path, 'log', '-1', '--format=%s', second)).toBe('second step')
    expect(git(path, 'cat-file', '-t', second)).toBe('commit')
  })

  it('names the commits made on top of a point, newest first', () => {
    const { path, folder } = scratchWorktree()
    const service = createRestoreGit()
    const at = service.state(path)!

    expect(service.commitsSince(path, at.commit)).toEqual([])

    writeFileSync(join(path, 'a.txt'), 'a\n')
    commit(path, 'first step')
    writeFileSync(join(path, 'b.txt'), 'b\n')
    commit(path, 'second step')

    expect(service.commitsSince(path, at.commit)).toEqual(['second step', 'first step'])
    expect(existsSync(folder)).toBe(true)
  })

  it('throws away nothing when the work it kept is gone', () => {
    const { path, folder } = scratchWorktree()
    const service = createRestoreGit()
    writeFileSync(join(path, 'README.md'), 'half done\n')
    const at = service.state(path)!
    const work = service.capture({ path, folder, id: 'p1' })
    rmSync(join(folder, work.treePatch!))
    writeFileSync(join(path, 'README.md'), 'what is here now\n')

    expect(() => service.restore({ path, folder, id: 'p1', commit: at.commit, work })).toThrow(/is gone/)
    expect(readFileSync(join(path, 'README.md'), 'utf8')).toBe('what is here now\n')
  })

  it('forgets a point’s captured work', () => {
    const { path, folder } = scratchWorktree()
    const service = createRestoreGit()
    writeFileSync(join(path, 'README.md'), 'edited\n')
    writeFileSync(join(path, 'notes.txt'), 'thinking\n')
    const work = service.capture({ path, folder, id: 'p1' })

    expect(existsSync(join(folder, work.treePatch!))).toBe(true)

    service.forget({ folder, work })
    service.forget({ folder, work })

    expect(existsSync(join(folder, work.treePatch!))).toBe(false)
    expect(existsSync(join(folder, work.untracked!))).toBe(false)
  })
})
