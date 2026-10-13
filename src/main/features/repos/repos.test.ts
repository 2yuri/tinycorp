import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { hasChecks, type StackConstraints } from '../../../shared/repos/repo'
import { runMigrations } from '../../core/database'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import type { RecentCompanies } from '../../core/recents'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'
import {
  createRepoRegistry,
  REPOS_BRIEF_MIGRATION,
  REPOS_MIGRATION,
  REPOS_RUNG_MIGRATION,
  REPOS_STACK_COMMANDS_MIGRATION,
} from './repos'

const engines: CompanyEngine[] = []
const tempDirs: string[] = []

afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const gitRepos = new Set([onDisk('/code/web'), onDisk('/code/api'), onDisk('/code/billing')])

function engineWith(options: { recents?: RecentCompanies; inMemory?: boolean } = {}) {
  const engine = createCompanyEngine({
    recents: options.recents ?? inMemoryRecents(),
    ...(options.inMemory === false ? {} : { openDatabase: inMemoryDatabases() }),
    isGitRepo: (path) => gitRepos.has(path),
  })
  engines.push(engine)
  return engine
}

function engineWithCompany() {
  const engine = engineWith()
  engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
  return engine
}

const node: StackConstraints = {
  language: 'TypeScript',
  framework: 'Next.js',
  packageManager: 'pnpm',
  packageManagerVersion: '9',
  install: 'pnpm install',
  build: 'pnpm build',
  test: 'pnpm vitest run',
  lint: 'biome check .',
}
const go: StackConstraints = {
  language: 'Go',
  framework: 'none',
  packageManager: 'go modules',
  packageManagerVersion: '',
  install: 'go mod download',
  build: 'go build ./...',
  test: 'go test ./...',
  lint: 'go vet ./...',
}

describe('Repos of a Company', () => {
  it('starts with no repos', () => {
    const engine = engineWithCompany()

    expect(engine.repos.list()).toEqual([])
  })

  it('attaches a repo with its mandatory stack', () => {
    const engine = engineWithCompany()

    const repo = engine.repos.add({ path: onDisk('/code/web'), name: 'web', stack: node })

    expect(repo).toMatchObject({ name: 'web', path: onDisk('/code/web'), brief: '', rung: 'merge', stack: node })
    expect(engine.repos.list()).toEqual([repo])
  })

  it('holds several repos, in the order they were added', () => {
    const engine = engineWithCompany()

    const web = engine.repos.add({ path: onDisk('/code/web'), stack: node })
    const api = engine.repos.add({ path: onDisk('/code/api'), stack: go })
    const billing = engine.repos.add({ path: onDisk('/code/billing'), stack: go })

    expect(engine.repos.list()).toEqual([web, api, billing])
  })

  it('names a repo after its folder when no name is given', () => {
    const engine = engineWithCompany()

    expect(engine.repos.add({ path: onDisk('/code/api/'), stack: go }).name).toBe('api')
  })

  it('trims names and stack values', () => {
    const engine = engineWithCompany()

    const repo = engine.repos.add({
      path: onDisk('/code/web'),
      name: '  web ',
      stack: { ...node, language: ' TypeScript ', framework: 'Next.js\n', install: ' pnpm install ' },
    })

    expect(repo).toMatchObject({ name: 'web', stack: node })
  })

  it('attaches a repo without checks, and sets them later', () => {
    const engine = engineWithCompany()

    const repo = engine.repos.add({ path: onDisk('/code/web') })

    expect(repo.stack).toEqual({
      language: '',
      framework: '',
      packageManager: '',
      packageManagerVersion: '',
      install: '',
      build: '',
      test: '',
      lint: '',
    })
    expect(hasChecks(repo.stack)).toBe(false)
    const defined = engine.repos.update(repo.id, { stack: node })
    expect(hasChecks(defined.stack)).toBe(true)
    expect(engine.repos.list()).toEqual([defined])
  })

  it('a repo has checks as soon as one of install, build, test or lint is set', () => {
    const none = { ...node, install: '', build: '', test: '', lint: ' ' }
    expect(hasChecks(node)).toBe(true)
    expect(hasChecks(none)).toBe(false)
    for (const field of ['install', 'build', 'test', 'lint'] as const) {
      expect(hasChecks({ ...none, [field]: 'x' }), field).toBe(true)
    }
  })

  it('attaches a repo with a trimmed brief, and edits it without touching the checks', () => {
    const engine = engineWithCompany()

    const repo = engine.repos.add({
      path: onDisk('/code/web'),
      brief: '  Checkout UI. You pick the stack.\n',
      stack: node,
    })
    const edited = engine.repos.update(repo.id, { brief: 'Checkout UI in Next.js.' })

    expect(repo.brief).toBe('Checkout UI. You pick the stack.')
    expect(edited).toEqual({ ...repo, brief: 'Checkout UI in Next.js.' })
    expect(engine.repos.update(repo.id, { stack: { lint: '' } }).brief).toBe('Checkout UI in Next.js.')
    expect(() => engine.repos.update(repo.id, { brief: 3 as unknown as string })).toThrow(/brief/i)
    expect(engine.repos.list()).toEqual([{ ...edited, stack: { ...node, lint: '' } }])
  })

  it('attaches a repo that may merge, and moves it up and down the ladder', () => {
    const engine = engineWithCompany()

    const repo = engine.repos.add({ path: onDisk('/code/web'), stack: node })
    const locked = engine.repos.update(repo.id, { rung: 'local' })

    expect(repo.rung).toBe('merge')
    expect(engine.repos.add({ path: onDisk('/code/api'), stack: node, rung: 'pr' }).rung).toBe('pr')
    expect(locked).toEqual({ ...repo, rung: 'local' })
    expect(engine.repos.list()[0]!.rung).toBe('local')
    expect(engine.repos.update(repo.id, { brief: 'Checkout UI.' }).rung).toBe('local')
    expect(() => engine.repos.update(repo.id, { rung: 'push' as 'pr' })).toThrow(/unknown repo rung: push/i)
  })

  it('refuses stack values that are not text', () => {
    const engine = engineWithCompany()

    expect(() => engine.repos.add({ path: onDisk('/code/web'), stack: { test: 42 as unknown as string } })).toThrow(
      /stack/i,
    )
    expect(engine.repos.list()).toEqual([])
  })

  it('refuses a folder that is not a git repo', () => {
    const engine = engineWithCompany()

    expect(() => engine.repos.add({ path: onDisk('/code/notes'), stack: node })).toThrow(/not a git/i)
    expect(engine.repos.list()).toEqual([])
  })

  it('refuses a relative path', () => {
    const engine = engineWithCompany()

    expect(() => engine.repos.add({ path: 'code/web', stack: node })).toThrow(/absolute/i)
  })

  it('refuses the same repo twice', () => {
    const engine = engineWithCompany()
    engine.repos.add({ path: onDisk('/code/web'), stack: node })

    expect(() => engine.repos.add({ path: onDisk('/code/web/'), name: 'other', stack: node })).toThrow(/already/i)
    expect(engine.repos.list()).toHaveLength(1)
  })

  it('refuses two repos with the same name', () => {
    const engine = engineWithCompany()
    engine.repos.add({ path: onDisk('/code/web'), name: 'app', stack: node })

    expect(() => engine.repos.add({ path: onDisk('/code/api'), name: 'app', stack: go })).toThrow(/already/i)
    expect(engine.repos.list()).toHaveLength(1)
  })

  it('updates part of a stack and keeps the rest', () => {
    const engine = engineWithCompany()
    const web = engine.repos.add({ path: onDisk('/code/web'), stack: node })

    const updated = engine.repos.update(web.id, { stack: { framework: 'Remix' } })

    expect(updated).toEqual({ ...web, stack: { ...node, framework: 'Remix' } })
    expect(engine.repos.list()).toEqual([updated])
  })

  it('renames a repo', () => {
    const engine = engineWithCompany()
    const web = engine.repos.add({ path: onDisk('/code/web'), stack: node })

    expect(engine.repos.update(web.id, { name: 'frontend' }).name).toBe('frontend')
    expect(engine.repos.list().map((r) => r.name)).toEqual(['frontend'])
  })

  it('clears a check with an empty value', () => {
    const engine = engineWithCompany()
    const web = engine.repos.add({ path: onDisk('/code/web'), stack: node })

    const cleared = engine.repos.update(web.id, { stack: { lint: ' ' } })

    expect(cleared.stack).toEqual({ ...node, lint: '' })
    expect(hasChecks(cleared.stack)).toBe(true)
  })

  it('refuses an update that would clash on name', () => {
    const engine = engineWithCompany()
    const web = engine.repos.add({ path: onDisk('/code/web'), stack: node })
    engine.repos.add({ path: onDisk('/code/api'), stack: go })

    expect(() => engine.repos.update(web.id, { name: 'api' })).toThrow(/already/i)
    expect(() => engine.repos.update(web.id, { name: ' ' })).toThrow(/name/i)
    expect(engine.repos.list()[0]).toEqual(web)
  })

  it('refuses to update an unknown repo', () => {
    const engine = engineWithCompany()

    expect(() => engine.repos.update('nope', { name: 'x' })).toThrow(/unknown repo/i)
  })

  it('removes a repo and keeps the others', () => {
    const engine = engineWithCompany()
    const web = engine.repos.add({ path: onDisk('/code/web'), stack: node })
    const api = engine.repos.add({ path: onDisk('/code/api'), stack: go })

    engine.repos.remove(web.id)

    expect(engine.repos.list()).toEqual([api])
    expect(() => engine.repos.remove(web.id)).toThrow(/unknown repo/i)
  })

  it('a removed repo can be attached again', () => {
    const engine = engineWithCompany()
    const web = engine.repos.add({ path: onDisk('/code/web'), stack: node })
    engine.repos.remove(web.id)

    engine.repos.add({ path: onDisk('/code/web'), stack: node })

    expect(engine.repos.list()).toHaveLength(1)
  })

  it('refuses repo operations when no Company is open', () => {
    const engine = engineWith()

    expect(() => engine.repos.list()).toThrow(/no company/i)
    expect(() => engine.repos.add({ path: onDisk('/code/web'), stack: node })).toThrow(/no company/i)
  })

  it('keeps the repos of each Company apart', () => {
    const engine = engineWith()
    const acme = engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
    const web = engine.repos.add({ path: onDisk('/code/web'), stack: node })
    engine.createCompany({ folder: onDisk('/work/globex'), name: 'Globex' })

    expect(engine.repos.list()).toEqual([])
    const globexWeb = engine.repos.add({ path: onDisk('/code/web'), stack: go })

    engine.switchCompany(acme.id)
    expect(engine.repos.list()).toEqual([web])
    expect(globexWeb.stack).toEqual(go)
  })
})

describe('Repos on disk', () => {
  it('keeps repos and their edits after the app restarts', () => {
    const folder = mkdtempSync(join(tmpdir(), 'tinycorp-'))
    tempDirs.push(folder)
    const recents = inMemoryRecents()
    const first = engineWith({ recents, inMemory: false })
    first.createCompany({ folder, name: 'Acme' })
    const web = first.repos.add({ path: onDisk('/code/web'), brief: 'Storefront', stack: node })
    const api = first.repos.add({ path: onDisk('/code/api'), stack: go })
    const billing = first.repos.add({ path: onDisk('/code/billing'), stack: go })
    const renamed = first.repos.update(api.id, { name: 'backend', brief: 'Orders API', stack: { framework: 'chi' } })
    first.repos.remove(billing.id)
    first.close()

    const second = engineWith({ recents, inMemory: false })
    second.openCompany(folder)

    expect(second.repos.list()).toEqual([web, renamed])
  })
})

describe('Repos from before stack commands', () => {
  it('keep their language, framework and package manager and need their commands defined', () => {
    const db = new DatabaseSync(':memory:')
    runMigrations(db, [REPOS_MIGRATION])
    db.prepare(
      `INSERT INTO repo (id, name, path, language, framework, package_manager, added_at)
       VALUES ('r1', 'web', '${onDisk('/code/web')}', 'TypeScript', 'React', 'pnpm', '2026-01-01T00:00:00.000Z')`,
    ).run()

    runMigrations(db, [REPOS_MIGRATION, REPOS_STACK_COMMANDS_MIGRATION])
    const [repo] = createRepoRegistry({ database: () => db, isGitRepo: () => true }).list()

    expect(repo!.stack).toEqual({
      language: 'TypeScript',
      framework: 'React',
      packageManager: 'pnpm',
      packageManagerVersion: '',
      install: '',
      build: '',
      test: '',
      lint: '',
    })
    expect(hasChecks(repo!.stack)).toBe(false)
  })
})

describe('Repos from before the brief', () => {
  it('keep their detected stack as checks and start with an empty brief', () => {
    const db = new DatabaseSync(':memory:')
    runMigrations(db, [REPOS_MIGRATION, REPOS_STACK_COMMANDS_MIGRATION])
    db.prepare(
      `INSERT INTO repo (id, name, path, language, framework, package_manager, package_manager_version,
         install_command, build_command, test_command, lint_command, added_at)
       VALUES ('r1', 'web', '${onDisk('/code/web')}', 'TypeScript', 'Next.js', 'pnpm', '9',
         'pnpm install', 'pnpm build', 'pnpm vitest run', 'biome check .', '2026-01-01T00:00:00.000Z')`,
    ).run()

    runMigrations(db, [REPOS_MIGRATION, REPOS_STACK_COMMANDS_MIGRATION, REPOS_BRIEF_MIGRATION])

    expect(createRepoRegistry({ database: () => db, isGitRepo: () => true }).list()).toEqual([
      {
        id: 'r1',
        name: 'web',
        path: onDisk('/code/web'),
        brief: '',
        rung: 'merge',
        stack: node,
        addedAt: '2026-01-01T00:00:00.000Z',
      },
    ])
  })
})

describe('Adding several repos at once', () => {
  it("adds them on one commit, sees the batch's own names, and reports the ones that refused", () => {
    const engine = engineWithCompany()

    const result = engine.repos.addMany([
      { path: onDisk('/code/web') },
      { path: onDisk('/code/api'), name: 'web' },
      { path: onDisk('/code/nowhere') },
      { path: onDisk('/code/billing') },
    ])

    expect(result.attached.map((repo) => repo.name)).toEqual(['web', 'billing'])
    expect(result.failed).toEqual([
      { path: onDisk('/code/api'), error: 'A repo named web already exists' },
      { path: onDisk('/code/nowhere'), error: `${onDisk('/code/nowhere')} is not a git repo` },
    ])
    expect(engine.repos.list().map((repo) => repo.name)).toEqual(['web', 'billing'])
  })

  it('writes nothing at all when the commit fails', () => {
    const database = new DatabaseSync(':memory:')
    runMigrations(database, [
      REPOS_MIGRATION,
      REPOS_STACK_COMMANDS_MIGRATION,
      REPOS_BRIEF_MIGRATION,
      REPOS_RUNG_MIGRATION,
    ])
    let commits = 0
    const failing = {
      ...database,
      prepare: (sql: string) => database.prepare(sql),
      exec: (sql: string) => {
        if (sql === 'COMMIT' && commits++ === 0) throw new Error('the disk went away')
        return database.exec(sql)
      },
    } as unknown as DatabaseSync
    const repos = createRepoRegistry({ database: () => failing, isGitRepo: (path) => gitRepos.has(path) })

    expect(() => repos.addMany([{ path: onDisk('/code/web') }, { path: onDisk('/code/api') }])).toThrow(
      'the disk went away',
    )
    expect(repos.list()).toEqual([])
  })
})
