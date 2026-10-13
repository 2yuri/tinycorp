/**
 * The setup wizard's Your team step: the roster the chosen preset starts, edited in memory until
 * Finish hires it (decision 39). Nothing here touches the Company; `rosterHires` is what Finish hands
 * to `staff.hire`, and `officePlan` is the step's `Your office` card.
 */
import type { AutonomyLevel } from '../approvals'
import type { Provider } from '../domain/providers'
import type { EmployeeInput, RoleTemplate } from '../domain/staff'
import type { Headcount } from '../hiring'
import { leastUsedSheet } from '../office/characters'
import { DEFAULT_MODEL_LABEL, modelOption, providerForModel } from './models'
import { ROLE_TEMPLATES, templateAsRole } from './role-templates'
import { presetModel, type TeamPreset, teamPreset } from './team-presets'

/**
 * The roles the wizard offers: the Company's own, then every built-in it has not taken yet (T240).
 *
 * A Company starts with no roles and takes one when a seat asks for it, so the Your team step
 * cannot read the catalog off the Company — the list it is picking *from* is the built-ins, and
 * what the Company holds is the part of it the draft has already claimed.
 */
export function wizardCatalog(companyRoles: RoleTemplate[]): RoleTemplate[] {
  const held = new Set(companyRoles.map((role) => role.id))
  return [...companyRoles, ...ROLE_TEMPLATES.filter((template) => !held.has(template.id)).map(templateAsRole)]
}

export interface DraftSeat {
  /** Stable within the draft, for React keys and edits; never stored. */
  key: string
  roleId: string
  /** The role's name, as the chip shows it. */
  role: string
  name: string
  /** The one line shown under the name; the hire keeps the role's own persona. */
  persona: string
  /**
   * A model id from any Provider's catalogue — it names the product that runs it (T139) — or null
   * for whatever that product's own CLI defaults to (decision 31).
   */
  model: string | null
  /** The character sheet this seat walks in on, handed out as the engine hands them out. */
  sprite: number
}

export type RosterDraft = DraftSeat[]

/**
 * The roster a preset starts, on the Provider this Mac is ready to run (T169). The preset names the
 * roles; which product they run on is a fact about the machine, read once here so every seat the
 * wizard proposes agrees with the hire modal.
 */
export function rosterFromPreset(preset: TeamPreset, provider: Provider): RosterDraft {
  const draft: RosterDraft = []
  for (const [index, seat] of preset.seats.entries()) {
    draft.push({ key: `${preset.id}-${index}`, ...seat, model: presetModel(provider), sprite: sheetFor(draft) })
  }
  return draft
}

/** The character a seat joining this draft takes. */
function sheetFor(draft: RosterDraft): number {
  return leastUsedSheet(draft.map((seat) => seat.sprite))
}

/** The names the draft holds, for the engine's name generator to avoid. */
export function draftNames(draft: RosterDraft): string[] {
  return draft.map((seat) => seat.name)
}

export function updateSeat(
  draft: RosterDraft,
  key: string,
  patch: Partial<Pick<DraftSeat, 'name' | 'model'>>,
): RosterDraft {
  return draft.map((seat) => (seat.key === key ? { ...seat, ...patch } : seat))
}

export function removeSeat(draft: RosterDraft, key: string): RosterDraft {
  return draft.filter((seat) => seat.key !== key)
}

/** A catalog role's one line: the presets' line for it, else the first sentence of its persona. */
export function roleLine(role: RoleTemplate): string {
  const seat = teamPreset('full-studio').seats.find((candidate) => candidate.roleId === role.id)
  if (seat) return seat.persona
  return role.persona.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? role.persona
}

/** Adds a seat for a catalog role, on the same model the preset's own seats started on. */
export function addSeat(draft: RosterDraft, role: RoleTemplate, name: string, provider: Provider): RosterDraft {
  const taken = new Set(draft.map((seat) => seat.key))
  let n = draft.length
  while (taken.has(`added-${n}`)) n++
  return [
    ...draft,
    {
      key: `added-${n}`,
      roleId: role.id,
      role: role.name,
      name,
      persona: roleLine(role),
      model: presetModel(provider),
      sprite: sheetFor(draft),
    },
  ]
}

/** A name the draft can hire under: not blank and not another seat's. Null when it is fine. */
export function seatNameError(draft: RosterDraft, key: string, name: string): string | null {
  const wanted = name.trim().toLowerCase()
  if (!wanted) return 'A name is required'
  if (draft.some((seat) => seat.key !== key && seat.name.trim().toLowerCase() === wanted)) {
    return 'Someone on the team already has this name'
  }
  return null
}

/**
 * The model as the seat's selector shows it: its own name, without the effort it runs at. The
 * Provider comes from the model, so a seat on any product shows the right name (T139); a seat with
 * no model runs on whatever its product defaults to and says so.
 */
export function shortModelLabel(model: string | null): string {
  if (model === null) return DEFAULT_MODEL_LABEL
  const provider = providerForModel(model)
  return (provider && modelOption(provider, model)?.label) || model
}

/** What Finish hires, in roster order; every field it leaves out comes from the role. */
export function rosterHires(draft: RosterDraft): EmployeeInput[] {
  return draft.map((seat) => ({ name: seat.name.trim(), roleId: seat.roleId, model: seat.model, sprite: seat.sprite }))
}

/**
 * The `Add another role` button: the catalog roles nobody in the draft has, in preset order (`QA,
 * DevOps, HR, PO…`); the ellipsis stands for the rest of the catalog the button opens.
 */
export function addRoleLabel(draft: RosterDraft, catalog: RoleTemplate[]): string {
  const held = new Set(draft.map((seat) => seat.roleId))
  const missing = catalogInPresetOrder(catalog).filter((role) => !held.has(role.id))
  if (missing.length === 0) return 'Add another role'
  return `Add another role — ${missing
    .slice(0, 4)
    .map((role) => role.name)
    .join(', ')}…`
}

/** The catalog with the preset roles first, in the order the Full studio preset hires them. */
export function catalogInPresetOrder(catalog: RoleTemplate[]): RoleTemplate[] {
  const order = teamPreset('full-studio').seats.map((seat) => seat.roleId)
  const rank = (role: RoleTemplate) => {
    const at = order.indexOf(role.id)
    return at === -1 ? order.length : at
  }
  return [...catalog].sort((a, b) => rank(a) - rank(b))
}

const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve']

/** `Four`, `Twelve`, `13`; `No` for none. */
export function countWord(count: number): string {
  return WORDS[count] ?? String(count)
}

/** `Four employees`, `One employee`. */
export function employeeCount(count: number): string {
  return `${countWord(count)} ${count === 1 ? 'employee' : 'employees'}`
}

export type NextStepIcon = 'desks' | 'general' | 'ticket'

export interface OfficePlan {
  /** `4 of 12`, or `4` without a maximum. */
  desksTaken: string
  /** Desks taken over the maximum, 0 to 1; null without a maximum. */
  desksFill: number | null
  /** The draft needs more desks than the maximum headcount allows. */
  overHeadcount: boolean
  /** The first connected repo's name, or `None yet`. */
  repository: string
  next: { icon: NextStepIcon; text: string }[]
}

/**
 * The `Your office` card, from the draft and the Company as it is: its headcount (Employees already
 * on staff take desks too), its catalog (who holds intake) and its repos.
 */
export function officePlan(input: {
  draft: RosterDraft
  headcount: Headcount | null
  catalog: RoleTemplate[]
  repos: string[]
  /** Under Supervised, Finish starts only the intake holder. */
  autonomy?: AutonomyLevel | null
}): OfficePlan {
  const { draft, headcount, catalog, repos } = input
  const supervised = input.autonomy === 'supervised'
  const taken = (headcount?.current ?? 0) + draft.length
  const max = headcount?.max ?? null
  return {
    desksTaken: max === null ? String(taken) : `${taken} of ${max}`,
    desksFill: max === null ? null : Math.min(1, taken / max),
    overHeadcount: max !== null && taken > max,
    repository: repos[0] ?? 'None yet',
    next: [
      { icon: 'desks', text: supervised ? supervisedDesksLine(draft, catalog) : desksLine(draft.length) },
      { icon: 'general', text: welcomeLine(draft, catalog) },
      { icon: 'ticket', text: 'Your first ticket lands in Todo and work starts.' },
    ],
  }
}

function desksLine(count: number): string {
  if (count === 0) return 'No desks yet — hire from the Staff page when you are ready.'
  if (count === 1) return 'One desk appears in the office, with its sprite.'
  return `${countWord(count)} desks appear in the office, one sprite each.`
}

/** Supervised asks before anyone starts work, so Finish clocks in only the intake holder. */
function supervisedDesksLine(draft: RosterDraft, catalog: RoleTemplate[]): string {
  if (draft.length === 0) return desksLine(0)
  const holder = draftIntakeHolder(draft, catalog)
  const others = draft.length - (holder ? 1 : 0)
  const desks = draft.length === 1 ? 'One desk appears' : `${countWord(draft.length)} desks appear`
  if (!holder) return `${desks}; under Supervised you start everyone from Employees.`
  const name = holder.name.trim() || 'Your intake lead'
  if (others === 0) return `${desks}; ${name} clocks in to plan.`
  return `${desks}; under Supervised only ${name} clocks in, you start the rest from Employees.`
}

/** The intake holder as the engine picks it: the first seat whose role has `intake`, or the only seat. */
export function draftIntakeHolder(draft: RosterDraft, catalog: RoleTemplate[]): DraftSeat | null {
  const intake = new Set(catalog.filter((role) => role.capabilities.includes('intake')).map((role) => role.id))
  return draft.find((seat) => intake.has(seat.roleId)) ?? (draft.length === 1 ? draft[0]! : null)
}

function welcomeLine(draft: RosterDraft, catalog: RoleTemplate[]): string {
  const holder = draftIntakeHolder(draft, catalog)
  if (holder) return `${holder.name.trim() || 'Your intake lead'} opens #general and introduces the team.`
  if (draft.length === 0) return '#general waits for your first hire.'
  return 'Nobody takes intake yet, so your goal waits in #general.'
}
