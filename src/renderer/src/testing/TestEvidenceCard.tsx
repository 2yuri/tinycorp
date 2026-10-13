import { CircleCheck, CircleX, Eye, FlaskConical, GitMerge, MessageSquare, Play } from 'lucide-react'
import { evidenceBadge, type TestResult, type TestRun, testCounts } from '../../../shared/testing'
import { cx } from '../ui'
import { openTesting } from './open-testing'
import '../ui/tailwind.css'

/** The tick or cross beside a criterion, in the colour its result earns. */
const RESULT_INK: Record<TestResult, string> = {
  pass: 'text-brand-success',
  fail: 'text-brand-danger',
  pending: 'text-muted-foreground',
}

/** One round chip per check, with the frame's 6px dot in front of it. */
const CHECK =
  'inline-flex items-center gap-5 rounded-full bg-card px-9 py-2 text-11/[inherit] text-foreground before:size-6 before:rounded-[50%] before:bg-brand-success before:content-[""]'

/**
 * What a test attempt looks like in chat and in the Inbox (frame `vKIwf`): what the QA agent
 * verified, criterion by criterion, with its checks — not a verdict on its own.
 *
 * The three states of the frame are one card: in Both it is the boss's turn and the card offers
 * `Test it now`; in QA agent mode a pass says the merge is going ahead and offers nothing to press;
 * a fail is red, names the bug thread, and says the ticket went back to Doing.
 */
export function TestEvidenceCard({
  run,
  ticketLabel,
  agentName,
  compact,
}: {
  run: TestRun
  ticketLabel: string
  agentName: string | null
  /** The Inbox's row: the same card without its criteria list, which the screen has room for. */
  compact?: boolean
}) {
  const counts = testCounts(run)
  const failed = run.state === 'failed'
  const who = agentName ?? 'the QA agent'
  const open = () => openTesting({ ticketId: run.ticketId })
  return (
    <section
      className={cx(
        'mt-8 flex flex-col gap-10 rounded-sm border border-border border-l-3 bg-muted p-12',
        failed ? 'border-l-brand-danger' : 'border-l-brand-success',
      )}
      aria-label={`Test of ${ticketLabel}`}
    >
      <header className="flex items-center gap-7 text-12-5/[inherit] text-foreground">
        <FlaskConical size={14} aria-hidden />
        <strong>
          {run.agentVerdict ? `Tested by ${who}` : `Test ${ticketLabel}`} · {evidenceBadge(run)}
        </strong>
      </header>
      {!compact && (
        <ul className="m-0 flex list-none flex-col gap-8 p-0">
          {run.steps.map((step) => (
            <li key={step.id} className="flex gap-8 text-12-5/[inherit] text-foreground">
              {step.result === 'fail' ? (
                <CircleX size={13} className={RESULT_INK[step.result]} aria-hidden />
              ) : (
                <CircleCheck size={13} className={RESULT_INK[step.result]} aria-hidden />
              )}
              <span>
                <span className="block">{step.title}</span>
                {step.note && (
                  <span
                    className={cx(
                      'block text-11-5/[inherit]',
                      step.result === 'fail' ? 'text-brand-danger' : 'text-muted-foreground',
                    )}
                  >
                    {step.note}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {run.checks.length > 0 && (
        <div className="flex flex-wrap items-center gap-6 text-11-5/[inherit] text-muted-foreground">
          <span>Checks</span>
          {run.checks.map((check) => (
            <span key={check} className={CHECK}>
              {check}
            </span>
          ))}
        </div>
      )}
      <footer className="flex items-center gap-10 border-border border-t pt-8">
        {failed ? (
          <span className="inline-flex items-center gap-6 text-12/[inherit] text-muted-foreground">
            <MessageSquare size={13} aria-hidden /> Bug thread opened · {ticketLabel} moved to Doing
          </span>
        ) : run.state === 'passed' ? (
          <span className="inline-flex items-center gap-6 text-12/[inherit] text-muted-foreground">
            <GitMerge size={13} aria-hidden /> Testing passed → {ticketLabel} is ready to merge
          </span>
        ) : (
          <button
            type="button"
            className="inline-flex cursor-pointer items-center gap-6 rounded-sm border-0 bg-primary px-12 py-6 font-semibold text-12/[inherit] text-primary-foreground"
            onClick={open}
          >
            <Play size={13} aria-hidden /> {run.state === 'you' ? 'Test it now' : 'Open the test run'}
          </button>
        )}
        <button
          type="button"
          className="ml-auto inline-flex cursor-pointer items-center gap-6 border-0 bg-transparent text-12/[inherit] text-muted-foreground"
          onClick={open}
        >
          <Eye size={13} aria-hidden />
          {run.agentVerdict ? `Open evidence · ${counts.total} steps` : 'Open the script'}
        </button>
      </footer>
    </section>
  )
}
