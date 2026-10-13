import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { FoundRepo } from '../../../shared/repos/found-repos'
import { onDisk } from '../../core/testing'
import { diskWalkDeps, type WalkDeps, type WalkEntry, walkForRepos } from './repo-walk'

const temps: string[] = []
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/**
 * The boss's reference folder, on disk: repos at the top, group folders, one a level deeper,
 * worktrees and a submodule, a `node_modules` with a checkout in it, a symlink loop, and a folder
 * that holds only loose files.
 */
function referenceFolder(): string {
  const root = mkdtempSync(join(tmpdir(), 'bo-walk-'))
  temps.push(root)
  const repo = (...parts: string[]) => {
    const path = join(root, ...parts)
    mkdirSync(join(path, '.git'), { recursive: true })
    return path
  }
  const link = (at: string, gitdir: string) => {
    mkdirSync(join(root, at), { recursive: true })
    writeFileSync(join(root, at, '.git'), `gitdir: ${gitdir}\n`)
  }

  for (const name of ['core', 'gitops', 'k8s']) repo(name)
  repo('payments', 'checkout-api')
  repo('payments', 'refunds')
  const subscriptions = repo('payments', 'subscriptions')
  repo('payments', 'nested', 'deeper', 'inner-api')
  link(
    join('payments', 'subscriptions', 'worktrees', 'retry-backoff'),
    join(subscriptions, '.git', 'worktrees', 'retry-backoff'),
  )
  link(join('payments', 'subscriptions', 'vendored'), join(subscriptions, '.git', 'modules', 'vendored'))

  // Never offered, never entered: a checkout vendored into node_modules and a build folder.
  mkdirSync(join(root, 'payments', 'checkout-api', 'node_modules', 'dep', '.git'), { recursive: true })
  mkdirSync(join(root, 'dist', 'bundled', '.git'), { recursive: true })

  // Loose files and nothing else.
  mkdirSync(join(root, 'notes'), { recursive: true })
  writeFileSync(join(root, 'notes', 'todo.md'), 'nothing here')

  // A symlink that points back at the root: following it would never end.
  symlinkSync(root, join(root, 'payments', 'loop'), 'dir')
  return root
}

async function walk(root: string, options = {}) {
  return walkForRepos(root, diskWalkDeps, options)
}

describe('Walking a folder for repos', () => {
  it('finds every checkout in the reference folder and says what it is', async () => {
    const root = referenceFolder()

    const result = await walk(root)

    expect(result.stopped).toBe('done')
    expect(kinds(result.found, 'repo')).toEqual([
      'core',
      'gitops',
      'k8s',
      'payments/checkout-api',
      'payments/refunds',
      'payments/subscriptions',
      'payments/nested/deeper/inner-api',
    ])
    expect(result.found.filter((one) => one.kind === 'worktree')).toEqual([
      {
        path: join(root, 'payments', 'subscriptions', 'worktrees', 'retry-backoff'),
        relative: 'payments/subscriptions/worktrees/retry-backoff',
        kind: 'worktree',
        parent: 'subscriptions',
      },
    ])
    expect(result.found.filter((one) => one.kind === 'submodule')).toEqual([
      {
        path: join(root, 'payments', 'subscriptions', 'vendored'),
        relative: 'payments/subscriptions/vendored',
        kind: 'submodule',
        parent: 'subscriptions',
      },
    ])
  })

  it('never enters node_modules, a build folder, a dot-folder or a symlink, and counts the empty ones', async () => {
    const root = referenceFolder()

    const result = await walk(root)

    expect(result.found.some((one) => one.relative.includes('node_modules'))).toBe(false)
    expect(result.found.some((one) => one.relative.startsWith('dist'))).toBe(false)
    expect(result.found.some((one) => one.relative.includes('loop'))).toBe(false)
    expect(result.found.some((one) => one.relative.includes('.git/'))).toBe(false)
    // Only `notes` counts as empty: `dist` is on the skip list, so the walk never looked inside it.
    expect(result.emptyFolders).toBe(1)
  })

  it('offers the picked folder itself when it is a repo too, and still finds what is inside it', async () => {
    const root = referenceFolder()
    mkdirSync(join(root, '.git'), { recursive: true })

    const result = await walk(root)

    expect(result.found[0]).toMatchObject({ path: root, relative: '', kind: 'repo' })
    expect(kinds(result.found, 'repo')).toContain('payments/checkout-api')
  })

  it('stops at its depth, breadth-first, so the shallow ones arrive first', async () => {
    const root = referenceFolder()

    const shallow = await walk(root, { depth: 2 })

    expect(kinds(shallow.found, 'repo')).toEqual([
      'core',
      'gitops',
      'k8s',
      'payments/checkout-api',
      'payments/refunds',
      'payments/subscriptions',
    ])
  })

  it('streams each checkout as it is found, and where it is', async () => {
    const root = referenceFolder()
    const streamed: string[] = []
    const visited: string[] = []

    const result = await walk(root, {
      onFound: (one: FoundRepo) => streamed.push(one.relative),
      onProgress: (at: string) => visited.push(at),
    })

    expect(streamed).toEqual(result.found.map((one) => one.relative))
    expect(visited[0]).toBe('')
    expect(visited).toContain('payments/subscriptions')
  })

  it('reads a real git worktree the way git writes it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bo-walk-real-'))
    temps.push(root)
    const main = join(root, 'acme', 'web')
    mkdirSync(main, { recursive: true })
    execFileSync('git', ['init', '-q', '-b', 'main', main])
    execFileSync('git', ['-C', main, 'commit', '-q', '--allow-empty', '-m', 'first'], {
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'T',
        GIT_AUTHOR_EMAIL: 't@t',
        GIT_COMMITTER_NAME: 'T',
        GIT_COMMITTER_EMAIL: 't@t',
      },
    })
    execFileSync('git', ['-C', main, 'worktree', 'add', '-q', '-b', 'fix', join(root, 'acme', 'web-fix')])

    const result = await walk(root)

    expect(result.found.map((one) => [one.relative, one.kind, one.parent])).toEqual([
      ['acme/web', 'repo', null],
      ['acme/web-fix', 'worktree', 'web'],
    ])
  })
})

describe('Giving up on a walk', () => {
  it('stops when it is cancelled and reports what it had', async () => {
    const root = referenceFolder()
    let folders = 0

    const result = await walk(root, { cancelled: () => folders++ >= 3 })

    expect(result.stopped).toBe('cancelled')
    expect(result.found.length).toBeGreaterThan(0)
    expect(result.found.length).toBeLessThan(7)
  })

  it('stops at its time box, keeping what it found, and never runs on forever', async () => {
    let clock = 0
    const deps: WalkDeps = {
      // A folder that always has one more folder inside it, one level down, for ever.
      entries: (path) =>
        Promise.resolve([
          { name: '.git', folder: true, symlink: false },
          { name: `sub${path.length}`, folder: true, symlink: false },
        ] satisfies WalkEntry[]),
      readGitFile: () => Promise.resolve(null),
      // Every folder read costs a second.
      now: () => (clock += 1000),
    }

    const result = await walkForRepos(onDisk('/code'), deps, { depth: 1000, budgetMs: 15_000 })

    expect(result.stopped).toBe('timed-out')
    expect(result.found.length).toBeLessThanOrEqual(16)
    expect(result.found.length).toBeGreaterThan(0)
  })

  it('refuses a folder that is not absolute', async () => {
    await expect(walkForRepos('code', diskWalkDeps)).rejects.toThrow('absolute')
  })
})

function kinds(found: FoundRepo[], kind: FoundRepo['kind']): string[] {
  return found.filter((one) => one.kind === kind).map((one) => one.relative)
}
