import {
  CalendarDays,
  Clock3,
  Gauge,
  GitMerge,
  GitPullRequestArrow,
  Hand,
  Info,
  type LucideIcon,
  Newspaper,
  OctagonAlert,
  SquareKanban,
} from 'lucide-react'
import type { UsageLine } from '../../../shared/planning/daily-digest'
import { usageLevel } from '../../../shared/usage/provider-usage'
import { openTicket } from '../board'
import { navigate } from '../chrome'
import { openReview } from '../review'
import { Badge, cx } from '../ui'
import type { DigestRow, DigestSection, MessageCard } from './chat-view'

/**
 * The design's soft body ink in chat: Slate 300 on the dark theme, the secondary ink on light.
 * `ui/tokens.css` has no token for it — the stylesheet carried it as a `--chat-soft` custom
 * property with a `[data-theme='light']` override, and this is that pair, per element.
 */
const SOFT = "text-[#cbd5e1] [[data-theme='light']_&]:text-secondary-foreground"

/** A card's own quiet action, flat until the pointer is on it. */
const QUIET =
  'inline-flex shrink-0 cursor-pointer items-center justify-center gap-8 whitespace-nowrap rounded-sm border-0 bg-transparent px-10 py-5 font-semibold text-12/[normal] text-muted-foreground hover:bg-[color-mix(in_srgb,var(--secondary)_70%,transparent)] hover:text-foreground focus-visible:shadow-focus focus-visible:outline-none'

/** A ticket reference: see `REF` in `Messages.tsx` for why `all: unset` is spelled out. */
const REF =
  'inline m-0 cursor-pointer border-0 bg-transparent p-0 font-code font-normal text-[0.9em] [appearance:none] [text-align:inherit] hover:text-status-info-foreground hover:underline focus-visible:rounded-[4px] focus-visible:shadow-focus'

/** A small fact at the end of a digest row. */
const META = 'shrink-0 whitespace-nowrap text-11/[normal] text-muted-foreground'

/** The `Ready for you` badge's two parts, reached through the kit. */
const WAITING = `[&_[data-slot=badge-label]]:text-[#cbd5e1] [[data-theme='light']_&]:[&_[data-slot=badge-label]]:text-secondary-foreground [&_[data-slot=badge-dot]]:bg-brand-warning`

/** The icon at the head of each section, as the frame draws them (`N47ud`). */
const SECTION_ICON: Record<DigestSection['id'], LucideIcon> = {
  shipped: GitMerge,
  inReview: GitPullRequestArrow,
  blocked: OctagonAlert,
  waiting: Hand,
  tomorrow: CalendarDays,
}

/**
 * The daily digest, as the app posts it in `#general` (T172, frame `N47ud`): two columns of
 * sections, Usage today between them on the right, and a footer that says what wrote it and when
 * the next one goes up. Every ticket id opens its ticket; a row with a PR opens the review.
 */
export function DigestCard({ card }: { card: Extract<MessageCard, { kind: 'digest' }> }) {
  return (
    <section className="flex w-full flex-col rounded-sm border border-border bg-card" aria-label={card.title}>
      <header className="flex items-center gap-8 border-border border-b px-14 py-11 text-foreground">
        <Newspaper size={15} aria-hidden />
        <span className="whitespace-nowrap font-bold text-13/[normal] text-foreground">{card.title}</span>
        <span className="shrink grow basis-0" />
        {card.since && <span className="whitespace-nowrap text-11/[normal] text-muted-foreground">{card.since}</span>}
      </header>
      {card.quiet ? (
        <p className={cx('m-0 p-14 text-13/[normal]', SOFT)}>{card.quiet}</p>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-12 px-14 py-12 [&+&]:border-border [&+&]:border-l">
            {card.left.map((section) => (
              <Section key={section.id} section={section} />
            ))}
          </div>
          <div className="flex min-w-0 flex-col gap-12 px-14 py-12 [&+&]:border-border [&+&]:border-l">
            {card.right.slice(0, 1).map((section) => (
              <Section key={section.id} section={section} />
            ))}
            {card.usage.length > 0 && <Usage lines={card.usage} />}
            {card.right.slice(1).map((section) => (
              <Section key={section.id} section={section} />
            ))}
          </div>
        </div>
      )}
      <footer className="flex items-center gap-10 whitespace-nowrap border-border border-t px-14 py-9 text-11/[normal] text-muted-foreground">
        <Info size={14} aria-hidden />
        <span>{card.footer}</span>
        <span className="shrink grow basis-0" />
        <button type="button" className={QUIET} onClick={() => navigate({ view: 'settings', tab: 'general' })}>
          <Clock3 size={13} aria-hidden />
          Change time
        </button>
        <button type="button" className={QUIET} onClick={() => navigate({ view: 'board' })}>
          <SquareKanban size={13} aria-hidden />
          Open board
        </button>
      </footer>
    </section>
  )
}

function Section({ section }: { section: DigestSection }) {
  const Icon = SECTION_ICON[section.id]
  return (
    <section className="flex min-w-0 flex-col gap-5" aria-label={section.title}>
      <h4 className="mx-0 mt-0 mb-2 flex items-center gap-8 font-semibold text-11/[normal] text-muted-foreground uppercase tracking-[0.8px]">
        <Icon size={13} aria-hidden />
        {section.title}
        {section.count !== null && (
          <span className="font-code font-normal text-11/[normal] text-muted-foreground tracking-[0]">
            {section.count}
          </span>
        )}
      </h4>
      {section.rows.map((row, index) => (
        <Row key={`${section.id}:${row.ticketId ?? index}:${row.text}`} row={row} />
      ))}
    </section>
  )
}

function Row({ row }: { row: DigestRow }) {
  return (
    <div className="flex min-w-0 items-baseline gap-10">
      {row.code && row.ticketId !== null && (
        <button
          type="button"
          className={cx(REF, 'shrink-0 text-status-info-foreground')}
          title={row.text}
          onClick={() => openTicket(row.ticketId!)}
        >
          {row.code}
        </button>
      )}
      <span className={cx('overflow-hidden text-ellipsis whitespace-nowrap text-13/[normal]', SOFT)}>{row.text}</span>
      <span className="shrink grow basis-0" />
      {row.ready ? (
        <Badge variant="neutral" className={cx(WAITING, 'shrink-0')}>
          Ready for you
        </Badge>
      ) : row.meta && row.reviewTicketId !== null ? (
        <button
          type="button"
          className={cx(META, 'cursor-pointer border-0 bg-transparent hover:text-foreground hover:underline')}
          onClick={() => openReview({ ticketId: row.reviewTicketId! })}
        >
          {row.meta}
        </button>
      ) : (
        row.meta && <span className={META}>{row.meta}</span>
      )}
    </div>
  )
}

/**
 * Usage today, one row per Provider. A Provider that reported nothing says so in its own words
 * rather than drawing an empty bar at zero (T80).
 */
function Usage({ lines }: { lines: UsageLine[] }) {
  return (
    <section className="flex min-w-0 flex-col gap-5" aria-label="Usage today">
      <h4 className="mx-0 mt-0 mb-2 flex items-center gap-8 font-semibold text-11/[normal] text-muted-foreground uppercase tracking-[0.8px]">
        <Gauge size={13} aria-hidden />
        Usage today
      </h4>
      {lines.map((line) => (
        <div key={line.id} className="flex min-w-0 items-center gap-8">
          <span className="shrink-0 font-bold text-13/[normal] text-foreground">{line.name}</span>
          {line.percent === null ? (
            <span className={cx(META, 'overflow-hidden text-ellipsis')}>{line.problem}</span>
          ) : (
            <>
              <span className="flex h-6 min-w-40 shrink grow basis-0 items-stretch overflow-hidden rounded-full bg-secondary">
                <span
                  className="rounded-full bg-brand-primary data-[level=full]:bg-brand-danger data-[level=high]:bg-brand-warning"
                  data-level={usageLevel(line.percent)}
                  style={{ width: `${Math.max(0, Math.min(100, line.percent))}%` }}
                />
              </span>
              <span className={cx('shrink-0 font-code text-12/[normal]', SOFT)}>{line.percent}%</span>
              <span className={META}>
                of {line.window} window{line.resets && ` · resets ${line.resets}`}
              </span>
            </>
          )}
        </div>
      ))}
    </section>
  )
}
