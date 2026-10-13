import {
  Check,
  CircleAlert,
  ClipboardList,
  FolderGit2,
  Hourglass,
  ListChecks,
  ListTree,
  MessageSquare,
  Pencil,
  SendHorizontal,
  Sparkles,
  Undo2,
} from 'lucide-react'
import { useState } from 'react'
import { repoLine, repoLineText } from '../../../shared/repos/repo-line'
import { Button, cx, focusOnMount } from '../ui'
import type { MessageCard, QuestionLine } from './chat-view'

/**
 * The design's soft body ink in chat: Slate 300 on the dark theme, the secondary ink on light.
 * `ui/tokens.css` has no token for it — the stylesheet carried it as a `--chat-soft` custom
 * property with a `[data-theme='light']` override, and this is that pair, per element.
 */
const SOFT = "text-[#cbd5e1] [[data-theme='light']_&]:text-secondary-foreground"

/** A card's own quiet action, flat until the pointer is on it. */
const QUIET =
  'inline-flex shrink-0 cursor-pointer items-center justify-center gap-8 whitespace-nowrap rounded-sm border-0 bg-transparent px-10 py-5 font-semibold text-12/[normal] text-muted-foreground hover:bg-[color-mix(in_srgb,var(--secondary)_70%,transparent)] hover:text-foreground focus-visible:shadow-focus focus-visible:outline-none'

/** The repo chip: the pill, in the mono face. */
const CHIP =
  'inline-flex items-center gap-6 whitespace-nowrap rounded-full bg-secondary px-10 py-4 font-code font-normal text-11/[normal] [&_svg]:text-muted-foreground'

/** One of the plan's column headings. */
const LABEL =
  'mx-0 mt-0 mb-4 flex items-center gap-5 font-semibold text-10/[normal] text-muted-foreground uppercase tracking-[0.06em] not-first:mt-12'

/** A line in the criteria or risks list. */
const BULLET = 'flex items-start gap-7 px-0 py-3 text-12-5/18'

const planning = window.tinyCorp.planning

/**
 * The planner's numbered questions, answered inline (frame `D1E2lt`): one row per question, a
 * tick once it is answered, and "Let <planner> decide" on the one being answered.
 */
export function QuestionsCard({ card }: { card: Extract<MessageCard, { kind: 'questions' }> }) {
  return (
    <section
      className="flex w-full flex-col gap-1 overflow-hidden rounded-sm bg-border"
      aria-label="Planning questions"
    >
      {card.questions.map((question) => (
        <QuestionRow key={question.id} question={question} asker={card.asker} />
      ))}
      {card.sent && (
        <div className="flex items-center gap-9 bg-muted px-14 py-9 text-12/[normal] text-muted-foreground">
          <Hourglass size={14} aria-hidden />
          <span className="min-w-0 shrink grow basis-0 font-semibold text-12-5/[normal] text-soft-ink-adaptive">
            {card.sent.state}
          </span>
          <span className="shrink-0">{card.sent.by}</span>
        </div>
      )}
    </section>
  )
}

function QuestionRow({ question, asker }: { question: QuestionLine; asker: string }) {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const answered = question.answer !== null

  async function send(action: () => Promise<{ ok: boolean; error?: string }>) {
    const result = await action()
    setError(result.ok ? null : (result.error ?? 'That did not go through'))
  }

  return (
    <div className="flex items-start gap-10 bg-card px-14 py-12">
      <span
        className={cx(
          'mt-1 grid size-18 shrink-0 place-items-center rounded-full font-semibold text-11/[normal]',
          answered ? 'bg-muted text-muted-foreground' : 'bg-brand-primary text-primary-foreground',
        )}
        aria-hidden
      >
        {question.number}
      </span>
      <div className="min-w-0 shrink grow basis-0">
        <p className="m-0 font-semibold text-13/19 text-foreground">{question.text}</p>
        {answered ? (
          <p className={cx('mx-0 mt-4 mb-0 flex items-baseline gap-8 text-12-5/19', SOFT)}>
            <span className="shrink-0 font-semibold text-10/[inherit] text-muted-foreground uppercase tracking-[0.04em]">
              {question.answeredBy}
            </span>
            {question.delegated ? `${asker} decides.` : question.answer}
          </p>
        ) : (
          <form
            className="mt-4 flex items-center gap-6"
            onSubmit={(event) => {
              event.preventDefault()
              if (draft.trim()) void send(() => planning.answer(question.id, draft.trim()))
            }}
          >
            <input
              className="min-w-0 shrink grow basis-0 border-0 bg-transparent px-0 py-4 text-12-5/[normal] text-foreground placeholder:text-muted-foreground focus:outline-none"
              value={draft}
              placeholder={`Answer question ${question.number}…`}
              aria-label={`Answer question ${question.number}`}
              onChange={(event) => setDraft(event.target.value)}
            />
            <button
              type="submit"
              className={QUIET}
              aria-label={`Send the answer to question ${question.number}`}
              disabled={!draft.trim()}
            >
              <SendHorizontal size={14} aria-hidden />
            </button>
            <button type="button" className={QUIET} onClick={() => void send(() => planning.delegate(question.id))}>
              <Sparkles size={13} aria-hidden />
              Let {asker} decide
            </button>
          </form>
        )}
        {error && (
          <p className="mx-24 my-0 text-12/[normal] text-status-error-foreground" role="alert">
            {error}
          </p>
        )}
      </div>
      {/* Quiet, never the approved green: a tick per answer is what TI-6 read as an approved plan. */}
      {answered && <Check size={15} className="mt-2 shrink-0 text-muted-foreground" aria-hidden />}
    </div>
  )
}

/**
 * The Plan card (frame `D1E2lt`): Goal and Approach, the acceptance criteria checklist, the repos,
 * subtasks and risks, the open-question strip, and the boss's three decisions. After approval a
 * replan draws what changed instead, with Approve v2 and Keep v1 (frame `hZrUN`).
 */
export function PlanCard({ card, onEdit }: { card: Extract<MessageCard, { kind: 'plan' }>; onEdit?(): void }) {
  return (
    <section
      className={cx(
        'flex w-full flex-col rounded-sm border-l-2 bg-card',
        card.status === 'approved' && 'border-l-brand-success',
        card.status === 'replan' && 'border-l-brand-warning',
        card.status !== 'approved' && card.status !== 'replan' && 'border-l-brand-primary',
      )}
      aria-label="Plan"
    >
      <header className="flex items-center gap-8 px-14 py-12 text-muted-foreground">
        <ClipboardList size={15} aria-hidden />
        <span className="font-semibold text-13/[normal] text-foreground">{card.title}</span>
        <span className="shrink grow basis-0" />
        <span className="text-11-5/[normal] text-muted-foreground">{card.by}</span>
      </header>

      {card.replan ? (
        <div className="px-14 pt-0 pb-12">
          <p className="mx-0 mt-0 mb-2 font-semibold text-10/[normal] text-brand-warning uppercase tracking-[0.06em]">
            Replan requested by {card.replan.by}
          </p>
          <p className={cx('mx-0 mt-0 mb-8 text-12-5/19', SOFT)}>{card.replan.reason}</p>
          <ul className="m-0 list-none p-0">
            {card.replan.changes.map((change) => (
              <li key={change} className={cx('px-0 py-2 font-code text-11-5/[normal]', SOFT)}>
                {change}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-20 px-14 pt-0 pb-12">
          <div className="min-w-0">
            {card.goal && (
              <>
                <h5 className={LABEL}>Goal</h5>
                <p className={cx('m-0 text-12-5/19', SOFT)}>{card.goal}</p>
              </>
            )}
            {card.approach && (
              <>
                <h5 className={LABEL}>Approach</h5>
                <p className={cx('m-0 text-12-5/19', SOFT)}>{card.approach}</p>
              </>
            )}
          </div>
          <div className="min-w-0">
            <h5 className={LABEL}>
              <ListChecks size={12} aria-hidden /> Acceptance criteria · {card.criteria.length}
            </h5>
            <ul className="m-0 list-none p-0">
              {card.criteria.map((criterion) => (
                <li key={criterion} className={cx(BULLET, SOFT)}>
                  <span className="mt-3 size-12 shrink-0 rounded-[3px] border border-border" aria-hidden />
                  {criterion}
                </li>
              ))}
            </ul>
          </div>
          <div className="min-w-0">
            {card.repos.length > 0 && (
              <>
                <h5 className={LABEL}>Repos</h5>
                <div className="flex flex-wrap items-center gap-8">
                  {/* Every repo a plan touches used to be a chip; a plan on 110 of them is one line (T285). */}
                  <span className={cx(CHIP, SOFT, 'max-w-full')} title={repoLine(card.repos).all}>
                    <FolderGit2 size={12} aria-hidden />
                    <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                      {repoLineText(card.repos)}
                    </span>
                  </span>
                </div>
              </>
            )}
            {card.subtasks.length > 0 && (
              <>
                <h5 className={LABEL}>
                  <ListTree size={12} aria-hidden /> Subtasks · {card.subtasks.length}
                </h5>
                <ol className="m-0 list-none p-0">
                  {card.subtasks.map((subtask, index) => (
                    <li key={subtask.title} className="flex items-baseline gap-8 px-0 py-3 text-12-5/18">
                      <span className="shrink-0 text-11/[inherit] text-muted-foreground">{index + 1}</span>
                      <span className={cx('min-w-0 shrink grow basis-0', SOFT)}>{subtask.title}</span>
                      {subtask.repo && (
                        <code className="shrink-0 font-code text-10-5/[inherit] text-muted-foreground">
                          {subtask.repo}
                        </code>
                      )}
                    </li>
                  ))}
                </ol>
              </>
            )}
            {card.risks.length > 0 && (
              <>
                <h5 className={LABEL}>Risks</h5>
                <ul className="m-0 list-none p-0">
                  {card.risks.map((risk) => (
                    <li key={risk} className={cx(BULLET, SOFT)}>
                      <CircleAlert className="mt-2 shrink-0 text-brand-warning" size={13} aria-hidden />
                      {risk}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      )}

      {card.openQuestions.length > 0 && (
        <div className="flex items-center gap-8 border-border border-t px-14 py-8 text-12/[normal] text-muted-foreground">
          <MessageSquare size={13} aria-hidden />
          <span>Open question · {card.openQuestions.join(' · ')}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-12 px-14 py-12">
        {card.waiting && (
          <PlanDecision
            planId={card.planId}
            version={card.version}
            replan={card.replan !== null}
            {...(onEdit && { onEdit })}
          />
        )}
        <span className="ml-auto flex flex-col items-end gap-2 text-11-5/[normal] text-muted-foreground">
          <span>{card.foot}</span>
          {/* What happens next, said on the card rather than left to the boss to work out (T233). */}
          {card.nextStep && <span className="font-semibold text-soft-ink-adaptive">{card.nextStep}</span>}
        </span>
      </div>
    </section>
  )
}

/**
 * Approve / Ask for changes on a drafted plan, and Approve v2 / Keep v1 on a replan (frames
 * `D1E2lt`, `hZrUN`). The Plan card draws them, and so does the Inbox row the plan raises (T233),
 * so the boss decides from wherever the plan reached them.
 */
export function PlanDecision({
  planId,
  version,
  replan,
  onEdit,
}: {
  planId: number
  version: number
  replan: boolean
  onEdit?(): void
}) {
  const [asking, setAsking] = useState(false)
  const [comments, setComments] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    const result = await action()
    setError(result.ok ? null : (result.error ?? 'That did not go through'))
    if (result.ok) setAsking(false)
  }

  return (
    <>
      {asking ? (
        <form
          className="flex shrink grow basis-full flex-col gap-10"
          onSubmit={(event) => {
            event.preventDefault()
            void run(() => planning.requestChanges(planId, comments.trim()))
          }}
        >
          <input
            ref={focusOnMount}
            className="w-full rounded-sm border border-input bg-card px-12 py-10 text-13/[normal] text-foreground outline-none focus:border-ring focus:shadow-focus"
            value={comments}
            placeholder="What should change?"
            aria-label="What should change"
            onChange={(event) => setComments(event.target.value)}
          />
          <div className="flex shrink-0 gap-10 [&>[data-slot=button]]:flex-none">
            <Button type="submit" size="sm" variant="destructive" icon={Undo2} disabled={!comments.trim()}>
              Ask for changes
            </Button>
            <Button size="sm" variant="outline" onClick={() => setAsking(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex shrink-0 gap-10 [&>[data-slot=button]]:flex-none">
          <Button size="sm" icon={Check} onClick={() => void run(() => planning.approve(planId))}>
            {replan ? `Approve v${version} → Ready` : 'Approve plan → Ready'}
          </Button>
          {replan ? (
            <Button size="sm" variant="secondary" icon={Undo2} onClick={() => void run(() => planning.keep(planId))}>
              Keep v{version - 1}
            </Button>
          ) : (
            <Button size="sm" variant="secondary" icon={MessageSquare} onClick={() => setAsking(true)}>
              Ask for changes
            </Button>
          )}
          {onEdit && (
            <button type="button" className={QUIET} onClick={onEdit}>
              <Pencil size={13} aria-hidden />
              Edit
            </button>
          )}
        </div>
      )}
      {error && (
        <p className="mx-24 my-0 basis-full text-12/[normal] text-status-error-foreground" role="alert">
          {error}
        </p>
      )}
    </>
  )
}
