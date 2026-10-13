import { sep } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { hasChecks, type RepoInspection } from '../../../shared/repos/repo'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryDatabases, inMemoryRecents, onDisk, readyStack } from '../../core/testing'
import { nearbyRepos } from './nearby-repos'
import type { InspectRepo } from './repo-inspector'
import { attachRepos } from './repo-scan'

const engines: CompanyEngine[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
})

const FOLDERS = [
  onDisk('/code/tinycorp/web-app'),
  onDisk('/code/tinycorp/billing-api'),
  onDisk('/code/tinycorp/infra'),
  onDisk('/code/tinycorp/notes'),
  onDisk('/code/tinycorp/clients'),
  onDisk('/code/tinycorp/clients/portal'),
  onDisk('/code/tinycorp/.cache'),
  onDisk('/code/tinycorp/.cache/mirror'),
]

const CHECKOUTS: Record<string, Partial<RepoInspection>> = {
  [onDisk('/code/tinycorp/web-app')]: { defaultBranch: 'main', detected: readyStack() },
  [onDisk('/code/tinycorp/billing-api')]: {
    commitCount: 2104,
    detected: {
      language: 'Node',
      packageManager: 'pnpm',
      install: 'pnpm install',
      build: 'pnpm build',
      test: 'vitest run',
      lint: 'biome check',
    },
  },
  [onDisk('/code/tinycorp/infra')]: { commitCount: 431, detected: { language: 'Terraform' } },
  [onDisk('/code/tinycorp/clients/portal')]: {},
  [onDisk('/code/tinycorp/.cache/mirror')]: {},
}

const inspect: InspectRepo = (path) => ({
  path,
  isGitRepo: path in CHECKOUTS,
  remote: null,
  defaultBranch: null,
  commitCount: null,
  lastCommitAt: null,
  detected: {},
  ...CHECKOUTS[path],
})

const folders = (path: string) =>
  FOLDERS.filter((folder) => folder.startsWith(path + sep) && !folder.slice(path.length + 1).includes(sep)).map(
    (folder) => folder.slice(path.length + 1),
  )

function tinyCorp() {
  const engine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
    isGitRepo: (path) => path in CHECKOUTS,
  })
  engines.push(engine)
  const company = engine.createCompany({ folder: onDisk('/code/tinycorp'), name: 'Tiny Corp' })
  return { engine, company }
}

describe('Repositories step: repos found next to the connected one', () => {
  it('lists the checkouts beside the repo connected at Create Company, one level deep, without it', () => {
    const { engine, company } = tinyCorp()
    engine.repos.add({ path: onDisk('/code/tinycorp/web-app'), stack: readyStack() })

    const nearby = nearbyRepos(company, engine.repos.list(), { folders, inspect })

    expect(nearby.folder).toBe(onDisk('/code/tinycorp'))
    expect(nearby.found.map((repo) => repo.path)).toEqual([
      onDisk('/code/tinycorp/billing-api'),
      onDisk('/code/tinycorp/infra'),
    ])
    expect(nearby.found[0]).toMatchObject({ commitCount: 2104, detected: { language: 'Node', packageManager: 'pnpm' } })
  })

  it('scans the Company folder when no repo is connected yet', () => {
    const { engine, company } = tinyCorp()

    const nearby = nearbyRepos(company, engine.repos.list(), { folders, inspect })

    expect(nearby.folder).toBe(onDisk('/code/tinycorp'))
    expect(nearby.found.map((repo) => repo.path)).toEqual([
      onDisk('/code/tinycorp/billing-api'),
      onDisk('/code/tinycorp/infra'),
      onDisk('/code/tinycorp/web-app'),
    ])
  })

  it('connects a found repo with its detected stack, and it leaves the found list', () => {
    const { engine, company } = tinyCorp()
    engine.repos.add({ path: onDisk('/code/tinycorp/web-app'), stack: readyStack() })

    const result = attachRepos([onDisk('/code/tinycorp/billing-api')], engine.repos, inspect)

    expect(result.failed).toEqual([])
    const billing = engine.repos.list().find((repo) => repo.name === 'billing-api')!
    expect(billing.stack).toMatchObject({ language: 'Node', install: 'pnpm install', lint: 'biome check' })
    expect(hasChecks(billing.stack)).toBe(true)
    const nearby = nearbyRepos(company, engine.repos.list(), { folders, inspect })
    expect(nearby.found.map((repo) => repo.path)).toEqual([onDisk('/code/tinycorp/infra')])
  })

  it('connects a repo without detected checks', () => {
    const { engine } = tinyCorp()

    attachRepos([onDisk('/code/tinycorp/infra')], engine.repos, inspect)

    const infra = engine.repos.list()[0]!
    expect(infra).toMatchObject({ name: 'infra', stack: { language: 'Terraform', install: '' } })
    expect(hasChecks(infra.stack)).toBe(false)
  })
})
