/**
 * The GitLab adapter against a real `glab`, signed in on this Mac. Run with `pnpm test:claude`;
 * skipped wherever `glab` is missing or signed out, which includes CI.
 *
 * It only reads. The fake `glab` in `fake-glab.ts` is what the conformance suite trusts, and this
 * is what keeps that fake honest: the same questions, asked of the real CLI, against a public
 * project on gitlab.com — the status command, a branch with no merge request, and one merge
 * request that was merged long ago. Nothing here opens, comments on or merges anything, and no
 * repository of anyone's is written to.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { forgeEntry } from '../../../shared/forges'
import { runForge } from '../run-forge'
import { createGitlabAdapter, GLAB_ENV } from './adapter'

const entry = forgeEntry('gitlab')

/** A public project and one of its merge requests that was merged, so it never changes again. */
const PROJECT = 'https://gitlab.com/gitlab-org/cli'
const MERGED = `${PROJECT}/-/merge_requests/3953`

function signedIn(): boolean {
  try {
    execFileSync(entry.command, ['auth', 'status', '--hostname', 'gitlab.com'], {
      stdio: 'ignore',
      timeout: 20_000,
      env: { ...process.env, ...GLAB_ENV },
    })
    return true
  } catch {
    return false
  }
}

describe.skipIf(!signedIn())('The GitLab adapter against a real glab', () => {
  const adapter = createGitlabAdapter({ command: entry.command, name: entry.name, runForge })
  let checkout: string

  beforeAll(() => {
    // A checkout with nothing in it but an `origin`, which is all glab reads the project from.
    checkout = mkdtempSync(join(tmpdir(), 'gitlab-itest-'))
    execFileSync('git', ['init', '--quiet'], { cwd: checkout })
    execFileSync('git', ['remote', 'add', 'origin', `${PROJECT}.git`], { cwd: checkout })
  })

  afterAll(() => {
    rmSync(checkout, { recursive: true, force: true })
  })

  it('says it is ready, and who it is signed in as on which host', async () => {
    const check = await adapter.checkCli()

    expect(check.state).toBe('ready')
    expect(check.account).toMatch(/\S+ on gitlab\.com/)
  })

  it('answers null for a branch with no merge request, reading the project from the checkout', async () => {
    const found = await adapter.findPullRequest({ cwd: checkout, branch: `tinycorp-itest-${Date.now()}` })

    expect(found).toBeNull()
  })

  it('reads a merge request in the contract’s words', async () => {
    const view = await adapter.readPullRequest({ cwd: checkout, url: MERGED })

    expect(view.state).toBe('merged')
    expect(view.base).toBe('main')
    expect(view.head).not.toBe('')
    expect(view.additions + view.deletions).toBeGreaterThan(0)
    expect(view.changedFiles).toBeGreaterThan(0)
    expect(view.checks.length).toBeGreaterThan(0)
    for (const check of view.checks) {
      expect(['passing', 'failing', 'pending', 'skipped']).toContain(check.state)
      expect(check.workflow).not.toBe('')
    }
  })

  it('reads the merge request’s whole change as a unified patch', async () => {
    const patch = await adapter.readDiff({ cwd: checkout, url: MERGED })

    expect(patch.startsWith('diff --git a/')).toBe(true)
    expect(patch).toMatch(/^@@ -\d+(,\d+)? \+\d+(,\d+)? @@/m)
  })

  it('fails a merge request nobody can see with words the boss can read', async () => {
    const failure = await adapter
      .readPullRequest({ cwd: checkout, url: `${PROJECT}/-/merge_requests/999999999` })
      .then(() => null)
      .catch((error: unknown) => (error instanceof Error ? error.message : String(error)))

    expect(failure).toMatch(/no merge request !999999999 in gitlab-org\/cli/)
  })
})
