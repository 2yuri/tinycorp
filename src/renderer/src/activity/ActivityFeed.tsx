import { Activity as ActivityIcon } from 'lucide-react'
import {
  ACTIVITY_GROUP_LABEL,
  ACTIVITY_GROUPS,
  type ActivityActor,
  type ActivityEvent,
  type ActivityGroup,
  activityDays,
  activityLine,
  activityTime,
} from '../../../shared/activity'
import { navigate } from '../chrome'
import { Written } from '../paths'
import { Badge, cx, EmptyState, Search, SHELL_BUTTON } from '../ui'
import { type ActivityTone, activityLook, actorLabel } from './activity-view'

export interface ActivityFeedProps {
  events: ActivityEvent[]
  /** The kind chip that is on, or null for All. */
  group: ActivityGroup | null
  onGroup(group: ActivityGroup | null): void
  /** Everyone with an event, shown when the Employee filter is open. */
  actors: ActivityActor[]
  actorId: string | null
  onActor(actorId: string | null): void
  /** Whether the Filters button opened the Employee filter. */
  peopleOpen: boolean
  search: string
  onSearch(search: string): void
  error?: string | null
  /** The clock the day headings read; tests pass their own. */
  now?: Date
}

/** The feed: the design's kind chips, the search, the Employee filter and the days of rows. */
export function ActivityFeed(props: ActivityFeedProps) {
  const days = activityDays(props.events, props.now ?? new Date())
  const filtered = props.group !== null || props.actorId !== null || props.search.trim() !== ''
  return (
    <section className={FEED} aria-label="Activity feed">
      <div className="flex items-center gap-8">
        <Chip label="All" active={props.group === null} onClick={() => props.onGroup(null)} />
        {ACTIVITY_GROUPS.map((id) => (
          <Chip
            key={id}
            label={ACTIVITY_GROUP_LABEL[id]}
            active={props.group === id}
            onClick={() => props.onGroup(props.group === id ? null : id)}
          />
        ))}
        <span className="flex-1" />
        <Search
          className="shrink-0 grow-0 basis-210"
          size="sm"
          placeholder="Search activity"
          value={props.search}
          onChange={(event) => props.onSearch(event.currentTarget.value)}
        />
      </div>

      {props.peopleOpen && (
        <fieldset className="flex flex-wrap items-center gap-8 pt-12" aria-label="Employee filter">
          <Chip label="Everyone" active={props.actorId === null} onClick={() => props.onActor(null)} />
          {props.actors.map((actor) => (
            <Chip
              key={actor.id}
              label={actor.name}
              active={props.actorId === actor.id}
              onClick={() => props.onActor(props.actorId === actor.id ? null : actor.id)}
            />
          ))}
        </fieldset>
      )}

      {props.error && (
        <p className="mt-12 mr-0 mb-0 ml-0 text-12-5/normal text-status-error-foreground" role="alert">
          {props.error}
        </p>
      )}

      {days.length === 0 ? (
        <EmptyState
          className="mt-32"
          icon={ActivityIcon}
          title={filtered ? 'Nothing matches those filters' : 'No activity yet'}
          body={
            filtered
              ? 'Clear a filter to see the rest of the log.'
              : 'Every move on the board, message, approval, PR and Session lands here as it happens.'
          }
        />
      ) : (
        days.map((day) => (
          <section key={day.key} aria-label={day.label}>
            <h2 className="m-0 flex items-center gap-10 pt-18 pb-8">
              <span className="font-bold text-11/normal text-muted-foreground tracking-[0.6px]">{day.label}</span>
              <span className="h-1 flex-1 bg-border" aria-hidden />
            </h2>
            <ul className="m-0 flex list-none flex-col p-0">
              {day.events.map((event) => (
                <Row key={event.id} event={event} />
              ))}
            </ul>
          </section>
        ))
      )}
    </section>
  )
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick(): void }) {
  return (
    <button type="button" className={cx(CHIP, active ? CHIP_ON : CHIP_OFF)} aria-pressed={active} onClick={onClick}>
      {label}
    </button>
  )
}

function Row({ event }: { event: ActivityEvent }) {
  const { icon: Icon, tone } = activityLook(event.kind)
  return (
    <li className="flex items-center gap-12 px-2 py-10">
      <time
        className="w-40 shrink-0 text-right font-code text-11-5/normal text-muted-foreground"
        dateTime={event.createdAt}
      >
        {activityTime(event.createdAt)}
      </time>
      <span className={cx(KIND, KIND_TONE[tone])} aria-hidden>
        <Icon size={13} />
      </span>
      <div className="flex min-w-0 flex-1 basis-0 flex-col gap-2">
        {/* The frame's Line (design/html/activity.html:4596): a flex row whose 5px gap — not a
            space in the text — separates the actor, the verb and what it acted on. It wraps, which
            the fixed-width frame never had to. */}
        <p className={LINE}>
          <span className="min-w-0 font-bold text-card-foreground">{actorLabel(event)}</span>
          {activityLine(event.summary, event.code).map((word, index) => (
            <span key={index} className="min-w-0">
              {word.map((segment, piece) =>
                segment.code ? (
                  <code key={piece} className={CODE}>
                    <Written text={segment.text} />
                  </code>
                ) : (
                  <span key={piece}>
                    <Written text={segment.text} />
                  </span>
                ),
              )}
            </span>
          ))}
        </p>
        {event.detail && (
          <p className="m-0 truncate text-11/normal text-muted-foreground">
            <Written text={event.detail} />
          </p>
        )}
      </div>
      {/* The capture line is the one row that goes somewhere: the pages this ticket wrote (T175). */}
      {event.subject?.kind === 'memory' && (
        <button
          type="button"
          className={cx(SHELL_BUTTON, OPEN)}
          onClick={() => navigate({ view: 'memory', ticket: event.subject!.id })}
        >
          Open
        </button>
      )}
      {event.badge && (
        <Badge className="shrink-0" variant={event.badge.tone} size="sm">
          {event.badge.label}
        </Badge>
      )}
    </li>
  )
}

/* The feed column (design/html/activity.html, screen `Andvt`), as utilities (T210f). */
const FEED = 'flex min-w-0 flex-1 basis-0 flex-col overflow-auto px-22 pt-16 pb-32'

/**
 * One kind filter: a 30px pill, and the one that is on takes the fill instead of the stroke. The
 * stroke, the fill, the weight and the ink are on the state and never on the base: two utilities of
 * the same property on one element are settled by the order Tailwind emitted them in.
 */
const CHIP =
  'inline-flex h-30 cursor-pointer items-center justify-center whitespace-nowrap rounded-full border px-13 text-12-5/normal hover:text-foreground focus-visible:shadow-focus focus-visible:outline-none'

const CHIP_OFF = 'border-border bg-transparent font-medium text-muted-foreground'

const CHIP_ON = 'border-transparent bg-secondary font-bold text-foreground'

/** The row's glyph tile, and the tint its kind gives it. */
const KIND = 'inline-flex h-26 w-26 shrink-0 items-center justify-center rounded-sm'

/*
 * Every tone, including `neutral`: the stylesheet gave the tile a default fill and let a modifier
 * override it, and two `bg-*` utilities in one layer would be settled by the order Tailwind emitted
 * them in. A `Record` over the union is also what fails to compile when a seventh tone is added.
 */
const KIND_TONE: Record<ActivityTone, string> = {
  primary: 'bg-primary-subtle text-primary',
  success: 'bg-status-success text-status-success-foreground',
  warning: 'bg-status-warning text-status-warning-foreground',
  info: 'bg-status-info text-status-info-foreground',
  quiet: 'bg-card text-muted-foreground',
  neutral: 'bg-secondary text-foreground',
}

const LINE = 'm-0 flex min-w-0 flex-wrap items-center gap-5 font-normal text-12-5/normal text-muted-foreground'

const CODE = 'font-code font-semibold text-12/normal text-card-foreground'

/** The capture line's way into Memory. */
const OPEN =
  'shrink-0 grow-0 basis-auto cursor-pointer rounded-full bg-transparent px-8 py-2 font-medium text-11-5/normal text-primary hover:bg-[color-mix(in_srgb,var(--primary)_14%,transparent)]'
