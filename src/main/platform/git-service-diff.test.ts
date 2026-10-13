import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { diffFilesOf } from '../../shared/review/diff-parse'
import { fakeForge } from '../forges/testing'
import { createGitService } from './git-service'

const scratch: string[] = []
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

// A machine with `commit.gpgsign` on would have these fixtures ask its GPG agent to sign.
const identity = ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false']

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', [...identity, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

/** A repo with no remote, `main` holding one file and a branch that changes it and adds another. */
function scratchRepo() {
  const root = mkdtempSync(join(tmpdir(), 'git-diff-'))
  scratch.push(root)
  const repo = join(root, 'app')
  mkdirSync(repo)
  execFileSync('git', ['init', '--initial-branch=main', repo], { stdio: 'ignore' })
  writeFileSync(join(repo, 'currency.ts'), 'export function formatPrice(cents) {\n  return cents\n}\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-m', 'init')
  git(repo, 'checkout', '-b', 'ticket-1-currency')
  writeFileSync(join(repo, 'currency.ts'), 'export function formatPrice(cents) {\n  return cents / 100\n}\n')
  writeFileSync(join(repo, 'locale.ts'), 'export const LOCALE = "en-US"\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-m', 'format')
  return { root, repo }
}

/** A `gh` stand-in that records its arguments and prints `stdout`. */
const PR_URL = 'https://github.com/acme/app/pull/42'

/** Gives the repo an `origin` on a forge the app has an adapter for. Nothing is ever pushed here. */
function onGithub(repo: string): void {
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/acme/app.git'], { cwd: repo })
}

describe('Git service diffs', () => {
  it('reads a branch’s change in a repo without a remote, as a file list', async () => {
    const { repo } = scratchRepo()
    const service = createGitService()

    const patch = await service.branchDiff({ repoPath: repo, base: 'main', branch: 'ticket-1-currency' })

    expect(service.hasRemote(repo)).toBe(false)
    expect(diffFilesOf(patch).map((f) => [f.path, f.status, f.additions, f.deletions])).toEqual([
      ['currency.ts', 'modified', 1, 1],
      ['locale.ts', 'added', 1, 0],
    ])
  })

  /*
   * The two sides the diff editor is given (T243). `base...branch` is the merge base, which is the
   * side `branchDiff` counted from, so the editor and the file list can never disagree — and a
   * `main` that moved on after the branch left it does not turn into a wall of false removals.
   */
  it('reads a file at a revision, and answers null where that revision has no such file', async () => {
    const { repo } = scratchRepo()
    // `main` moves on after the branch left it, which is what makes the merge base the right side.
    git(repo, 'checkout', 'main')
    writeFileSync(join(repo, 'README.md'), '# app\n')
    git(repo, 'add', '.')
    git(repo, 'commit', '-m', 'readme')
    git(repo, 'checkout', 'ticket-1-currency')
    const service = createGitService()

    const base = await service.revision({ repoPath: repo, rev: 'main...ticket-1-currency' })
    const head = await service.revision({ repoPath: repo, rev: 'ticket-1-currency' })

    expect(base).toBe(git(repo, 'rev-parse', 'main~1'))
    expect(head).toBe(git(repo, 'rev-parse', 'ticket-1-currency'))
    expect(await service.fileAtRef({ repoPath: repo, ref: base!, path: 'currency.ts' })).toBe(
      'export function formatPrice(cents) {\n  return cents\n}\n',
    )
    expect(await service.fileAtRef({ repoPath: repo, ref: head!, path: 'currency.ts' })).toBe(
      'export function formatPrice(cents) {\n  return cents / 100\n}\n',
    )
    // A file the change added: the base has nothing to show for it.
    expect(await service.fileAtRef({ repoPath: repo, ref: base!, path: 'locale.ts' })).toBeNull()
    expect(await service.revision({ repoPath: repo, rev: 'no-such-branch' })).toBeNull()
  })

  it('asks the repo’s forge for the PR’s patch, from the repo', async () => {
    const { repo } = scratchRepo()
    onGithub(repo)
    const forge = fakeForge()
    forge.setPatch('diff --git a/a.ts b/a.ts')

    const patch = await createGitService({ forges: { github: forge } }).pullRequestDiff({
      repoPath: repo,
      url: PR_URL,
    })

    expect(patch).toBe('diff --git a/a.ts b/a.ts')
    expect(forge.diffs).toEqual([{ cwd: repo, url: PR_URL }])
  })

  it('posts a line comment through the repo’s forge, and answers where it landed', async () => {
    const { repo } = scratchRepo()
    onGithub(repo)
    const forge = fakeForge()

    const url = await createGitService({ forges: { github: forge } }).commentOnPullRequestLine({
      repoPath: repo,
      url: PR_URL,
      path: 'currency.ts',
      line: 2,
      body: 'Worth a fallback here.',
    })

    expect(url).toBe(`${PR_URL}#discussion_r1`)
    expect(forge.lineComments).toEqual([
      { cwd: repo, url: PR_URL, path: 'currency.ts', line: 2, body: 'Worth a fallback here.' },
    ])
  })
})
