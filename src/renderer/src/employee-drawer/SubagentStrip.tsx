import { GitBranch, GitFork, Link } from 'lucide-react'
import type { SessionStatus } from '../../../shared/session'
import type { SubSessionInfo } from '../../../shared/sub-sessions'
import type { SubagentInfo } from '../../../shared/subagents'
import { cx } from '../ui'
import {
  type ChipTone,
  pickedSubagent,
  pickedSubSession,
  seatLine,
  stripChips,
  subagentElapsed,
  subagentNow,
  subSessionElapsed,
  subSessionNow,
  subSessionWhere,
} from './subagents-model'
import '../ui/tailwind.css'

/**
 * The Terminal tab's strip and its telemetry card (`design/screens/CuLyV.png`).
 *
 * `line-height: normal` is written out on the chip and the card, because both said so: the strip
 * sits inside the drawer, which sets it anyway, but the sheet did not rely on that and neither does
 * this. Everything under them is size-only and inherits it, so each says `/[normal]`.
 *
 * **`DOT_TONE` is a lookup, and the modifier still trails the list.** `subagent-chip__dot--${tone}`
 * cannot be compiled — Tailwind reads the source text and that string is never in it — so the colour
 * comes from the map. The BEM modifier stays, last, because `SubagentStrip.dom.test.tsx` reads the
 * tone back with `className.split('--')[1]`: it has to be the final `--` in the attribute, so no
 * utility carrying `--` may be added after it. The sweep that moves that read to `data-tone` is what
 * makes this safe to touch.
 */
const CHIP =
  'subagent-chip m-0 flex max-w-full cursor-pointer items-center gap-6 rounded-full border border-border bg-muted px-10 py-5 font-normal text-11-5/[normal] text-muted-foreground focus-visible:shadow-focus focus-visible:outline-none'

const CHIP_ON = 'border-primary bg-primary-subtle font-semibold text-foreground'

const DOT = 'subagent-chip__dot size-7 shrink-0 rounded-[50%]'

const DOT_TONE = {
  live: 'bg-brand-success',
  wait: 'bg-brand-warning',
  quiet: 'bg-muted-foreground',
} satisfies Record<ChipTone, string>

const CARD = 'flex shrink-0 flex-col gap-5 rounded-sm border border-border bg-muted px-11 py-9 leading-[normal]'

const TASK = 'flex items-center gap-7 [&_svg]:shrink-0 [&_svg]:text-muted-foreground'

const TITLE =
  'min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-sans font-semibold text-12/[normal] text-foreground'

const ELAPSED = 'shrink-0 font-sans text-11/[normal] text-muted-foreground'

const NOW = 'overflow-hidden text-ellipsis whitespace-pre font-code text-10-5/[normal]'

const NOW_TONE = {
  live: 'text-brand-success',
  wait: 'text-brand-warning',
  quiet: 'text-muted-foreground',
} satisfies Record<ChipTone, string>

/* Where a sub-session works (T163): its own worktree and branch, or the parent's. */
const WHERE = 'font-code text-10-5/[1.4] text-muted-foreground [overflow-wrap:anywhere]'

/* How many of the Company's Session seats the Employee holds, under the card (T163). */
const SEATS = 'subagent-seats m-0 shrink-0 font-sans text-11/[1.4] text-muted-foreground'

/**
 * The top of the Terminal tab (`design/screens/CuLyV.png`): the Employee's chip, one chip per
 * Session it started of its own (T163), one per subagent its own process runs (T162), and the
 * picked one's telemetry card.
 *
 * A sub-session has a terminal of its own, so picking its chip swaps the terminal below to it;
 * its chip carries where it works — its own worktree, or a link to the parent's. A subagent runs
 * inside the Employee's process and has none, so picking one shows its card and leaves the
 * terminal on the Employee. The seat line under the card counts what this Employee holds.
 */
export function SubagentStrip(props: {
  employeeName: string
  status: SessionStatus
  subagents: readonly SubagentInfo[]
  /** The Sessions the Employee started of its own (T163). */
  subSessions?: readonly SubSessionInfo[] | undefined
  /** The Company's concurrency cap, for the seat line; null when it is not known yet. */
  concurrencyCap?: number | null
  /** The picked chip's id; null is the Employee's own chip. */
  picked: string | null
  onPick(id: string | null): void
  now: number
}) {
  const subSessions = props.subSessions ?? []
  const chips = stripChips(props.employeeName, props.status, props.subagents, subSessions)
  if (!chips) return null
  const pickedSession = pickedSubSession(subSessions, props.picked)
  const picked = pickedSubagent(props.subagents, props.picked)
  const seats = seatLine(props.employeeName, props.status, subSessions, props.concurrencyCap ?? null)
  return (
    <>
      <fieldset className="flex shrink-0 flex-wrap items-center gap-6" aria-label={`${props.employeeName}’s subagents`}>
        {chips.map((chip) => {
          const on = chip.id === (pickedSession?.id ?? picked?.id ?? null)
          const Workspace = chip.workspace === 'own' ? GitBranch : chip.workspace === 'shared' ? Link : null
          return (
            <button
              key={chip.id ?? 'employee'}
              type="button"
              className={cx(CHIP, chip.id === null ? 'font-sans' : 'font-code', on && CHIP_ON)}
              aria-pressed={on}
              title={chip.title ?? undefined}
              onClick={() => props.onPick(chip.id)}
            >
              <span className={cx(DOT, DOT_TONE[chip.tone], `subagent-chip__dot--${chip.tone}`)} aria-hidden />
              <span className="overflow-hidden text-ellipsis whitespace-nowrap">{chip.label}</span>
              {Workspace && (
                <Workspace
                  className="subagent-chip__workspace shrink-0 text-muted-foreground"
                  size={11}
                  aria-label={chip.workspace === 'own' ? 'own worktree' : `shares ${props.employeeName}’s worktree`}
                />
              )}
            </button>
          )
        })}
      </fieldset>
      {pickedSession && <SubSessionCard sub={pickedSession} parentName={props.employeeName} now={props.now} />}
      {picked && <SubagentCard subagent={picked} now={props.now} />}
      {seats && <p className={SEATS}>{seats}</p>}
    </>
  )
}

function SubagentCard({ subagent, now }: { subagent: SubagentInfo; now: number }) {
  const line = subagentNow(subagent)
  return (
    <div className={CARD} data-testid="subagent-card">
      <div className={TASK}>
        <GitFork size={13} aria-hidden />
        <span className={TITLE} title={subagent.task}>
          {subagent.task}
        </span>
        <span className={ELAPSED}>{subagentElapsed(subagent, now)}</span>
      </div>
      <div className={cx(NOW, NOW_TONE[line.tone])}>{line.text}</div>
    </div>
  )
}

function SubSessionCard({ sub, parentName, now }: { sub: SubSessionInfo; parentName: string; now: number }) {
  const line = subSessionNow(sub)
  return (
    <div className={CARD} data-testid="sub-session-card">
      <div className={TASK}>
        <GitFork size={13} aria-hidden />
        <span className={TITLE} title={sub.task}>
          {sub.task}
        </span>
        <span className={ELAPSED}>{subSessionElapsed(sub, now)}</span>
      </div>
      <div className={WHERE}>{subSessionWhere(sub, parentName)}</div>
      <div className={cx(NOW, NOW_TONE[line.tone])} title={sub.result ?? undefined}>
        {line.text}
      </div>
    </div>
  )
}
