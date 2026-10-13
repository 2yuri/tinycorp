import type { DatabaseSync } from 'node:sqlite'
import {
  BOSS_INITIALS_PATTERN,
  COMPANY_KEY_PATTERN,
  type Company,
  type CompanyUpdate,
  companyKeyFrom,
  initialsFrom,
} from '../../../shared/company'
import type { Migration } from '../../core'

/** The Company key's migration step. Rows made before it get a key when next opened. */
export const COMPANY_KEY_MIGRATION: Migration = {
  name: 'company-key',
  sql: `ALTER TABLE company ADD COLUMN key TEXT`,
}

/** The boss profile's migration step. Null columns fall back to the OS account name and its initials. */
export const COMPANY_BOSS_PROFILE_MIGRATION: Migration = {
  name: 'company-boss-profile',
  sql: `
  ALTER TABLE company ADD COLUMN boss_name TEXT;
  ALTER TABLE company ADD COLUMN boss_initials TEXT;
`,
}

/** The profile columns are optional: a database with an odd history may lack them and must still open. */
interface CompanyRow {
  id: string
  name: string
  key?: string | null
  boss_name?: string | null
  boss_initials?: string | null
  created_at: string
}

function companyRow(db: DatabaseSync): CompanyRow | undefined {
  return db.prepare('SELECT * FROM company').get() as CompanyRow | undefined
}

/** The Company stored in `db`, or null for an empty database. */
export function readCompany(db: DatabaseSync, folder: string, defaultBossName: string): Company | null {
  const row = companyRow(db)
  if (!row) return null
  const bossName = row.boss_name ?? defaultBossName
  return {
    id: row.id,
    name: row.name,
    key: row.key ?? companyKeyFrom(row.name),
    boss: { name: bossName, initials: row.boss_initials ?? initialsFrom(bossName) },
    folder,
    createdAt: row.created_at,
  }
}

/**
 * The boss fields the Company row itself carries, before T79 moved the profile to userData. The
 * engine hands these to the boss profile store once, so an existing Company's boss carries over.
 */
export function readBossColumns(db: DatabaseSync): { name: string | null; initials: string | null } {
  const row = companyRow(db)
  return { name: row?.boss_name ?? null, initials: row?.boss_initials ?? null }
}

/** A key for a new Company: its name's initials, varied when another open Company has them. */
export function freshCompanyKey(name: string, taken: ReadonlySet<string>): string {
  const base = companyKeyFrom(name)
  if (!taken.has(base)) return base
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  const stem = base.slice(0, 3)
  for (const letter of letters) {
    const candidate = stem + letter
    if (!taken.has(candidate)) return candidate
  }
  return base
}

/** Stores a key for a Company made before keys existed, so its ticket ids stay stable. */
export function ensureCompanyKey(db: DatabaseSync, name: string, taken: ReadonlySet<string>): void {
  const row = companyRow(db)
  if (!row || row.key !== null) return
  db.prepare('UPDATE company SET key = ?').run(freshCompanyKey(name, taken))
}

/**
 * Applies Company settings to `db` after checking them all; nothing is written when one is wrong.
 * `taken` holds the keys of the other open Companies.
 */
export function updateCompanyProfile(db: DatabaseSync, update: CompanyUpdate, taken: ReadonlySet<string>): void {
  const sets: string[] = []
  const values: (string | null)[] = []

  if (update.name !== undefined) {
    const name = update.name.trim()
    if (!name) throw new Error('A Company needs a name')
    sets.push('name = ?')
    values.push(name)
  }
  if (update.key !== undefined) {
    const key = update.key.trim()
    if (!COMPANY_KEY_PATTERN.test(key)) throw new Error('A Company key is 2 to 4 uppercase letters')
    if (taken.has(key)) throw new Error(`Another open Company already uses the key ${key}`)
    sets.push('key = ?')
    values.push(key)
  }
  if (update.bossName !== undefined) {
    const bossName = update.bossName.trim()
    if (!bossName) throw new Error('The boss needs a name')
    sets.push('boss_name = ?')
    values.push(bossName)
  }
  if (update.bossInitials !== undefined) {
    const initials = update.bossInitials.trim().toUpperCase()
    if (initials && !BOSS_INITIALS_PATTERN.test(initials)) {
      throw new Error('Initials are 1 to 3 letters or digits')
    }
    sets.push('boss_initials = ?')
    values.push(initials || null)
  }

  if (sets.length) db.prepare(`UPDATE company SET ${sets.join(', ')}`).run(...values)
}
