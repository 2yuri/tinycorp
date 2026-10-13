import type { AutonomyLevel } from '../../../shared/approvals'
import { COMPANY_KEY_PATTERN, type Company, type CompanyUpdate } from '../../../shared/company'
import type { PermissionMode } from '../../../shared/domain/staff'
import type { RoomSlug } from '../../../shared/office/rooms'

/** What Company settings show, as the engine has it. */
export interface SavedSettings {
  company: Company
  concurrencyCap: number
  autonomy: AutonomyLevel
  notifications: boolean
  /** The room every Employee works in (T83); the Office tab picks it. */
  room: RoomSlug
  /** What a new Employee starts with (T164). Everyone already on staff keeps their own. */
  permissionMode: PermissionMode
}

/** The settings form as typed. One Save changes applies all of it; Discard changes goes back to the saved values. */
export interface SettingsDraft {
  name: string
  key: string
  /** As typed; see `parseCap`. */
  concurrencyCap: string
  autonomy: AutonomyLevel
  notifications: boolean
  room: RoomSlug
  permissionMode: PermissionMode
}

export type SettingsField = keyof SettingsDraft

/** What Save changes sends, split by the engine API that takes it. */
export interface SettingsChanges {
  company: CompanyUpdate
  concurrencyCap?: number
  autonomy?: AutonomyLevel
  notifications?: boolean
  room?: RoomSlug
  permissionMode?: PermissionMode
}

export function settingsDraft(saved: SavedSettings): SettingsDraft {
  const { company } = saved
  return {
    name: company.name,
    key: company.key,
    concurrencyCap: String(saved.concurrencyCap),
    autonomy: saved.autonomy,
    notifications: saved.notifications,
    room: saved.room,
    permissionMode: saved.permissionMode,
  }
}

/** Only what differs from the saved settings; text is trimmed. */
export function settingsChanges(saved: SavedSettings, draft: SettingsDraft): SettingsChanges {
  const was = settingsDraft(saved)
  const company: CompanyUpdate = {}
  // The boss's own name and initials live in Your profile (T79), not in a Company's settings.
  for (const field of ['name', 'key'] as const) {
    if (draft[field].trim() !== was[field]) company[field] = draft[field].trim()
  }
  const changes: SettingsChanges = { company }
  const cap = parseCap(draft.concurrencyCap)
  if ('cap' in cap && cap.cap !== saved.concurrencyCap) changes.concurrencyCap = cap.cap
  if (draft.autonomy !== saved.autonomy) changes.autonomy = draft.autonomy
  if (draft.notifications !== saved.notifications) changes.notifications = draft.notifications
  if (draft.room !== saved.room) changes.room = draft.room
  if (draft.permissionMode !== saved.permissionMode) changes.permissionMode = draft.permissionMode
  return changes
}

export function hasChanges(saved: SavedSettings, draft: SettingsDraft): boolean {
  const changes = settingsChanges(saved, draft)
  return (
    Object.keys(changes.company).length > 0 ||
    changes.concurrencyCap !== undefined ||
    changes.autonomy !== undefined ||
    changes.notifications !== undefined ||
    changes.room !== undefined ||
    changes.permissionMode !== undefined ||
    // A cap that cannot be parsed is still a change the boss has to fix or discard.
    draft.concurrencyCap !== String(saved.concurrencyCap)
  )
}

/** The form's own checks, the same the engine makes; the key's uniqueness is the engine's to say. */
export function settingsProblems(draft: SettingsDraft): Partial<Record<SettingsField, string>> {
  const problems: Partial<Record<SettingsField, string>> = {}
  if (!draft.name.trim()) problems.name = 'A Company needs a name'
  if (!COMPANY_KEY_PATTERN.test(draft.key.trim())) problems.key = '2 to 4 uppercase letters'
  const cap = parseCap(draft.concurrencyCap)
  if ('error' in cap) problems.concurrencyCap = cap.error
  return problems
}

/** A key as typed: letters only, upper case, at most four. */
export function keyInput(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 4)
}

/** The ticket id a key gives (decision 33). */
export function sampleTicketId(key: string): string {
  return `${key || 'KEY'}-142`
}

/** What each level asks the boss, worded as the design has it (decision 38). */
export const AUTONOMY_DESCRIPTION: Record<AutonomyLevel, string> = {
  supervised: 'Asks before every step',
  managed: 'Asks for merges and hires',
  autonomous: 'Asks only on red CI, limits and hires',
}

/** A concurrency cap as typed, or the reason it cannot be saved. */
export function parseCap(value: string): { cap: number } | { error: string } {
  const cap = Number(value)
  if (value.trim() === '' || !Number.isInteger(cap) || cap < 1) {
    return { error: 'A whole number of at least 1' }
  }
  return { cap }
}
