import { describe, expect, it } from 'vitest'
import { createCompanyContext } from '../../core/company-context'
import { type Migration, runMigrations } from '../../core/database'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'
import { COMPANY_BOSS_PROFILE_MIGRATION, COMPANY_KEY_MIGRATION } from './company-profile'
import { COMPANY_VISITS_MIGRATION } from './company-summaries'
import { register } from './wire'

/**
 * The tables a Company row needs, and no feature's. The base table is spelled here rather than
 * imported, because the list every migration is in belongs to the engine and a feature does not
 * reach into it (`ARCHITECTURE.md`); the three steps after it are this feature's own.
 */
const COMPANY_TABLE: Migration = {
  name: 'company-table',
  sql: 'CREATE TABLE company (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL)',
}
const SCHEMA = [COMPANY_TABLE, COMPANY_KEY_MIGRATION, COMPANY_BOSS_PROFILE_MIGRATION, COMPANY_VISITS_MIGRATION]

/** The Company lifecycle with nothing else of the app around it: what an open and a close mean. */
function lifecycle(opened: () => void = () => {}) {
  const recents = inMemoryRecents()
  const feature = register(createCompanyContext(), {
    recents,
    openDatabase: inMemoryDatabases(),
    migrate: (db) => runMigrations(db, SCHEMA),
    log: () => {},
    opened,
    closing: () => {},
    reopened: () => {},
    bossInbox: () => [],
    onActivity: () => () => {},
  })
  return { feature, recents }
}

describe('A create that fails once the Company is registered', () => {
  it('leaves nothing holding it: not the app, not the launcher list, not a closed connection', () => {
    let opens = 0
    const { feature, recents } = lifecycle(() => {
      // Whatever the app does with a newly opened Company — the digest, the worktrees, a Session —
      // can throw, and until T252 the Company stayed registered against a connection about to close.
      opens++
      throw new Error('the office could not be opened')
    })

    expect(() => feature.facade.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })).toThrow(
      /could not be opened/i,
    )

    expect(opens).toBe(1)
    expect(feature.facade.currentCompany()).toBeNull()
    expect(feature.facade.listCompanies()).toEqual([])
    expect(recents.list()).toEqual([])
  })

  it('creates the Company when the open goes through, and that is the Company the app is on', () => {
    const { feature, recents } = lifecycle()

    const acme = feature.facade.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })

    expect(feature.facade.currentCompany()).toEqual(acme)
    expect(recents.list()).toEqual([acme])
  })
})
