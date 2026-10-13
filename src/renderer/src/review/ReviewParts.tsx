import {
  Check,
  CircleCheck,
  CircleDashed,
  CircleX,
  CornerDownRight,
  ExternalLink,
  FileCode,
  MessageSquare,
  ShieldCheck,
  Undo2,
  UserCheck,
} from 'lucide-react'
import { type ReactNode, useRef, useState } from 'react'
import type { PullRequestCheck, PullRequestCheckState, PullRequestDetails } from '../../../shared/code'
import type { Employee } from '../../../shared/domain/staff'
import type { Review } from '../../../shared/review'
import { countsLabel, type DiffFile, type FileSides, type ReviewComment } from '../../../shared/review/review-diff'
import { type ReviewThread, threadAnchor } from '../../../shared/review/review-threads'
import {
  blockingFindings,
  findingsLine,
  riskLine,
  SEVERITY_LABEL,
  type SecurityPass,
  type SecurityTone,
  securityChip,
} from '../../../shared/review/security'
import { DiffControlBar, type DiffControls, DiffEditor, type DiffMark } from '../editor'
import { PersonAvatar } from '../people'
import { cx } from '../ui'
import { CommentRow, CommentThread, Composer } from './ReviewComments'
import { LineThreads, type ThreadActions, type ThreadPeople } from './ReviewThreads'
import {
  branchLine,
  type DiffSummary,
  durationLabel,
  type FileRow,
  fileRows,
  filesCaption,
  firstOpenThread,
  forgeLine,
  mergeabilityLabel,
  reviewerCardLine,
  roundTimeline,
  threadsProgress,
  unresolvedLabel,
  verdictPill,
} from './review-model'

/** Left column: every changed file with its counts, its comment count and a viewed tick. */
export function FileList(props: {
  files: DiffFile[]
  comments: ReviewComment[]
  viewed: ReadonlySet<string>
  activePath: string | null
  onPick(path: string): void
  /** The pointer resting on a row, so its diff can be fetched before the click lands (T243). */
  onHover?(path: string): void
}) {
  const rows = fileRows(props.files, props.comments, props.viewed)
  return (
    <aside
      className="flex w-240 shrink-0 flex-col gap-2 overflow-y-auto border-border border-r bg-card px-10 py-14"
      aria-label="Changed files"
    >
      <p className="mx-0 mt-0 mb-8 font-bold text-11/[inherit] text-muted-foreground tracking-[0.5px]">
        {filesCaption(props.files)}
      </p>
      {rows.length === 0 && <p className="m-0 px-0 py-12 text-12/[inherit] text-muted-foreground">No changes yet</p>}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {rows.map((row) => (
          <li key={row.path}>
            <FileRowButton
              row={row}
              active={row.path === props.activePath}
              onPick={() => props.onPick(row.path)}
              onHover={() => props.onHover?.(row.path)}
            />
          </li>
        ))}
      </ul>
    </aside>
  )
}

function FileRowButton({
  row,
  active,
  onPick,
  onHover,
}: {
  row: FileRow
  active: boolean
  onPick(): void
  onHover(): void
}) {
  return (
    <button
      type="button"
      className={cx(
        FILE_ROW,
        active ? 'bg-muted shadow-[inset_0_0_0_1px_var(--border)]' : 'bg-transparent hover:bg-secondary',
      )}
      aria-current={active ? 'true' : undefined}
      onClick={onPick}
      onPointerEnter={onHover}
      onFocus={onHover}
    >
      {row.viewed ? (
        <Check className="shrink-0 text-status-success-foreground" size={13} aria-label="Viewed" />
      ) : (
        <FileCode className="shrink-0 text-muted-foreground" size={13} aria-hidden />
      )}
      <span className="flex min-w-0 flex-[1_1_0] flex-col gap-1">
        <span
          className={cx(
            'overflow-hidden text-ellipsis whitespace-nowrap font-semibold text-12-5/[inherit]',
            row.viewed ? 'text-muted-foreground' : 'text-foreground',
          )}
        >
          {row.name}
        </span>
        {row.dir && (
          <span className="overflow-hidden text-ellipsis whitespace-nowrap font-code text-10-5/[inherit] text-muted-foreground">
            {row.dir}
          </span>
        )}
      </span>
      {row.comments > 0 && (
        <span className="inline-flex items-center gap-3 text-10-5/[inherit] text-muted-foreground">
          <MessageSquare size={11} aria-hidden />
          {row.comments}
        </span>
      )}
      <span className="shrink-0 font-code font-semibold text-10-5/[inherit] text-status-success-foreground">
        +{row.additions}
      </span>
      <span className="shrink-0 font-code font-semibold text-10-5/[inherit] text-status-error-foreground">
        −{row.deletions}
      </span>
    </button>
  )
}

/** Which lines of one file carry what, so the gutter and the zones agree about them. */
export interface DiffTalk {
  /** The boss's own line comments on this file. */
  comments: ReviewComment[]
  /** The review threads on this file (T170); a finding's thread is one of these. */
  threads: readonly ReviewThread[]
  /** The threads a security finding was filed as, so they take the shield rather than the speech
      bubble (T241). */
  findingThreads: ReadonlySet<number>
}

/** Centre: the file's head, and VS Code's own diff of it with the talk hanging under its lines. */
export function DiffView(props: {
  /** The file the boss is reading, or null with nothing picked. */
  file: DiffFile | null
  /** Its two sides, or null while they are still being read. */
  sides: FileSides | null
  /** True while the two sides are on their way, so an empty box does not read as an empty diff. */
  loading: boolean
  /** Why the two sides could not be read, or null. */
  sidesError: string | null
  /** The layout and the walk through the changes, held by the screen so its header can draw them. */
  controls: DiffControls
  /** A line the panel asked the editor to scroll to; `seq` moves on every ask. */
  reveal?: { seq: number; line: number }
  talk: DiffTalk
  employees: Employee[]
  bossName: string
  viewed: boolean
  url: string | null
  onToggleViewed(): void
  /** The line the composer is open on, and how it opens and closes. */
  commentOn: number | null
  onCommentOn(line: number | null): void
  onComment(line: number, body: string): void
  /** How the boss joins a review thread (T170); left out, the threads are read only. */
  threadPeople?: ThreadPeople
  threadActions?: ThreadActions
}) {
  if (!props.file) {
    return (
      <section className="flex min-w-0 flex-[1_1_0] flex-col" aria-label="Diff">
        <p className="m-0 px-0 py-12 text-12/[inherit] text-muted-foreground">Pick a file to read its diff.</p>
      </section>
    )
  }
  const { file, talk } = props
  const lines = talkingLines(talk, props.commentOn)
  return (
    <section className="flex min-w-0 flex-[1_1_0] flex-col" aria-label="Diff">
      {/* The bar never wraps (T244): the path is the one thing that gives, by an ellipsis, and the
          two actions drop to their icons in a column too narrow to spell them out. */}
      <header className="@container flex shrink-0 items-center gap-10 border-border border-b bg-card px-16 py-12">
        <span
          className="min-w-0 truncate font-code font-semibold text-12-5/[inherit] text-foreground"
          title={file.path}
        >
          {file.path}
        </span>
        <span className="shrink-0 whitespace-nowrap font-code text-11-5/[inherit] text-muted-foreground">
          {countsLabel(file)}
        </span>
        <span className="flex-[1_1_0]" />
        <DiffControlBar controls={props.controls} />
        <button
          type="button"
          className={cx(DIFF_ACTION, props.viewed ? 'text-status-success-foreground' : 'text-muted-foreground')}
          aria-pressed={props.viewed}
          aria-label={props.viewed ? 'Viewed' : 'Mark viewed'}
          title={props.viewed ? 'Viewed' : 'Mark viewed'}
          onClick={props.onToggleViewed}
        >
          <Check size={13} aria-hidden />
          <span className={DIFF_ACTION_LABEL}>{props.viewed ? 'Viewed' : 'Mark viewed'}</span>
        </button>
        {props.url && (
          <a
            className={cx(DIFF_ACTION, 'text-muted-foreground')}
            href={props.url}
            target="_blank"
            rel="noreferrer"
            aria-label="Open file"
            title="Open file on the forge"
          >
            <ExternalLink size={13} aria-hidden />
            <span className={DIFF_ACTION_LABEL}>Open file</span>
          </a>
        )}
      </header>
      {file.binary ? (
        <p className="m-0 px-16 py-12 text-12/[inherit] text-muted-foreground">
          This file is binary; there is nothing to show.
        </p>
      ) : props.sidesError !== null ? (
        <p className="m-0 px-16 py-12 text-12/[inherit] text-destructive" role="alert">
          {props.sidesError}
        </p>
      ) : props.sides === null ? (
        <p className="m-0 px-16 py-12 text-12/[inherit] text-muted-foreground">
          {props.loading ? 'Reading the diff…' : ''}
        </p>
      ) : (
        <DiffEditor
          path={file.path}
          original={props.sides.original}
          modified={props.sides.modified}
          overlays={lines.map((line) => ({ id: `line-${line}`, line }))}
          marks={markedLines(talk)}
          onCommentOn={(line) => props.onCommentOn(line === props.commentOn ? null : line)}
          {...(props.reveal && { reveal: props.reveal })}
          {...props.controls.bind}
        >
          {(overlay) => (
            <LineTalk
              line={overlay.line}
              talk={talk}
              employees={props.employees}
              bossName={props.bossName}
              open={props.commentOn === overlay.line}
              onComment={(body) => props.onComment(overlay.line, body)}
              {...(props.threadPeople && { people: props.threadPeople })}
              {...(props.threadActions && { actions: props.threadActions })}
            />
          )}
        </DiffEditor>
      )}
    </section>
  )
}

/** Every line of the file that has something under it, in order. */
function talkingLines(talk: DiffTalk, commentOn: number | null): number[] {
  const lines = [
    ...talk.comments.map((comment) => comment.line),
    ...talk.threads.map((thread) => thread.line).filter((line): line is number => line !== null),
    ...(commentOn === null ? [] : [commentOn]),
  ]
  return [...new Set(lines)].sort((a, b) => a - b)
}

/** The gutter's marks: a shield where a finding is still open, a speech bubble everywhere else. */
function markedLines(talk: DiffTalk): DiffMark[] {
  const findings = new Set(
    talk.threads
      .filter((thread) => talk.findingThreads.has(thread.id) && thread.state !== 'resolved')
      .map((thread) => thread.line)
      .filter((line): line is number => line !== null),
  )
  return talkingLines(talk, null).map((line) => ({ line, kind: findings.has(line) ? 'finding' : 'comment' }))
}

/** Everything hanging under one line: the review threads first, then the boss's own comments. */
function LineTalk(props: {
  line: number
  talk: DiffTalk
  employees: Employee[]
  bossName: string
  open: boolean
  onComment(body: string): void
  people?: ThreadPeople
  actions?: ThreadActions
}) {
  const threads = props.talk.threads.filter((thread) => thread.line === props.line)
  const comments = props.talk.comments.filter((comment) => comment.line === props.line)
  return (
    <div className="bg-card" data-thread-line={props.line}>
      {threads.length > 0 && props.people && props.actions && (
        <LineThreads threads={threads} people={props.people} actions={props.actions} />
      )}
      {(comments.length > 0 || props.open) && (
        <CommentThread
          comments={comments}
          employees={props.employees}
          bossName={props.bossName}
          line={props.line}
          onComment={props.onComment}
        />
      )}
    </div>
  )
}

/*
 * The state-dependent halves of the screen. A utility that overrides another's property is chosen
 * here rather than appended, because two utilities on one property are settled by the compiled
 * sheet's order and not by the `className`.
 */
/** A file row in the left column; `--on` fills it and rings it. */
const FILE_ROW = 'flex w-full cursor-pointer items-center gap-8 rounded-sm border-0 px-8 py-7 text-left text-inherit'
/** The pill's dot, by what the pill says. */
const PILL_DOT: Record<'ok' | 'bad' | 'unknown', string> = {
  ok: 'bg-brand-success',
  bad: 'bg-brand-danger',
  unknown: 'bg-muted-foreground',
}
/** The round's bullet, by who moved. */
const ROUND_DOT: Record<'reviewer' | 'assignee' | 'handoff', string> = {
  reviewer: 'bg-status-warning-foreground',
  assignee: 'bg-muted-foreground',
  handoff: 'bg-primary',
}
/** `Approve` and `Request changes`: one shape, two fills. */
const PANEL_ACTION =
  'inline-flex flex-[1_1_0] cursor-pointer items-center justify-center gap-8 rounded-sm px-14 py-11 text-14/[inherit] font-semibold whitespace-nowrap disabled:cursor-default disabled:opacity-50'
/** A check's name (review.html:4842-4855): the frame leaves all three glyphs muted and names
    the check in the soft ink at 400 — only a failure takes a colour of its own. */
export const CHECK_NAME = 'text-12/[inherit] font-normal text-soft-ink'
/** A status pill; `PILL_DOT` gives its dot the colour. */
const PILL =
  'inline-flex items-center gap-6 rounded-full bg-secondary px-9 py-3 text-11/[inherit] font-semibold text-secondary-foreground'
/** `Viewed` and `Open on the forge`, above the diff. */
const DIFF_ACTION =
  'inline-flex shrink-0 cursor-pointer items-center gap-8 rounded-sm border-0 bg-transparent px-10 py-5 text-12/[inherit] font-semibold whitespace-nowrap no-underline hover:bg-secondary'
/**
 * What either of them says out loud, where the header is wide enough to say it (T244).
 *
 * Below that the button is its icon and its `title`, because the alternative is what T243 shipped:
 * `Mark viewed` and `Open file` each broken over two lines. The width is the header's own, through
 * a container query, so closing the conversation panel spells them out again without a resize
 * listener anywhere. 640px is what the two labels, the counts, the control bar and a path worth
 * reading all fit in at once.
 */
const DIFF_ACTION_LABEL = 'hidden @[640px]:inline'
/** One of the panel's tabs, without the colour the open one takes. */
const TAB =
  'inline-flex cursor-pointer items-center gap-5 border-x-0 border-t-0 border-b-2 bg-transparent px-0 pt-0 pb-8 text-12-5/[inherit] font-semibold whitespace-nowrap'
const CHECK_ICON: Record<PullRequestCheckState, typeof CircleCheck> = {
  passing: CircleCheck,
  failing: CircleX,
  pending: CircleDashed,
  skipped: CircleDashed,
}

/** The security row's shield, by what the pass makes of the change (T241). */
const SECURITY_ICON: Record<SecurityTone, string> = {
  reading: 'text-brand-primary',
  blocked: 'text-brand-danger',
  findings: 'text-brand-warning',
  clear: 'text-brand-success',
  overridden: 'text-muted-foreground',
}
/** A finding's severity tag, in the row's list. */
const SEVERITY_TAG: Record<'high' | 'medium' | 'low', string> = {
  high: 'bg-status-error text-status-error-foreground',
  medium: 'bg-status-warning text-status-warning-foreground',
  low: 'bg-secondary text-secondary-foreground',
}

/** The panel's three tabs (frame `VtAMR`). */
export type PanelTab = 'conversation' | 'checks' | 'summary'

/**
 * Right column: the agents' conversation and how far it got, the PR's checks, and the two
 * decisions — which are only live once the review has reached the boss (T170).
 */
export function ReviewPanel(props: {
  repoName: string
  details: PullRequestDetails | null
  diff: DiffSummary | null
  review: Review | null
  round: string
  summary: string
  unresolved: ReviewComment[]
  employees: Employee[]
  bossName: string
  comments: string
  busy: boolean
  canDecide: boolean
  error: string | null
  /** The whole ticket's review conversation, for the Conversation tab. */
  threads: readonly ReviewThread[]
  /** Whether the forge is carrying it, so the panel can say when it is not. */
  onForge: boolean
  /** The ticket's security pass (T241), or null when it never had one. */
  security?: SecurityPass | null
  /** The boss letting a held merge through, with the reason they typed in the composer. */
  onOverrideSecurity?(): void
  /** Scrolls the diff to a thread the boss should read. */
  onJumpTo(thread: ReviewThread): void
  /** Which tab opens first; `conversation` unless something says otherwise. */
  defaultTab?: PanelTab
  onComments(text: string): void
  onApprove(): void
  onRequestChanges(): void
  onClose(): void
  children?: ReactNode
}) {
  const state = mergeabilityLabel(props.details, props.diff)
  const title = props.details?.title || props.repoName
  const composer = useRef<HTMLTextAreaElement>(null)
  const unresolvedHead = useRef<HTMLParagraphElement>(null)
  // Set by pressing Send back with nothing written: the decision needs a reason.
  const [asked, setAsked] = useState(false)
  const [tab, setTab] = useState<PanelTab>(props.defaultTab ?? 'conversation')
  // Merging before the agents have settled the review: the boss's call, asked once more (T248)
  const [forcing, setForcing] = useState(false)
  // The decisions are the boss's only once the reviewer has handed the PR over, or the round limit
  // has: while the agents are still talking there is nothing to approve (T170).
  const reached = props.review !== null && props.review.handoff !== 'agents'
  const decidable = props.canDecide && (reached || props.review === null)
  const open = firstOpenThread(props.threads)

  /**
   * The frame draws Request changes live, and the flow will not take one without a reason. So the
   * button always answers: with a reason it decides, without one it puts the caret where the reason
   * goes and says so, rather than sitting dead until the boss happens to type.
   */
  function requestChanges(): void {
    if (props.comments.trim()) {
      setAsked(false)
      props.onRequestChanges()
      return
    }
    setAsked(true)
    composer.current?.focus()
  }

  return (
    <aside className="flex w-368 shrink-0 flex-col border-border border-l bg-card" aria-label="Review">
      <header className="flex h-64 shrink-0 items-center gap-10 border-border border-b px-16 py-0">
        <div className="flex min-w-0 gap-16 overflow-x-auto" role="tablist" aria-label="Review">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={cx(
                TAB,
                tab === id ? 'border-b-primary text-primary' : 'border-b-transparent text-muted-foreground',
              )}
              onClick={() => setTab(id)}
            >
              {label}
              <span className="before:content-['·_']">{tabCount(id, props)}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          className="cursor-pointer border-0 bg-transparent px-4 py-0 text-20/[1] text-muted-foreground"
          aria-label="Close the review"
          onClick={props.onClose}
        >
          ×
        </button>
      </header>
      <div className="flex flex-[1_1_0] flex-col gap-14 overflow-y-auto p-16">
        {tab === 'conversation' && (
          <>
            <ReviewerCard
              review={props.review}
              threads={props.threads}
              employees={props.employees}
              bossName={props.bossName}
              details={props.details}
              onForge={props.onForge}
            />
            {props.security && (
              <SecurityRow
                pass={props.security}
                employees={props.employees}
                bossName={props.bossName}
                busy={props.busy}
                canDecide={props.canDecide}
                {...(props.onOverrideSecurity && { onOverride: props.onOverrideSecurity })}
              />
            )}
            <p className="m-0 flex items-center gap-10 pt-6 font-bold text-11/[inherit] text-muted-foreground tracking-[0.6px]">
              <span>ROUNDS</span>
              <span className="h-1 flex-[1_1_0] bg-border" />
            </p>
            <RoundList
              review={props.review}
              threads={props.threads}
              employees={props.employees}
              bossName={props.bossName}
            />
          </>
        )}
        {tab === 'summary' && (
          <p className="m-0 overflow-hidden text-ellipsis whitespace-nowrap text-11/[inherit] text-muted-foreground">
            {props.round}
          </p>
        )}
        {(tab === 'checks' || tab === 'summary') && (
          <section className="flex shrink-0 flex-col gap-10 rounded-sm border border-border bg-card p-14">
            <div className="flex items-center gap-8">
              <span className="inline-flex items-center gap-6 rounded-full bg-secondary px-9 py-3 font-semibold text-11/[inherit] text-secondary-foreground">
                {props.repoName}
              </span>
              {props.details && props.details.number !== null && (
                <span className="font-code text-11/[inherit] text-muted-foreground">#{props.details.number}</span>
              )}
              <span className="flex-[1_1_0]" />
              <span className={PILL}>
                <span className={cx('size-6 rounded-full', PILL_DOT[state.tone])} aria-hidden />
                {state.label}
              </span>
            </div>
            <h3 className="m-0 font-semibold text-14/20 text-foreground">{title}</h3>
            <p className="m-0 break-words font-code text-11/17 text-muted-foreground">
              {branchLine(props.diff, props.details)}
            </p>
            <hr className="m-0 h-1 w-full border-0 bg-border" />
            {props.details?.checks.length ? (
              props.details.checks.map((check) => <CheckRow key={`${check.workflow}:${check.name}`} check={check} />)
            ) : (
              <p className="m-0 px-0 py-12 text-12/[inherit] text-muted-foreground">No checks reported</p>
            )}
          </section>
        )}

        <p className="m-0 flex items-center gap-9 rounded-sm bg-secondary px-12 py-10 text-muted-foreground">
          <UserCheck size={15} aria-hidden />
          <span className="flex-[1_1_0] font-semibold text-12/17">{props.summary}</span>
          {props.unresolved.length > 0 && (
            <button
              type="button"
              className="shrink-0 cursor-pointer border-0 bg-transparent p-0 font-bold text-11/[inherit] text-muted-foreground hover:text-soft-ink"
              onClick={() => unresolvedHead.current?.scrollIntoView?.({ block: 'nearest' })}
            >
              View
            </button>
          )}
        </p>

        <div className="flex gap-10">
          <button
            type="button"
            className={cx(
              PANEL_ACTION,
              'border-0 bg-primary text-primary-foreground shadow-button-primary not-disabled:hover:bg-primary-hover',
            )}
            disabled={props.busy || !decidable}
            onClick={props.onApprove}
          >
            <Check size={16} aria-hidden />
            {props.review?.merge === 'failed' ? 'Retry merge' : 'Approve & merge'}
          </button>
          <button
            type="button"
            className={cx(
              PANEL_ACTION,
              'border border-border bg-transparent text-foreground not-disabled:hover:bg-secondary',
            )}
            disabled={props.busy || !decidable}
            onClick={requestChanges}
          >
            <Undo2 size={16} aria-hidden />
            Send back
          </button>
        </div>
        {/*
          While the agents are still talking there is nothing to decide, so the buttons are dead and
          the panel says why rather than leaving the boss to guess (frame `F2HxCz`, card a).
        */}
        {!reached && props.review !== null && (
          <p className="m-0 text-12/[inherit] text-muted-foreground" role="status">
            {props.review.reviewerId === props.review.decidedBy
              ? 'The agents are still reviewing.'
              : `Waiting for the review to be settled: round ${props.review.round} of ${props.review.roundLimit}.`}
          </p>
        )}
        {/*
          The boss may merge without waiting for the agents to settle (T248). It is the same approve
          the settled review takes, so it goes through the same merge, checks and security pass; it
          only skips the rest of the review, and asks once more before it does.
        */}
        {!reached && props.review !== null && props.canDecide && !forcing && (
          <button
            type="button"
            className="inline-flex cursor-pointer items-center justify-center gap-8 self-start rounded-sm border border-border bg-transparent px-12 py-8 font-semibold text-12/[inherit] text-foreground not-disabled:hover:bg-secondary disabled:cursor-default disabled:opacity-50"
            disabled={props.busy}
            onClick={() => setForcing(true)}
          >
            Merge now, without waiting
          </button>
        )}
        {!reached && props.review !== null && props.canDecide && forcing && (
          <fieldset
            className="flex flex-col gap-8 rounded-sm border border-border bg-secondary px-12 py-10"
            aria-label="Merge without waiting"
          >
            <p className="m-0 text-12/[inherit] text-foreground">
              Skip the rest of the review and merge? Round {props.review.round} of {props.review.roundLimit} is still
              with the agents.
            </p>
            <div className="flex gap-8">
              <button
                type="button"
                className={cx(
                  PANEL_ACTION,
                  'border-0 bg-primary text-primary-foreground not-disabled:hover:bg-primary-hover',
                )}
                disabled={props.busy}
                onClick={() => {
                  setForcing(false)
                  props.onApprove()
                }}
              >
                <Check size={16} aria-hidden />
                Merge now
              </button>
              <button
                type="button"
                className={cx(
                  PANEL_ACTION,
                  'border border-border bg-transparent text-foreground not-disabled:hover:bg-card',
                )}
                onClick={() => setForcing(false)}
              >
                Keep waiting
              </button>
            </div>
          </fieldset>
        )}
        {open && (
          <button
            type="button"
            className="flex cursor-pointer items-center gap-6 border-none bg-transparent p-0 text-left text-12/[inherit] text-primary"
            onClick={() => props.onJumpTo(open)}
          >
            <CornerDownRight size={14} aria-hidden />
            Jump to open thread · {threadAnchor(open)}
          </button>
        )}
        {props.error && (
          <p className="m-0 text-12/[inherit] text-status-error-foreground" role="alert">
            {props.error}
          </p>
        )}
        {asked && !props.comments.trim() && (
          <p className="m-0 text-12/[inherit] text-muted-foreground" role="status">
            Say what to change, then send it back.
          </p>
        )}

        {props.unresolved.length > 0 && (
          <>
            <p
              className="m-0 flex items-center gap-10 pt-6 font-bold text-11/[inherit] text-muted-foreground tracking-[0.6px]"
              ref={unresolvedHead}
            >
              <span>{unresolvedLabel(props.unresolved.length)}</span>
              <span className="h-1 flex-[1_1_0] bg-border" />
            </p>
            {props.unresolved.map((comment) => (
              <CommentRow key={comment.id} comment={comment} employees={props.employees} bossName={props.bossName} />
            ))}
          </>
        )}
        {props.children}
      </div>
      <div className="shrink-0 p-16">
        <Composer
          placeholder={commentPlaceholder(props)}
          value={props.comments}
          onChange={props.onComments}
          onSend={props.onRequestChanges}
          disabled={props.busy || !props.canDecide}
          inputRef={composer}
        />
      </div>
    </aside>
  )
}

const TABS: [PanelTab, string][] = [
  ['conversation', 'Conversation'],
  ['checks', 'Checks'],
  ['summary', 'Summary'],
]

/** The number beside a tab: threads, checks green over all, or the round. */
function tabCount(
  tab: PanelTab,
  props: { threads: readonly ReviewThread[]; details: PullRequestDetails | null; review: Review | null },
): string {
  if (tab === 'conversation') return String(props.threads.length)
  if (tab === 'checks') {
    const checks = props.details?.checks ?? []
    return `${checks.filter((check) => check.state === 'passing').length}/${checks.length}`
  }
  return props.review ? String(props.review.rounds) : '0'
}

/** `Comment to Iris and Vega…`: the people the boss would be writing to. */
function commentPlaceholder(props: {
  review: Review | null
  employees: Employee[]
  threads: readonly ReviewThread[]
}): string {
  const ids = [
    ...new Set([props.review?.reviewerId, ...props.threads.flatMap((t) => t.messages.map((m) => m.authorId))]),
  ]
  const names = ids
    .map((id) => props.employees.find((e) => e.id === id)?.name)
    .filter((name): name is string => Boolean(name))
  if (names.length === 0) return 'Comment on this pull request…'
  const said = names.length === 1 ? names[0]! : `${names.slice(0, -1).join(', ')} and ${names.at(-1)!}`
  return `Comment to ${said}…`
}

/**
 * The reviewer's card (frame `VtAMR`): who reviewed it, how many rounds it took, how much of the
 * conversation is settled, their verdict in their own words, and where it is on the forge — or
 * that it is only here.
 */
function ReviewerCard(props: {
  review: Review | null
  threads: readonly ReviewThread[]
  employees: Employee[]
  bossName: string
  details: PullRequestDetails | null
  onForge: boolean
}) {
  const { review } = props
  if (!review)
    return (
      <p className="m-0 px-0 py-12 text-12/[inherit] text-muted-foreground">This ticket has no review round yet.</p>
    )
  const employee = props.employees.find((e) => e.id === review.reviewerId)
  const name = employee?.name ?? props.bossName
  const pill = verdictPill(review)
  const forge = forgeLine({
    onForge: props.onForge,
    url: props.threads.find((thread) => thread.url)?.url ?? null,
    number: props.details?.number ?? null,
  })
  return (
    <section className="flex shrink-0 flex-col gap-10" aria-label="Reviewer">
      <header className="flex items-center gap-10">
        <PersonAvatar id={review.reviewerId} name={name} people={{ employees: props.employees }} size={30} />
        <div className="flex min-w-0 flex-col gap-2">
          <strong className="font-semibold text-13-5/[inherit] text-foreground">Reviewed by {name}</strong>
          <span className="text-11-5/[inherit] text-muted-foreground">{reviewerCardLine(review, props.threads)}</span>
        </div>
        <span className="flex-[1_1_0]" />
        <span className={PILL}>
          <span className={cx('size-6 rounded-full', PILL_DOT[pill.tone])} aria-hidden />
          {pill.label}
        </span>
      </header>
      <div className="h-4 overflow-hidden rounded-full bg-secondary" role="presentation">
        <span
          className="block h-full rounded-full bg-primary"
          style={{ width: `${Math.round(threadsProgress(props.threads) * 100)}%` }}
        />
      </div>
      {review.comments && (
        <blockquote className="m-0 text-12-5/19 text-soft-ink italic">“{review.comments}”</blockquote>
      )}
      <p className="m-0 flex items-center gap-6 text-11-5/[inherit] text-muted-foreground [&_a]:text-muted-foreground">
        <ExternalLink size={13} aria-hidden />
        {forge.url ? (
          <a href={forge.url} target="_blank" rel="noreferrer">
            {forge.label}
          </a>
        ) : (
          <span>{forge.label}</span>
        )}
      </p>
    </section>
  )
}

/**
 * The security pass's own row (T241), under the reviewer's card and above the rounds: who read it
 * and why, what they found with the fix on each finding, and — while a high one holds the merge —
 * the boss's Override, which takes the reason from the panel's composer.
 */
function SecurityRow(props: {
  pass: SecurityPass
  employees: Employee[]
  bossName: string
  busy: boolean
  canDecide: boolean
  onOverride?(): void
}) {
  const { pass } = props
  const name = props.employees.find((e) => e.id === pass.reviewerId)?.name ?? props.bossName
  const chip = securityChip(pass, name)
  const blocking = blockingFindings(pass)
  const why =
    pass.reason.kind === 'every'
      ? 'every PR gets one here'
      : pass.reason.kind === 'label'
        ? 'the ticket is labelled for it'
        : `it touches ${riskLine(pass.reason.classes)}`
  return (
    <section
      className="flex shrink-0 flex-col gap-10 rounded-sm border border-border bg-card p-14"
      aria-label="Security"
    >
      <header className="flex items-center gap-8">
        <ShieldCheck className={cx('shrink-0', SECURITY_ICON[chip.tone])} size={15} aria-hidden />
        <strong className="font-semibold text-12-5/[inherit] text-foreground">{chip.text}</strong>
        <span className="flex-[1_1_0]" />
        <span className={PILL}>{findingsLine(pass) || 'nothing found'}</span>
      </header>
      <p className="m-0 text-11-5/17 text-muted-foreground">
        {name} read this change because {why}.
      </p>
      {pass.summary && <blockquote className="m-0 text-12-5/19 text-soft-ink italic">“{pass.summary}”</blockquote>}
      {pass.findings.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-8 p-0">
          {pass.findings.map((finding) => (
            <li key={finding.id} className="flex flex-col gap-3">
              <span className="flex items-center gap-7">
                <span
                  className={cx(
                    'inline-flex shrink-0 items-center rounded-full px-7 py-2 font-semibold text-10-5/[inherit]',
                    SEVERITY_TAG[finding.severity],
                  )}
                >
                  {SEVERITY_LABEL[finding.severity]}
                </span>
                <span
                  className={cx(
                    'min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-semibold text-12/[inherit]',
                    finding.resolved ? 'text-muted-foreground line-through' : 'text-foreground',
                  )}
                >
                  {finding.title}
                </span>
              </span>
              <span className="font-code text-10-5/[inherit] text-muted-foreground">{finding.where}</span>
              <span className="text-11-5/17 text-muted-foreground">Fix: {finding.fix}</span>
            </li>
          ))}
        </ul>
      )}
      {pass.state === 'overridden' && (
        <p className="m-0 text-11-5/17 text-muted-foreground">You overrode it: “{pass.overrideReason}”</p>
      )}
      {blocking.length > 0 && pass.state !== 'overridden' && props.onOverride && (
        <button
          type="button"
          className="inline-flex cursor-pointer items-center justify-center gap-8 self-start rounded-sm border border-border bg-transparent px-12 py-8 font-semibold text-12/[inherit] text-foreground not-disabled:hover:bg-secondary disabled:cursor-default disabled:opacity-50"
          disabled={props.busy || !props.canDecide}
          onClick={props.onOverride}
        >
          Override and merge anyway
        </button>
      )}
    </section>
  )
}

/** The rounds, in order, with what each one came to (frame `VtAMR`). */
function RoundList(props: {
  review: Review | null
  threads: readonly ReviewThread[]
  employees: Employee[]
  bossName: string
}) {
  const nameOf = (id: string) => props.employees.find((e) => e.id === id)?.name ?? props.bossName
  const events = roundTimeline(props.review, props.threads, nameOf)
  if (events.length === 0)
    return <p className="m-0 px-0 py-12 text-12/[inherit] text-muted-foreground">Nothing has happened yet.</p>
  return (
    <ol className="m-0 flex list-none flex-col gap-12 p-0">
      {events.map((event) => (
        <li key={event.key} className="flex items-start gap-10">
          <span className={cx('mt-5 size-7 shrink-0 rounded-full', ROUND_DOT[event.tone])} aria-hidden />
          <span className="flex min-w-0 flex-[1_1_0] flex-col gap-2">
            <strong className="font-semibold text-12-5/[inherit] text-foreground">{event.title}</strong>
            <span className="text-11-5/[inherit] text-muted-foreground">{event.detail}</span>
          </span>
          <time className="shrink-0 text-11/[inherit] text-muted-foreground">{event.at}</time>
        </li>
      ))}
    </ol>
  )
}

function CheckRow({ check }: { check: PullRequestCheck }) {
  const Icon = CHECK_ICON[check.state]
  return (
    <p
      className={cx(
        'm-0 flex items-center gap-8 text-12/[inherit]',
        check.state === 'failing' ? 'text-status-error-foreground' : 'text-muted-foreground',
      )}
    >
      <Icon size={14} aria-hidden />
      <span className={CHECK_NAME}>{check.workflow ? `${check.name} · ${check.workflow}` : check.name}</span>
      <span className="flex-[1_1_0]" />
      <span className="font-code text-11/[inherit] text-muted-foreground">{durationLabel(check)}</span>
    </p>
  )
}
