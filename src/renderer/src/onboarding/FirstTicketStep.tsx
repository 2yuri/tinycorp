import { ChevronRight, CornerDownLeft, FolderGit2, SquareDashed, UserRound } from 'lucide-react'
import type { RoleTemplate } from '../../../shared/domain/staff'
import { GOAL_SUGGESTIONS } from '../../../shared/onboarding'
import { draftIntakeHolder, type RosterDraft, wizardCatalog } from '../../../shared/staff/roster-draft'
import { resources, useIpcResource } from '../ipc'
import { focusOnMount } from '../ui'
import '../ui/tailwind.css'

/*
 * The First-ticket step's classes (T210c), off frame `Desktop App / Onboarding / First Ticket`.
 * `field-sizing: content` has no utility and is written as the property it is; the prompt's lift
 * is `--elevation-prompt`, added in T210c for the one shadow in the app that was a bare hex.
 */
const STEP = 'flex w-720 max-w-full shrink-0 flex-col'
const PROMPT = 'flex flex-col gap-16 rounded-md border border-primary bg-card p-17 shadow-prompt'
const GOAL =
  'm-0 block min-h-44 w-full resize-none border-0 bg-transparent p-0 font-sans text-foreground text-14-5/22 outline-none [field-sizing:content] placeholder:text-muted-foreground'
const ROW = 'flex items-center gap-8'
const TAG =
  'flex shrink-0 items-center gap-6 rounded-full bg-secondary px-10 py-5 whitespace-nowrap text-soft-ink text-11/[normal] font-semibold [&_svg]:shrink-0 [&_svg]:text-muted-foreground'
const TAG_REPO =
  'flex shrink-0 items-center gap-6 rounded-full bg-secondary px-10 py-5 font-code whitespace-nowrap text-soft-ink text-11/[normal] font-semibold [&_svg]:shrink-0 [&_svg]:text-muted-foreground'
const SUGGESTIONS = 'mt-14 flex flex-wrap justify-center gap-8'
const SUGGESTION =
  'm-0 flex cursor-pointer items-center gap-6 rounded-full border border-border bg-card px-11 py-6 font-sans whitespace-nowrap text-soft-ink text-11-5/[normal] font-semibold [&:hover:not(:disabled)]:border-muted-foreground focus-visible:shadow-focus focus-visible:outline-none disabled:cursor-default disabled:opacity-50 [&_svg]:shrink-0 [&_svg]:text-muted-foreground'
const OR = 'mt-22 flex items-center gap-12 text-muted-foreground text-11-5/[normal]'
const RULE = 'm-0 h-1 flex-1 border-0 bg-border'
const EMPTY =
  'mt-14 mr-0 mb-0 ml-0 flex w-full cursor-pointer items-center gap-12 rounded-sm border border-border bg-card px-15 py-12 text-left font-sans text-[length:inherit] text-inherit [&:hover:not(:disabled)]:border-muted-foreground focus-visible:shadow-focus focus-visible:outline-none disabled:cursor-default disabled:opacity-50 [&_svg]:shrink-0 [&_svg]:text-muted-foreground'
const EMPTY_TEXT = 'flex min-w-0 flex-1 flex-col gap-2'
const EMPTY_TITLE = 'whitespace-nowrap text-foreground text-13/[normal] font-semibold'
const EMPTY_SUB = 'text-muted-foreground text-11-5/[normal]'

export interface FirstTicketStepViewProps {
  goal: string
  onGoal(goal: string): void
  /** The first connected repo's name, and how many more there are; null with none. */
  repo: { name: string; more: number } | null
  /** The draft's intake holder, who plans the goal; null when nobody takes intake. */
  planner: string | null
  onEmptyBoard(): void
  /** Finish is running: the step's actions wait. */
  busy?: boolean
}

/** The chip under the goal: who turns it into tickets. */
export function plannerLabel(planner: string | null): string {
  return planner ? `${planner} plans it` : 'Posted in #general'
}

/** Step 5, First ticket (design/html/onboarding-first-ticket.html, frame `Desktop App / Onboarding / First Ticket`). */
export function FirstTicketStepView(props: FirstTicketStepViewProps) {
  return (
    <div className={STEP}>
      <div className={PROMPT}>
        <textarea
          className={GOAL}
          aria-label="First goal"
          placeholder="Describe the outcome in a sentence"
          rows={2}
          ref={focusOnMount}
          value={props.goal}
          disabled={props.busy}
          onChange={(event) => props.onGoal(event.target.value)}
        />
        <div className={ROW}>
          {props.repo && (
            <span className={TAG_REPO} data-tag="repo">
              <FolderGit2 size={12} aria-hidden />
              {props.repo.name}
              {props.repo.more > 0 && ` +${props.repo.more}`}
            </span>
          )}
          <span className={TAG}>
            <UserRound size={12} aria-hidden />
            {plannerLabel(props.planner)}
          </span>
        </div>
      </div>

      <fieldset className={SUGGESTIONS} aria-label="Suggested goals">
        {GOAL_SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            className={SUGGESTION}
            disabled={props.busy}
            onClick={() => props.onGoal(suggestion)}
          >
            <CornerDownLeft size={12} aria-hidden />
            {suggestion}
          </button>
        ))}
      </fieldset>

      <div className={OR}>
        <hr className={RULE} />
        <span>or</span>
        <hr className={RULE} />
      </div>

      <button type="button" className={EMPTY} disabled={props.busy} onClick={props.onEmptyBoard}>
        <SquareDashed size={16} aria-hidden />
        <span className={EMPTY_TEXT}>
          <span className={EMPTY_TITLE}>Open with an empty board</span>
          <span className={EMPTY_SUB}>The team clocks in and waits. You can drop a ticket whenever you are ready.</span>
        </span>
        <ChevronRight size={16} aria-hidden />
      </button>
    </div>
  )
}

export interface FirstTicketStepProps {
  goal: string
  onGoal(goal: string): void
  roster: RosterDraft
  onEmptyBoard(): void
  busy?: boolean
}

/** The First ticket step bound to the engine: it reads the catalog and repos, and writes nothing. */
export function FirstTicketStep({ roster, ...props }: FirstTicketStepProps) {
  const catalog = useCatalog()
  const repo = useFirstRepo()
  return <FirstTicketStepView {...props} repo={repo} planner={draftPlanner(roster, catalog)} />
}

/** The intake holder's name as the step shows it, or null. */
export function draftPlanner(roster: RosterDraft, catalog: RoleTemplate[]): string | null {
  const holder = draftIntakeHolder(roster, catalog)
  return holder ? holder.name.trim() || holder.role : null
}

/** The wizard's roles: the Company's own and the built-ins it has not taken yet (T240). */
export function useCatalog(): RoleTemplate[] {
  return wizardCatalog(useIpcResource(resources.roles))
}

function useFirstRepo(): FirstTicketStepViewProps['repo'] {
  const [first, ...rest] = useIpcResource(resources.repos)
  return first ? { name: first.name, more: rest.length } : null
}
