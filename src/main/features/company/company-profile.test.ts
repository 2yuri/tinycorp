import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import type { BossProfile } from '../../../shared/company'
import { companyKeyFrom } from '../../../shared/company'
import { openDatabaseFile, runMigrations } from '../../core/database'
import { type CompanyEngine, type CompanyEngineOptions, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryBossProfile, inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'

/** The boss a Company shows: the profile's own fields (T79), not the Company's. */
function boss(name: string, initials: string, rest: Partial<BossProfile> = {}): BossProfile {
  return { name, initials, handle: name.split(' ')[0]!.toLowerCase(), sprite: 0, status: 'available', ...rest }
}

const engines: CompanyEngine[] = []
const tempDirs: string[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempFolder() {
  const dir = mkdtempSync(join(tmpdir(), 'tinycorp-'))
  tempDirs.push(dir)
  return dir
}

/** An engine on real SQLite files, so a Company can be closed and opened again. */
function engineOnDisk(options: Partial<CompanyEngineOptions> = {}) {
  return engineWith({ openDatabase: openDatabaseFile, ...options })
}

function engineWith(options: Partial<CompanyEngineOptions> = {}) {
  const engine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
    bossName: () => 'Grace Holt',
    ...options,
  })
  engines.push(engine)
  return engine
}

describe('Company key', () => {
  it('derives a default key from the name', () => {
    expect(companyKeyFrom('Test Co')).toBe('TC')
    expect(companyKeyFrom('Acme')).toBe('AC')
    expect(companyKeyFrom('tinycorp')).toBe('TI')
    expect(companyKeyFrom('the big red dog co')).toBe('TBRD')
    expect(companyKeyFrom('X')).toBe('XC')
    expect(companyKeyFrom('42')).toBe('CO')
  })

  it('gives a new Company its initials as key, varied when an open Company has them', () => {
    const engine = engineWith()

    const first = engine.createCompany({ folder: onDisk('/work/a'), name: 'Test Co' })
    const second = engine.createCompany({ folder: onDisk('/work/b'), name: 'Tiny Cats' })

    expect(first.key).toBe('TC')
    expect(second.key).toMatch(/^TC[A-Z]$/)
  })

  it('changes the key and keeps it across a reopen', () => {
    const folder = tempFolder()
    const engine = engineOnDisk()
    engine.createCompany({ folder, name: 'Acme' })

    const updated = engine.updateCompany({ key: 'ACME' })
    engine.close()
    const reopened = engineOnDisk().openCompany(folder)

    expect(updated.key).toBe('ACME')
    expect(reopened.key).toBe('ACME')
  })

  it.each(['A', 'ABCDE', 'ab', 'A1', 'A B'])('refuses the key %j', (key) => {
    const engine = engineWith()
    engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })

    expect(() => engine.updateCompany({ key })).toThrow(/2 to 4 uppercase letters/)
    expect(engine.currentCompany()?.key).toBe('AC')
  })

  it('refuses a key another open Company uses, and allows keeping its own', () => {
    const engine = engineWith()
    engine.createCompany({ folder: onDisk('/work/globex'), name: 'Globex' })
    engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })

    expect(() => engine.updateCompany({ key: 'GL' })).toThrow(/already uses the key GL/)
    expect(engine.updateCompany({ key: 'AC' }).key).toBe('AC')
  })

  it('stores a key for a Company made before keys existed', () => {
    const databases = inMemoryDatabases()
    const db = databases(onDisk('/work/old'), 'create')!
    runMigrations(db, [
      {
        name: 'company-table',
        sql: 'CREATE TABLE company (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL)',
      },
    ])
    db.prepare("INSERT INTO company (id, name, created_at) VALUES ('old', 'Old Timers', '2026-01-01')").run()

    const engine = engineWith({ openDatabase: databases })
    const opened = engine.openCompany(onDisk('/work/old'))

    expect(opened.key).toBe('OT')
    expect((db.prepare('SELECT key FROM company').get() as { key: string }).key).toBe('OT')
  })
})

// Decision 33: each Company keeps its board in its own database, so a ticket's own id is already the
// per-Company sequence; the key in front of it is what makes `AC-1` read across Companies.
describe('Ticket ids carry the Company key', () => {
  /** The label the activity log gives the newest ticket event. */
  const newestTicket = (engine: CompanyEngine) =>
    engine.activity.list({ limit: 50 }).find((event) => event.subject?.kind === 'ticket')?.subject?.label

  it('numbers tickets from one in each Company, in creation order, under that Company’s key', () => {
    const engine = engineWith()
    engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
    const first = engine.board().createTicket({ title: 'Login page' })
    const second = engine.board().createTicket({ title: 'Signup' })
    expect(newestTicket(engine)).toBe('AC-2')

    engine.createCompany({ folder: onDisk('/work/globex'), name: 'Globex' })
    const theirs = engine.board().createTicket({ title: 'Invoices' })

    expect([first.id, second.id, theirs.id]).toEqual([1, 2, 1])
    expect(newestTicket(engine)).toBe('GL-1')
  })

  it('writes the new key the moment Company settings changes it', () => {
    const engine = engineWith()
    engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
    const ticket = engine.board().createTicket({ title: 'Login page' })

    engine.updateCompany({ key: 'ACME' })
    engine.board().moveTicket(ticket.id, 'doing')

    expect(newestTicket(engine)).toBe('ACME-1')
  })
})

describe('Company settings', () => {
  it('renames the current Company, remembers it and tells listeners', () => {
    const recents = inMemoryRecents()
    const engine = engineWith({ recents })
    engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
    let changes = 0
    engine.onChange(() => changes++)

    const renamed = engine.updateCompany({ name: '  Acme Labs ' })

    expect(renamed.name).toBe('Acme Labs')
    expect(engine.currentCompany()).toEqual(renamed)
    expect(engine.listCompanies()).toEqual([renamed])
    expect(recents.list()).toEqual([renamed])
    expect(changes).toBe(1)
  })

  it('refuses a blank name and writes nothing when any field is wrong', () => {
    const engine = engineWith()
    engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })

    expect(() => engine.updateCompany({ name: ' ' })).toThrow(/name/)
    expect(() => engine.updateCompany({ name: 'Other', key: 'x' })).toThrow(/key/)
    expect(engine.currentCompany()).toMatchObject({ name: 'Acme', key: 'AC' })
  })

  it('refuses edits while no Company is open', () => {
    expect(() => engineWith().updateCompany({ name: 'Acme' })).toThrow(/no company/i)
  })

  it('names the boss after the OS account until the boss sets a profile', () => {
    const engine = engineWith()

    const company = engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })

    expect(company.boss).toEqual(boss('Grace Holt', 'GH'))
  })

  it('falls back to Boss when the OS account has no name', () => {
    const engine = engineWith({ bossName: () => '  ' })

    expect(engine.createCompany({ folder: onDisk('/work/acme') }).boss).toEqual(boss('Boss', 'BO'))
  })

  // One boss runs every Company, so the profile is theirs, not a Company's (T79).
  it('shows the one boss profile in every Company, across a restart', () => {
    const [globexFolder, acmeFolder] = [tempFolder(), tempFolder()]
    const bossProfile = inMemoryBossProfile()
    const engine = engineOnDisk({ bossProfile })
    engine.createCompany({ folder: globexFolder, name: 'Globex' })
    engine.createCompany({ folder: acmeFolder, name: 'Acme' })

    const named = engine.updateCompany({ bossName: 'Ada Lorne' })
    const withInitials = engine.updateCompany({ bossInitials: 'al' })
    engine.close()
    const next = engineOnDisk({ bossProfile })
    const acme = next.openCompany(acmeFolder)
    const globex = next.openCompany(globexFolder)

    expect(named.boss).toEqual(boss('Ada Lorne', 'AL', { handle: 'ada' }))
    expect(withInitials.boss).toEqual(boss('Ada Lorne', 'AL', { handle: 'ada' }))
    expect(acme.boss).toEqual(boss('Ada Lorne', 'AL', { handle: 'ada' }))
    expect(globex.boss).toEqual(acme.boss)
  })

  it('carries the boss a Company stored before the profile existed', () => {
    const folder = tempFolder()
    const engine = engineOnDisk()
    engine.createCompany({ folder, name: 'Acme' })
    // What a pre-T79 Company row holds: the boss fields Company settings wrote into it.
    engine.close()
    const db = openDatabaseFile(folder, 'existing')!
    db.prepare('UPDATE company SET boss_name = ?, boss_initials = ?').run('Ada Lorne', 'AL')
    db.close()

    const reopened = engineOnDisk().openCompany(folder)

    expect(reopened.boss).toEqual(boss('Ada Lorne', 'AL', { handle: 'ada' }))
  })

  it('keeps custom initials when the name changes, and derives them again once cleared', () => {
    const engine = engineWith()
    engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })

    engine.updateCompany({ bossInitials: 'Y' })
    expect(engine.updateCompany({ bossName: 'Yuri Miguel' }).boss).toEqual(boss('Yuri Miguel', 'Y'))
    expect(engine.updateCompany({ bossInitials: '' }).boss).toEqual(boss('Yuri Miguel', 'YM'))
  })

  it('writes neither half when the Company key and the boss change together and one is wrong', () => {
    const engine = engineWith()
    engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })

    expect(() => engine.updateCompany({ bossName: 'Ada Lorne', key: 'x' })).toThrow(/key/)
    expect(() => engine.updateCompany({ bossName: '', name: 'Renamed' })).toThrow(/boss needs a name/)

    expect(engine.currentCompany()).toMatchObject({ name: 'Acme', key: 'AC', boss: boss('Grace Holt', 'GH') })
  })

  it('refuses a blank boss name and initials longer than three characters', () => {
    const engine = engineWith()
    engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })

    expect(() => engine.updateCompany({ bossName: '' })).toThrow(/boss needs a name/)
    expect(() => engine.updateCompany({ bossInitials: 'ABCD' })).toThrow(/Initials/)
    expect(() => engine.updateCompany({ bossInitials: 'A.' })).toThrow(/Initials/)
    expect(engine.currentCompany()?.boss).toEqual(boss('Grace Holt', 'GH'))
  })

  it('applies both migrations by name', () => {
    const db = new DatabaseSync(':memory:')
    const engine = engineWith({ openDatabase: () => db })
    engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })

    const names = (db.prepare('SELECT name FROM schema_migration').all() as { name: string }[]).map((r) => r.name)

    expect(names).toEqual(expect.arrayContaining(['company-key', 'company-boss-profile']))
  })
})
