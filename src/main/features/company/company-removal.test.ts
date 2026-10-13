import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { recentsFile } from '../../app/recents-file'
import { COMPANY_FILE, type OpenDatabase, openDatabaseFile } from '../../core/database'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import type { RecentCompanies } from '../../core/recents'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'
import { type FakeProvider, fakeProvider } from '../../providers/testing'

const engines: CompanyEngine[] = []
const dirs: string[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tinycorp-removal-'))
  dirs.push(dir)
  return dir
}

function engineWith(options: { openDatabase?: OpenDatabase; recents?: RecentCompanies } = {}): {
  engine: CompanyEngine
  provider: FakeProvider
} {
  const provider = fakeProvider()
  const engine = createCompanyEngine({
    openDatabase: options.openDatabase ?? inMemoryDatabases(),
    recents: options.recents ?? inMemoryRecents(),
    providers: { claude: provider },
    isGitRepo: () => true,
    mcpUrl: () => 'http://127.0.0.1/mcp',
    log: () => {},
  })
  provider.connect(engine.sessions.receiveHook)
  engines.push(engine)
  return { engine, provider }
}

describe('forgetting a Company', () => {
  it('drops it from the known Companies and closes it, so the Launcher no longer lists it', () => {
    const { engine } = engineWith()
    const acme = engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
    const globex = engine.createCompany({ folder: onDisk('/work/globex'), name: 'Globex' })

    engine.forgetCompany(acme.id)

    expect(engine.listCompanies()).toEqual([globex])
    expect(engine.companySummaries().map((s) => s.id)).toEqual([globex.id])
    expect(engine.currentCompany()).toEqual(globex)
  })

  it('stops the Company’s running Sessions and leaves other Companies’ Sessions running', () => {
    const { engine, provider } = engineWith()
    engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
    engine.sessions.start(ada.id)
    const acme = engine.currentCompany()!
    engine.createCompany({ folder: onDisk('/work/globex'), name: 'Globex' })
    const grace = engine.employees.create({ name: 'Grace', roleId: 'backend' })
    engine.sessions.start(grace.id)

    engine.forgetCompany(acme.id)

    expect(provider.spawnOf(ada.id).pty.killed).toBe(true)
    expect(provider.spawnOf(grace.id).pty.killed).toBe(false)
    expect(engine.sessions.get(grace.id).status).not.toBe('off')
  })

  it('leaves no Company current when the current one is forgotten, and tells listeners', () => {
    const { engine } = engineWith()
    const acme = engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
    let changes = 0
    engine.onChange(() => changes++)

    engine.forgetCompany(acme.id)

    expect(engine.currentCompany()).toBeNull()
    expect(engine.listCompanies()).toEqual([])
    expect(engine.companySummaries()).toEqual([])
    expect(changes).toBe(1)
    expect(() => engine.board()).toThrow()
  })

  it('forgets a Company that is only remembered, without opening it', () => {
    const recents = inMemoryRecents()
    const openDatabase = inMemoryDatabases()
    const first = engineWith({ recents, openDatabase }).engine
    const acme = first.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
    first.close()
    const { engine } = engineWith({ recents, openDatabase })

    engine.forgetCompany(acme.id)

    expect(engine.listCompanies()).toEqual([])
    expect(recents.list()).toEqual([])
  })

  it('leaves the folder untouched and the Company can be opened again from it', () => {
    const folder = tempDir()
    const recents = recentsFile(join(tempDir(), 'recent-companies.json'))
    const { engine } = engineWith({ recents, openDatabase: openDatabaseFile })
    const acme = engine.createCompany({ folder, name: 'Acme' })
    engine.employees.create({ name: 'Ada', roleId: 'backend' })
    const before = readdirSync(folder).sort()

    engine.forgetCompany(acme.id)

    expect(recents.list()).toEqual([])
    expect(readdirSync(folder).sort()).toEqual(before)
    const reopened = engine.openCompany(folder)
    expect(reopened.id).toBe(acme.id)
    expect(engine.employees.list().map((e) => e.name)).toEqual(['Ada'])
  })

  it('refuses an unknown Company', () => {
    const { engine } = engineWith()

    expect(() => engine.forgetCompany('nope')).toThrow(/Unknown Company/)
  })
})

describe('deleting a Company', () => {
  function companyOnDisk() {
    const root = tempDir()
    const folder = join(root, 'acme')
    const repo = join(root, 'web')
    mkdirSync(folder)
    mkdirSync(join(repo, '.git'), { recursive: true })
    writeFileSync(join(repo, 'README.md'), 'web')
    const recents = recentsFile(join(tempDir(), 'recent-companies.json'))
    const { engine, provider } = engineWith({ recents, openDatabase: openDatabaseFile })
    const company = engine.createCompany({ folder, name: 'Acme' })
    engine.repos.add({ path: repo, name: 'web' })
    for (const data of ['memory', 'worktrees/web/acme-1', 'attachments']) {
      mkdirSync(join(folder, data), { recursive: true })
      writeFileSync(join(folder, data, 'file.txt'), 'data')
    }
    writeFileSync(join(folder, 'notes.md'), 'the boss’s own file')
    mkdirSync(join(folder, 'src'))
    return { root, folder, repo, recents, engine, provider, company }
  }

  it('removes the Company’s data from its folder and forgets it', () => {
    const { folder, recents, engine, company } = companyOnDisk()

    engine.deleteCompany(company.id)

    expect(readdirSync(folder).sort()).toEqual(['notes.md', 'src'])
    expect(existsSync(join(folder, COMPANY_FILE))).toBe(false)
    expect(recents.list()).toEqual([])
    expect(engine.listCompanies()).toEqual([])
    expect(engine.currentCompany()).toBeNull()
    expect(() => engine.openCompany(folder)).toThrow(/There is no Company/)
  })

  it('never touches a connected repo or anything else outside the Company’s own data', () => {
    const { root, repo, engine, company } = companyOnDisk()

    engine.deleteCompany(company.id)

    expect(readdirSync(root).sort()).toEqual(['acme', 'web'])
    expect(readdirSync(repo).sort()).toEqual(['.git', 'README.md'])
  })

  it('stops the Company’s running Sessions first', () => {
    const { engine, provider, company } = companyOnDisk()
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
    engine.sessions.start(ada.id)

    engine.deleteCompany(company.id)

    expect(provider.spawnOf(ada.id).pty.killed).toBe(true)
  })

  it('deletes a Company that is only remembered', () => {
    const { folder, recents, engine, company } = companyOnDisk()
    engine.close()
    const { engine: next } = engineWith({ recents, openDatabase: openDatabaseFile })

    next.deleteCompany(company.id)

    expect(readdirSync(folder).sort()).toEqual(['notes.md', 'src'])
    expect(recents.list()).toEqual([])
  })

  it('deletes nothing when a connected repo lives inside the Company’s data', () => {
    const { folder, engine, company } = companyOnDisk()
    const inside = join(folder, 'worktrees', 'vendored')
    mkdirSync(join(inside, '.git'), { recursive: true })
    engine.repos.add({ path: inside, name: 'vendored' })
    const before = readdirSync(folder).sort()

    expect(() => engine.deleteCompany(company.id)).toThrow(/vendored/)
    expect(readdirSync(folder).sort()).toEqual(before)
    expect(engine.listCompanies().map((c) => c.id)).toEqual([company.id])
  })
})
