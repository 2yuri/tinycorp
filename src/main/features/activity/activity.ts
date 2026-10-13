import type { DatabaseSync } from 'node:sqlite'
import {
  ACTIVITY_GROUP_OF,
  type ActivityActor,
  type ActivityBadge,
  type ActivityEvent,
  type ActivityGroup,
  type ActivityQuery,
  type ActivitySubject,
  isActivityKind,
} from '../../../shared/activity'
import type { Migration } from '../../core'

/**
 * The activity log's migration step, appended to the engine's migrations.
 * Append-only: rows are inserted, never updated or deleted.
 */
export const ACTIVITY_MIGRATION: Migration = {
  name: 'activity-event-log',
  sql: `
  CREATE TABLE activity_event (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    actor_name TEXT NOT NULL,
    subject_kind TEXT,
    subject_id TEXT,
    subject_label TEXT,
    summary TEXT NOT NULL,
    detail TEXT,
    payload TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );
  CREATE INDEX activity_event_by_time ON activity_event (created_at DESC, id DESC);
`,
}

/** What a flow hands the log; everything else the log fills in. */
export interface NewActivityEvent {
  kind: ActivityEvent['kind']
  actorId: string
  actorName: string
  summary: string
  subject?: ActivitySubject | null
  detail?: string | null
  code?: string[]
  badge?: ActivityBadge | null
  payload?: Record<string, unknown>
  /** Defaults to now; tests pass their own. */
  createdAt?: string
}

/** One Company's append-only event log. */
export interface ActivityLog {
  /** Appends an event and returns it as readers see it. */
  record(input: NewActivityEvent): ActivityEvent
  /** Newest first, filtered by group, actor and free text. */
  list(query?: ActivityQuery): ActivityEvent[]
  /** Everyone who has an event in the log, by their latest name, in name order. */
  actors(): ActivityActor[]
}

/** How many events the feed reads at once when the query names no limit. */
export const ACTIVITY_PAGE = 200

interface ActivityRow {
  id: number
  kind: string
  actor_id: string
  actor_name: string
  subject_kind: string | null
  subject_id: string | null
  subject_label: string | null
  summary: string
  detail: string | null
  payload: string
  created_at: string
}

export interface ActivityLogOptions {
  db: DatabaseSync
  /** Called after every appended event, e.g. to push the feed over IPC. */
  onRecorded?(event: ActivityEvent): void
  /** The clock; tests pass their own. */
  now?: () => Date
}

export function createActivityLog({ db, onRecorded, now = () => new Date() }: ActivityLogOptions): ActivityLog {
  return {
    record(input) {
      // A flow can finish after its Company closed (an async PR or merge); the log is simply over.
      if (!db.isOpen) return { ...input, id: 0, ...blankEvent(input) }
      const payload = { ...(input.payload ?? {}) }
      if (input.code?.length) payload['code'] = input.code
      if (input.badge) payload['badge'] = input.badge
      const createdAt = input.createdAt ?? now().toISOString()
      const { lastInsertRowid } = db
        .prepare(
          `INSERT INTO activity_event
             (kind, actor_id, actor_name, subject_kind, subject_id, subject_label, summary, detail, payload, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.kind,
          input.actorId,
          input.actorName,
          input.subject?.kind ?? null,
          input.subject?.id ?? null,
          input.subject?.label ?? null,
          input.summary,
          input.detail ?? null,
          JSON.stringify(payload),
          createdAt,
        )
      const event = toEvent({
        id: Number(lastInsertRowid),
        kind: input.kind,
        actor_id: input.actorId,
        actor_name: input.actorName,
        subject_kind: input.subject?.kind ?? null,
        subject_id: input.subject?.id ?? null,
        subject_label: input.subject?.label ?? null,
        summary: input.summary,
        detail: input.detail ?? null,
        payload: JSON.stringify(payload),
        created_at: createdAt,
      })
      onRecorded?.(event)
      return event
    },

    list(query = {}) {
      if (!db.isOpen) return []
      const where: string[] = []
      const values: (string | number)[] = []
      const kinds = kindsOf(query.groups)
      if (kinds) {
        if (kinds.length === 0) return []
        where.push(`kind IN (${kinds.map(() => '?').join(', ')})`)
        values.push(...kinds)
      }
      if (query.actorId) {
        where.push('actor_id = ?')
        values.push(query.actorId)
      }
      const search = query.search?.trim()
      if (search) {
        where.push("(summary LIKE ? ESCAPE '\\' OR detail LIKE ? ESCAPE '\\' OR subject_label LIKE ? ESCAPE '\\')")
        const like = `%${escapeLike(search)}%`
        values.push(like, like, like)
      }
      const limit = Number.isInteger(query.limit) && query.limit! > 0 ? query.limit! : ACTIVITY_PAGE
      const rows = db
        .prepare(
          `SELECT * FROM activity_event
           ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
           ORDER BY created_at DESC, id DESC LIMIT ?`,
        )
        .all(...values, limit) as unknown as ActivityRow[]
      return rows.map(toEvent)
    },

    actors() {
      if (!db.isOpen) return []
      const rows = db
        .prepare(
          `SELECT actor_id, actor_name FROM activity_event
           WHERE id IN (SELECT MAX(id) FROM activity_event GROUP BY actor_id)
           ORDER BY actor_name COLLATE NOCASE`,
        )
        .all() as { actor_id: string; actor_name: string }[]
      return rows.map((row) => ({ id: row.actor_id, name: row.actor_name }))
    },
  }
}

/** The kinds in `groups`, or null when every kind is wanted. */
function kindsOf(groups: ActivityGroup[] | undefined): string[] | null {
  if (!groups || groups.length === 0) return null
  const wanted = new Set(groups)
  return Object.keys(ACTIVITY_GROUP_OF).filter((kind) =>
    wanted.has(ACTIVITY_GROUP_OF[kind as keyof typeof ACTIVITY_GROUP_OF]),
  )
}

function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`)
}

function toEvent(row: ActivityRow): ActivityEvent {
  const payload = parsePayload(row.payload)
  const { code, badge, ...rest } = payload
  return {
    id: row.id,
    // An unknown kind can only come from a newer schema; it stays readable and lands under System.
    kind: isActivityKind(row.kind) ? row.kind : 'approval_decided',
    actorId: row.actor_id,
    actorName: row.actor_name,
    subject:
      row.subject_kind === null
        ? null
        : ({ kind: row.subject_kind, id: row.subject_id ?? '', label: row.subject_label ?? '' } as ActivitySubject),
    summary: row.summary,
    detail: row.detail,
    code: Array.isArray(code) ? (code as string[]).filter((c) => typeof c === 'string') : [],
    badge: isBadge(badge) ? badge : null,
    payload: rest,
    createdAt: row.created_at,
  }
}

/** What `record` returns when the Company closed under it: the event as written, with no row. */
function blankEvent(input: NewActivityEvent): Omit<ActivityEvent, 'id' | 'kind' | 'actorId' | 'actorName' | 'summary'> {
  return {
    subject: input.subject ?? null,
    detail: input.detail ?? null,
    code: input.code ?? [],
    badge: input.badge ?? null,
    payload: input.payload ?? {},
    createdAt: input.createdAt ?? new Date().toISOString(),
  }
}

function parsePayload(text: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function isBadge(value: unknown): value is ActivityBadge {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as ActivityBadge).label === 'string' &&
    typeof (value as ActivityBadge).tone === 'string'
  )
}
