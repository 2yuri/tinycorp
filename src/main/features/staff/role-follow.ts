import type { DatabaseSync } from 'node:sqlite'
import { JOB_FIELDS, type JobField, type RoleTemplate } from '../../../shared/domain/staff'
import type { Job } from '../../../shared/staff/role-follow'
import type { Migration } from '../../core'

/**
 * Employees follow their role template (decision 34): a job field (persona, capabilities,
 * repo filter) an Employee has not overridden takes the role's value whenever the role is
 * edited. Instructions are rendered from the Employee at every spawn, so the next Session
 * start picks the change up.
 */

const COLUMN: Record<JobField, string> = {
  persona: 'persona',
  capabilities: 'capabilities',
  repoFilter: 'repo_filter',
  areas: 'areas',
  mcpServers: 'mcp_servers',
  skills: 'skills',
}

/**
 * The job fields as they stood when `staff-employee-overrides` was written. A migration's SQL is
 * fixed at the moment it ran: a field added later has no column yet at this point in the list, so
 * it brings its own migration (T136) rather than rewriting this one under every database that has
 * already applied it.
 */
const OVERRIDES_MIGRATION_FIELDS = ['persona', 'capabilities', 'repoFilter'] as const

/**
 * Adds `employee.overrides` and marks, for Employees hired before it, every job field that
 * already differs from the role as overridden, so a later role edit does not clobber it.
 */
export const ROLE_FOLLOW_MIGRATION: Migration = {
  name: 'staff-employee-overrides',
  sql: `
  ALTER TABLE employee ADD COLUMN overrides TEXT NOT NULL DEFAULT '[]';
  UPDATE employee SET overrides = (
    SELECT json_group_array(field) FROM (
      ${OVERRIDES_MIGRATION_FIELDS.map(
        (field) =>
          `SELECT '${field}' AS field FROM role_template r
           WHERE r.id = employee.role_id AND r.${COLUMN[field]} != employee.${COLUMN[field]}`,
      ).join(' UNION ALL ')}
    )
  );
`,
}

/** Writes the role's job fields onto every Employee on it that has not overridden them. */
export function propagateRole(db: DatabaseSync, role: RoleTemplate): void {
  const employees = db.prepare('SELECT id, overrides FROM employee WHERE role_id = ?').all(role.id) as {
    id: string
    overrides: string
  }[]
  for (const employee of employees) {
    const overrides = parseOverrides(employee.overrides)
    const following = JOB_FIELDS.filter((field) => !overrides.includes(field))
    if (!following.length) continue
    db.prepare(`UPDATE employee SET ${following.map((f) => `${COLUMN[f]} = ?`).join(', ')} WHERE id = ?`).run(
      ...following.map((f) => storedValue(role, f)),
      employee.id,
    )
  }
}

export function parseOverrides(text: string): JobField[] {
  const parsed = JSON.parse(text) as unknown
  return JOB_FIELDS.filter((field) => Array.isArray(parsed) && parsed.includes(field))
}

export function requireJobFields(fields: unknown): JobField[] {
  if (!Array.isArray(fields)) throw new Error('Fields to follow must be a list')
  for (const field of fields) {
    if (!JOB_FIELDS.includes(field as JobField)) throw new Error(`Unknown job field: ${String(field)}`)
  }
  return fields as JobField[]
}

function storedValue(role: Job, field: JobField): string {
  return field === 'persona' ? role.persona : JSON.stringify(role[field])
}
