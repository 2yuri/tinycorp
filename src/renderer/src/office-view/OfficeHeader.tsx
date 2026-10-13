import { Pause, Play, UserRoundPlus } from 'lucide-react'
import type { CapacityInfo } from '../../../shared/capacity'
import { BudgetBadge, budgetSubtitle } from '../budget'
import { ViewHeader } from '../chrome'
import { Avatar, AvatarStack, Badge, Button } from '../ui'
import { countLabel, fullLabel, type OfficeHeaderFacts } from './header-facts'

export interface OfficeHeaderProps {
  /** The Company's name: its office is the floor. */
  floor: string
  facts: OfficeHeaderFacts
  capacity: Pick<CapacityInfo, 'running' | 'concurrencyCap'> | null
  /** Whether any Session is on, so there is something to pause. */
  canPause: boolean
  onPauseAll(): void
  /** The boss paused the Company: the button reads Resume all (decision 38). */
  paused?: boolean
  onResumeAll?(): void
  onHire(): void
  /** The subscription limit is hit: the header says so (design/html/out-of-budget.html). */
  outOfBudget?: boolean
}

/** Fills the shell's content header as design/html/office.html layer `Top Bar` does. */
export function OfficeHeader(props: OfficeHeaderProps) {
  return (
    <ViewHeader
      title={props.floor}
      badge={props.outOfBudget ? <BudgetBadge /> : <AtWorkBadge atWork={props.facts.atWork} />}
      subtitle={props.outOfBudget ? budgetSubtitle(props.floor) : officeSubtitle(props.floor, props.facts)}
    >
      <OfficeActions {...props} />
    </ViewHeader>
  )
}

export function officeSubtitle(floor: string, facts: OfficeHeaderFacts): string {
  const parts = [`${floor} · ${countLabel(facts.atDesks, 'Employee')} at their desks`]
  // The room seats what its painting seats; past that the boss has to pick a bigger one (T101).
  if (facts.full) parts.push(fullLabel(facts))
  // The `!`s over the boss desk, said in words: the menu-bar item says the same while the window
  // is closed, so the two readings of the floor are one (T117).
  if (facts.waitingOnYou > 0) parts.push(`${facts.waitingOnYou} waiting on you`)
  return parts.join(' · ')
}

export function AtWorkBadge({ atWork }: { atWork: number }) {
  return (
    <Badge className={LIVE_BADGE} data-live={atWork > 0 || undefined}>
      {atWork} at work
    </Badge>
  )
}

/** Presence stack, Sessions pill, Pause all, Hire Employee and the `…` menu. */
export function OfficeActions({
  facts,
  capacity,
  canPause,
  onPauseAll,
  paused,
  onResumeAll,
  onHire,
  outOfBudget,
}: OfficeHeaderProps) {
  const running = capacity?.running ?? 0
  return (
    <>
      {facts.presence.length > 0 && (
        <AvatarStack>
          {facts.presence.map((sprite) => (
            <Avatar
              key={sprite.employeeId}
              className={SOFT_INK}
              name={sprite.name}
              person={{ id: sprite.employeeId, sprite: sprite.sprite }}
              size={32}
              ring
            />
          ))}
          {facts.more > 0 && (
            <Avatar
              className={SOFT_INK}
              name={countLabel(facts.more, 'more Employee')}
              text={`+${facts.more}`}
              size={32}
              tone="neutral"
              ring
            />
          )}
        </AvatarStack>
      )}
      {capacity && (
        <span className={RUN_STATE} data-live={running > 0 || undefined} data-out-of-budget={outOfBudget || undefined}>
          <span className={RUN_DOT} aria-hidden />
          {running} / {capacity.concurrencyCap} Sessions running
        </span>
      )}
      {paused ? (
        <Button variant="outline" icon={Play} onClick={onResumeAll}>
          Resume all
        </Button>
      ) : (
        <Button variant="outline" icon={Pause} disabled={!canPause} onClick={onPauseAll}>
          Pause all
        </Button>
      )}
      <Button icon={UserRoundPlus} onClick={onHire}>
        Hire Employee
      </Button>
    </>
  )
}

/*
 * Top Bar: the shell header lays it out, and these are the Office's parts in it (T210f). `#cbd5e1`
 * is the design's soft ink on the office floor; no token names it, so it is written where it draws.
 *
 * The badge and the dot inside it are one element and its child, so the dot is reached with an
 * arbitrary variant naming the `data-slot` the kit puts on it (T216).
 */
const SOFT_INK = 'text-[#cbd5e1]'

const LIVE_BADGE =
  'bg-secondary text-[#cbd5e1] [&_[data-slot=badge-dot]]:bg-muted-foreground data-live:[&_[data-slot=badge-dot]]:bg-brand-success'

/** `2 / 6 Sessions running`: a quiet pill whose dot says whether any of them is up. */
const RUN_STATE =
  'flex shrink-0 items-center gap-8 whitespace-nowrap rounded-full bg-secondary py-7 pr-12 pl-10 font-semibold text-12/normal text-muted-foreground'

const RUN_DOT =
  'h-7 w-7 shrink-0 rounded-full bg-muted-foreground in-data-live:bg-brand-success in-data-out-of-budget:bg-destructive'
