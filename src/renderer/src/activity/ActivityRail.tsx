import { Archive } from 'lucide-react'
import type { ActivityEvent } from '../../../shared/activity'
import type { SessionInfo, SessionStatus } from '../../../shared/session'
import { type People, PersonAvatar } from '../people'
import { cx } from '../ui'
import { elapsedLabel, todayStats } from './activity-view'

/** Sessions that are up, as the rail lists them. */
const LIVE: SessionStatus[] = ['starting', 'idle', 'busy', 'out_of_budget']

export interface ActivityRailProps {
  events: ActivityEvent[]
  sessions: SessionInfo[]
  /** An Employee's name, from the log's actors. */
  nameOf(employeeId: string): string
  /** Who the avatars draw: the Employees on staff and the boss's initials (T70). */
  people: People
  /** View all: opens the Employees view. */
  onViewAll?(): void
  now?: Date
}

/** The right rail: what happened today and whose Session is up. Every number comes from the log. */
export function ActivityRail(props: ActivityRailProps) {
  const now = props.now ?? new Date()
  const stats = todayStats(props.events, now)
  const live = props.sessions.filter((session) => LIVE.includes(session.status))
  /** What an Employee last did, as their newest event reads. */
  const lastOf = (employeeId: string) => props.events.find((event) => event.actorId === employeeId)?.summary ?? null

  return (
    <aside className={RAIL} aria-label="Today">
      <section className={PANEL}>
        <h2 className={TITLE}>Today</h2>
        <div className="grid grid-cols-2 gap-10">
          {stats.map((stat) => (
            <div key={stat.key} className={STAT}>
              {/* The line boxes are pinned so the tile is the frame's 59px: 11+11 padding, 1+1
                  stroke, and 20 + 2 + 13 of text. Inter's `normal` leading would make those 21.8
                  and 13.3, i.e. 61px. */}
              <div className="font-bold text-18/20 text-card-foreground tracking-[-0.4px]">{stat.value}</div>
              <div className="text-11 text-muted-foreground">{stat.label}</div>
            </div>
          ))}
        </div>
      </section>

      <section className={PANEL}>
        <div className="flex items-center gap-8">
          <h2 className={TITLE}>Live sessions</h2>
          {props.onViewAll && (
            <button type="button" className={ACTION} onClick={props.onViewAll}>
              View all
            </button>
          )}
        </div>
        {live.length === 0 ? (
          <p className="m-0 text-11/normal text-muted-foreground">No Session is running.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-10 p-0">
            {live.map((session) => {
              const name = props.nameOf(session.employeeId)
              const last = lastOf(session.employeeId)
              return (
                <li key={session.employeeId} className={SESSION}>
                  <PersonAvatar id={session.employeeId} name={name} people={props.people} size={28} />
                  <div className="flex min-w-0 flex-1 basis-0 flex-col gap-1">
                    <p className="m-0 flex min-w-0 items-center gap-6">
                      <span className={cx(DOT, DOT_STATUS[session.status])} aria-hidden />
                      <span className="truncate font-semibold text-12-5/normal text-card-foreground">{name}</span>
                    </p>
                    <p className="m-0 truncate text-11/normal text-muted-foreground">
                      {last ?? session.status.replace('_', ' ')}
                    </p>
                  </div>
                  {session.startedAt && (
                    <span className="shrink-0 font-code text-11/normal text-muted-foreground">
                      {elapsedLabel(session.startedAt, now)}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* The design's retention pill; the log keeps everything, so it says so. */}
      <p className={NOTE}>
        <Archive size={14} aria-hidden />
        <span>The log is append-only: every event is kept.</span>
      </p>
    </aside>
  )
}

/** The right rail (design `Andvt`, `Side`): 320px, the card surface, 18px padding, 16px gaps. */
const RAIL = 'flex shrink-0 grow-0 basis-320 flex-col gap-16 overflow-auto border-l border-l-border bg-card p-18'

const PANEL = 'flex flex-col gap-10'

const TITLE = 'm-0 flex-1 basis-0 font-bold text-11/normal text-muted-foreground uppercase tracking-[0.6px]'

const ACTION =
  'cursor-pointer border-0 bg-transparent p-0 font-semibold text-11-5/normal text-primary hover:underline focus-visible:shadow-focus focus-visible:outline-none'

const STAT = 'flex flex-col gap-2 rounded-sm border border-border bg-card px-12 py-11'

/**
 * No stroke: the frame draws each row on the rail's own #1E293B, so the rail reads as three rows
 * and not as three cards. The fill is kept, as the frame keeps it.
 */
const SESSION = 'flex items-center gap-10 rounded-sm bg-card px-10 py-8'

const DOT = 'h-6 w-6 shrink-0 rounded-full'

/**
 * A Session's state, as its dot. Every status the rail lists is here rather than only the three
 * the stylesheet named: the dot's default fill and a modifier over it would be two `bg-*` in one
 * layer, settled by the order Tailwind emitted them in.
 */
const DOT_STATUS: Record<SessionStatus, string> = {
  off: 'bg-muted-foreground',
  starting: 'bg-muted-foreground',
  idle: 'bg-status-warning-foreground',
  busy: 'bg-status-success-foreground',
  parked: 'bg-muted-foreground',
  out_of_budget: 'bg-status-error-foreground',
}

const NOTE =
  'mt-auto mr-0 mb-0 ml-0 flex items-center gap-8 rounded-sm px-12 py-10 text-11/normal text-muted-foreground'
