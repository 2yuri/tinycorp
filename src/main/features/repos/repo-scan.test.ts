import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { hasChecks, type RepoInspection } from '../../../shared/repos/repo'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryDatabases, inMemoryRecents, onDisk, readyStack } from '../../core/testing'
import { createRepoInspector, type InspectRepo } from './repo-inspector'
import { attachRepos, diskFolders, scanForRepos } from './repo-scan'

const engines: CompanyEngine[] = []
const temps: string[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A fake disk: folder paths, the git checkouts among them, and what each checkout detects. */
function fakeDisk(folders: string[], repos: Record<string, Partial<RepoInspection>>) {
  const inspected: string[] = []
  const inspect: InspectRepo = (path) => {
    inspected.push(path)
    return {
      path,
      isGitRepo: path in repos,
      remote: null,
      defaultBranch: null,
      commitCount: null,
      lastCommitAt: null,
      detected: {},
      ...repos[path],
    }
  }
  const children = (path: string) =>
    folders
      .filter((folder) => folder.startsWith(path + sep) && !folder.slice(path.length + 1).includes(sep))
      .map((folder) => folder.slice(path.length + 1))
  return { deps: { folders: children, inspect }, inspected }
}

function engineWithCompany(isGitRepo = (path: string) => path.startsWith(onDisk('/code') + sep)) {
  const engine = createCompanyEngine({ openDatabase: inMemoryDatabases(), recents: inMemoryRecents(), isGitRepo })
  engines.push(engine)
  engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
  return engine
}

describe('Scanning a folder for repos', () => {
  it('finds checkouts two levels deep, skipping node_modules, hidden folders and the inside of a checkout', () => {
    const { deps, inspected } = fakeDisk(
      [
        onDisk('/code/web'),
        onDisk('/code/web/packages'),
        onDisk('/code/clients'),
        onDisk('/code/clients/billing'),
        onDisk('/code/clients/deep'),
        onDisk('/code/clients/deep/too-far'),
        onDisk('/code/node_modules'),
        onDisk('/code/node_modules/lib'),
        onDisk('/code/.cache'),
        onDisk('/code/.cache/mirror'),
        onDisk('/code/notes'),
      ],
      {
        [onDisk('/code/web')]: { remote: 'github.com/acme/web', detected: { packageManager: 'pnpm' } },
        [onDisk('/code/clients/billing')]: { remote: 'github.com/acme/billing' },
        [onDisk('/code/clients/deep/too-far')]: {},
        [onDisk('/code/node_modules/lib')]: {},
        [onDisk('/code/.cache/mirror')]: {},
      },
    )

    const found = scanForRepos(onDisk('/code'), deps)

    expect(found.map((repo) => repo.path)).toEqual([onDisk('/code/clients/billing'), onDisk('/code/web')])
    expect(found[1]).toMatchObject({ remote: 'github.com/acme/web', detected: { packageManager: 'pnpm' } })
    expect(inspected).not.toContain(onDisk('/code/web/packages'))
    expect(inspected).not.toContain(onDisk('/code/clients/deep/too-far'))
    expect(inspected.some((path) => path.includes('node_modules') || path.includes('.cache'))).toBe(false)
  })

  it('returns the chosen folder itself when it is a checkout, and refuses a relative folder', () => {
    const { deps } = fakeDisk([onDisk('/code/web/src')], { [onDisk('/code/web')]: {} })

    expect(scanForRepos(onDisk('/code/web'), deps).map((repo) => repo.path)).toEqual([onDisk('/code/web')])
    expect(() => scanForRepos('code', deps)).toThrow('absolute')
  })

  it('finds real checkouts on disk with the real inspector, remote and detected stack included', () => {
    const root = mkdtempSync(join(tmpdir(), 'bo-scan-'))
    temps.push(root)
    const web = join(root, 'clients', 'web')
    mkdirSync(web, { recursive: true })
    mkdirSync(join(root, 'node_modules', 'dep'), { recursive: true })
    execFileSync('git', ['init', '-q', web])
    execFileSync('git', ['init', '-q', join(root, 'node_modules', 'dep')])
    execFileSync('git', ['-C', web, 'remote', 'add', 'origin', 'git@github.com:acme/web.git'])
    writeFileSync(join(web, 'package.json'), JSON.stringify({ scripts: { build: 'vite build' } }))
    writeFileSync(join(web, 'pnpm-lock.yaml'), '')

    const found = scanForRepos(root, { folders: diskFolders, inspect: createRepoInspector() })

    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({
      path: web,
      isGitRepo: true,
      remote: 'github.com/acme/web',
      detected: { packageManager: 'pnpm', build: 'pnpm build' },
    })
  })
})

describe('Attaching scanned repos', () => {
  it('attaches several at once with their briefs and detected stacks, with or without checks', () => {
    const engine = engineWithCompany()
    const { deps } = fakeDisk([], {
      [onDisk('/code/web')]: { detected: readyStack() },
      [onDisk('/code/api')]: { detected: { language: 'Go', packageManager: 'go modules' } },
    })

    const result = attachRepos([onDisk('/code/web'), onDisk('/code/api')], engine.repos, deps.inspect, {
      [onDisk('/code/api')]: 'Orders API; you pick the framework.',
    })

    expect(result.failed).toEqual([])
    const repos = engine.repos.list()
    expect(repos.map((repo) => [repo.name, repo.brief, hasChecks(repo.stack)])).toEqual([
      ['web', '', true],
      ['api', 'Orders API; you pick the framework.', false],
    ])
    expect(repos[1]!.stack).toMatchObject({ language: 'Go', packageManager: 'go modules', install: '' })
    expect(result.attached).toEqual(repos)
  })

  it('adds them all on one commit, keeping the rest when one repo fails', () => {
    const engine = engineWithCompany()
    const { deps } = fakeDisk([], { [onDisk('/code/web')]: {}, [onDisk('/code/api')]: {}, [onDisk('/code/infra')]: {} })
    const repos = engine.repos
    const commits: string[] = []
    const watched = {
      ...repos,
      addMany(inputs: Parameters<typeof repos.addMany>[0]) {
        commits.push(inputs.map((one) => one.path).join(','))
        return repos.addMany(inputs)
      },
    }

    const result = attachRepos(
      [onDisk('/code/web'), onDisk('/code/gone'), onDisk('/code/api'), onDisk('/code/infra')],
      watched,
      deps.inspect,
    )

    expect(commits).toEqual([`${onDisk('/code/web')},${onDisk('/code/api')},${onDisk('/code/infra')}`])
    expect(result.attached.map((repo) => repo.name)).toEqual(['web', 'api', 'infra'])
    expect(result.failed).toEqual([{ path: onDisk('/code/gone'), error: `${onDisk('/code/gone')} is not a git repo` }])
    expect(engine.repos.list()).toHaveLength(3)
  })

  it('names clashing repos after their parent folder and reports the ones it could not attach', () => {
    const engine = engineWithCompany()
    engine.repos.add({ path: onDisk('/code/web') })
    const { deps } = fakeDisk([], {
      [onDisk('/code/web')]: {},
      [onDisk('/code/acme/web')]: {},
      [onDisk('/code/beta/acme/web')]: {},
      [onDisk('/code/other/acme/web')]: {},
      [onDisk('/code/plain')]: {},
    })

    const result = attachRepos(
      [
        onDisk('/code/acme/web'),
        onDisk('/code/beta/acme/web'),
        onDisk('/code/other/acme/web'),
        onDisk('/code/web'),
        onDisk('/elsewhere/x'),
        onDisk('/code/plain'),
      ],
      engine.repos,
      deps.inspect,
    )

    expect(result.attached.map((repo) => repo.name)).toEqual(['acme-web', 'web-2', 'web-3', 'plain'])
    expect(result.failed).toEqual([
      { path: onDisk('/code/web'), error: `${onDisk('/code/web')} is already attached` },
      { path: onDisk('/elsewhere/x'), error: `${onDisk('/elsewhere/x')} is not a git repo` },
    ])
    expect(engine.repos.list()).toHaveLength(5)
  })
})
