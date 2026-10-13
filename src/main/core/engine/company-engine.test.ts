import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DATABASE_ON_ANOTHER_PC } from '../../../shared/platform/company-folder'
import { APP_DATA_COMPANIES, companyDatabases } from '../company-databases'
import { COMPANY_FILE, openDatabaseFile } from '../database'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../testing'
import { type CompanyEngine, createCompanyEngine } from './company-engine'

const engines: CompanyEngine[] = []
const tempDirs: string[] = []

function engineInMemory() {
  const engine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
  })
  engines.push(engine)
  return engine
}

function tempFolder() {
  const dir = mkdtempSync(join(tmpdir(), 'tinycorp-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('Company engine', () => {
  it('starts with no Company open and none known', () => {
    const engine = engineInMemory()

    expect(engine.currentCompany()).toBeNull()
    expect(engine.listCompanies()).toEqual([])
  })

  it('creates a Company from a folder and makes it current', () => {
    const engine = engineInMemory()

    const company = engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })

    expect(company).toMatchObject({ name: 'Acme', folder: onDisk('/work/acme') })
    expect(engine.currentCompany()).toEqual(company)
    expect(engine.listCompanies()).toEqual([company])
  })

  it('names a Company after its folder when no name is given', () => {
    const engine = engineInMemory()

    const company = engine.createCompany({ folder: onDisk('/work/globex') })

    expect(company.name).toBe('globex')
  })

  it('refuses a blank name', () => {
    const engine = engineInMemory()

    expect(() => engine.createCompany({ folder: onDisk('/work/acme'), name: '   ' })).toThrow(/name/i)
    expect(engine.currentCompany()).toBeNull()
  })

  it('refuses to create a second Company in the same folder', () => {
    const engine = engineInMemory()
    engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })

    expect(() => engine.createCompany({ folder: onDisk('/work/acme'), name: 'Other' })).toThrow(/already/i)
    expect(engine.listCompanies()).toHaveLength(1)
  })

  it('refuses to open a folder that holds no Company', () => {
    const engine = engineInMemory()

    expect(() => engine.openCompany(onDisk('/work/empty'))).toThrow(/no company/i)
    expect(engine.currentCompany()).toBeNull()
    expect(engine.listCompanies()).toEqual([])
  })

  it('switches between Companies', () => {
    const engine = engineInMemory()
    const acme = engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
    const globex = engine.createCompany({ folder: onDisk('/work/globex'), name: 'Globex' })
    expect(engine.currentCompany()).toEqual(globex)

    expect(engine.switchCompany(acme.id)).toEqual(acme)
    expect(engine.currentCompany()).toEqual(acme)
    expect(engine.listCompanies()).toEqual(expect.arrayContaining([acme, globex]))
  })

  it('refuses to switch to an unknown Company and keeps the current one', () => {
    const engine = engineInMemory()
    const acme = engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })

    expect(() => engine.switchCompany('nope')).toThrow(/unknown company/i)
    expect(engine.currentCompany()).toEqual(acme)
  })

  it('opening an already open folder returns the same Company', () => {
    const engine = engineInMemory()
    const acme = engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
    engine.createCompany({ folder: onDisk('/work/globex'), name: 'Globex' })

    expect(engine.openCompany(onDisk('/work/acme'))).toEqual(acme)
    expect(engine.currentCompany()).toEqual(acme)
    expect(engine.listCompanies()).toHaveLength(2)
  })

  it('tells subscribers when the current Company changes', () => {
    const engine = engineInMemory()
    const seen: (string | null)[] = []
    engine.onChange(() => seen.push(engine.currentCompany()?.name ?? null))

    const acme = engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
    engine.createCompany({ folder: onDisk('/work/globex'), name: 'Globex' })
    engine.switchCompany(acme.id)

    expect(seen).toEqual(['Acme', 'Globex', 'Acme'])
  })
})

describe('Company engine on disk', () => {
  it('writes exactly one SQLite file into the Company folder', () => {
    const folder = tempFolder()
    const engine = createCompanyEngine({ recents: inMemoryRecents() })
    engines.push(engine)

    engine.createCompany({ folder, name: 'Acme' })

    expect(readdirSync(folder)).toEqual(['company.sqlite'])
  })

  it('reloads a Company after the app restarts', () => {
    const folder = tempFolder()
    const recents = inMemoryRecents()
    const first = createCompanyEngine({ recents })
    const created = first.createCompany({ folder, name: 'Acme' })
    first.close()

    const second = createCompanyEngine({ recents })
    engines.push(second)

    expect(second.currentCompany()).toBeNull()
    expect(second.listCompanies()).toEqual([created])
    expect(second.openCompany(folder)).toEqual(created)
    expect(second.currentCompany()).toEqual(created)
  })

  it('switches to a known Company that is not open yet', () => {
    const acmeFolder = tempFolder()
    const globexFolder = tempFolder()
    const recents = inMemoryRecents()
    const first = createCompanyEngine({ recents })
    const acme = first.createCompany({ folder: acmeFolder, name: 'Acme' })
    first.createCompany({ folder: globexFolder, name: 'Globex' })
    first.close()

    const second = createCompanyEngine({ recents })
    engines.push(second)

    expect(second.switchCompany(acme.id)).toEqual(acme)
  })

  it('refuses to create a Company where one already exists on disk', () => {
    const folder = tempFolder()
    const first = createCompanyEngine({ recents: inMemoryRecents() })
    first.createCompany({ folder, name: 'Acme' })
    first.close()

    const second = createCompanyEngine({ recents: inMemoryRecents() })
    engines.push(second)

    expect(() => second.createCompany({ folder, name: 'Again' })).toThrow(/already/i)
    expect(second.openCompany(folder).name).toBe('Acme')
  })

  it('opening an empty folder leaves no file behind', () => {
    const folder = tempFolder()
    const engine = createCompanyEngine({ recents: inMemoryRecents() })
    engines.push(engine)

    expect(() => engine.openCompany(folder)).toThrow(/no company/i)
    expect(readdirSync(folder)).toEqual([])
  })

  it('makes the folder it was given, so a Company can be created without opening the picker', () => {
    const folder = join(tempFolder(), 'TinyCorp', 'Acme')
    const engine = createCompanyEngine({ recents: inMemoryRecents() })
    engines.push(engine)

    const company = engine.createCompany({ folder, name: 'Acme' })

    expect(company.folder).toBe(folder)
    expect(readdirSync(folder)).toEqual(['company.sqlite'])
  })

  it('leaves nothing of its own behind when a create fails, and keeps what the folder held', () => {
    const folder = tempFolder()
    writeFileSync(join(folder, 'notes.md'), 'the boss picked their own folder')
    const engine = createCompanyEngine({
      recents: inMemoryRecents(),
      // The file is made and then the connection is gone, which is what a database that cannot be
      // locked looks like from here: everything after the open throws.
      openDatabase: (at, mode) => {
        const db = openDatabaseFile(at, mode)
        db?.close()
        return db
      },
    })
    engines.push(engine)

    expect(() => engine.createCompany({ folder, name: 'Acme' })).toThrow()

    // No empty `company.sqlite` for the boss to open later, and their own file is untouched.
    expect(readdirSync(folder)).toEqual(['notes.md'])
    expect(engine.listCompanies()).toEqual([])
  })
})

describe('A Company folder SQLite cannot lock', () => {
  // Not WSL: since T256 a folder in a distro is accepted and its database goes to this PC. What is
  // still refused is a share a *second* PC can open, which would end up with a database each.
  const shares = ['\\\\nas\\share\\acme', '\\\\FILESERVER\\teams\\acme']

  it('is refused on create, before a file is written into it', () => {
    const engine = engineInMemory()

    for (const folder of shares) {
      expect(() => engine.createCompany({ folder, name: 'Acme' })).toThrow(/drive of this PC/i)
    }
    expect(engine.listCompanies()).toEqual([])
  })

  it('is refused on open, whatever is in it', () => {
    const engine = engineInMemory()

    for (const folder of shares) {
      expect(() => engine.openCompany(folder)).toThrow(/one database per PC/i)
    }
  })

  it('is refused as the target of a move, and the Company stays where it is', () => {
    const engine = engineInMemory()
    const acme = engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })

    expect(() => engine.moveCompany(acme.id, shares[0]!)).toThrow(/drive of this PC/i)
    expect(engine.currentCompany()).toMatchObject({ id: acme.id, folder: onDisk('/work/acme') })
  })

  it('accepts a drive on this PC and a folder on a Mac or Linux', () => {
    const engine = engineInMemory()

    expect(engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' }).name).toBe('Acme')
  })
})

/**
 * A Company folder in WSL, whose database stays on this PC (T256).
 *
 * The share is declared rather than made: a `\\wsl.localhost\…` path only exists on Windows, and a
 * test that could only run on the Windows runner is a test that runs nowhere. So the folder is a
 * real temp folder the site keeper is *told* is on a share, and everything else — the database,
 * the id file, AppData, the Launcher's summaries — is real files on disk.
 */
describe('A Company folder in WSL', () => {
  function inWsl() {
    const localAppData = tempFolder()
    const share = tempFolder()
    const folder = join(share, 'Acme')
    const databases = companyDatabases({ localAppData, onShare: (at) => at.startsWith(share) })
    const engine = createCompanyEngine({ recents: inMemoryRecents(), databases })
    engines.push(engine)
    return { engine, databases, localAppData, share, folder, appData: join(localAppData, ...APP_DATA_COMPANIES) }
  }

  it('creates the Company in the folder and its database in AppData, under the Company id', () => {
    const { engine, folder, appData } = inWsl()

    const acme = engine.createCompany({ folder, name: 'Acme' })

    expect(acme.folder).toBe(folder)
    expect(readdirSync(folder)).toEqual(['.tinycorp'])
    expect(readdirSync(appData)).toEqual([acme.id])
    expect(readdirSync(join(appData, acme.id))).toContain(COMPANY_FILE)
    expect(JSON.parse(readFileSync(join(folder, '.tinycorp', 'company.json'), 'utf8'))).toEqual({
      id: acme.id,
      database: 'this-pc',
    })
  })

  it('opens it again from the folder, which is all the boss ever names', () => {
    const { engine, folder } = inWsl()
    const acme = engine.createCompany({ folder, name: 'Acme' })
    engine.employees.create({ name: 'Ada', roleId: 'backend' })
    engine.forgetCompany(acme.id)

    const reopened = engine.openCompany(folder)

    expect(reopened.id).toBe(acme.id)
    expect(engine.employees.list().map((employee) => employee.name)).toEqual(['Ada'])
  })

  it('says so and offers nothing else when this PC does not hold the database', () => {
    const { engine, folder, localAppData } = inWsl()
    const acme = engine.createCompany({ folder, name: 'Acme' })
    engine.forgetCompany(acme.id)
    // Another PC, or an AppData that has been wiped: the folder still names the id.
    rmSync(join(localAppData, ...APP_DATA_COMPANIES), { recursive: true, force: true })

    expect(() => engine.openCompany(folder)).toThrow(DATABASE_ON_ANOTHER_PC)
  })

  it('lists that Company as one with nothing to open, so the Launcher offers only Forget', () => {
    const { engine, folder, localAppData } = inWsl()
    engine.createCompany({ folder, name: 'Acme' })
    engine.close()
    rmSync(join(localAppData, ...APP_DATA_COMPANIES), { recursive: true, force: true })

    const [summary] = engine.companySummaries()

    expect(summary).toMatchObject({ missing: false, databaseElsewhere: true, employees: null })
  })

  it('reads a Company that is closed but whose database is here, for the Launcher’s card', () => {
    const { engine, folder } = inWsl()
    const acme = engine.createCompany({ folder, name: 'Acme' })
    engine.employees.create({ name: 'Ada', roleId: 'backend' })
    // Closed, not forgotten: the Launcher still lists it, and reads its staff out of AppData.
    engine.close()

    const [summary] = engine.companySummaries()

    expect(summary).toMatchObject({ id: acme.id, databaseElsewhere: false, employees: 1 })
  })

  it('takes the AppData database with it when the Company is deleted', () => {
    const { engine, folder, appData } = inWsl()
    const acme = engine.createCompany({ folder, name: 'Acme' })

    engine.deleteCompany(acme.id)

    expect(readdirSync(appData)).toEqual([])
    expect(existsSync(join(folder, '.tinycorp'))).toBe(false)
  })

  it('leaves everything where it is when the Company is only forgotten', () => {
    const { engine, folder, appData } = inWsl()
    const acme = engine.createCompany({ folder, name: 'Acme' })

    engine.forgetCompany(acme.id)

    expect(readdirSync(join(appData, acme.id))).toContain(COMPANY_FILE)
    expect(existsSync(join(folder, '.tinycorp'))).toBe(true)
  })

  it('carries the database into the folder when the Company moves out of WSL', () => {
    const { engine, folder, appData } = inWsl()
    const acme = engine.createCompany({ folder, name: 'Acme' })
    engine.employees.create({ name: 'Ada', roleId: 'backend' })
    const to = join(tempFolder(), 'Acme')

    const moved = engine.moveCompany(acme.id, to)

    expect(moved.folder).toBe(to)
    expect(existsSync(join(to, COMPANY_FILE))).toBe(true)
    expect(existsSync(join(to, '.tinycorp'))).toBe(false)
    expect(existsSync(join(appData, acme.id))).toBe(false)
    expect(engine.employees.list().map((employee) => employee.name)).toEqual(['Ada'])
  })

  it('carries it out to AppData when a Company on a drive moves into WSL', () => {
    const { engine, share, appData } = inWsl()
    const from = join(tempFolder(), 'Acme')
    const acme = engine.createCompany({ folder: from, name: 'Acme' })
    engine.employees.create({ name: 'Ada', roleId: 'backend' })
    const to = join(share, 'Acme')

    const moved = engine.moveCompany(acme.id, to)

    expect(moved.folder).toBe(to)
    expect(existsSync(join(to, COMPANY_FILE))).toBe(false)
    expect(readdirSync(join(appData, acme.id))).toContain(COMPANY_FILE)
    expect(JSON.parse(readFileSync(join(to, '.tinycorp', 'company.json'), 'utf8')).id).toBe(acme.id)
    expect(engine.employees.list().map((employee) => employee.name)).toEqual(['Ada'])
  })
})
