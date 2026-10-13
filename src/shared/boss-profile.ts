import { initialsFrom } from './company'
import { CHARACTER_SHEETS } from './office/characters'
import type { TerminalRightClick } from './platform/terminal-right-click'

/**
 * The boss's own profile (T79). One per boss, kept beside the recent Companies in `userData`, not
 * per Company: every Company shows the same name, handle, character and status.
 */
export interface Boss {
  name: string
  /** Mentions address the boss by this, stored without the `@`: `yuri` shows as `@yuri`. */
  handle: string
  /** 1–3 letters, shown until the character sheet decodes and wherever a sprite does not fit. */
  initials: string
  /** The account the Provider is signed in as. Read-only in the app: the CLI owns the login. */
  email: string
  /** The row of `characters.png` the boss is drawn with, everywhere they appear. */
  sprite: number
  status: BossStatus
  /** When the status clears itself, in epoch ms; null for `Never — until I change it`. */
  statusUntil: number | null
  /** Native notifications play a sound on this Mac. Showing them at all is the Company's toggle. */
  sound: boolean
  /**
   * Where each Provider's CLI runs on this machine, by Provider id → a runtime key (T167):
   * `windows`, or `wsl:Ubuntu`.
   *
   * It is a boss-level setting and not a Company one for the same reason the rest of this file is:
   * which CLI this machine runs is a fact about the machine, and all four Companies on it get the
   * same answer. A Provider with no entry runs where {@link defaultRuntime} puts it, and failing
   * that where it was found; an entry naming a place the CLI is **not in** is neither obeyed nor
   * quietly replaced — that Provider reads as *not installed there* until the boss has said
   * otherwise, which is the promise `chooseRuntime` keeps (T258).
   *
   * Empty everywhere but Windows: a Mac has one place.
   */
  providerRuntimes: Record<string, string>
  /**
   * Where a Provider runs when it has no entry in {@link providerRuntimes} (T249): a runtime key,
   * or null while the boss has not said. It is the answer to *where does the team run*, asked once
   * on the first launch on Windows and changed in Your profile after that.
   *
   * A per-Provider pick still wins: the boss who keeps everything in Ubuntu and one CLI on Windows
   * says so once here and once there, and both screens say which is which. A default naming a place
   * a CLI is not in reads as *not installed there*, exactly as a per-Provider pick does —
   * `chooseRuntime` is where both are settled, and neither is ever moved without a word (T258).
   *
   * Null everywhere but Windows: a Mac has one place.
   */
  defaultRuntime: string | null
  /**
   * What the right mouse button does in an Employee's terminal (T249), or null while the boss has
   * not said — which reads as this platform's own habit
   * ({@link import('./platform/terminal-right-click').defaultRightClick}).
   *
   * Unlike the two above this is not a Windows question: every desktop has a right button, and the
   * habit differs by where the boss came from rather than by what the machine can do.
   */
  rightClick: TerminalRightClick | null
  /**
   * Whether the first launch has already asked the Windows questions (T249). Set by Set up Windows,
   * by Skip for now, and never unset: the step is shown once, and Your profile is where it is
   * changed afterwards.
   */
  windowsSetupDone: boolean
}

/** What Your profile can change. Absent fields stay as they are; `email` is the Provider's to set. */
export interface BossUpdate {
  name?: string
  handle?: string
  /** Blank goes back to the initials of the boss's name. */
  initials?: string
  sprite?: number
  status?: BossStatus
  statusUntil?: number | null
  sound?: boolean
  /** Where a Provider runs, by id → runtime key. Merged into what is stored, never replacing it. */
  providerRuntimes?: Record<string, string>
  /** Where every Provider without its own pick runs. Null puts them back on what was found. */
  defaultRuntime?: string | null
  /** What the right mouse button does in a terminal. Null goes back to the platform's habit. */
  rightClick?: TerminalRightClick | null
  /** Set by the first-launch step, and by Skip for now. */
  windowsSetupDone?: boolean
}

export const BOSS_STATUSES = ['available', 'focused', 'away'] as const
export type BossStatus = (typeof BOSS_STATUSES)[number]

export function isBossStatus(value: unknown): value is BossStatus {
  return typeof value === 'string' && (BOSS_STATUSES as readonly string[]).includes(value)
}

export const BOSS_STATUS_LABEL: Record<BossStatus, string> = {
  available: 'Available',
  focused: 'Focused',
  away: 'Away',
}

/** What each status tells the team, worded as the design has it (frame `Oykzs`). */
export const BOSS_STATUS_DESCRIPTION: Record<BossStatus, string> = {
  available: 'Employees DM you directly and notifications arrive as they happen.',
  focused: 'Only approvals break through. Mentions and DMs wait at your desk.',
  away: 'Nothing interrupts. Everything collects at your desk until you are back.',
}

/** How long a status lasts before it clears itself. */
export const STATUS_DURATIONS = [
  { value: 'never', label: 'Never — until I change it', minutes: null },
  { value: '30m', label: 'In 30 minutes', minutes: 30 },
  { value: '1h', label: 'In 1 hour', minutes: 60 },
  { value: '4h', label: 'In 4 hours', minutes: 240 },
  { value: '8h', label: 'In 8 hours', minutes: 480 },
] as const

export type StatusDuration = (typeof STATUS_DURATIONS)[number]['value']

export function isStatusDuration(value: unknown): value is StatusDuration {
  return typeof value === 'string' && STATUS_DURATIONS.some((d) => d.value === value)
}

/** When a status picked now would clear itself, or null for `Never`. */
export function statusUntilFrom(duration: StatusDuration, now: number): number | null {
  const minutes = STATUS_DURATIONS.find((d) => d.value === duration)?.minutes ?? null
  return minutes === null ? null : now + minutes * 60_000
}

/** The duration a stored `statusUntil` came from, so the select shows what was saved. */
export function durationOf(statusUntil: number | null, now: number): StatusDuration {
  if (statusUntil === null) return 'never'
  const minutes = (statusUntil - now) / 60_000
  if (minutes <= 0) return 'never'
  const timed = STATUS_DURATIONS.filter(
    (d): d is (typeof STATUS_DURATIONS)[number] & { minutes: number } => d.minutes !== null,
  )
  const nearest = timed.reduce((a, b) => (Math.abs(b.minutes - minutes) < Math.abs(a.minutes - minutes) ? b : a))
  return nearest.value
}

/** The status in force at `now`: one with a passed expiry is back to Available. */
export function statusAt(boss: Pick<Boss, 'status' | 'statusUntil'>, now: number): BossStatus {
  if (boss.statusUntil !== null && boss.statusUntil <= now) return 'available'
  return boss.status
}

/** 1 to 30 lower-case letters, digits, dot, dash or underscore, starting with a letter or digit. */
export const BOSS_HANDLE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,29}$/

/** A handle from a name: the first word, lower case, letters and digits only. */
export function handleFrom(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? ''
  const handle = first
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 30)
  return handle || 'boss'
}

/** A handle as typed: a leading `@` dropped, lower case, only the characters a handle may hold. */
export function handleInput(value: string): string {
  return value
    .replace(/^@+/, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '')
    .slice(0, 30)
}

/** `@yuri`, as chat and the profile show it. */
export function mentionOf(handle: string): string {
  return `@${handle}`
}

/** A sprite index inside the sheet, whatever number comes in. */
export function spriteIndex(sprite: number): number {
  const rounded = Math.trunc(sprite)
  return ((rounded % CHARACTER_SHEETS) + CHARACTER_SHEETS) % CHARACTER_SHEETS
}

/** The profile a boss starts with: their OS account name, a handle from it, and the first character. */
export function defaultBoss(name: string, email = ''): Boss {
  const clean = name.trim() || 'Boss'
  return {
    name: clean,
    handle: handleFrom(clean),
    initials: initialsFrom(clean),
    email,
    sprite: 0,
    status: 'available',
    statusUntil: null,
    sound: false,
    providerRuntimes: {},
    defaultRuntime: null,
    rightClick: null,
    windowsSetupDone: false,
  }
}
