import {
  BOSS_HANDLE_PATTERN,
  type Boss,
  type BossStatus,
  type BossUpdate,
  durationOf,
  handleFrom,
  type StatusDuration,
  statusUntilFrom,
} from '../../../shared/boss-profile'
import type { Company, CompanySummary } from '../../../shared/company'

/** What Your profile shows, as the engine has it. */
export interface SavedProfile {
  boss: Boss
  /** The open Company's native notification toggle: Company settings' own setting (decision 38). */
  notifications: boolean
}

/** The page as typed. One Save changes applies all of it; Discard goes back to the saved values. */
export interface ProfileDraft {
  name: string
  handle: string
  sprite: number
  status: BossStatus
  /** How long the status lasts: `Clear this status` picks it. */
  duration: StatusDuration
  notifications: boolean
  sound: boolean
}

export type ProfileField = keyof ProfileDraft

/** What Save changes sends, split by the engine API that takes it. */
export interface ProfileChanges {
  profile: BossUpdate
  notifications?: boolean
}

export function profileDraft(saved: SavedProfile, now: number): ProfileDraft {
  const { boss } = saved
  return {
    name: boss.name,
    handle: boss.handle,
    sprite: boss.sprite,
    status: boss.status,
    duration: durationOf(boss.statusUntil, now),
    notifications: saved.notifications,
    sound: boss.sound,
  }
}

/** Only what differs from the saved profile; text is trimmed. */
export function profileChanges(saved: SavedProfile, draft: ProfileDraft, now: number): ProfileChanges {
  const was = profileDraft(saved, now)
  const profile: BossUpdate = {}
  if (draft.name.trim() !== was.name) profile.name = draft.name.trim()
  if (draft.handle.trim() !== was.handle) profile.handle = draft.handle.trim()
  if (draft.sprite !== was.sprite) profile.sprite = draft.sprite
  // A status and how long it lasts travel together: either one changing rewrites both.
  if (draft.status !== was.status || draft.duration !== was.duration) {
    profile.status = draft.status
    profile.statusUntil = statusUntilFrom(draft.duration, now)
  }
  if (draft.sound !== was.sound) profile.sound = draft.sound
  const changes: ProfileChanges = { profile }
  if (draft.notifications !== was.notifications) changes.notifications = draft.notifications
  return changes
}

export function hasProfileChanges(saved: SavedProfile, draft: ProfileDraft, now: number): boolean {
  const changes = profileChanges(saved, draft, now)
  return Object.keys(changes.profile).length > 0 || changes.notifications !== undefined
}

/** The page's own checks, the same the engine makes. */
export function profileProblems(draft: ProfileDraft): Partial<Record<ProfileField, string>> {
  const problems: Partial<Record<ProfileField, string>> = {}
  if (!draft.name.trim()) problems.name = 'You need a name'
  if (!BOSS_HANDLE_PATTERN.test(draft.handle.trim())) {
    problems.handle = 'Lower-case letters, digits, dot, dash or underscore'
  }
  return problems
}

/** The handle the page shows while one is being typed: what was typed, else the one the name gives. */
export function previewHandle(draft: Pick<ProfileDraft, 'name' | 'handle'>): string {
  return draft.handle.trim() || handleFrom(draft.name)
}

/** `Employees address you by your handle — @yuri in any channel wakes nobody but reaches your desk.` */
export function handleNote(handle: string): string {
  return `Employees address you by your handle — @${handle} in any channel wakes nobody but reaches your desk.`
}

/** `Running Tiny Corp since March`, from the Company's own creation date. */
export function runningSince(company: Pick<Company, 'name' | 'createdAt'>, now = Date.now()): string {
  const created = new Date(company.createdAt)
  if (Number.isNaN(created.getTime())) return `Running ${company.name}`
  const month = created.toLocaleString('en-GB', { month: 'long' })
  const sameYear = created.getFullYear() === new Date(now).getFullYear()
  return `Running ${company.name} since ${month}${sameYear ? '' : ` ${created.getFullYear()}`}`
}

/** `Owner · 8 Employees` under a Company in Your Companies; the boss owns every Company they run. */
export function companyMeta(summary: Pick<CompanySummary, 'employees'>): string {
  const n = summary.employees
  if (n === null) return 'Owner'
  return `Owner · ${n} ${n === 1 ? 'Employee' : 'Employees'}`
}

/**
 * The account line under the Provider: the address when one is known, else who owns the login.
 *
 * It names no product (T169). The boss may be signed into any of them, or several, and the line
 * stands under whichever Provider the card is drawing — naming one made the page read as if
 * TinyCorp were that product's.
 */
export const NO_ACCOUNT = "Signed in through the Provider's own CLI"

export function accountLine(email: string): string {
  return email.trim() || NO_ACCOUNT
}
