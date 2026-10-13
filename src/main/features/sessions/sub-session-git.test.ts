import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { changedAnything, createSubSessionGit } from './sub-session-git'

const scratch: string[] = []
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
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

/** A repo on `main`, and the parent's ticket worktree on its own branch with one commit of its own. */
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'sub-session-git-'))
  scratch.push(root)
  const repo = join(root, 'app')
  execFileSync('git', ['init', '--initial-branch=main', repo], { stdio: 'ignore' })
  writeFileSync(join(repo, 'README.md'), '# app\n')
  commit(repo, 'init')
  const parentPath = join(root, 'wt', 'tc-1-chart')
  git(repo, 'worktree', 'add', '-b', 'tc-1-chart', parentPath)
  writeFileSync(join(parentPath, 'chart.ts'), 'export const chart = 1\n')
  const parentHead = commit(parentPath, 'chart')
  return { root, repo, parentPath, parentHead, subPath: join(root, 'wt', 'tc-1-chart+tests') }
}

describe('A sub-session’s own worktree', () => {
  it('starts on a new branch at what the parent has committed, not at the repo’s default branch', () => {
    const { parentPath, parentHead, subPath } = setup()
    const subGit = createSubSessionGit()

    const { base } = subGit.add({ parentPath, path: subPath, branch: 'tc-1-chart+tests' })

    expect(base).toBe(parentHead)
    expect(git(subPath, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('tc-1-chart+tests')
    expect(git(subPath, 'rev-parse', 'HEAD')).toBe(parentHead)
    expect(existsSync(join(subPath, 'chart.ts'))).toBe(true)
  })

  it('counts what it changed since it started, committed or not', () => {
    const { parentPath, subPath } = setup()
    const subGit = createSubSessionGit()
    const { base } = subGit.add({ parentPath, path: subPath, branch: 'tc-1-chart+tests' })
    expect(changedAnything(subGit.changes({ path: subPath, base }))).toBe(false)

    writeFileSync(join(subPath, 'chart.test.ts'), 'test\n')
    commit(subPath, 'tests')
    writeFileSync(join(subPath, 'notes.md'), 'wip\n')

    expect(subGit.changes({ path: subPath, base })).toEqual({ commits: 1, dirty: true, files: 2 })
  })

  it('keeps a branch that holds commits the parent’s branch does not, when the worktree goes', () => {
    const { parentPath, subPath } = setup()
    const subGit = createSubSessionGit()
    subGit.add({ parentPath, path: subPath, branch: 'tc-1-chart+tests' })
    writeFileSync(join(subPath, 'chart.test.ts'), 'test\n')
    commit(subPath, 'tests')

    const removed = subGit.remove({ parentPath, path: subPath, branch: 'tc-1-chart+tests', parentBranch: 'tc-1-chart' })

    expect(removed).toEqual({ branchKept: true })
    expect(existsSync(subPath)).toBe(false)
    expect(subGit.hasBranch(parentPath, 'tc-1-chart+tests')).toBe(true)
  })

  it('leaves nothing behind when it changed nothing, or the parent already merged it', () => {
    const { parentPath, subPath } = setup()
    const subGit = createSubSessionGit()
    subGit.add({ parentPath, path: subPath, branch: 'tc-1-chart+tests' })
    writeFileSync(join(subPath, 'chart.test.ts'), 'test\n')
    commit(subPath, 'tests')
    git(parentPath, ...IDENTITY, 'merge', '--no-edit', 'tc-1-chart+tests')

    const removed = subGit.remove({ parentPath, path: subPath, branch: 'tc-1-chart+tests', parentBranch: 'tc-1-chart' })

    expect(removed).toEqual({ branchKept: false })
    expect(existsSync(subPath)).toBe(false)
    expect(subGit.hasBranch(parentPath, 'tc-1-chart+tests')).toBe(false)
  })
})
