import type { ActivityActor, ActivityEvent, ActivityQuery } from '../../../shared/activity'
import { BOSS, COMPANY_AUTHOR, type Message } from '../../../shared/domain/chat'
import type { CompanyContext, OpenCompany } from '../../core'
import type { CompanyChanged, OwnFace } from '../company'
import type { SessionActivity } from '../sessions'
import { type ActivityLog, createActivityLog } from './activity'
import { type ActivityContext, createSessionRecorder, recordBudgetExhausted, recordPost } from './activity-sources'

/** What the Activity view reads, and what tells it a new event landed. */
export interface Activity {
  list(query?: ActivityQuery): ActivityEvent[]
  /** Everyone with an event in the log, for the Employee filter. */
  actors(): ActivityActor[]
  /** Called after an event is appended in any open Company. Returns an unsubscribe function. */
  onChange(listener: () => void): () => void
}

/** The one thing the log reads of another feature: every Session's starting and stopping. */
export interface ActivityDeps {
  onSessionActivity(listener: (activity: SessionActivity) => void): () => void
}

/** The activity feature, once it is wired. */
export interface ActivityFeature {
  /** That Company's log, made the first time it is asked for. */
  of(entry: OpenCompany): ActivityLog
  /**
   * How a line in that Company's log names who acted: the boss, an Employee (fired or not), or the
   * app itself. Every recorder in `activity-sources.ts` is handed one of these.
   */
  context(entry: OpenCompany): () => ActivityContext
  /** A post, which is a line in the log only when it is worth one. */
  posted(entry: OpenCompany, message: Message): boolean
  /** The subscription limit: one line per Company that had a Session stopped by it (decision 18). */
  budgetExhausted(posts: { companyId: string }[], resetsAt: Date | null): void
  facade: OwnFace<ActivityFacade>
}

/**
 * Wires the append-only activity log to the Companies the app has open (decision 36, T186).
 *
 * One log per open Company, because the rows live in that Company's own database — so it is a
 * `perCompany` cache and closing the Company empties it. The listeners are not per Company: the
 * Activity view redraws whenever an event lands anywhere, and reads whichever Company is current.
 * The engine goes on feeding the log through {@link ActivityFeature.of}, because what is worth
 * recording is something only the feature that did it knows.
 */
export function register(ctx: CompanyContext, deps: ActivityDeps): ActivityFeature {
  const changed = ctx.listeners()
  const logs = ctx.perCompany((entry) => createActivityLog({ db: entry.db, onRecorded: () => changed.notify() }))

  function context(entry: OpenCompany): () => ActivityContext {
    return () => ({
      log: logs.of(entry),
      companyKey: entry.company.key,
      nameOf(actorId) {
        if (actorId === BOSS) return entry.company.boss.name
        if (actorId === COMPANY_AUTHOR) return 'System'
        const row = entry.db.isOpen
          ? (entry.db.prepare('SELECT name FROM employee WHERE id = ?').get(actorId) as { name: string } | undefined)
          : undefined
        return row?.name ?? 'An Employee'
      },
    })
  }

  // A Session starting or stopping is activity; the log takes it from the stream the office reads.
  const recorders = ctx.perCompany((entry) => createSessionRecorder(context(entry)))
  deps.onSessionActivity((activity) => {
    const entry = ctx.entryOf(activity.companyId)
    if (entry) recorders.of(entry)(activity)
  })

  return {
    of: (entry) => logs.of(entry),
    context,
    posted: (entry, message) => recordPost(context(entry), message),

    budgetExhausted(posts, resetsAt) {
      for (const { companyId } of posts) {
        const entry = ctx.entryOf(companyId)
        if (entry) recordBudgetExhausted(context(entry), resetsAt)
      }
    },

    facade: {
      activity: {
        list: (query) => logs.current().list(query),
        actors: () => logs.current().actors(),
        onChange: (listener) => changed.add(listener),
      },
    },
  }
}

/** The Activity view's face: the log of whichever Company is current, and when one lands. */
export interface ActivityFacade extends CompanyChanged {
  /** The current Company's append-only activity log (decision 36). */
  activity: Activity
}
