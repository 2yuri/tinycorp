/**
 * The team presets the setup wizard offers (decision 39). Shipped data: each preset lists the
 * seats it hires, a seat being a catalog role (the seeded `role_template` ids) with a default
 * name and persona line the boss can change in the wizard's Your team step.
 */
import { type Provider, providerDefaultModel } from '../domain/providers'

export type TeamPresetId = 'solo-builder' | 'product-squad' | 'full-studio' | 'start-empty'

export interface PresetSeat {
  /** A seeded catalog role id (`pm`, `tech-lead`, …). */
  roleId: string
  /** The role's name as the chips and the Your team rows show it. */
  role: string
  /** The Employee's default name. */
  name: string
  /** One line on how this Employee works, shown under the name in the Your team step. */
  persona: string
}

export interface TeamPreset {
  id: TeamPresetId
  name: string
  description: string
  /** The preset this one builds on; its card lists only the seats it adds, as `+ QA`. */
  extends: TeamPresetId | null
  seats: PresetSeat[]
}

/**
 * The model a preset seat starts on: the catalogue's first entry for whichever Provider this Mac is
 * ready to run (T169). A preset names roles and nothing else — it never names a product, and it
 * never names a model that belongs to one.
 *
 * Null when that Provider lists no model at all: the seat is then hired on the CLI's own default
 * (decision 31), which is what an Employee with no model runs on anyway.
 */
export function presetModel(provider: Provider): string | null {
  return providerDefaultModel(provider)
}

export const DEFAULT_PRESET: TeamPresetId = 'product-squad'

const PM: PresetSeat = {
  roleId: 'pm',
  role: 'PM',
  name: 'Hera',
  persona: 'Breaks the goal into tickets and keeps the board honest.',
}
const TECH_LEAD: PresetSeat = {
  roleId: 'tech-lead',
  role: 'Tech Lead',
  name: 'Orion',
  persona: 'Guards the repo, reviews every PR before it reaches you.',
}
const FRONTEND: PresetSeat = {
  roleId: 'frontend',
  role: 'Frontend',
  name: 'Ada',
  persona: 'Small PRs, tests first, a screenshot on every UI change.',
}
const BACKEND: PresetSeat = {
  roleId: 'backend',
  role: 'Backend',
  name: 'Vega',
  persona: 'APIs, migrations and the boring parts nobody volunteers for.',
}
const QA: PresetSeat = {
  roleId: 'qa',
  role: 'QA',
  name: 'Iris',
  persona: 'Tries to break every PR against its acceptance criteria.',
}
const DEVOPS: PresetSeat = {
  roleId: 'devops',
  role: 'DevOps',
  name: 'Atlas',
  persona: 'Keeps CI green and the deploys boring.',
}
const HR: PresetSeat = {
  roleId: 'hr',
  role: 'HR',
  name: 'Juno',
  persona: 'Watches the load and proposes a hire when work piles up.',
}
const PO: PresetSeat = {
  roleId: 'po',
  role: 'PO',
  name: 'Theo',
  persona: 'Writes acceptance criteria and says no to scope creep.',
}

/** In the order the Team preset step shows them. */
export const TEAM_PRESETS: readonly TeamPreset[] = [
  {
    id: 'solo-builder',
    name: 'Solo builder',
    description:
      'One senior generalist who does intake, code and review end to end. Cheapest way to see the loop work.',
    extends: null,
    seats: [TECH_LEAD],
  },
  {
    id: 'product-squad',
    name: 'Product squad',
    description:
      'A PM to break work down, a tech lead to guard the repo, and two engineers shipping. The default shape for one product.',
    extends: null,
    seats: [PM, TECH_LEAD, FRONTEND, BACKEND],
  },
  {
    id: 'full-studio',
    name: 'Full studio',
    description:
      'Adds QA, DevOps, an HR lead who proposes hires, and a PO who keeps the board honest. For several repos at once.',
    extends: 'product-squad',
    seats: [PM, TECH_LEAD, FRONTEND, BACKEND, QA, DEVOPS, HR, PO],
  },
  {
    id: 'start-empty',
    name: 'Start empty',
    description: 'No employees yet. Open the office and hire one role at a time from the Staff page.',
    extends: null,
    seats: [],
  },
]

export function teamPreset(id: TeamPresetId): TeamPreset {
  const preset = TEAM_PRESETS.find((candidate) => candidate.id === id)
  if (!preset) throw new Error(`Unknown team preset: ${String(id)}`)
  return preset
}

/** `1 seat`, `4 seats`, `0 seats`. */
export function seatLabel(preset: TeamPreset): string {
  const count = preset.seats.length
  return `${count} ${count === 1 ? 'seat' : 'seats'}`
}

/** The card's role chips: every seat, only the added ones (`+ QA`) for a preset that extends another, `Nobody yet` for none. */
export function presetChips(preset: TeamPreset): string[] {
  if (preset.seats.length === 0) return ['Nobody yet']
  if (!preset.extends) return preset.seats.map((seat) => seat.role)
  const base = new Set(teamPreset(preset.extends).seats.map((seat) => seat.roleId))
  return preset.seats.filter((seat) => !base.has(seat.roleId)).map((seat) => `+ ${seat.role}`)
}
