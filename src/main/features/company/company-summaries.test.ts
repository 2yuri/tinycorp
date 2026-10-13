import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type OpenDatabase, openDatabaseFile } from '../../core/database'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import type { RecentCompanies } from '../../core/recents'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'
import { fakeGit } from '../../platform/testing'
import { fakeProvider } from '../../providers/testing'

const engines: CompanyEngine[] = []
const dirs: string[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  vi.useRealTimers()
})

function engineWith(options: { openDatabase?: OpenDatabase; recents?: RecentCompanies } = {}) {
  const provider = fakeProvider()
  const engine = createCompanyEngine({
    openDatabase: options.openDatabase ?? inMemoryDatabases(),
    recents: options.recents ?? inMemoryRecents(),
    providers: { claude: provider },
    isGitRepo: () => true,
    git: fakeGit(),
    mcpUrl: () => 'http://127.0.0.1/mcp',
    log: () => {},
  })
  provider.connect(engine.sessions.receiveHook)
  engines.push(engine)
  return engine
}

describe('company summaries', () => {
  it('lists every open Company with its staff, running Sessions and which one is current', () => {
    vi.useFakeTimers({ now: new Date('2026-09-17T10:00:00Z') })
    const engine = engineWith()
    const acme = engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
    engine.employees.create({ name: 'Grace', roleId: 'backend' })
    engine.sessions.start(ada.id)
    const globex = engine.createCompany({ folder: onDisk('/work/globex'), name: 'Globex' })

    expect(engine.companySummaries()).toEqual([
      {
        ...acme,
        open: true,
        current: false,
        employees: 2,
        sessions: 1,
        lastOpenedAt: '2026-09-17T10:00:00.000Z',
        onboardingCompletedAt: null,
        missing: false,
        databaseElsewhere: false,
      },
      {
        ...globex,
        open: true,
        current: true,
        employees: 0,
        sessions: 0,
        lastOpenedAt: '2026-09-17T10:00:00.000Z',
        onboardingCompletedAt: null,
        missing: false,
        databaseElsewhere: false,
      },
    ])
  })

  it('stops counting a Session once it is stopped', () => {
    const engine = engineWith()
    engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
    engine.sessions.start(ada.id)
    engine.sessions.stop(ada.id)

    expect(engine.companySummaries()[0]).toMatchObject({ sessions: 0 })
  })

  it('does not count fired Employees', () => {
    const engine = engineWith()
    engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
    engine.employees.create({ name: 'Grace', roleId: 'backend' })
    engine.hiring.fire(ada.id)

    expect(engine.companySummaries()[0]).toMatchObject({ employees: 1 })
  })

  it('reads a Company that is not open from its folder, with the time it was last open', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tinycorp-summaries-'))
    dirs.push(dir)
    const recents = inMemoryRecents()
    const folder = dir
    vi.useFakeTimers({ now: new Date('2026-09-10T08:00:00Z') })
    const before = engineWith({ recents, openDatabase: openDatabaseFile })
    const acme = before.createCompany({ folder, name: 'Acme' })
    before.employees.create({ name: 'Ada', roleId: 'backend' })
    vi.setSystemTime(new Date('2026-09-12T18:30:00Z'))
    before.close()

    vi.setSystemTime(new Date('2026-09-17T10:00:00Z'))
    const after = engineWith({ recents, openDatabase: openDatabaseFile })

    expect(after.companySummaries()).toEqual([
      {
        ...acme,
        open: false,
        current: false,
        employees: 1,
        sessions: 0,
        lastOpenedAt: '2026-09-12T18:30:00.000Z',
        onboardingCompletedAt: null,
        missing: false,
        databaseElsewhere: false,
      },
    ])
  })

  it('marks a Company whose folder is gone, with unknown staff', () => {
    const recents = inMemoryRecents()
    recents.remember({
      id: 'gone',
      name: 'Gone',
      key: 'GO',
      boss: { name: 'Boss', initials: 'BO' },
      folder: onDisk('/nowhere/gone'),
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    const engine = engineWith({ recents })

    expect(engine.companySummaries()).toEqual([
      expect.objectContaining({
        id: 'gone',
        open: false,
        employees: null,
        sessions: 0,
        lastOpenedAt: null,
        onboardingCompletedAt: '2026-01-01T00:00:00.000Z',
        missing: true,
      }),
    ])
  })

  // The folder is pulled out from under an open database, which is a thing only a POSIX filesystem
  // lets anyone do: Windows refuses to unlink a file anything still holds open, so there is no way
  // to set this up there and nothing there to get wrong (T166).
  it.skipIf(process.platform === 'win32')(
    'never marks an open Company missing: its database is in hand whatever the folder does',
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'tinycorp-summaries-'))
      dirs.push(dir)
      const engine = engineWith({ openDatabase: openDatabaseFile })
      engine.createCompany({ folder: dir, name: 'Acme' })
      rmSync(dir, { recursive: true, force: true })

      expect(engine.companySummaries()[0]).toMatchObject({ open: true, missing: false })
    },
  )
})
