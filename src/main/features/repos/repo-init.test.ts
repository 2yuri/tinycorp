import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createGitService } from '../../platform/git-service'
import { gitignoreFor, initialiseRepo, planRepoStart } from './repo-init'
import { createRepoInspector } from './repo-inspector'

/**
 * Starting a repo from the app (T61, T144), on disk against real git.
 *
 * Git's own configuration is swapped for a file each test writes, so the identity the first commit
 * is made on is the one the test gave git — never the identity of whoever runs the suite.
 */

const scratch: string[] = []
let globalConfig = ''
beforeEach(() => {
  const home = realpathSync.native(mkdtempSync(join(tmpdir(), 'repo-init-git-')))
  scratch.push(home)
  globalConfig = join(home, 'gitconfig')
  writeFileSync(globalConfig, '')
  vi.stubEnv('GIT_CONFIG_GLOBAL', globalConfig)
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1')
})
afterEach(() => {
  vi.unstubAllEnvs()
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Gives git a name and an email, as `git config --global` would. */
function gitIdentity(name: string, email: string): void {
  writeFileSync(globalConfig, `[user]\n\tname = ${name}\n\temail = ${email}\n`)
}

function folder(files: Record<string, string> = {}): string {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'repo-init-')))
  scratch.push(root)
  const path = join(root, 'app')
  mkdirSync(path)
  for (const [name, text] of Object.entries(files)) writeFileSync(join(path, name), text)
  return path
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

describe('Initialise a folder as a git repository', () => {
  it('runs git init on main with an initial commit on the boss’s own git identity', () => {
    gitIdentity('Ada Lorne', 'ada@example.com')
    const path = folder({ 'README.md': '# app\n' })

    const inspection = initialiseRepo(path, { author: 'Boss From The Profile' })

    expect(git(path, 'branch', '--show-current')).toBe('main')
    expect(git(path, 'log', '--format=%s|%an <%ae>|%cn <%ce>')).toBe(
      'Initial commit|Ada Lorne <ada@example.com>|Ada Lorne <ada@example.com>',
    )
    expect(git(path, 'ls-files')).toBe('README.md')
    expect(git(path, 'status', '--porcelain')).toBe('')
    expect(inspection).toMatchObject({ path, isGitRepo: true, remote: null, defaultBranch: 'main', commitCount: 1 })
  })

  it('writes a .gitignore for the detected stack and commits it', () => {
    const path = folder({
      'package.json': JSON.stringify({ scripts: { build: 'tsc', test: 'vitest', lint: 'biome check' } }),
      'pnpm-lock.yaml': '',
      'tsconfig.json': '{}',
    })

    const inspection = initialiseRepo(path, { author: 'Ada' })

    const ignore = readFileSync(join(path, '.gitignore'), 'utf8')
    expect(ignore).toContain('node_modules/')
    expect(ignore).toContain('.env')
    expect(git(path, 'ls-files').split('\n')).toContain('.gitignore')
    expect(inspection.detected).toMatchObject({ packageManager: 'pnpm', build: 'pnpm build', test: 'pnpm test' })
  })

  it('writes no .gitignore when no stack is detected, and commits an empty folder', () => {
    const path = folder()

    initialiseRepo(path, { author: 'Ada' })

    expect(existsSync(join(path, '.gitignore'))).toBe(false)
    expect(git(path, 'rev-list', '--count', 'HEAD')).toBe('1')
  })

  it('keeps a .gitignore that is already there', () => {
    const path = folder({ 'go.mod': 'module app\n', '.gitignore': 'secrets/\n' })

    initialiseRepo(path, { author: 'Ada' })

    expect(readFileSync(join(path, '.gitignore'), 'utf8')).toBe('secrets/\n')
  })

  it('refuses a folder that already has a .git', () => {
    const path = folder()
    git(path, 'init')

    expect(() => initialiseRepo(path, { author: 'Ada' })).toThrow(`${path} is already a git repository`)
  })

  it('falls back to the boss’s name only where git has no identity, rather than refusing the commit', () => {
    const path = folder()

    initialiseRepo(path, { author: 'Ada Lorne' })

    expect(git(path, 'log', '--format=%an|%cn')).toBe('Ada Lorne|Ada Lorne')
  })

  it('refuses a relative path and a folder whose parent does not exist', () => {
    expect(() => initialiseRepo('app', { author: 'Ada' })).toThrow('must be absolute')
    const parent = join(folder(), 'nope')
    expect(() => initialiseRepo(join(parent, 'app'), { author: 'Ada' })).toThrow(`${parent} does not exist`)
    expect(existsSync(parent)).toBe(false)
  })

  it('leaves a repo that the git service can branch from, without a remote', () => {
    const path = folder({ 'README.md': '# app\n' })
    initialiseRepo(path, { author: 'Ada' })
    const service = createGitService()
    const worktree = join(path, '..', 'worktrees', 'ticket-1')

    const added = service.addWorktree({ repoPath: path, path: worktree, branch: 'ticket-1' })

    expect(added).toEqual({ path: worktree, branch: 'ticket-1', base: 'main' })
    expect(git(worktree, 'branch', '--show-current')).toBe('ticket-1')
    expect(service.hasRemote(path)).toBe(false)
  })

  it('reads the inspection after initialising like any repo', () => {
    const path = folder({ 'Cargo.toml': '[package]\nname = "app"\n' })

    initialiseRepo(path, { author: 'Ada' })

    expect(createRepoInspector()(path).detected).toMatchObject({ language: 'Rust', packageManager: 'cargo' })
  })
})

describe('Start a new repo (T144)', () => {
  it('creates a folder that does not exist yet, and starts an empty repo with one commit in it', () => {
    gitIdentity('Ada Lorne', 'ada@example.com')
    const path = join(folder(), 'payments-web')

    const inspection = initialiseRepo(path, { author: 'Ada' })

    expect(readdirSync(path)).toEqual(['.git'])
    expect(git(path, 'ls-files')).toBe('')
    expect(git(path, 'log', '--format=%s|%an')).toBe('Initial commit|Ada Lorne')
    expect(inspection).toMatchObject({ path, isGitRepo: true, remote: null, defaultBranch: 'main', commitCount: 1 })
  })

  it('scaffolds nothing in an empty folder: no framework, no template, no .gitignore', () => {
    const path = folder()

    initialiseRepo(path, { author: 'Ada' })

    expect(readdirSync(path)).toEqual(['.git'])
    expect(git(path, 'ls-tree', '-r', '--name-only', 'HEAD')).toBe('')
  })

  it('starts in place in a folder that holds files, keeping every one of them as it was', () => {
    const path = folder({ 'notes.md': 'my plan\n', 'sketch.txt': 'v1\n' })

    initialiseRepo(path, { author: 'Ada' })

    expect(readFileSync(join(path, 'notes.md'), 'utf8')).toBe('my plan\n')
    expect(git(path, 'ls-files').split('\n')).toEqual(['notes.md', 'sketch.txt'])
    expect(git(path, 'status', '--porcelain')).toBe('')
  })

  it('refuses a folder inside another repo’s worktree, and touches nothing there', () => {
    const outer = folder({ 'README.md': '# outer\n' })
    git(outer, 'init', '--quiet')
    mkdirSync(join(outer, 'packages'))
    const inside = join(outer, 'packages', 'new-thing')

    expect(() => initialiseRepo(inside, { author: 'Ada' })).toThrow(`is inside the repository at ${outer}`)
    expect(() => initialiseRepo(join(outer, 'packages'), { author: 'Ada' })).toThrow(
      `inside the repository at ${outer}`,
    )
    expect(existsSync(inside)).toBe(false)
    expect(existsSync(join(outer, 'packages', '.git'))).toBe(false)
  })

  it('leaves a repo with no remote, which is an end state: worktrees branch from it and nothing asks for origin', () => {
    const path = join(folder(), 'solo')
    initialiseRepo(path, { author: 'Ada' })

    const service = createGitService()
    expect(service.hasRemote(path)).toBe(false)
    expect(service.addWorktree({ repoPath: path, path: join(path, '..', 'wt'), branch: 'ticket-1' })).toMatchObject({
      base: 'main',
    })
  })
})

describe('What starting a repo would do', () => {
  it('says it creates a folder that does not exist yet', () => {
    const path = join(folder(), 'payments-web')

    expect(planRepoStart(path)).toEqual({ kind: 'new-folder', path })
    expect(existsSync(path)).toBe(false)
  })

  it('tells an empty folder from one that holds files, and counts them', () => {
    expect(planRepoStart(folder())).toMatchObject({ kind: 'empty' })
    expect(planRepoStart(folder({ 'a.md': '', 'b.md': '' }))).toMatchObject({ kind: 'in-place', files: 2 })
  })

  it('refuses, with the reason, a repo, a folder inside one, a file and a missing parent', () => {
    const repo = folder()
    git(repo, 'init', '--quiet')
    mkdirSync(join(repo, 'sub'))
    const file = join(folder({ 'x.txt': '' }), 'x.txt')

    expect(planRepoStart(repo)).toMatchObject({
      kind: 'refused',
      reason: expect.stringContaining('already a git repository'),
    })
    expect(planRepoStart(join(repo, 'sub'))).toMatchObject({
      kind: 'refused',
      reason: expect.stringContaining(`inside the repository at ${repo}`),
    })
    expect(planRepoStart(join(repo, 'sub', 'new'))).toMatchObject({ kind: 'refused' })
    expect(planRepoStart(file)).toMatchObject({ kind: 'refused', reason: expect.stringContaining('is a file') })
    expect(planRepoStart(join(folder(), 'a', 'b'))).toMatchObject({
      kind: 'refused',
      reason: expect.stringContaining('does not exist'),
    })
    expect(planRepoStart('relative/app')).toMatchObject({
      kind: 'refused',
      reason: expect.stringContaining('absolute'),
    })
  })
})

describe('.gitignore per stack', () => {
  it('ignores what each stack builds', () => {
    expect(gitignoreFor({ language: 'TypeScript' })).toContain('dist/')
    expect(gitignoreFor({ language: 'Rust' })).toContain('target/')
    expect(gitignoreFor({ language: 'Go' })).toContain('*.test')
    expect(gitignoreFor({})).toBeNull()
  })
})
