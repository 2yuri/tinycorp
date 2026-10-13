import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FAKE_PR_URL, fakeForge } from '../forges/testing'
import { branchName, createGitService, INJECTED_PATHS } from './git-service'

const scratch: string[] = []
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

/**
 * The worktrees git lists, each resolved: git answers with forward slashes on every platform, so
 * its own spelling is never the one the app handed it (T166).
 */
function worktreesOf(repo: string): string[] {
  return git(repo, 'worktree', 'list')
    .split('\n')
    .map((line) => resolve(line.split(' ')[0]!))
}

/** A repo with one commit on `main`, cloned from a bare `origin`, plus a Company folder. */
function scratchRepo() {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'git-service-')))
  scratch.push(root)
  const origin = join(root, 'origin.git')
  const seed = join(root, 'seed')
  execFileSync('git', ['init', '--bare', '--initial-branch=main', origin])
  execFileSync('git', ['init', '--initial-branch=main', seed])
  const identity = ['-c', 'user.name=Test', '-c', 'user.email=test@example.com']
  writeFileSync(join(seed, 'README.md'), '# app\n')
  git(seed, 'add', '.')
  git(seed, ...identity, 'commit', '-m', 'init')
  git(seed, 'push', origin, 'main')
  const repo = join(root, 'app')
  execFileSync('git', ['clone', origin, repo], { stdio: 'ignore' })
  const company = join(root, 'company')
  mkdirSync(company)
  return { root, origin, repo, company, identity }
}

/**
 * Points the repo's `origin` at a forge the app has an adapter for, while pushes still go to the
 * bare repo next door. `git remote get-url` answers the forge URL, which is what picks the adapter;
 * `git push` follows the push URL, which is what makes a test repo a test repo.
 */
function onGithub(repo: string, origin: string): void {
  git(repo, 'remote', 'set-url', 'origin', 'https://github.com/acme/app.git')
  git(repo, 'config', 'remote.origin.pushurl', origin)
}

describe('Git service', () => {
  it('names branches after the ticket’s display id', () => {
    expect(branchName('TC', 12, 'Magic-link login: API & UI!')).toBe('ticket-tc-12-magic-link-login-api-ui')
    expect(branchName('TC', 3, '   ')).toBe('ticket-tc-3')
    expect(branchName('ZETA', 7, 'a'.repeat(80))).toBe(`ticket-zeta-7-${'a'.repeat(40)}`)
  })

  it('adds a worktree on a new branch from the default branch', () => {
    const { repo, company } = scratchRepo()
    const path = join(company, 'worktrees', 'app', 'ticket-1-login')

    const added = createGitService().addWorktree({ repoPath: repo, path, branch: 'ticket-1-login' })

    expect(added).toEqual({ path, branch: 'ticket-1-login', base: 'main' })
    expect(git(path, 'branch', '--show-current')).toBe('ticket-1-login')
    expect(readFileSync(join(path, 'README.md'), 'utf8')).toBe('# app\n')
    expect(worktreesOf(repo)).toContain(resolve(path))
  })

  it('starts a new branch from a chosen base branch, from origin first, else the local branch', () => {
    const { root, origin, repo, company, identity } = scratchRepo()
    const seed = join(root, 'seed')
    git(seed, 'checkout', '-b', 'release')
    writeFileSync(join(seed, 'CHANGELOG.md'), 'v2\n')
    git(seed, 'add', '.')
    git(seed, ...identity, 'commit', '-m', 'release')
    git(seed, 'push', origin, 'release')
    git(repo, 'fetch', 'origin')
    git(repo, 'branch', 'local-only', 'HEAD')
    const service = createGitService()
    const fromOrigin = join(company, 'worktrees', 'app', 'ticket-1-fix')
    const fromLocal = join(company, 'worktrees', 'app', 'ticket-2-fix')

    const added = service.addWorktree({ repoPath: repo, path: fromOrigin, branch: 'ticket-1-fix', base: 'release' })
    const local = service.addWorktree({ repoPath: repo, path: fromLocal, branch: 'ticket-2-fix', base: 'local-only' })

    expect(added).toEqual({ path: fromOrigin, branch: 'ticket-1-fix', base: 'release' })
    expect(readFileSync(join(fromOrigin, 'CHANGELOG.md'), 'utf8')).toBe('v2\n')
    expect(local.base).toBe('local-only')
    expect(existsSync(join(fromLocal, 'CHANGELOG.md'))).toBe(false)
    expect(() =>
      service.addWorktree({ repoPath: repo, path: join(company, 'x'), branch: 'ticket-3-x', base: 'nope' }),
    ).toThrow('has no branch nope to start from')
  })

  it('reuses an existing worktree, and an existing branch when the worktree is gone', () => {
    const { repo, company, identity } = scratchRepo()
    const service = createGitService()
    const path = join(company, 'worktrees', 'app', 'ticket-1-login')
    service.addWorktree({ repoPath: repo, path, branch: 'ticket-1-login' })
    writeFileSync(join(path, 'login.ts'), 'export {}\n')
    git(path, 'add', '.')
    git(path, ...identity, 'commit', '-m', 'login')

    const again = service.addWorktree({ repoPath: repo, path, branch: 'ticket-1-login' })
    git(repo, 'worktree', 'remove', '--force', path)
    const restored = service.addWorktree({ repoPath: repo, path, branch: 'ticket-1-login' })

    expect(again).toEqual({ path, branch: 'ticket-1-login', base: 'main' })
    expect(restored).toEqual({ path, branch: 'ticket-1-login', base: 'main' })
    expect(existsSync(join(path, 'login.ts'))).toBe(true)
  })

  it('keeps injected files out of every commit made in the worktree', () => {
    const { repo, company, identity } = scratchRepo()
    const path = join(company, 'worktrees', 'app', 'ticket-2-signup')
    createGitService().addWorktree({ repoPath: repo, path, branch: 'ticket-2-signup' })
    writeFileSync(join(path, 'CLAUDE.md'), '# You are Ada\n')
    mkdirSync(join(path, '.claude'))
    writeFileSync(join(path, '.claude', 'settings.json'), '{}\n')
    mkdirSync(join(path, 'memory'))
    writeFileSync(join(path, 'memory', 'ada.md'), 'notes\n')
    writeFileSync(join(path, 'MEMORY.md'), 'notes\n')
    writeFileSync(join(path, 'signup.ts'), 'export {}\n')

    git(path, 'add', '-A')
    git(path, ...identity, 'commit', '-m', 'signup')

    expect(git(path, 'show', '--name-only', '--format=', 'HEAD').split('\n')).toEqual(['signup.ts'])
    expect(git(path, 'status', '--porcelain')).toBe('')
    const exclude = readFileSync(join(repo, '.git', 'info', 'exclude'), 'utf8').split('\n')
    expect(exclude).toEqual(expect.arrayContaining([...INJECTED_PATHS]))
  })

  it('does not repeat exclude lines when adding more worktrees', () => {
    const { repo, company } = scratchRepo()
    const service = createGitService()
    service.addWorktree({ repoPath: repo, path: join(company, 'a'), branch: 'ticket-1' })
    service.addWorktree({ repoPath: repo, path: join(company, 'b'), branch: 'ticket-2' })

    const exclude = readFileSync(join(repo, '.git', 'info', 'exclude'), 'utf8').split('\n')
    expect(exclude.filter((line) => line === 'CLAUDE.md')).toHaveLength(1)
  })

  it('refuses a folder that is not a git repo', () => {
    const { root, company } = scratchRepo()
    const notRepo = join(root, 'plain')
    mkdirSync(notRepo)

    expect(() =>
      createGitService().addWorktree({ repoPath: notRepo, path: join(company, 'x'), branch: 'ticket-1' }),
    ).toThrow(/git/i)
  })

  it('pushes the branch, then asks the repo’s forge to open the PR', async () => {
    const { origin, repo, company, identity } = scratchRepo()
    onGithub(repo, origin)
    const forge = fakeForge()
    const service = createGitService({ forges: { github: forge } })
    const path = join(company, 'wt')
    service.addWorktree({ repoPath: repo, path, branch: 'ticket-3-api' })
    writeFileSync(join(path, 'api.ts'), 'export {}\n')
    git(path, 'add', '.')
    git(path, ...identity, 'commit', '-m', 'api')

    const pr = await service.openPullRequest({
      path,
      branch: 'ticket-3-api',
      base: 'main',
      title: '#3 API',
      body: 'Ticket #3',
    })

    expect(pr).toEqual({ url: FAKE_PR_URL, number: 42 })
    expect(git(origin, 'rev-parse', 'ticket-3-api')).toBe(git(path, 'rev-parse', 'HEAD'))
    expect(forge.opened).toEqual([
      { cwd: path, branch: 'ticket-3-api', base: 'main', title: '#3 API', body: 'Ticket #3' },
    ])
  })

  it('lands on the PR the branch already has when the forge refuses a second one', async () => {
    const { origin, repo, company } = scratchRepo()
    onGithub(repo, origin)
    const forge = fakeForge()
    forge.failOpen('a pull request for branch "ticket-4" already exists')
    forge.existing = { url: 'https://github.com/acme/app/pull/7', number: 7 }
    const service = createGitService({ forges: { github: forge } })
    const path = join(company, 'wt')
    service.addWorktree({ repoPath: repo, path, branch: 'ticket-4' })

    const pr = await service.openPullRequest({ path, branch: 'ticket-4', base: 'main', title: 't', body: 'b' })

    expect(pr).toEqual({ url: 'https://github.com/acme/app/pull/7', number: 7 })
    expect(forge.searched).toEqual([{ cwd: path, branch: 'ticket-4' }])
  })

  it('fails with the forge’s own message when the PR cannot be opened', async () => {
    const { origin, repo, company } = scratchRepo()
    onGithub(repo, origin)
    const forge = fakeForge()
    forge.failOpen('No commits between main and ticket-5')
    const service = createGitService({ forges: { github: forge } })
    const path = join(company, 'wt')
    service.addWorktree({ repoPath: repo, path, branch: 'ticket-5' })

    await expect(
      service.openPullRequest({ path, branch: 'ticket-5', base: 'main', title: 't', body: 'b' }),
    ).rejects.toThrow(/No commits between main and ticket-5/)
  })

  it('refuses a PR, in words, in a repo on a forge it has no adapter for — and pushes nothing', async () => {
    const { repo, company } = scratchRepo()
    git(repo, 'remote', 'set-url', 'origin', 'git@code.example.com:acme/app.git')
    const forge = fakeForge()
    const service = createGitService({ forges: { github: forge } })
    const path = join(company, 'wt')
    service.addWorktree({ repoPath: repo, path, branch: 'ticket-6' })

    expect(service.hasRemote(repo)).toBe(true)
    expect(service.forgeOf(repo)).toBeNull()
    expect(service.pullRequestRefusal(repo)).toBe('No adapter for code.example.com, cannot open a PR')
    await expect(
      service.openPullRequest({ path, branch: 'ticket-6', base: 'main', title: 't', body: 'b' }),
    ).rejects.toThrow(/No adapter for code.example.com/)
    expect(forge.opened).toEqual([])
  })

  it('says the forge’s CLI is missing rather than letting a PR fail later', () => {
    const { origin, repo } = scratchRepo()
    onGithub(repo, origin)
    const forge = fakeForge()
    forge.setInstalled(false)
    const service = createGitService({ forges: { github: forge } })

    expect(service.forgeOf(repo)).toBe('github')
    expect(service.pullRequestRefusal(repo)).toBe(
      'GitHub needs the gh command, which is not installed here, so no PR can be opened',
    )
  })

  it('has no refusal for a repo on a forge it can open a PR on', () => {
    const { origin, repo } = scratchRepo()
    onGithub(repo, origin)

    const service = createGitService({ forges: { github: fakeForge() } })

    expect(service.pullRequestRefusal(repo)).toBeNull()
    expect(service.forgeOf(repo)).toBe('github')
  })
})
