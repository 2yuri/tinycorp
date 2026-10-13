/**
 * The setup wizard's Finish (decision 39): what the renderer hands the engine and what came of it.
 */
import type { Message } from '../domain/chat'
import type { Employee, EmployeeInput } from '../domain/staff'
import type { DraftSeat, RosterDraft } from '../staff/roster-draft'
import { TEAM_PRESETS, type TeamPresetId } from '../staff/team-presets'

export interface OnboardingFinish {
  /** The Your team roster, in hire order. */
  hires: EmployeeInput[]
  /** The First ticket step's one-sentence goal; null or blank opens with an empty board. */
  goal: string | null
}

export interface OnboardingOutcome {
  hired: Employee[]
  /** Employees whose Session Finish started; beyond the cap they park, while paused they wait. */
  started: string[]
  /** The intake holder the goal was DMed to, or null when nobody got it. */
  intakeId: string | null
  /** The message carrying the goal: a DM to the intake holder, or `#general` without one. */
  goalMessage: Message | null
}

/** The First ticket step's suggestion chips; each one fills the field. */
export const GOAL_SUGGESTIONS = [
  'Set up CI and a preview deploy',
  'Add auth with magic links',
  'Migrate the API to Postgres',
] as const

/** The DM the intake holder gets on Finish. */
export function goalInstruction(goal: string): string {
  return [
    `Our first goal: ${goal.trim()}`,
    'Please post a short welcome to the team in #general, then break this goal into a target, epics and tickets on the board.',
  ].join('\n\n')
}

/**
 * The setup wizard's five steps, in order (decision 39). The engine stores the step the boss is on,
 * so this list is a stored contract: a name here is never reused for another step.
 */
export const WIZARD_STEPS = ['company', 'preset', 'team', 'repositories', 'first-ticket'] as const
export type WizardStep = (typeof WIZARD_STEPS)[number]

/** Where the wizard stands, as the engine keeps it between launches (T59). */
export interface OnboardingDraft {
  step: WizardStep
  preset: TeamPresetId
  /** The Your team roster as it has been edited so far; hired only on Finish. */
  roster: RosterDraft
  /** The First ticket step's goal, still being written. */
  goal: string
}

export interface OnboardingProgress {
  /** When the wizard was finished or skipped; null while it has not been, and the wizard opens. */
  completedAt: string | null
  /** Where to resume, or null for a Company that saved no step — the wizard then starts over. */
  draft: OnboardingDraft | null
}

/**
 * A stored or incoming draft, or null when it is not one. Both sides use this: the engine to read
 * back its own JSON (a file hand-edited or written by a newer build must never crash the wizard),
 * and the IPC handler to check what the renderer sent.
 */
export function parseOnboardingDraft(value: unknown): OnboardingDraft | null {
  if (!isRecord(value)) return null
  const { step, preset, roster, goal } = value
  if (!isWizardStep(step) || !isPreset(preset) || !Array.isArray(roster)) return null
  const seats: RosterDraft = []
  for (const seat of roster) {
    const parsed = parseSeat(seat)
    if (!parsed) return null
    seats.push(parsed)
  }
  return { step, preset, roster: seats, goal: isText(goal) ? goal : '' }
}

export function isWizardStep(value: unknown): value is WizardStep {
  return isText(value) && (WIZARD_STEPS as readonly string[]).includes(value)
}

function isPreset(value: unknown): value is TeamPresetId {
  return isText(value) && TEAM_PRESETS.some((preset) => preset.id === value)
}

function parseSeat(value: unknown): DraftSeat | null {
  if (!isRecord(value)) return null
  const { key, roleId, role, name, persona, model, sprite } = value
  if (!isText(key) || !isText(roleId) || !isText(role) || !isText(name) || !isText(persona)) return null
  // Null is a seat on its product's own default (decision 31); undefined is a draft written before
  // a seat could have one, and reads the same way.
  if (!(model === null || model === undefined || isText(model))) return null
  if (typeof sprite !== 'number' || !Number.isInteger(sprite)) return null
  return { key, roleId, role, name, persona, model: model ?? null, sprite }
}

const isText = (value: unknown): value is string => typeof value === 'string'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
