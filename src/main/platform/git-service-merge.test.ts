import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { PullRequestCheck } from '../../shared/code'
import { fakeForge } from '../forges/testing'
import { createGitService } from './git-service'

const scratch: string[] = []
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

/** A clone of a bare `origin` with one commit on `main`, and a Company folder. */
function scratchRepo() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'git-merge-')))
  scratch.push(root)
  const origin = join(root, 'origin.git')
  const repo = join(root, 'app')
  execFileSync('git', ['init', '--bare', '--initial-branch=main', origin])
  execFileSync('git', ['init', '--initial-branch=main', repo])
  writeFileSync(join(repo, 'README.md'), '# app\n')
  git(repo, 'add', '.')
  git(repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'init')
  git(repo, 'remote', 'add', 'origin', origin)
  git(repo, 'push', '-u', 'origin', 'main')
  // `origin` reads as a forge the app has an adapter for; pushes still go to the bare repo.
  git(repo, 'remote', 'set-url', 'origin', 'https://github.com/acme/app.git')
  git(repo, 'config', 'remote.origin.pushurl', origin)
  const company = join(root, 'company')
  mkdirSync(company)
  return { root, origin, repo, company }
}

const url = 'https://github.com/acme/app/pull/42'

describe('Git service: review and merge', () => {
  it('merges a PR through the repo’s forge, from the repo', async () => {
    const { repo } = scratchRepo()
    const forge = fakeForge()

    await createGitService({ forges: { github: forge } }).mergePullRequest({ repoPath: repo, url })

    expect(forge.merges).toEqual([{ cwd: repo, url }])
  })

  it('comments on a PR through the repo’s forge', async () => {
    const { repo } = scratchRepo()
    const forge = fakeForge()

    await createGitService({ forges: { github: forge } }).commentOnPullRequest({
      repoPath: repo,
      url,
      body: 'Looks good',
    })

    expect(forge.comments).toEqual([{ cwd: repo, url, body: 'Looks good' }])
  })

  it('reads a PR’s CI state off the checks its forge reports, in one read', async () => {
    const { repo } = scratchRepo()
    const forge = fakeForge()
    const service = createGitService({ forges: { github: forge } })
    const read = async (checks: PullRequestCheck[]) => {
      forge.setView({ checks })
      return service.pullRequestChecks({ repoPath: repo, url })
    }
    const check = (name: string, state: PullRequestCheck['state']): PullRequestCheck => ({
      name,
      workflow: 'ci',
      state,
      durationMs: null,
    })

    expect(await read([check('build', 'passing'), check('deploy', 'skipped')])).toBe('passing')
    expect(await read([check('build', 'passing'), check('test', 'failing')])).toBe('failing')
    expect(await read([check('build', 'passing'), check('test', 'pending')])).toBe('pending')
    expect(await read([])).toBe('none')
    // One read answers both what the card draws and whether CI is red: the forge is asked once.
    expect(forge.reads).toHaveLength(4)
  })

  it('refuses to merge a PR in a repo whose forge it has no adapter for', async () => {
    const { repo } = scratchRepo()
    git(repo, 'remote', 'set-url', 'origin', 'https://gitlab.example.com/acme/app.git')

    await expect(
      createGitService({ forges: { github: fakeForge() } }).mergePullRequest({ repoPath: repo, url }),
    ).rejects.toThrow(/No adapter for gitlab.example.com/)
  })

  it('removes a merged worktree and its branch, locally and on origin', async () => {
    const { origin, repo, company } = scratchRepo()
    const service = createGitService({ forges: { github: fakeForge() } })
    const path = join(company, 'worktrees', 'app', 'ticket-1-login')
    service.addWorktree({ repoPath: repo, path, branch: 'ticket-1-login' })
    writeFileSync(join(path, 'wip.ts'), 'export {}\n')
    git(path, 'push', 'origin', 'ticket-1-login')

    await service.removeWorktree({ repoPath: repo, path, branch: 'ticket-1-login' })

    expect(existsSync(path)).toBe(false)
    expect(git(repo, 'worktree', 'list')).not.toContain(path)
    expect(git(repo, 'branch', '--list', 'ticket-1-login')).toBe('')
    expect(git(origin, 'branch', '--list', 'ticket-1-login')).toBe('')
  })

  it('removes nothing more when the worktree and branch are already gone', async () => {
    const { repo, company } = scratchRepo()
    const service = createGitService({ forges: { github: fakeForge() } })

    await expect(
      service.removeWorktree({ repoPath: repo, path: join(company, 'gone'), branch: 'ticket-9' }),
    ).resolves.toBe(undefined)
  })
})
