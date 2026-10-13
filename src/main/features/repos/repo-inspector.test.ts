import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { onDisk } from '../../core/testing'
import { createRepoInspector, displayRemote, type InspectorDeps, inspectMany } from './repo-inspector'

function fakeDeps(files: Record<string, string>, git: Record<string, string> = {}): InspectorDeps {
  return {
    list: (folder) =>
      Object.keys(files)
        .filter((path) => path.startsWith(folder + sep))
        .map((path) => path.slice(folder.length + 1)),
    readFile: (path) => files[path] ?? null,
    git: (_cwd, args) => git[args.join(' ')] ?? null,
  }
}

describe('Repo inspector', () => {
  it('reads origin, the default branch and the history of a checkout', () => {
    const inspect = createRepoInspector(
      fakeDeps(
        { [onDisk('/code/web/.git')]: '' },
        {
          'remote get-url origin': 'git@github.com:acme/web.git',
          'symbolic-ref --short refs/remotes/origin/HEAD': 'origin/trunk',
          'rev-list --count origin/trunk': '1284',
          'log -1 --format=%cI origin/trunk': '2026-09-17T08:00:00+00:00',
        },
      ),
    )

    expect(inspect(onDisk('/code/web'))).toEqual({
      path: onDisk('/code/web'),
      isGitRepo: true,
      remote: 'github.com/acme/web',
      defaultBranch: 'trunk',
      commitCount: 1284,
      lastCommitAt: '2026-09-17T08:00:00+00:00',
      detected: {},
    })
  })

  it('falls back to the checked-out branch and leaves unknowns null', () => {
    const inspect = createRepoInspector(
      fakeDeps({ [onDisk('/code/web/.git')]: '' }, { 'rev-parse --abbrev-ref HEAD': 'main' }),
    )

    expect(inspect(onDisk('/code/web'))).toMatchObject({
      isGitRepo: true,
      remote: null,
      defaultBranch: 'main',
      commitCount: null,
      lastCommitAt: null,
    })
  })

  it('says a folder without .git is not a git repo', () => {
    const inspect = createRepoInspector(fakeDeps({ '/notes/readme.md': '' }))

    expect(inspect('/notes')).toMatchObject({ isGitRepo: false, remote: null, defaultBranch: null })
  })

  it('shows remotes without protocol, user or .git', () => {
    expect(displayRemote('https://github.com/acme/web.git')).toBe('github.com/acme/web')
    expect(displayRemote('ssh://git@gitlab.com/acme/api.git')).toBe('gitlab.com/acme/api')
    expect(displayRemote('git@bitbucket.org:acme/infra')).toBe('bitbucket.org/acme/infra')
  })

  it('detects a pnpm TypeScript React project from package.json and its lockfile', () => {
    const inspect = createRepoInspector(
      fakeDeps({
        [onDisk('/code/web/.git')]: '',
        [onDisk('/code/web/pnpm-lock.yaml')]: '',
        [onDisk('/code/web/tsconfig.json')]: '{}',
        [onDisk('/code/web/biome.json')]: '{}',
        [onDisk('/code/web/package.json')]: JSON.stringify({
          packageManager: 'pnpm@9.12.0',
          scripts: { build: 'vite build', test: 'vitest run' },
          dependencies: { react: '^19' },
        }),
      }),
    )

    expect(inspect(onDisk('/code/web')).detected).toEqual({
      language: 'TypeScript',
      framework: 'React',
      packageManager: 'pnpm',
      packageManagerVersion: '9',
      install: 'pnpm install',
      build: 'pnpm build',
      test: 'pnpm test',
      lint: 'biome check .',
    })
  })

  it('uses npm run for npm scripts and leaves out what it cannot find', () => {
    const inspect = createRepoInspector(
      fakeDeps({
        [onDisk('/code/api/.git')]: '',
        [onDisk('/code/api/package-lock.json')]: '',
        [onDisk('/code/api/package.json')]: JSON.stringify({
          scripts: { lint: 'eslint .', test: 'node --test' },
          dependencies: { fastify: '^5' },
        }),
      }),
    )

    expect(inspect(onDisk('/code/api')).detected).toEqual({
      language: 'JavaScript',
      framework: 'Fastify',
      packageManager: 'npm',
      install: 'npm install',
      test: 'npm test',
      lint: 'npm run lint',
    })
  })

  it('detects Go modules', () => {
    const inspect = createRepoInspector(fakeDeps({ [onDisk('/code/svc/.git')]: '', [onDisk('/code/svc/go.mod')]: '' }))

    expect(inspect(onDisk('/code/svc')).detected).toMatchObject({ language: 'Go', test: 'go test ./...' })
  })
})

describe('Repo inspector on disk', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('reads a real git checkout', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tinycorp-inspect-'))
    dirs.push(dir)
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' })
    git('init', '-q', '-b', 'main')
    git('remote', 'add', 'origin', 'https://github.com/acme/real.git')
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { build: 'tsc' } }))
    git('add', '.')
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init')

    const found = createRepoInspector()(dir)

    expect(found).toMatchObject({
      isGitRepo: true,
      remote: 'github.com/acme/real',
      defaultBranch: 'main',
      commitCount: 1,
      detected: { packageManager: 'npm', build: 'npm run build' },
    })
    expect(found.lastCommitAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})

describe('Reading several checkouts', () => {
  it('reads them a capful at a time, giving the process a turn between batches', async () => {
    const order: string[] = []
    const paths = ['a', 'b', 'c', 'd', 'e']

    const read = await inspectMany(
      paths,
      (path) => {
        order.push(path)
        return {
          path,
          isGitRepo: true,
          remote: null,
          defaultBranch: null,
          commitCount: null,
          lastCommitAt: null,
          detected: {},
        }
      },
      {
        cap: 2,
        breathe: () => {
          order.push('—')
          return Promise.resolve()
        },
      },
    )

    expect(order).toEqual(['a', 'b', '—', 'c', 'd', '—', 'e'])
    expect(Object.keys(read)).toEqual(paths)
  })

  it('reads nothing for no paths, and never breathes before the first batch', async () => {
    let breaths = 0
    const breathe = () => {
      breaths += 1
      return Promise.resolve()
    }
    const never = () => {
      throw new Error('nothing to read')
    }

    expect(await inspectMany([], never, { breathe })).toEqual({})
    expect(breaths).toBe(0)
  })
})
