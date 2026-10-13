/**
 * The Company's append-only activity log (decision 36): every meaningful change lands here once,
 * and the Activity view, the office projection and the notifications read it instead of each
 * recomputing what happened.
 */

/** The filter chips above the feed, in the design's order. */
export const ACTIVITY_GROUPS = ['code', 'tickets', 'people', 'capacity', 'system'] as const
export type ActivityGroup = (typeof ACTIVITY_GROUPS)[number]

export const ACTIVITY_GROUP_LABEL: Record<ActivityGroup, string> = {
  code: 'Code',
  tickets: 'Tickets',
  people: 'People',
  capacity: 'Capacity',
  system: 'System',
}

/**
 * Every kind of event the engine writes. The name says what happened, never who saw it; the
 * filter chips group them with `ACTIVITY_GROUP_OF`.
 */
export const ACTIVITY_GROUP_OF = {
  // The board.
  ticket_created: 'tickets',
  ticket_moved: 'tickets',
  ticket_assigned: 'tickets',
  // The last blocker of a ticket went to Done, so it no longer waits (T266).
  ticket_unblocked: 'tickets',
  // The boss deleted a ticket that held no work (T275): the line is all that is left of it.
  ticket_deleted: 'tickets',
  epic_created: 'tickets',
  // One line per closed ticket, whatever the capture wrote (T175). No model writes those pages.
  memory_captured: 'tickets',
  // The code flow and reviews.
  worktree_opened: 'code',
  pull_request_opened: 'code',
  review_requested: 'code',
  review_submitted: 'code',
  merged: 'code',
  // Chat posts (never their bodies) and hiring.
  message_posted: 'people',
  hire_proposed: 'people',
  employee_hired: 'people',
  employee_fired: 'people',
  // The concurrency cap and the subscription limit.
  budget_exhausted: 'capacity',
  concurrency_cap_changed: 'capacity',
  // A Provider ran out and the Company routed around it, or it came back (T173).
  provider_switched: 'capacity',
  provider_reset: 'capacity',
  // Approvals, Sessions and repos.
  approval_requested: 'system',
  approval_decided: 'system',
  session_started: 'system',
  session_stopped: 'system',
  repo_connected: 'system',
} as const satisfies Record<string, ActivityGroup>

export type ActivityKind = keyof typeof ACTIVITY_GROUP_OF

export const ACTIVITY_KINDS = Object.keys(ACTIVITY_GROUP_OF) as ActivityKind[]

export function isActivityKind(value: unknown): value is ActivityKind {
  return typeof value === 'string' && value in ACTIVITY_GROUP_OF
}

export function isActivityGroup(value: unknown): value is ActivityGroup {
  return ACTIVITY_GROUPS.includes(value as ActivityGroup)
}

/** What an event is about; the view links to it. */
export type ActivitySubjectKind =
  | 'ticket'
  | 'pull_request'
  | 'approval'
  | 'session'
  | 'employee'
  | 'repo'
  | 'channel'
  /** The Company memory, filtered to the pages one ticket wrote. */
  | 'memory'

export interface ActivitySubject {
  kind: ActivitySubjectKind
  /** The ticket number, the channel id, the Employee id… as text, so one column holds them all. */
  id: string
  /** How the subject reads in the feed, e.g. `TC-318` or `#general`. */
  label: string
}

/** The pill on the right of a row, e.g. `Needs review`. */
export interface ActivityBadge {
  label: string
  tone: 'neutral' | 'primary' | 'success' | 'warning' | 'danger'
}

export interface ActivityEvent {
  id: number
  kind: ActivityKind
  /** `boss` or an Employee id. */
  actorId: string
  /** The actor's name when the event happened; a fired Employee keeps their name in the log. */
  actorName: string
  subject: ActivitySubject | null
  /** The line after the actor's name, e.g. `moved TC-318 to Doing`. */
  summary: string
  /** The second, quieter line, or null when the event needs none. */
  detail: string | null
  /** Substrings of `summary` and `detail` drawn in the mono style, e.g. a branch or a repo. */
  code: string[]
  badge: ActivityBadge | null
  /** Whatever the flow that wrote the event knows, for later readers. Never a message body. */
  payload: Record<string, unknown>
  createdAt: string
}

/** What the Activity view asks the engine for. */
export interface ActivityQuery {
  /** Only these groups; all of them when absent or empty. */
  groups?: ActivityGroup[]
  /** Only this actor (`boss` or an Employee id). */
  actorId?: string
  /** Matches the summary, the detail or the subject label, case-insensitively. */
  search?: string
  /** Newest first; 200 by default. */
  limit?: number
}

/** An actor the feed can filter by, newest event first. */
export interface ActivityActor {
  id: string
  name: string
}

export function activityGroupOf(kind: ActivityKind): ActivityGroup {
  return ACTIVITY_GROUP_OF[kind]
}

/** One day of the feed, newest day first. */
export interface ActivityDay {
  /** `YYYY-MM-DD` in local time; the list key. */
  key: string
  /** `TODAY`, `YESTERDAY` or the date, as the design's day heading. */
  label: string
  events: ActivityEvent[]
}

function dayKey(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/**
 * Groups events (newest first) by the local day they happened on, keeping their order.
 * `now` decides which days read `TODAY` and `YESTERDAY`.
 */
export function activityDays(events: ActivityEvent[], now: Date): ActivityDay[] {
  const today = dayKey(now)
  const yesterday = dayKey(new Date(now.getTime() - 24 * 60 * 60 * 1000))
  const days: ActivityDay[] = []
  for (const event of events) {
    const date = new Date(event.createdAt)
    const key = dayKey(date)
    let day = days[days.length - 1]
    if (!day || day.key !== key) {
      day = { key, label: dayLabel(key, date, today, yesterday), events: [] }
      days.push(day)
    }
    day.events.push(event)
  }
  return days
}

function dayLabel(key: string, date: Date, today: string, yesterday: string): string {
  if (key === today) return 'TODAY'
  if (key === yesterday) return 'YESTERDAY'
  return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase()
}

/** A piece of a row's text: `code` pieces are drawn in the mono style. */
export interface ActivitySegment {
  text: string
  code: boolean
}

/**
 * Splits `text` on the `code` substrings, longest first so a repo name inside `repo #12` stays whole.
 * Returns one plain segment when nothing matches.
 */
export function activitySegments(text: string, code: string[]): ActivitySegment[] {
  const marks = [...new Set(code.filter(Boolean))].sort((a, b) => b.length - a.length)
  let segments: ActivitySegment[] = [{ text, code: false }]
  for (const mark of marks) {
    segments = segments.flatMap((segment) => (segment.code ? [segment] : splitOn(segment.text, mark)))
  }
  return segments.filter((segment) => segment.text !== '')
}

function splitOn(text: string, mark: string): ActivitySegment[] {
  const parts = text.split(mark)
  if (parts.length === 1) return [{ text, code: false }]
  return parts.flatMap((part, index) =>
    index === 0
      ? [{ text: part, code: false }]
      : [
          { text: mark, code: true },
          { text: part, code: false },
        ],
  )
}

/**
 * One item of a row's Line. The frame lays the Line out as a flex row with a 5px gap
 * (design/html/activity.html:4596), so the spacing has to come from the gap and not from the
 * text: `activityLine` strips the spaces that separated the pieces and keeps the pieces that
 * touched — `payments-web` and the comma after it — inside one word, so the gap never opens
 * where the summary had no space.
 */
export type ActivityWord = ActivitySegment[]

export function activityLine(text: string, code: string[]): ActivityWord[] {
  const words: ActivityWord[] = []
  // Whether the piece just added ends flush against whatever comes next.
  let touching = false
  const push = (segment: ActivitySegment) => {
    const last = words[words.length - 1]
    if (touching && last) last.push(segment)
    else words.push([segment])
  }
  for (const segment of activitySegments(text, code)) {
    if (segment.code) {
      push(segment)
      touching = true
      continue
    }
    const trimmed = segment.text.trim()
    if (trimmed === '') {
      touching = false
      continue
    }
    if (/^\s/.test(segment.text)) touching = false
    push({ text: trimmed, code: false })
    touching = !/\s$/.test(segment.text)
  }
  return words
}

/** `15:10`, the time column of a row. */
export function activityTime(createdAt: string): string {
  const date = new Date(createdAt)
  return `${`${date.getHours()}`.padStart(2, '0')}:${`${date.getMinutes()}`.padStart(2, '0')}`
}
