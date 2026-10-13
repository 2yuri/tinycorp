import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createGitService } from './git-service'

const scratch: string[] = []
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const identity = ['-c', 'user.name=Test', '-c', 'user.email=test@example.com']

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function commit(cwd: string, file: string, text: string, message: string): void {
  writeFileSync(join(cwd, file), text)
  git(cwd, 'add', '.')
  git(cwd, ...identity, '-c', 'commit.gpgsign=false', 'commit', '-m', message)
}

/** A repo without a remote, `main` checked out, and a ticket worktree with one commit on its branch. */
function scratchRepo() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'git-local-merge-')))
  scratch.push(root)
  const repo = join(root, 'notes')
  execFileSync('git', ['init', '--initial-branch=main', repo])
  commit(repo, 'README.md', '# notes\n', 'init')
  const company = join(root, 'company')
  mkdirSync(company)
  const service = createGitService()
  const branch = 'ticket-1-login'
  const path = join(company, 'worktrees', 'notes', branch)
  service.addWorktree({ repoPath: repo, path, branch })
  commit(path, 'login.md', 'login\n', 'login page')
  return { repo, path, branch, service }
}

describe('Git service: local merge', () => {
  it('fast-forwards the checked-out base branch, from the repo', async () => {
    const { repo, branch, service } = scratchRepo()

    await service.mergeLocally({ repoPath: repo, branch, base: 'main' })

    expect(git(repo, 'rev-parse', 'main')).toBe(git(repo, 'rev-parse', branch))
    expect(readFileSync(join(repo, 'login.md'), 'utf8')).toBe('login\n')
  })

  it('merges a base that moved on with a merge commit', async () => {
    const { repo, branch, service } = scratchRepo()
    commit(repo, 'other.md', 'other\n', 'other work')

    await service.mergeLocally({ repoPath: repo, branch, base: 'main' })

    expect(git(repo, 'log', '-1', '--format=%P', 'main').split(' ')).toHaveLength(2)
    expect(existsSync(join(repo, 'login.md'))).toBe(true)
    expect(existsSync(join(repo, 'other.md'))).toBe(true)
  })

  it('merges into a base that is not checked out without touching the checkout', async () => {
    const { repo, branch, service } = scratchRepo()
    git(repo, 'switch', '-c', 'scratch')
    git(repo, 'switch', 'main')
    commit(repo, 'other.md', 'other\n', 'other work')
    git(repo, 'switch', 'scratch')

    await service.mergeLocally({ repoPath: repo, branch, base: 'main' })

    expect(git(repo, 'branch', '--show-current')).toBe('scratch')
    expect(git(repo, 'ls-tree', '--name-only', 'main')).toContain('login.md')
    expect(git(repo, 'ls-tree', '--name-only', 'main')).toContain('other.md')
    expect(git(repo, 'worktree', 'list')).not.toContain('tinycorp-merge')
  })

  it('refuses to merge over uncommitted changes on the base', async () => {
    const { repo, branch, service } = scratchRepo()
    writeFileSync(join(repo, 'README.md'), '# changed\n')

    await expect(service.mergeLocally({ repoPath: repo, branch, base: 'main' })).rejects.toThrow(/uncommitted changes/)
    expect(git(repo, 'rev-parse', 'main')).not.toBe(git(repo, 'rev-parse', branch))
  })

  it('aborts a conflicting merge and leaves the base as it was', async () => {
    const { repo, branch, service } = scratchRepo()
    commit(repo, 'login.md', 'other login\n', 'conflicting work')
    const before = git(repo, 'rev-parse', 'main')

    await expect(service.mergeLocally({ repoPath: repo, branch, base: 'main' })).rejects.toThrow(/conflict/i)
    expect(git(repo, 'rev-parse', 'main')).toBe(before)
    expect(git(repo, 'status', '--porcelain')).toBe('')
  })
})
