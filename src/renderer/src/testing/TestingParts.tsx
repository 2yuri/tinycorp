import {
  Bug,
  Camera,
  Check,
  CircleCheck,
  CircleX,
  ExternalLink,
  FlaskConical,
  Paperclip,
  Play,
  Plus,
  Square,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { clockTime } from '../../../shared/platform/clock-time'
import {
  type AppRun,
  evidenceBadge,
  type RunnableRepo,
  type TestResult,
  type TestRun,
  type TestStep,
  testCounts,
} from '../../../shared/testing'
import { Button, cx } from '../ui'
import {
  actionBarLine,
  bossCanTest,
  canPassNow,
  passRefusal,
  runMeta,
  scriptSource,
  scriptSummary,
  stepTag,
  stepVerdictLine,
} from './testing-model'

/*
 * The frame's tint for a pass or a fail: the token mixed down to a wash, in sRGB. `bg-status-*` with
 * an opacity modifier would say the same thing in oklab, which is a different colour, so the mix is
 * written out.
 */
const SUCCESS_WASH = 'bg-[color-mix(in_srgb,var(--color-success)_55%,transparent)]'
const SUCCESS_WASH_50 = 'bg-[color-mix(in_srgb,var(--color-success)_50%,transparent)]'
const SUCCESS_WASH_65 = 'bg-[color-mix(in_srgb,var(--color-success)_65%,transparent)]'
const ERROR_WASH = 'bg-[color-mix(in_srgb,var(--color-error)_55%,transparent)]'
const ERROR_WASH_50 = 'bg-[color-mix(in_srgb,var(--color-error)_50%,transparent)]'
const ERROR_WASH_65 = 'bg-[color-mix(in_srgb,var(--color-error)_65%,transparent)]'

/** The label over a block of the screen: the frame's 11/700 muted caps. */
export const SECTION_LABEL = 'm-0 text-11/[inherit] font-bold text-muted-foreground uppercase tracking-[0.08em]'
/** A button that is only its label: the log toggle, `More`, `+ Add step`, the panel's own. */
const QUIET_BUTTON = 'cursor-pointer border-0 bg-transparent text-12/[inherit] text-muted-foreground'
/** A line of prose that is not the thing itself. */
const QUIET = 'text-12/[inherit] text-muted-foreground'
/** The play/stop square. Whether it is running decides its colour, so that is not in here. */
const RUN_PLAY = 'flex size-34 cursor-pointer items-center justify-center rounded-sm border'
/** The running/stopped pill, likewise without its colour. */
const RUN_STATE = 'inline-flex items-center gap-6 rounded-full px-9 py-2 text-11/[inherit] font-semibold'
/** The 6px dot the frame puts in front of a chip. */
const DOT_BEFORE = 'before:size-6 before:rounded-[50%] before:content-[""]'
/** One criterion card. Its left edge says the verdict, so that colour is chosen per step. */
const STEP = 'flex gap-12 rounded-md border border-border border-l-3 bg-card p-12'
/** The numbered circle, without the tint a decided step gives it. */
const STEP_MARK = 'flex size-24 shrink-0 items-center justify-center rounded-[50%] text-12/[inherit] font-semibold'
/** `Attach`, `Capture`: a button that is only its label, with room for an icon. */
const STEP_ACTION =
  'inline-flex cursor-pointer items-center gap-5 border-0 bg-transparent text-12/[inherit] text-muted-foreground disabled:cursor-default disabled:opacity-45'
/** `Pass` / `Fail`, without the colour the chosen one takes. */
const VERDICT =
  'inline-flex cursor-pointer items-center gap-5 rounded-sm border px-11 py-5 text-12/[inherit] font-semibold disabled:cursor-default disabled:opacity-40'
const VERDICT_OFF = 'border-border bg-transparent text-muted-foreground'
/** The panel's tabs, without the underline the open one wears. */
const PANEL_TAB = 'cursor-pointer border-0 bg-transparent text-13/[inherit] font-semibold'
/** The label over a block of the panel. */
const PANEL_H3 = 'mx-0 mt-0 mb-6 text-11/[inherit] font-bold text-muted-foreground uppercase tracking-[0.06em]'
/** A chip in the panel, before its dot. */
const CHIP = 'inline-flex items-center gap-5 rounded-full bg-secondary px-9 py-2 text-11/[inherit] text-soft-ink'
/** The card's left edge, which is the verdict. `pending` leaves the border where the card set it. */
const STEP_EDGE: Record<TestResult, string> = {
  pass: 'border-l-status-success-foreground',
  fail: 'border-l-status-error-foreground',
  pending: '',
}
/** A decided step fills its circle and drops the outline; an undecided one keeps it. */
const STEP_MARK_INK: Record<TestResult, string> = {
  pass: cx('border border-transparent', SUCCESS_WASH_65, 'text-status-success-foreground'),
  fail: cx('border border-transparent', ERROR_WASH_65, 'text-status-error-foreground'),
  pending: 'border border-border text-muted-foreground',
}
/** The tick or cross the agent left beside a check. */
const CHECK_INK: Record<TestResult, string> = {
  pass: 'text-status-success-foreground',
  fail: 'text-status-error-foreground',
  pending: 'text-muted-foreground',
}
/** The timeline's bullet, by how far the ticket has got. */
const EVENT_DOT: Record<'done' | 'now' | 'next', string> = {
  done: 'bg-status-success-foreground',
  now: 'bg-status-warning-foreground',
  next: 'bg-muted-foreground',
}

const now = () => new Date()
const clock = (iso: string) => clockTime(new Date(iso), now())

/**
 * The Run it row (frame `BRzY6`): the repo's run command in the ticket's worktree, with the Log
 * toggle, Stop and Open, and a one-line strip of its output under it.
 */
export function RunIt({
  repo,
  log,
  logOpen,
  busy,
  onStart,
  onStop,
  onToggleLog,
  className,
}: {
  repo: RunnableRepo
  log: string[]
  logOpen: boolean
  busy: boolean
  onStart(): void
  onStop(): void
  onToggleLog(): void
  /** The gap to the run above, which is the list's to give: `.testing-run + .testing-run`. */
  className?: string | undefined
}) {
  const run: AppRun | null = repo.run
  const running = run?.state === 'running'
  return (
    <div className={cx('rounded-md border border-border bg-card', className)} data-repo={repo.repoName}>
      <div className="flex items-center gap-12 p-12">
        <button
          type="button"
          className={cx(
            RUN_PLAY,
            running
              ? cx('border-status-success-foreground', SUCCESS_WASH, 'text-status-success-foreground')
              : 'border-border bg-secondary text-foreground',
          )}
          onClick={running ? onStop : onStart}
          disabled={busy}
          aria-label={running ? `Stop ${repo.repoName}` : `Run ${repo.repoName}`}
        >
          {running ? <Square size={16} /> : <Play size={16} />}
        </button>
        <div className="flex min-w-0 flex-[1_1_0] flex-col gap-2">
          <div className="flex items-center gap-8 text-14/[inherit]">
            <strong>{repo.repoName}</strong>
            <span className="font-code text-12/[inherit] text-soft-ink">{repo.command}</span>
            <span
              className={cx(
                RUN_STATE,
                running
                  ? cx(
                      SUCCESS_WASH,
                      'text-status-success-foreground',
                      DOT_BEFORE,
                      'before:bg-status-success-foreground',
                    )
                  : 'bg-secondary text-muted-foreground',
              )}
            >
              {running ? 'Running' : run ? 'Stopped' : 'Not running'}
            </span>
          </div>
          <div className="overflow-hidden text-ellipsis whitespace-nowrap text-12/[inherit] text-muted-foreground">
            {runMeta(run, (id) => id, clock) ?? repo.cwd}
          </div>
        </div>
        <button
          type="button"
          className={cx(QUIET_BUTTON, 'aria-pressed:text-foreground')}
          onClick={onToggleLog}
          aria-pressed={logOpen}
        >
          Log
        </button>
        <Button variant="secondary" size="sm" onClick={onStop} disabled={!running || busy}>
          <Square size={14} /> Stop
        </Button>
        {/* The system browser opens it, through the window's own open handler; never an app window. */}
        <a
          className={cx(
            'inline-flex items-center gap-6 rounded-sm bg-primary px-12 py-7 font-semibold text-13/[inherit] text-primary-foreground no-underline',
            (!running || repo.url === null) && 'pointer-events-none opacity-45',
          )}
          href={repo.url ?? '#'}
          target="_blank"
          rel="noreferrer"
          aria-disabled={!running || repo.url === null}
          onClick={(event) => {
            if (!running || repo.url === null) event.preventDefault()
          }}
        >
          <ExternalLink size={14} /> Open {repo.port === null ? 'the app' : `localhost:${repo.port}`}
        </a>
      </div>
      {logOpen ? (
        <pre className="m-0 max-h-180 overflow-auto whitespace-pre-wrap border-border border-t p-12 font-code text-12/[1.6] text-soft-ink">
          {log.join('\n') || 'Nothing yet.'}
        </pre>
      ) : (
        <div className="flex items-center gap-12 border-border border-t px-12 py-8 font-code text-12/[inherit] text-muted-foreground">
          <span className="flex-[1_1_0] overflow-hidden text-ellipsis whitespace-nowrap">
            {run?.lastLine || 'No output yet.'}
          </span>
          <button type="button" className={QUIET_BUTTON} onClick={onToggleLog}>
            Show log · {run?.lines ?? 0} lines
          </button>
        </div>
      )}
    </div>
  )
}

/** One step of the script, with Pass / Fail, its note and what is attached to it. */
export function StepCard({
  step,
  number,
  canTest,
  nameOf,
  thumbnails,
  onResult,
  onNote,
  onAttach,
  onPaste,
  onCapture,
  canCapture,
}: {
  step: TestStep
  number: number
  canTest: boolean
  nameOf(id: string): string
  thumbnails: Record<number, string>
  onResult(result: 'pass' | 'fail'): void
  onNote(note: string): void
  onAttach(): void
  /** Files pasted into the step's note: a screenshot from the clipboard is attached to it. */
  onPaste(files: File[]): void
  onCapture(): void
  canCapture: boolean
}) {
  const [note, setNote] = useState(step.note)
  const tag = stepTag(step, nameOf)
  const verdict = stepVerdictLine(step, nameOf, clock)
  return (
    <li className={cx(STEP, STEP_EDGE[step.result])}>
      <div className={cx(STEP_MARK, STEP_MARK_INK[step.result])} aria-hidden>
        {step.result === 'pass' ? <Check size={14} /> : step.result === 'fail' ? <X size={14} /> : number}
      </div>
      <div className="flex min-w-0 flex-[1_1_0] flex-col gap-6">
        <div className="flex items-start gap-12">
          <h3 className="m-0 flex-[1_1_0] font-semibold text-14/[inherit]">{step.title}</h3>
          <div className="flex gap-6">
            <button
              type="button"
              className={cx(
                VERDICT,
                step.result === 'pass'
                  ? cx('border-status-success-foreground', SUCCESS_WASH_50, 'text-status-success-foreground')
                  : VERDICT_OFF,
              )}
              disabled={!canTest}
              onClick={() => onResult('pass')}
            >
              <Check size={13} /> Pass
            </button>
            <button
              type="button"
              className={cx(
                VERDICT,
                step.result === 'fail'
                  ? cx('border-status-error-foreground', ERROR_WASH_50, 'text-status-error-foreground')
                  : VERDICT_OFF,
              )}
              disabled={!canTest}
              onClick={() => onResult('fail')}
            >
              <X size={13} /> Fail
            </button>
          </div>
        </div>
        {step.detail && <p className="m-0 text-12-5/[inherit] text-muted-foreground">{step.detail}</p>}
        <div className="flex flex-wrap items-center gap-8">
          {tag && (
            <span className="rounded-sm bg-secondary px-8 py-2 font-semibold text-11/[inherit] text-muted-foreground">
              {tag}
            </span>
          )}
          {verdict && <span className={QUIET}>{verdict}</span>}
          {step.result === 'pass' && step.note && <span className={QUIET}>“{step.note}”</span>}
        </div>
        {step.result === 'fail' && step.note && !canTest && (
          <p className="m-0 rounded-sm border border-border bg-secondary px-10 py-8 text-12-5/[inherit] text-soft-ink">
            {step.note}
          </p>
        )}
        {((canTest && step.result !== 'pass') || step.attachments.length > 0) && (
          <div className="flex items-start gap-12">
            <div className="flex min-w-0 flex-[1_1_0] flex-col gap-6">
              {canTest && step.result !== 'pass' && (
                <textarea
                  className="min-h-34 w-full resize-y rounded-sm border border-border bg-input px-10 py-8 text-13/[inherit] text-foreground"
                  rows={1}
                  value={note}
                  placeholder={`Add a note${step.result === 'fail' ? ' for the assignee' : ''}…`}
                  onChange={(event) => setNote(event.target.value)}
                  onBlur={() => note !== step.note && onNote(note)}
                  onPaste={(event) => {
                    // A screenshot in the clipboard is the fastest evidence there is: keep it,
                    // and let anything else the clipboard holds paste as text.
                    const files = [...event.clipboardData.files]
                    if (files.length === 0) return
                    event.preventDefault()
                    onPaste(files)
                  }}
                />
              )}
              {canTest && step.result !== 'pass' && (
                <div className="flex flex-wrap items-center gap-12">
                  <button type="button" className={STEP_ACTION} onClick={onAttach}>
                    <Paperclip size={13} /> {step.attachments.length > 0 ? 'Attach another' : 'Attach screenshot'}
                  </button>
                  <button
                    type="button"
                    className={STEP_ACTION}
                    onClick={onCapture}
                    disabled={!canCapture}
                    title={canCapture ? undefined : 'Start the app first'}
                  >
                    <Camera size={13} /> Capture the running app
                  </button>
                  {step.result === 'fail' && (
                    <span className={QUIET}>Goes to the assignee as a bug thread when you report it</span>
                  )}
                </div>
              )}
            </div>
            {step.attachments.length > 0 && (
              <ul className="m-0 flex list-none gap-8 p-0">
                {step.attachments.map((attachment) => (
                  <li key={attachment.id} className="flex w-132 flex-col gap-4">
                    {thumbnails[attachment.id] ? (
                      <img
                        src={thumbnails[attachment.id]}
                        alt={attachment.name}
                        className="block h-84 w-132 rounded-sm border border-border bg-secondary object-cover"
                      />
                    ) : (
                      <span
                        className="block h-84 w-132 rounded-sm border border-border bg-secondary object-cover"
                        aria-hidden
                      />
                    )}
                    <span className="overflow-hidden text-ellipsis whitespace-nowrap font-code text-10/[inherit] text-muted-foreground">
                      {attachment.name}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </li>
  )
}

/** The script's header: how many steps, where they came from, and how far they have got. */
export function ScriptHeader({
  run,
  agentName,
  canTest,
  onAddStep,
}: {
  run: TestRun | null
  agentName: string | null
  canTest: boolean
  onAddStep(): void
}) {
  const counts = testCounts(run ?? { steps: [] })
  return (
    <div className="flex items-center gap-8 pb-8">
      <h2 className={SECTION_LABEL}>
        Test script · {counts.total} {counts.total === 1 ? 'step' : 'steps'}
      </h2>
      <span className="text-12/[inherit] text-muted-foreground">{scriptSource(run, agentName)}</span>
      <span className="flex-[1_1_0]" />
      <span className="text-12/[inherit] text-muted-foreground">{scriptSummary(run ?? { steps: [] })}</span>
      {canTest && (
        <button type="button" className={cx(QUIET_BUTTON, 'inline-flex items-center gap-4')} onClick={onAddStep}>
          <Plus size={14} /> Add step
        </button>
      )}
    </div>
  )
}

/** The panel on the right: what the QA agent verified, its checks, its shots, and what is next. */
export function EvidencePanel({
  run,
  mode,
  agentName,
  timeline,
  onChangeMode,
  onOpenReview,
  onClose,
}: {
  run: TestRun | null
  mode: string
  agentName: string | null
  timeline: { tone: 'done' | 'now' | 'next'; title: string; detail: string; at: string | null }[]
  onChangeMode(): void
  onOpenReview(): void
  onClose(): void
}) {
  const counts = testCounts(run ?? { steps: [] })
  return (
    <aside
      className="flex w-348 shrink-0 flex-col gap-12 overflow-auto border-border border-l bg-card p-16"
      aria-label="Agent evidence"
    >
      <header className="flex items-center gap-12 border-border border-b pb-8">
        <span
          className={cx(PANEL_TAB, '-mb-10 cursor-default border-b-2 border-b-primary pb-6 text-primary-foreground')}
        >
          Agent evidence
        </span>
        <button type="button" className={cx(PANEL_TAB, 'text-muted-foreground')} onClick={onOpenReview}>
          Review
        </button>
        <span className="flex-[1_1_0]" />
        <button
          type="button"
          className="cursor-pointer border-0 bg-transparent text-muted-foreground"
          onClick={onClose}
          aria-label="Close"
        >
          <X size={16} />
        </button>
      </header>
      <div className="flex items-center gap-8 rounded-sm border border-border bg-secondary px-10 py-8 text-12/[inherit] text-soft-ink">
        <span className="flex-[1_1_0]">{mode}</span>
        <button type="button" className={QUIET_BUTTON} onClick={onChangeMode}>
          Change
        </button>
      </div>
      {run?.agentVerdict ? (
        <>
          <div>
            <div className="flex items-center gap-8 text-13/[inherit]">
              <strong>Tested by {agentName ?? 'the QA agent'}</strong>
              <span
                className={cx(
                  'ml-auto rounded-full px-9 py-2 font-semibold text-11/[inherit]',
                  run.agentVerdict === 'pass'
                    ? cx(SUCCESS_WASH, 'text-status-success-foreground')
                    : cx(ERROR_WASH, 'text-status-error-foreground'),
                )}
              >
                {evidenceBadge(run)}
              </span>
            </div>
            <p className="mx-0 mt-6 mb-0 text-13/[inherit] text-soft-ink italic">“{run.agentSummary}”</p>
          </div>
          <section>
            <h3 className={PANEL_H3}>What {agentName ?? 'the agent'} verified</h3>
            <ul className="m-0 flex list-none flex-col gap-6 p-0">
              {run.steps.map((step, index) => (
                <li key={step.id} className="flex gap-8 text-12-5/[inherit] text-soft-ink">
                  {step.result === 'fail' ? (
                    <CircleX size={14} className={CHECK_INK[step.result]} />
                  ) : (
                    <CircleCheck size={14} className={CHECK_INK[step.result]} />
                  )}
                  <span>
                    {step.title}
                    {/* What the boss overturned after the agent's pass, and where to find it. */}
                    {run.agentVerdict === 'pass' && step.result === 'fail' && (
                      <em className="text-status-warning-foreground not-italic">
                        {' '}
                        You failed this one{step.testedAt ? ` at ${clock(step.testedAt)}` : ''} · step {index + 1}
                      </em>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </section>
          {run.checks.length > 0 && (
            <section>
              <h3 className={PANEL_H3}>Checks on the worktree</h3>
              <div className="flex flex-wrap gap-6">
                {run.checks.map((check) => (
                  <span key={check} className={cx(CHIP, DOT_BEFORE, 'before:bg-status-success-foreground')}>
                    {check}
                  </span>
                ))}
              </div>
            </section>
          )}
        </>
      ) : (
        <div className="flex flex-col gap-6 rounded-sm border border-border border-dashed p-12 text-12-5/[inherit] text-muted-foreground">
          <FlaskConical size={18} />
          <p className="m-0">
            {run?.state === 'agent'
              ? `${agentName ?? 'The QA agent'} is testing this now. Its evidence lands here.`
              : 'No agent evidence on this one: it is yours to test.'}
          </p>
          <p className={QUIET}>
            {counts.total} {counts.total === 1 ? 'step' : 'steps'} from the plan’s acceptance criteria.
          </p>
        </div>
      )}
      <section>
        <h3 className={PANEL_H3}>Before merge</h3>
        <ol className="m-0 flex list-none flex-col gap-8 p-0">
          {timeline.map((entry) => (
            <li key={entry.title} className="flex items-start gap-8 text-12-5/[inherit]">
              <span className={cx('mt-5 size-8 rounded-[50%]', EVENT_DOT[entry.tone])} aria-hidden />
              <div>
                <strong className="block font-semibold">{entry.title}</strong>
                <span className="text-11-5/[inherit] text-muted-foreground">{entry.detail}</span>
              </div>
              <span className="ml-auto text-11-5/[inherit] text-muted-foreground">{entry.at ?? '—'}</span>
            </li>
          ))}
        </ol>
      </section>
    </aside>
  )
}

/** The bar along the bottom: what the merge is waiting for, and the two things the boss can do. */
export function TestingActions({
  run,
  busy,
  onReportBug,
  onPass,
}: {
  run: TestRun | null
  busy: boolean
  onReportBug(): void
  onPass(): void
}) {
  const refusal = passRefusal(run)
  return (
    <footer className="flex items-center gap-12 border-border border-t bg-card px-24 py-12">
      <div className="flex flex-[1_1_0] flex-col">
        <strong className="text-13/[inherit]">
          {run?.state === 'passed' ? 'Testing passed · the merge can go ahead' : 'Merge waits for Testing to pass'}
        </strong>
        <span className="text-12/[inherit] text-muted-foreground">{actionBarLine(run)}</span>
      </div>
      <Button
        variant="destructive"
        onClick={onReportBug}
        disabled={!bossCanTest(run) || busy || testCounts(run ?? { steps: [] }).failed === 0}
        title={
          testCounts(run ?? { steps: [] }).failed === 0 ? 'Mark the step that failed first, with a note' : undefined
        }
      >
        <Bug size={15} /> Report bug → back to Doing
      </Button>
      <Button onClick={onPass} disabled={!canPassNow(run) || busy} title={refusal ?? undefined}>
        <Check size={15} /> Pass testing → ready to merge
      </Button>
    </footer>
  )
}
