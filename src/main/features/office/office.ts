import type { DatabaseSync } from 'node:sqlite'
import { BOSS, COMPANY_AUTHOR, type Message } from '../../../shared/domain/chat'
import { PROVIDER_SHORT_NAME } from '../../../shared/domain/providers'
import type { Provider } from '../../../shared/domain/staff'
import { POST_MEMORY_MS } from '../../../shared/office/movement'
import type { EmployeeActivity, OfficeFacts } from '../../../shared/office/projection'
import type { RoomSlug } from '../../../shared/office/rooms'
import type { SessionActivity, Sessions } from '../sessions'
import { readOfficeRoom, writeOfficeRoom } from './office-room'

/** What the office shows, as facts from the engine; the renderer projects them into sprites. */
export interface Office {
  /** The current Company's facts. Throws when no Company is open. */
  facts(): OfficeFacts
  /** The room the current Company works in (T83). */
  room(): RoomSlug
  /**
   * Picks the room. It is applied on the next office render; running Sessions are untouched and
   * every Employee keeps their desk index, so they sit at the same desk number in the new room.
   * Throws for a room whose geometry is not measured yet.
   */
  setRoom(slug: string): RoomSlug
  /** Called after anything the office shows may have changed. Returns an unsubscribe function. */
  onChange(listener: () => void): () => void
}

/** The office plus the hooks the engine feeds it. */
export interface OfficeService extends Office {
  /** A message was posted in an open Company. */
  posted(message: Message): void
  /** Something the office shows changed elsewhere: the board, an Approval, the current Company. */
  notify(): void
  close(): void
}

export interface OfficeOptions {
  sessions: Sessions
  /** The current Company's database, pending Approvals and tickets; throws when none is open. */
  current(): Pick<OfficeFacts, 'approvals' | 'tickets'> & { db: DatabaseSync }
}

/** Keeps each Employee's current tool and recent chat posts; everything else is read from the engine. */
export function createOffice({ sessions, current }: OfficeOptions): OfficeService {
  const activity = new Map<string, EmployeeActivity>()
  const listeners = new Set<() => void>()
  const notify = () => {
    for (const listener of listeners) listener()
  }

  function track({ employeeId, status, hook, tool }: SessionActivity): void {
    if (status === 'off' || status === 'parked') activity.delete(employeeId)
    else if (hook === 'UserPromptSubmit' || hook === 'Stop') update(employeeId, { tool: null })
    else if (tool) update(employeeId, { tool })
    notify()
  }

  function update(employeeId: string, changes: Partial<EmployeeActivity>): void {
    const previous = activity.get(employeeId) ?? { tool: null, posts: [] }
    activity.set(employeeId, { ...previous, ...changes })
  }

  const stops = [sessions.onActivity(track), sessions.onChange(notify)]

  return {
    facts() {
      const { approvals, tickets, db } = current()
      const statuses = sessions.list()
      return {
        room: readOfficeRoom(db),
        sessions: Object.fromEntries(statuses.map((s) => [s.employeeId, s.status])),
        activity: Object.fromEntries(
          statuses.flatMap((s) => {
            const found = activity.get(s.employeeId)
            return found ? [[s.employeeId, found]] : []
          }),
        ),
        approvals,
        // A Session stopped in its terminal is waiting on the boss exactly as an Approval is (T165).
        asking: statuses.flatMap((s) => (s.asking ? [s.employeeId] : [])),
        // Whoever is working on a fallback Provider while its own is out (T173).
        routed: Object.fromEntries(
          statuses.flatMap((s) =>
            s.routedTo
              ? [[s.employeeId, PROVIDER_SHORT_NAME[s.routedTo.provider as Provider] ?? s.routedTo.provider]]
              : [],
          ),
        ),
        tickets,
      }
    },

    room: () => readOfficeRoom(current().db),

    setRoom(slug) {
      const chosen = writeOfficeRoom(current().db, slug)
      notify()
      return chosen
    },

    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    posted(message) {
      const { authorId, channelId, threadId, mentions } = message
      if (authorId === BOSS || authorId === COMPANY_AUTHOR) return
      const at = Date.parse(message.createdAt)
      // Only what is still young enough to send anyone anywhere is kept (T74).
      const kept = (activity.get(authorId)?.posts ?? []).filter((post) => post.at > at - POST_MEMORY_MS)
      update(authorId, { posts: [...kept, { at, channelId, threadId, mentions }] })
      notify()
    },

    notify,

    close() {
      for (const stop of stops) stop()
      activity.clear()
      listeners.clear()
    },
  }
}
