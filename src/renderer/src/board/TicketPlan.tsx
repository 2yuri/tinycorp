import {
  Check,
  CircleAlert,
  FolderGit2,
  Hourglass,
  ListChecks,
  ListTree,
  MessagesSquare,
  Pause,
  Pencil,
  RotateCcw,
  Undo2,
} from 'lucide-react'
import { useState } from 'react'
import type { Ticket } from '../../../shared/domain/board'
import { BOSS } from '../../../shared/domain/chat'
import { answersSent, type Plan, planNextStep, unanswered } from '../../../shared/planning/planning'
import { repoLineText } from '../../../shared/repos/repo-line'
import { navigate } from '../chrome'
import { Badge, Button, cx, focusOnMount } from '../ui'
import { type BoardFacts, planOf } from './board-model'

/**
 * PLAN in the ticket drawer (frame `hZrUN`): who approved it and when, what it holds in one line
 * each, and the way into its planning thread. A replan draws what changed instead, with
 * Approve v2 / Keep v1 / Diff.
 */
/** The section label the drawer puts over every block. */
const SECTION_LABEL =
  'm-0 font-sans text-11/[normal] font-bold tracking-[0.5px] whitespace-nowrap text-muted-foreground uppercase'
/** The files a plan says it will touch, in mono. */
const CHANGES =
  'mx-0 mt-0 mb-8 list-none p-0 [&_li]:px-0 [&_li]:py-2 [&_li]:font-code [&_li]:text-11-5/[inherit] [&_li]:text-muted-foreground'

export function TicketPlan(props: {
  ticket: Ticket
  facts: BoardFacts
  repoName(id: string): string
  employeeName(id: string): string
}) {
  const plan = planOf(props.ticket.id, props.facts)
  const [error, setError] = useState<string | null>(null)
  const [diff, setDiff] = useState(false)
  const [replanning, setReplanning] = useState(false)
  const [reason, setReason] = useState('')
  if (!plan) return null

  const who = (id: string | null) => (id === null ? '' : id === BOSS ? 'you' : props.employeeName(id))
  const nextStep = planNextStep(plan, who(plan.plannerId) || 'the planner')

  const planning = window.tinyCorp.planning

  async function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    const result = await action()
    setError(result.ok ? null : (result.error ?? 'That did not go through'))
    if (result.ok) setReplanning(false)
  }

  return (
    <section className="px-20 pt-16 pb-0" aria-label="Plan">
      <div className="mb-8 flex items-baseline justify-between">
        <h4 className={SECTION_LABEL}>Plan</h4>
        <span className="text-11/[inherit] text-muted-foreground">
          {plan.status === 'replan' ? `v${plan.version - 1} → v${plan.version}` : `v${plan.version}`}
        </span>
      </div>
      <div
        className={cx(
          'rounded-md border bg-card p-12',
          plan.status === 'replan' ? 'border-brand-warning' : 'border-border',
        )}
      >
        <header className="mb-8 flex items-center gap-8">
          <span className="font-semibold text-12-5/[inherit] text-foreground">{headline(plan, who)}</span>
          <span className="flex-[1_1_0]" />
          <Badge variant={plan.status === 'approved' ? 'success' : 'neutral'}>
            {plan.status === 'approved' ? 'Ready' : plan.status === 'replan' ? 'Waiting on you' : statusLabel(plan)}
          </Badge>
        </header>

        {plan.status === 'replan' ? (
          <>
            <p className="mx-0 mt-0 mb-2 font-bold text-10/[inherit] text-brand-warning uppercase tracking-[0.06em]">
              Scope grew
            </p>
            <p className="mx-0 mt-0 mb-10 text-12-5/19 text-muted-foreground">{plan.replanReason}</p>
            <ul className={CHANGES}>
              {plan.replanChanges.map((change) => (
                <li key={change}>{change}</li>
              ))}
            </ul>
            <p className="mx-0 mt-0 mb-10 flex items-center gap-7 text-11-5/[inherit] text-brand-warning">
              <Pause size={13} aria-hidden />
              Back in Planning · {who(props.ticket.assigneeId)} paused, work kept on its worktree
            </p>
          </>
        ) : (
          <>
            {plan.goal && <p className="mx-0 mt-0 mb-10 text-12-5/19 text-muted-foreground">{plan.goal}</p>}
            <dl className="m-0 flex flex-col">
              <Row icon={<ListChecks size={14} aria-hidden />} label="Acceptance criteria">
                {plan.acceptanceCriteria.length === 0 ? 'none' : `0 / ${plan.acceptanceCriteria.length} met`}
              </Row>
              <Row icon={<ListTree size={14} aria-hidden />} label="Subtasks">
                {plan.subtasks.length}
              </Row>
              {plan.repos.length > 0 && (
                <Row icon={<FolderGit2 size={14} aria-hidden />} label={repoLineText(plan.repos.map(props.repoName))}>
                  {plan.repos.length} {plan.repos.length === 1 ? 'repo' : 'repos'}
                </Row>
              )}
              {plan.risks.length > 0 && (
                <Row icon={<CircleAlert size={14} aria-hidden />} label="Risks">
                  {plan.risks.length}
                </Row>
              )}
            </dl>
          </>
        )}

        {diff && (
          <ul className={cx(CHANGES, 'border-border border-t pt-8')}>
            {plan.replanChanges.map((change) => (
              <li key={change}>{change}</li>
            ))}
          </ul>
        )}

        {/* What happens next. A replan already says it in its own words, above. */}
        {plan.status !== 'replan' && nextStep !== null && (
          <p className="mx-0 mt-0 mb-10 flex items-center gap-7 text-11-5/[inherit] text-muted-foreground">
            <Hourglass size={13} aria-hidden />
            {nextStep}
          </p>
        )}

        <footer className="flex items-center gap-8 border-border border-t pt-10">
          {plan.status === 'replan' ? (
            <>
              <Button size="sm" icon={Check} onClick={() => void run(() => planning.approve(plan.id))}>
                Approve v{plan.version} → Ready
              </Button>
              <Button size="sm" variant="secondary" icon={Undo2} onClick={() => void run(() => planning.keep(plan.id))}>
                Keep v{plan.version - 1}
              </Button>
              <span className="flex-[1_1_0]" />
              <button
                type="button"
                className="inline-flex cursor-pointer items-center gap-6 border-0 bg-transparent p-0 font-[inherit] text-11-5/[inherit] text-muted-foreground hover:text-foreground"
                aria-pressed={diff}
                onClick={() => setDiff((open) => !open)}
              >
                <RotateCcw size={13} aria-hidden />
                Diff
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="inline-flex cursor-pointer items-center gap-6 border-0 bg-transparent p-0 font-[inherit] text-11-5/[inherit] text-muted-foreground hover:text-foreground"
                onClick={() => navigate({ view: 'chat', channelId: plan.channelId })}
              >
                <MessagesSquare size={13} aria-hidden />
                Planning thread
              </button>
              <span className="flex-[1_1_0]" />
              {/* Both open the planning thread: the plan is written there, by the planner (T171). */}
              <button
                type="button"
                className="inline-flex cursor-pointer items-center gap-6 border-0 bg-transparent p-0 font-[inherit] text-11-5/[inherit] text-muted-foreground hover:text-foreground"
                onClick={() => navigate({ view: 'chat', channelId: plan.channelId })}
              >
                <Pencil size={13} aria-hidden />
                Edit
              </button>
              {plan.status === 'approved' && props.ticket.id > 0 && (
                <button
                  type="button"
                  className="inline-flex cursor-pointer items-center gap-6 border-0 bg-transparent p-0 font-[inherit] text-11-5/[inherit] text-muted-foreground hover:text-foreground"
                  onClick={() => setReplanning(true)}
                >
                  <RotateCcw size={13} aria-hidden />
                  Replan
                </button>
              )}
            </>
          )}
        </footer>
        {replanning && (
          <form
            className="flex items-center gap-8 pt-10 [&_input]:h-30 [&_input]:min-w-0 [&_input]:flex-[1_1_0] [&_input]:rounded-sm [&_input]:border [&_input]:border-border [&_input]:bg-muted [&_input]:px-10 [&_input]:py-0 [&_input]:font-[inherit] [&_input]:text-12/[inherit] [&_input]:text-foreground"
            onSubmit={(event) => {
              event.preventDefault()
              void run(() => planning.replan(props.ticket.id, reason.trim()))
            }}
          >
            <input
              ref={focusOnMount}
              aria-label="Why the plan has to change"
              placeholder="What changed?"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            <Button type="submit" size="sm" disabled={!reason.trim()}>
              Replan
            </Button>
            <Button size="sm" variant="outline" onClick={() => setReplanning(false)}>
              Cancel
            </Button>
          </form>
        )}
      </div>
      {error && (
        <p className="mx-24 mt-12 mb-0 text-13/[inherit] text-status-error-foreground" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}

function Row(props: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-8 border-border border-t px-0 py-5 text-12/[inherit] text-muted-foreground [&_dd]:m-0 [&_dd]:font-code [&_dd]:text-11/[inherit] [&_dt]:min-w-0 [&_dt]:flex-[1_1_0] [&_dt]:text-foreground">
      {props.icon}
      <dt>{props.label}</dt>
      <dd>{props.children}</dd>
    </div>
  )
}

/** `Approved by you · Tue 09:21`, `Self-approved by Nova`, or who is still working on it. */
function headline(plan: Plan, who: (id: string | null) => string): string {
  const planner = who(plan.plannerId) || 'the planner'
  if (plan.status === 'approved') {
    const when = plan.approvedAt
      ? ` · ${new Date(plan.approvedAt).toLocaleString('en-US', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })}`
      : ''
    return plan.approvedBy === BOSS ? `Approved by you${when}` : `Self-approved by ${who(plan.approvedBy)}${when}`
  }
  if (plan.status === 'replan') return `Replan requested by ${who(plan.replanBy)}`
  // Nothing is drafted yet in either of these: saying "Drafted by Nova" is what made an answered
  // plan read as a finished one (T233).
  if (answersSent(plan)) return `Answers sent to ${planner}`
  if (unanswered(plan).length > 0) return `${planner} is asking you`
  return plan.messageId === null ? `${planner} is drafting it` : `Drafted by ${planner}`
}

function statusLabel(plan: Plan): string {
  if (plan.status === 'waiting' || unanswered(plan).length > 0) return 'Waiting on you'
  return answersSent(plan) ? 'Answers sent' : 'Planning'
}
