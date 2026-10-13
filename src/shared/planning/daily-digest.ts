import { APP_NAME } from '../app/app-name'
import { DEFAULT_CHANNELS } from '../domain/chat'
import { dayIn, fromWallClock, wallClock, weekdayIn } from '../platform/wall-clock'

/**
 * The daily digest (T172): what shipped, what waits on the boss and what today cost, written by the
 * app itself from the database and posted in `#general`.
 *
 * Nothing here asks an Employee anything, so a digest spends no usage — which is the whole point of
 * it and the reason every number in it is read from a table rather than summarised by a Session.
 */

/** Days as `Date` counts them: 0 is Sunday. */
export const WEEKDAYS = [1, 2, 3, 4, 5] as const

/** Monday first, as the settings card draws the chips. */
export const DAY_CHIPS: { day: number; label: string }[] = [
  { day: 1, label: 'Mon' },
  { day: 2, label: 'Tue' },
  { day: 3, label: 'Wed' },
  { day: 4, label: 'Thu' },
  { day: 5, label: 'Fri' },
  { day: 6, label: 'Sat' },
  { day: 0, label: 'Sun' },
]

/** When a Company posts its digest, and where. */
export interface DigestSchedule {
  enabled: boolean
  /** `18:00`, 24-hour, read on a clock in {@link timezone}. */
  time: string
  /** The days it posts on, 0 for Sunday, ascending. Empty means it never posts. */
  days: number[]
  /** The channel it is posted in. */
  channelId: string
  /** Whether posting also rings a native notification, subject to the Company's own toggle. */
  notify: boolean
  /**
   * The IANA zone the Company keeps its hours in, or null for this Mac's. The design gives the boss
   * no control for it, so it is null everywhere until something sets one; it exists because "18:00"
   * has to mean an instant, and a schedule that silently meant UTC would fire in the middle of the
   * night for most of the world.
   */
  timezone: string | null
}

/** On, weekdays at 18:00, in `#general`, and it notifies (T172). */
export const DEFAULT_DIGEST_SCHEDULE: DigestSchedule = {
  enabled: true,
  time: '18:00',
  days: [...WEEKDAYS],
  channelId: DEFAULT_CHANNELS[0],
  notify: true,
  timezone: null,
}

/** What Company settings can change about the digest. Absent fields stay as they are. */
export type DigestScheduleUpdate = Partial<DigestSchedule>

export const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/

/**
 * A schedule with every field checked, or a thrown sentence. The engine applies it whole, so a
 * wrong day never lands beside a right time.
 */
export function requireSchedule(update: DigestScheduleUpdate, saved: DigestSchedule): DigestSchedule {
  const next = { ...saved, ...update }
  if (typeof next.enabled !== 'boolean') throw new Error('The daily digest is either on or off')
  if (typeof next.notify !== 'boolean') throw new Error('The digest either notifies or it does not')
  if (typeof next.time !== 'string' || !TIME_PATTERN.test(next.time)) {
    throw new Error('A digest time is a 24-hour clock time, as in 18:00')
  }
  if (!Array.isArray(next.days) || next.days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
    throw new Error('Digest days are 0 (Sunday) to 6 (Saturday)')
  }
  const channelId = typeof next.channelId === 'string' ? next.channelId.trim().replace(/^#/, '') : ''
  if (!channelId) throw new Error('The digest needs a channel to post in')
  if (next.timezone !== null && typeof next.timezone !== 'string') throw new Error('A timezone is a name, or none')
  return {
    enabled: next.enabled,
    time: next.time,
    days: [...new Set(next.days)].sort((a, b) => a - b),
    channelId,
    notify: next.notify,
    timezone: next.timezone,
  }
}

/** `every weekday`, `every day`, `on Mon, Wed and Fri` — how the footer and the settings card say it. */
export function daysLabel(days: readonly number[]): string {
  const set = new Set(days)
  if (set.size === 0) return 'never'
  if (set.size === 7) return 'every day'
  if (set.size === 5 && WEEKDAYS.every((day) => set.has(day))) return 'every weekday'
  const names = DAY_CHIPS.filter((chip) => set.has(chip.day)).map((chip) => chip.label)
  const last = names.pop()!
  return names.length === 0 ? `every ${last}` : `on ${names.join(', ')} and ${last}`
}

/** `WEEKDAYS`, `EVERY DAY`, `CUSTOM`: the suffix on the settings card's DAYS label. */
export function daysPreset(days: readonly number[]): string {
  const set = new Set(days)
  if (set.size === 7) return 'EVERY DAY'
  if (set.size === 5 && WEEKDAYS.every((day) => set.has(day))) return 'WEEKDAYS'
  if (set.size === 0) return 'NEVER'
  return 'CUSTOM'
}

/**
 * The most recent instant the schedule names at or before `now`, or null when it names none in the
 * week before it — an empty day list, or a schedule that is off.
 *
 * Only the latest one is ever looked at: a run older than that was missed and stays missed, and the
 * next digest covers the gap it left (T172).
 */
export function lastRunAt(schedule: DigestSchedule, now: Date): Date | null {
  if (!schedule.enabled || schedule.days.length === 0) return null
  const zone = schedule.timezone ?? undefined
  const [hour, minute] = schedule.time.split(':').map(Number) as [number, number]
  const wall = wallClock(now, zone)
  if (!wall) return null
  for (let back = 0; back <= 7; back += 1) {
    const day = new Date(Date.UTC(wall.year, wall.month, wall.day - back))
    const at = fromWallClock(
      { year: day.getUTCFullYear(), month: day.getUTCMonth(), day: day.getUTCDate(), hour, minute },
      now,
      zone,
    )
    if (at > now) continue
    const weekday = weekdayIn(at, zone)
    if (weekday !== null && schedule.days.includes(weekday)) return at
  }
  return null
}

/** The next instant the schedule names after `now`, or null when it names none in the week after it. */
export function nextRunAt(schedule: DigestSchedule, now: Date): Date | null {
  if (!schedule.enabled || schedule.days.length === 0) return null
  const zone = schedule.timezone ?? undefined
  const [hour, minute] = schedule.time.split(':').map(Number) as [number, number]
  const wall = wallClock(now, zone)
  if (!wall) return null
  for (let ahead = 0; ahead <= 7; ahead += 1) {
    const day = new Date(Date.UTC(wall.year, wall.month, wall.day + ahead))
    const at = fromWallClock(
      { year: day.getUTCFullYear(), month: day.getUTCMonth(), day: day.getUTCDate(), hour, minute },
      now,
      zone,
    )
    if (at <= now) continue
    const weekday = weekdayIn(at, zone)
    if (weekday !== null && schedule.days.includes(weekday)) return at
  }
  return null
}

/**
 * How late a missed run may be and still post: the app was closed at 18:00, so the digest goes up
 * the next time the Company opens, as long as that is within 12 hours (T172). Past that the run is
 * skipped and the next digest says "Since" the one before it.
 */
export const MISSED_RUN_GRACE_MS = 12 * 60 * 60 * 1000

/** The day a digest is filed under, `2026-09-22` on a clock in the schedule's zone. */
export function digestDay(at: Date, schedule: Pick<DigestSchedule, 'timezone'>): string {
  return dayIn(at, schedule.timezone ?? undefined) ?? at.toISOString().slice(0, 10)
}

/**
 * The run the digest owes right now: the schedule's latest instant, when it is within the grace
 * window and no digest carries its day yet. Null when nothing is owed.
 */
export function dueRun(
  schedule: DigestSchedule,
  now: Date,
  postedDays: ReadonlySet<string>,
): { at: Date; day: string } | null {
  const at = lastRunAt(schedule, now)
  if (!at) return null
  if (now.getTime() - at.getTime() > MISSED_RUN_GRACE_MS) return null
  const day = digestDay(at, schedule)
  return postedDays.has(day) ? null : { at, day }
}

/** A merged PR of a ticket, as the Shipped section lists it. */
export interface ShippedLine {
  ticketId: number
  title: string
  /** `billing-api #128`, or the repo alone when the PR's URL named no number. */
  where: string
  /** The PR's URL, so the line opens the review; empty for a local merge. */
  url: string
  /** The assignee's name, or empty when the ticket had none. */
  who: string
}

/** A ticket in Review, as the In review section lists it. */
export interface ReviewLine {
  ticketId: number
  title: string
  /** `Iris testing · web-app #89`, or empty when there is nothing to say. */
  where: string
  /** The round is routed to the boss: the card draws the "Ready for you" badge. */
  readyForYou: boolean
}

/** A blocked ticket, with the reason in the assignee's own words. */
export interface BlockedLine {
  ticketId: number
  title: string
  reason: string
}

/** One row of Waiting on you: the same source as the Inbox (decision 43). */
export interface WaitingLine {
  /** The Inbox row's id, so the digest and the Inbox can never drift apart. */
  id: string
  /** The ticket the row is about, or null; the card writes its code where there is one. */
  ticketId: number | null
  text: string
  /** `Plan · 4 steps`, `Permission`, `Approval` — what kind of thing it is. */
  kind: string
  channelId: string
  threadId: number
}

/** One Provider's share of its window, or why there is no number for it. */
export interface UsageLine {
  id: string
  name: string
  /** 0-100, or null when the Provider reported nothing. */
  percent: number | null
  /** `5h`, `wk`: the window the percent is of; empty when there is none. */
  window: string
  /** `21:00`, or empty when the Provider named no reset. */
  resets: string
  /** Why there is no number, in the Provider's own words; empty when there is one. */
  problem: string
}

/** A Ready ticket and who holds it, as Tomorrow lists it. */
export interface TomorrowLine {
  ticketId: number
  title: string
  /** The assignee's name. */
  who: string
}

/** One day's digest, as it was composed; stored whole, so it never changes after it is posted. */
export interface DailyDigest {
  /** `2026-09-22`, the day it is filed under in the schedule's zone. */
  day: string
  /** The instant it covers from, ISO. */
  since: string
  /** The instant it covers to, ISO: the scheduled time it went up at. */
  until: string
  shipped: ShippedLine[]
  inReview: ReviewLine[]
  blocked: BlockedLine[]
  waiting: WaitingLine[]
  usage: UsageLine[]
  tomorrow: TomorrowLine[]
  /** What the footer says the schedule is, frozen at the time of posting. */
  footer: string
}

/** The one line a day with nothing in it posts. */
export const QUIET_DAY = 'Quiet day: nothing shipped, nothing waiting on you.'

/** Whether every section of a digest is empty: the day the card is one sentence. */
export function isQuietDigest(digest: DailyDigest): boolean {
  return (
    digest.shipped.length === 0 &&
    digest.inReview.length === 0 &&
    digest.blocked.length === 0 &&
    digest.waiting.length === 0 &&
    digest.tomorrow.length === 0
  )
}

/**
 * `Daily digest · Tue 22 Sep · 18:00`. Built from the parts rather than `toLocaleString`, so the
 * card reads the same on every machine and a test can say what it expects.
 */
export function digestTitle(until: string, timezone: string | null): string {
  const wall = wallClock(new Date(until), timezone ?? undefined)
  if (!wall) return 'Daily digest'
  const date = new Date(Date.UTC(wall.year, wall.month, wall.day))
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getUTCDay()]
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][wall.month]
  return `Daily digest · ${weekday} ${wall.day} ${month} · ${hhmm(wall.hour, wall.minute)}`
}

/**
 * `Since yesterday 18:00`, `Since 09:00`, `Since Fri 18:00`: how far back the digest reaches. A gap
 * wider than a week says the date, because "Since Tue" would then mean the wrong Tuesday.
 */
export function sinceLabel(digest: Pick<DailyDigest, 'since' | 'until'>, timezone: string | null): string {
  const zone = timezone ?? undefined
  const from = wallClock(new Date(digest.since), zone)
  const to = wallClock(new Date(digest.until), zone)
  if (!from || !to) return ''
  const time = hhmm(from.hour, from.minute)
  const days = Math.round(
    (Date.UTC(to.year, to.month, to.day) - Date.UTC(from.year, from.month, from.day)) / 86_400_000,
  )
  if (days === 0) return `Since ${time}`
  if (days === 1) return `Since yesterday ${time}`
  if (days < 7) {
    const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][
      new Date(Date.UTC(from.year, from.month, from.day)).getUTCDay()
    ]
    return `Since ${weekday} ${time}`
  }
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][from.month]
  return `Since ${from.day} ${month} ${time}`
}

/** `Posted by TinyCorp · no usage spent · every weekday at 18:00`. */
export function digestFooter(schedule: DigestSchedule): string {
  return `Posted by ${APP_NAME} · no usage spent · ${daysLabel(schedule.days)} at ${schedule.time}`
}

/**
 * `3 shipped, 2 in review, 1 blocked. 2 things wait on you. Claude at 68%, resets 21:00.` — the
 * message's own text, and the notification's body. One sentence, whatever the card draws.
 */
export function digestSummary(digest: DailyDigest): string {
  if (isQuietDigest(digest)) return QUIET_DAY
  const counts = [
    digest.shipped.length > 0 && `${digest.shipped.length} shipped`,
    digest.inReview.length > 0 && `${digest.inReview.length} in review`,
    digest.blocked.length > 0 && `${digest.blocked.length} blocked`,
  ].filter((part): part is string => part !== false)
  const waiting =
    digest.waiting.length === 0
      ? 'Nothing waits on you.'
      : `${digest.waiting.length} thing${digest.waiting.length === 1 ? '' : 's'} wait${digest.waiting.length === 1 ? 's' : ''} on you.`
  const spent = digest.usage.find((line) => line.percent !== null)
  const usage = spent ? ` ${spent.name} at ${spent.percent}%${spent.resets ? `, resets ${spent.resets}` : ''}.` : ''
  return `${counts.length > 0 ? `${counts.join(', ')}. ` : ''}${waiting}${usage}`
}

/** The notification's title: `Tiny Corp · Daily digest`. */
export function digestNotificationTitle(companyName: string): string {
  return `${companyName} · Daily digest`
}

function hhmm(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}
