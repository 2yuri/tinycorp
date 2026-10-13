/**
 * The Company's catalogue of skill folders (T137, frame `uApL8`).
 *
 * A skill is a folder of instructions an agent opens when the work calls for it — a review
 * checklist, a deploy runbook, the way this team hands a design off. The Company names the folder
 * once, here, and hands it out through the role; nothing in it is parsed, validated or run by
 * TinyCorp, and nothing is copied in: the catalogue stores the path the boss picked.
 */

import { isAbsolutePath } from '../platform/absolute-path'

/** What a name may hold: it becomes a folder name inside the Employee's worktree. */
export const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]*$/

export const MAX_SKILL_NAME_LENGTH = 40

/** One skill folder in the Company's catalogue. */
export interface Skill {
  id: string
  /** Unique in the Company, and the folder name the agent sees it under. */
  name: string
  /** Absolute path of the folder on this Mac. Never copied, never read by TinyCorp. */
  path: string
}

/** A catalogue row as the settings card draws it: the skill, plus what is true about it now. */
export interface SkillRow extends Skill {
  /** Whether the folder is on this Mac now. A folder that moved says so, and fails no spawn. */
  missing: boolean
  /** How many Employees hold this skill now. */
  employees: number
}

/** A catalogue skill with what it says it does, as the composer's `/` palette lists it (T264). */
export interface SkillDescribed {
  id: string
  /** The name the agent sees it under, and what follows the `/`. */
  name: string
  /** Its `SKILL.md` front matter's `description`; empty when it has none, or no folder. */
  description: string
  /** Whether the folder is gone, so the row says {@link MISSING_FOLDER_LINE} instead. */
  missing: boolean
}

/** What the add and edit forms send. */
export interface SkillInput {
  name: string
  path: string
}

/** What removing a skill takes with it, counted before it is done. */
export interface SkillImpact {
  name: string
  /** Employees that hold it now and would lose it. */
  employees: number
  /** Roles that hand it out and would stop. */
  roles: number
}

/** The fields a form can be wrong about, with the sentence each one is wrong in. */
export type SkillProblems = Partial<Record<'name' | 'path', string>>

/**
 * What is wrong with a skill, as the form shows it and the engine refuses it. One function, so the
 * boss never reads one sentence in the form and a different one from the engine.
 */
export function skillProblems(input: Pick<SkillInput, 'name' | 'path'>, taken: readonly string[] = []): SkillProblems {
  const problems: SkillProblems = {}
  const name = (input.name ?? '').trim()
  if (!name) problems.name = 'A skill needs a name'
  else if (name.length > MAX_SKILL_NAME_LENGTH) problems.name = `A name is at most ${MAX_SKILL_NAME_LENGTH} characters`
  else if (!SKILL_NAME_PATTERN.test(name)) {
    problems.name = 'Lower case letters, digits, - and _, starting with a letter or digit'
  } else if (taken.some((other) => other.toLowerCase() === name.toLowerCase())) {
    problems.name = `This Company already has a skill named ${name}`
  }

  const path = (input.path ?? '').trim()
  if (!path) problems.path = 'Choose the folder the skill lives in'
  else if (!isAbsolutePath(path)) problems.path = 'A skill folder is an absolute path'
  return problems
}

/** The name a picked folder suggests: its own, lower-cased, with anything else turned into `-`. */
export function nameFromPath(path: string): string {
  const base =
    path
      .trim()
      .replace(/[/\\]+$/, '')
      .split(/[/\\]/)
      .pop() ?? ''
  return skillName(base)
}

/**
 * Any text as a name this catalogue takes: lower case, with anything {@link SKILL_NAME_PATTERN}
 * refuses turned into `-` and the length cut to {@link MAX_SKILL_NAME_LENGTH}.
 *
 * One function, because two places name a folder the boss did not name: the picker, from the
 * folder itself, and the machine scan, from a `SKILL.md`'s front matter (T253). A name they
 * normalised differently would be two rows for one folder.
 */
export function skillName(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SKILL_NAME_LENGTH)
    .replace(/-+$/, '')
}

/** What the row says about who holds the skill. */
export function skillHoldersLine(employees: number): string {
  if (employees === 0) return 'No employees'
  return employees === 1 ? '1 employee' : `${employees} employees`
}

/** What a row says about a folder that is not where the boss left it. */
export const MISSING_FOLDER_LINE = 'Folder is missing'

/**
 * The sentence the boss reads before a skill is removed. It says what goes with it, because the
 * grant is taken off every Employee and every role that held it. The folder itself is left alone:
 * TinyCorp never copied it and does not delete it.
 */
export function skillRemovalLine(impact: SkillImpact): string {
  const parts = [
    impact.employees === 1 ? '1 Employee' : `${impact.employees} Employees`,
    impact.roles === 1 ? '1 role' : `${impact.roles} roles`,
  ]
  return (
    `${impact.name} is held by ${parts[0]} and handed out by ${parts[1]}. Removing it takes the grant off all of ` +
    'them. The folder on your Mac is left where it is.'
  )
}

/**
 * What a skill is, said plainly, because adding one is choosing what steers an Employee. The same
 * trust as a repo the Company works in: TinyCorp does not parse, validate or run anything in the
 * folder — the agent reads it at its own discretion, like any other file in its worktree.
 */
export const SKILL_TRUST_WARNING =
  'A skill is instructions, and instructions steer an Employee. Where the folder came from matters — the same ' +
  'trust as a repo this Company works in. TinyCorp never parses, validates or runs anything in it; the Employee ' +
  'reads it when the work calls for it, like any other file in its worktree.'

/** What the Integrations card says the skills are. */
export const SKILLS_CARD_SUB =
  'Folders of instructions an Employee can open when the work calls for them. Each Provider reads them from its own ' +
  'folder in the worktree; one that reads none says so on the Employee.'

/** What the drawer says about an Employee whose Provider reads no skills at all. */
export function noSkillsLine(providerLabel: string): string {
  return `${providerLabel} — no skills`
}

/**
 * The drawer's skills item (T137): how many skills this Employee holds, or, on a Provider that
 * reads none, that it holds them and this product will not look at them. Null when there is
 * nothing to say — no skills held, on a Provider that has none.
 */
export function skillsMeta(
  held: { name: string; missing: boolean }[],
  providerLabel: string,
  providerReadsSkills: boolean,
): string | null {
  if (held.length === 0) return null
  if (!providerReadsSkills) return noSkillsLine(providerLabel)
  const missing = held.filter((skill) => skill.missing).length
  const count = held.length === 1 ? '1 skill' : `${held.length} skills`
  return missing === 0 ? count : `${count} · ${missing} missing`
}
