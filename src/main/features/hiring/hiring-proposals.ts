import type { DatabaseSync } from 'node:sqlite'
import {
  CAPABILITIES,
  type Capability,
  type EmployeeInput,
  JOB_FIELDS,
  type RoleTemplate,
} from '../../../shared/domain/staff'
import type { ProposalPatch, ProposedEmployee } from '../../../shared/hiring'
import { type Job, sameJobValue } from '../../../shared/staff/role-follow'
import type { Migration } from '../../core'

/**
 * How a proposal is stored: the proposed Employee plus the role's job fields it started from, so
 * fields the boss left alone follow the role (decision 34) if the role changes before approval.
 */
export interface StoredProposal extends ProposedEmployee {
  base: Job
}

/**
 * The hire-proposal migration step, appended to the engine's migrations: the proposed Employee of a
 * new-hire request (JSON), and the Company's maximum headcount (no row, or null, means unlimited).
 */
export const HIRING_PROPOSALS_MIGRATION: Migration = {
  name: 'hiring-proposals-and-max-headcount',
  sql: `
  ALTER TABLE staffing_request ADD COLUMN proposal TEXT;
  CREATE TABLE headcount_setting (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    max_headcount INTEGER
  );
`,
}

export function readMaxHeadcount(db: DatabaseSync): number | null {
  const row = db.prepare('SELECT max_headcount FROM headcount_setting WHERE id = 1').get() as
    | { max_headcount: number | null }
    | undefined
  return row?.max_headcount ?? null
}

/** A positive whole number, or null for unlimited. */
export function writeMaxHeadcount(db: DatabaseSync, max: unknown): number | null {
  if (max !== null && !(typeof max === 'number' && Number.isInteger(max) && max >= 1)) {
    throw new Error('The maximum headcount must be a whole number from 1, or unlimited')
  }
  db.prepare(
    `INSERT INTO headcount_setting (id, max_headcount) VALUES (1, ?)
     ON CONFLICT (id) DO UPDATE SET max_headcount = excluded.max_headcount`,
  ).run(max)
  return max
}

/**
 * The proposal a new hire starts from: the role's fields under the given name. The role's MCP
 * grants and skills are in `base` but not in the proposal itself — a proposal is written by an
 * Employee, and neither an MCP server nor a skill is something an Employee hands out (T136, T137).
 * The hire takes them from the role at approval.
 */
export function proposalFromRole(role: RoleTemplate, name: string): StoredProposal {
  const base = jobOf(role)
  const { mcpServers: _granted, skills: _skills, ...proposed } = base
  return { name, roleId: role.id, ...proposed, model: null, base }
}

function jobOf(role: RoleTemplate): Job {
  return {
    persona: role.persona,
    capabilities: [...role.capabilities],
    repoFilter: [...role.repoFilter],
    areas: [...role.areas],
    mcpServers: [...role.mcpServers],
    skills: [...role.skills],
  }
}

/**
 * The job fields a proposal carries. `mcpServers` and `skills` are deliberately not among them: a
 * proposal is written by an Employee, and a skill is instructions — an Employee that could propose
 * one could write what the next Employee is steered by (T136, T137). A hire takes the role's
 * servers and skills as they stand at approval, and only the boss changes them afterwards.
 */
const PROPOSAL_FIELDS = JOB_FIELDS.filter((field) => field !== 'mcpServers' && field !== 'skills')

/** What approval hires: the proposal, with fields still as the role had them left to the role as it is now. */
export function hireInput(stored: StoredProposal): EmployeeInput {
  const input: EmployeeInput = { name: stored.name, roleId: stored.roleId }
  for (const field of PROPOSAL_FIELDS) {
    if (sameJobValue(field, stored[field], stored.base[field])) continue
    Object.assign(input, { [field]: stored[field] })
  }
  return input
}

/**
 * Applies the boss’s edit to a proposal. Changing the role keeps the other fields as they are and
 * rebases them on the new role. `nameTaken` says whether a name belongs to someone else.
 */
export function editProposal(
  current: StoredProposal,
  patch: ProposalPatch,
  { roles, nameTaken }: { roles: RoleTemplate[]; nameTaken(name: string): boolean },
): StoredProposal {
  if (typeof patch !== 'object' || patch === null) throw new Error('A proposal edit must be an object')
  const next = { ...current }
  if (patch.name !== undefined) {
    const name = typeof patch.name === 'string' ? patch.name.trim().replace(/^@/, '') : ''
    if (!name) throw new Error('A proposed Employee needs a name')
    if (name.toLowerCase() !== current.name.toLowerCase() && nameTaken(name)) {
      throw new Error(`An Employee named ${name} already exists`)
    }
    next.name = name
  }
  if (patch.roleId !== undefined && patch.roleId !== current.roleId) {
    const role = roles.find((r) => r.id === patch.roleId)
    if (!role) throw new Error(`Unknown role: ${String(patch.roleId)}`)
    next.roleId = role.id
    next.base = jobOf(role)
  }
  if (patch.persona !== undefined) {
    if (typeof patch.persona !== 'string') throw new Error('A persona must be text')
    next.persona = patch.persona.trim()
  }
  if (patch.capabilities !== undefined) {
    const list: unknown = patch.capabilities
    if (!Array.isArray(list) || !list.every((c) => CAPABILITIES.includes(c as Capability))) {
      throw new Error(`Capabilities must be some of: ${CAPABILITIES.join(', ')}`)
    }
    next.capabilities = CAPABILITIES.filter((c) => list.includes(c))
  }
  if (patch.repoFilter !== undefined) {
    const list: unknown = patch.repoFilter
    if (!Array.isArray(list) || !list.every((p) => typeof p === 'string')) {
      throw new Error('A repo filter must be a list of repo name patterns')
    }
    next.repoFilter = [...new Set(list.map((p: string) => p.trim()).filter(Boolean))]
  }
  if (patch.model !== undefined) {
    if (patch.model !== null && typeof patch.model !== 'string') throw new Error('A model must be text')
    next.model = patch.model?.trim() || null
  }
  return next
}

export function parseStoredProposal(json: string | null): StoredProposal | null {
  return json === null ? null : (JSON.parse(json) as StoredProposal)
}

/** The proposal as callers see it, without its base. */
export function parseProposal(json: string | null): ProposedEmployee | null {
  const stored = parseStoredProposal(json)
  if (!stored) return null
  const { base: _base, ...proposal } = stored
  return proposal
}
