import { JOB_FIELDS, type JobField, type RoleTemplate } from '../domain/staff'

/** The job fields of a role or an Employee (decision 34). */
export type Job = Pick<RoleTemplate, JobField>

export function sameJobValue(field: JobField, a: Job[JobField], b: Job[JobField]): boolean {
  if (field === 'persona') return a === b
  const [left, right] = [a as string[], b as string[]]
  // A repo filter and the areas under it are ordered lists of patterns the boss wrote;
  // capabilities, MCP servers and skills are sets.
  if (field === 'repoFilter' || field === 'areas') {
    return left.length === right.length && left.every((p, i) => p === right[i])
  }
  return left.length === right.length && left.every((value) => right.includes(value))
}

/** Fields a new hire overrides: those given at hire that differ from the role. */
export function overridesAtHire(role: Job, hired: Job): JobField[] {
  return JOB_FIELDS.filter((field) => !sameJobValue(field, role[field], hired[field]))
}

/**
 * Overrides after an edit. A field the edit changes is overridden unless it now equals the
 * role; a field left as it was keeps its state; `followRole` fields are no longer overridden.
 */
export function overridesAfterEdit(options: {
  role: Job
  before: Job & { overrides: JobField[] }
  after: Job
  followRole: JobField[]
}): JobField[] {
  const { role, before, after, followRole } = options
  return JOB_FIELDS.filter((field) => {
    if (followRole.includes(field)) return false
    if (sameJobValue(field, before[field], after[field])) return before.overrides.includes(field)
    return !sameJobValue(field, role[field], after[field])
  })
}

/**
 * The job an Employee holds the moment its role changes (T138). A field it had not overridden
 * follows the new role and takes its value; a field it had overridden keeps the Employee's own.
 * The edit form previews with this and the engine saves with it, so what the boss is shown before
 * Save is what lands.
 */
export function jobAfterRoleChange(role: Job, employee: Job & { overrides: JobField[] }): Job {
  return Object.fromEntries(
    JOB_FIELDS.map((field) => [field, employee.overrides.includes(field) ? employee[field] : role[field]]),
  ) as unknown as Job
}
