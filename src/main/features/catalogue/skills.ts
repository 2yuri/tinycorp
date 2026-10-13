import { randomUUID } from 'node:crypto'
import { statSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'
import {
  type Skill,
  type SkillImpact,
  type SkillInput,
  type SkillRow,
  skillProblems,
} from '../../../shared/catalogue/skills'
import type { SkillGrants } from '../../../shared/domain/staff'
import type { Migration } from '../../core'
import type { GrantedSkill } from '../../providers'

/**
 * The Company's own catalogue of skill folders (T137, decision 58).
 *
 * A skill is a name and a folder on this Mac, picked with the folder picker. The catalogue stores
 * the path and never copies the folder in: the boss edits it once and every Employee holding it
 * sees the edit. Nothing in a skill folder is read, parsed or executed by TinyCorp — it is the
 * agent that opens it, at its own discretion, like any other file in its worktree.
 *
 * Adding, editing and removing one is the boss's, the way the MCP catalogue is (T136): a skill is
 * instructions, and instructions steer an Employee, so no Employee can hand itself one.
 */

/** The catalogue table, and the grant beside `persona`, `capabilities`, `repo_filter` and `mcp_servers`. */
export const SKILLS_MIGRATION: Migration = {
  name: 'skill-catalogue-and-grants',
  sql: `
  CREATE TABLE skill (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    position INTEGER NOT NULL
  );
  ALTER TABLE role_template ADD COLUMN skills TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE employee ADD COLUMN skills TEXT NOT NULL DEFAULT '[]';
`,
}

export interface SkillCatalogue {
  list(): SkillRow[]
  create(input: SkillInput): SkillRow
  update(id: string, patch: Partial<SkillInput>): SkillRow
  /** What removing this skill would take with it, counted before anything is done. */
  impact(id: string): SkillImpact
  /**
   * Removes the skill and takes the grant off every Employee and every role that held it. The
   * folder on disk is not touched: TinyCorp never copied it and does not delete it.
   */
  remove(id: string): void
  /** Called after any change to the catalogue or to who holds what. */
  onChange(listener: () => void): () => void
}

export interface SkillCatalogueOptions {
  /** The current Company's database; throws when none is open. */
  current(): { db: DatabaseSync }
  /** Called after the catalogue changes, so the staff and the office can be told too. */
  notify(): void
  /** Whether a folder is on this Mac. Injected so the engine's tests never need one. */
  exists?: (path: string) => boolean
}

/** Whether `path` is a folder on this Mac now. A file, or nothing at all, is not. */
export function folderExists(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

export function createSkillCatalogue({
  current,
  notify,
  exists = folderExists,
}: SkillCatalogueOptions): SkillCatalogue {
  const listeners = new Set<() => void>()
  const changed = () => {
    notify()
    for (const listener of listeners) listener()
  }

  return {
    list() {
      return listSkills(current().db, exists)
    },

    create(input) {
      const { db } = current()
      const skill: Skill = { id: randomUUID(), ...cleanInput(input, db) }
      const { next } = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM skill').get() as {
        next: number
      }
      db.prepare('INSERT INTO skill (id, name, path, position) VALUES (?, ?, ?, ?)').run(
        skill.id,
        skill.name,
        skill.path,
        next,
      )
      changed()
      return { ...skill, missing: !exists(skill.path), employees: 0 }
    },

    update(id, patch) {
      const { db } = current()
      const before = findSkill(db, id)
      const next = cleanInput({ ...before, ...patch }, db, id)
      db.prepare('UPDATE skill SET name = ?, path = ? WHERE id = ?').run(next.name, next.path, id)
      changed()
      return rowOf(db, id, exists)
    },

    impact(id) {
      const { db } = current()
      const skill = findSkill(db, id)
      return {
        name: skill.name,
        employees: countHolding(db, 'employee', id),
        roles: countHolding(db, 'role_template', id),
      }
    },

    remove(id) {
      const { db } = current()
      findSkill(db, id)
      dropGrant(db, 'employee', id)
      dropGrant(db, 'role_template', id)
      db.prepare('DELETE FROM skill WHERE id = ?').run(id)
      changed()
    },

    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

/** Every skill in the Company, in catalogue order, with who holds it and whether it is still there. */
export function listSkills(db: DatabaseSync, exists: (path: string) => boolean = folderExists): SkillRow[] {
  const rows = db.prepare('SELECT * FROM skill ORDER BY position, rowid').all() as unknown as SkillRow0[]
  const held = holders(db)
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    path: row.path,
    missing: !exists(row.path),
    employees: held.get(row.id) ?? 0,
  }))
}

/**
 * The skills an Employee is handed, in catalogue order. A folder that has moved or been deleted is
 * still in the list and says so: the spawn goes ahead without it rather than failing (T137).
 */
export function grantedSkills(
  db: DatabaseSync,
  grants: SkillGrants,
  exists: (path: string) => boolean = folderExists,
): GrantedSkill[] {
  if (grants.length === 0) return []
  const wanted = new Set(grants)
  return listSkills(db, exists)
    .filter((skill) => wanted.has(skill.id))
    .map(({ name, path, missing }) => ({ name, path, missing }))
}

/** What an Employee's instructions say it has: the skills it holds, and where each one is. */
export function skillSummaries(
  db: DatabaseSync,
  grants: SkillGrants,
  exists: (path: string) => boolean = folderExists,
): { name: string; missing: boolean }[] {
  return grantedSkills(db, grants, exists).map(({ name, missing }) => ({ name, missing: missing === true }))
}

/** Grants as they are stored: known ids only, in catalogue order, each at most once. */
export function cleanSkillGrants(db: DatabaseSync, grants: unknown): SkillGrants {
  if (!Array.isArray(grants) || grants.some((id) => typeof id !== 'string')) {
    throw new Error('Skills are given as a list of ids')
  }
  const wanted = new Set(grants as string[])
  const known = (db.prepare('SELECT id FROM skill ORDER BY position, rowid').all() as { id: string }[]).map(
    (row) => row.id,
  )
  for (const id of wanted) {
    if (!known.includes(id)) throw new Error(`Unknown skill: ${id}`)
  }
  return known.filter((id) => wanted.has(id))
}

/** The skills one Employee holds, as stored. Empty for an Employee the catalogue never reached. */
export function employeeSkillGrants(db: DatabaseSync, employeeId: string): SkillGrants {
  const row = db.prepare('SELECT skills FROM employee WHERE id = ?').get(employeeId) as
    | { skills: string | null }
    | undefined
  return parseSkillGrants(row?.skills ?? null)
}

export function parseSkillGrants(text: string | null): SkillGrants {
  if (!text) return []
  const parsed = JSON.parse(text) as unknown
  if (!Array.isArray(parsed)) return []
  return parsed.filter((id): id is string => typeof id === 'string')
}

/** How many Employees hold each skill; fired Employees hold nothing. */
function holders(db: DatabaseSync): Map<string, number> {
  const rows = db.prepare('SELECT skills FROM employee WHERE fired_at IS NULL').all() as {
    skills: string | null
  }[]
  const counts = new Map<string, number>()
  for (const row of rows) {
    for (const id of new Set(parseSkillGrants(row.skills))) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return counts
}

function countHolding(db: DatabaseSync, table: 'employee' | 'role_template', id: string): number {
  const where = table === 'employee' ? ' WHERE fired_at IS NULL' : ''
  const rows = db.prepare(`SELECT skills FROM ${table}${where}`).all() as { skills: string | null }[]
  return rows.filter((row) => parseSkillGrants(row.skills).includes(id)).length
}

/** Takes one skill off every row of a table that held it, leaving the rest of each list alone. */
function dropGrant(db: DatabaseSync, table: 'employee' | 'role_template', id: string): void {
  const rows = db.prepare(`SELECT rowid AS rowid, skills FROM ${table}`).all() as {
    rowid: number
    skills: string | null
  }[]
  const write = db.prepare(`UPDATE ${table} SET skills = ? WHERE rowid = ?`)
  for (const row of rows) {
    const grants = parseSkillGrants(row.skills)
    if (!grants.includes(id)) continue
    write.run(JSON.stringify(grants.filter((held) => held !== id)), row.rowid)
  }
}

/** The input as it is stored: trimmed and validated. The folder itself is never opened. */
function cleanInput(input: SkillInput, db: DatabaseSync, exceptId = ''): Omit<Skill, 'id'> {
  const name = (input.name ?? '').trim()
  const path = (input.path ?? '').trim().replace(/\/+$/, '')
  const taken = (db.prepare('SELECT name FROM skill WHERE id != ?').all(exceptId) as { name: string }[]).map(
    (row) => row.name,
  )
  const problems = skillProblems({ name, path }, taken)
  const first = Object.values(problems)[0]
  if (first) throw new Error(first)
  return { name, path }
}

interface SkillRow0 {
  id: string
  name: string
  path: string
  position: number
}

function findSkill(db: DatabaseSync, id: string): Skill {
  const row = db.prepare('SELECT * FROM skill WHERE id = ?').get(id) as SkillRow0 | undefined
  if (!row) throw new Error(`Unknown skill: ${id}`)
  return { id: row.id, name: row.name, path: row.path }
}

function rowOf(db: DatabaseSync, id: string, exists: (path: string) => boolean): SkillRow {
  const row = listSkills(db, exists).find((skill) => skill.id === id)
  if (!row) throw new Error(`Unknown skill: ${id}`)
  return row
}
