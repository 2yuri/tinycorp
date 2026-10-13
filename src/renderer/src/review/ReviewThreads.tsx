/**
 * The agents' conversation in the diff (frame `VtAMR`): a settled thread collapses to one row with
 * the commit that fixed it and who resolved it; an open one hangs under its line with every
 * message, a reply box and Resolve.
 *
 * Kept beside `ReviewComments`, which draws the boss's own line comments on a worktree in the Files
 * view. Those have no round and nobody to answer them; these are a review (T170).
 */
import { Check, ChevronRight, GitCommitHorizontal, MessageSquare, Undo2 } from 'lucide-react'
import { BOSS } from '../../../shared/domain/chat'
import type { Employee } from '../../../shared/domain/staff'
import { forgeLabelOf } from '../../../shared/forges'
import type { ReviewThread, ThreadMessage } from '../../../shared/review/review-threads'
import { Written } from '../paths'
import { type People, PersonAvatar, personAccent } from '../people'
import { Composer } from './ReviewComments'
import { timeOf } from './review-model'

export interface ThreadActions {
  /** Answers the thread as the boss. */
  onReply(threadId: number, body: string): void
  /** Settles it, or puts it back. */
  onResolve(threadId: number, resolved: boolean): void
}

export interface ThreadPeople {
  employees: Employee[]
  bossName: string
  /** Who holds the ticket, so a pushback can be told from the reviewer saying more. */
  reviewerId: string | null
}

/** Every thread on one line: the resolved ones as rows, the rest open. */
export function LineThreads(props: { threads: readonly ReviewThread[]; people: ThreadPeople; actions: ThreadActions }) {
  return (
    <div className="flex flex-col border-border border-t border-b bg-card">
      {props.threads.map((thread) =>
        thread.state === 'resolved' ? (
          <ResolvedThread key={thread.id} thread={thread} people={props.people} actions={props.actions} />
        ) : (
          <OpenThread key={thread.id} thread={thread} people={props.people} actions={props.actions} />
        ),
      )}
    </div>
  )
}

/** A settled thread: one row, its commit chip, and who closed it. Clicking it puts it back. */
function ResolvedThread({
  thread,
  people,
  actions,
}: {
  thread: ReviewThread
  people: ThreadPeople
  actions: ThreadActions
}) {
  const summary = thread.messages[0]?.body ?? ''
  return (
    <button
      type="button"
      className="flex w-full cursor-pointer items-center gap-8 border-none bg-transparent py-8 pr-16 pl-68 text-left text-12/[inherit] text-muted-foreground hover:bg-secondary"
      onClick={() => actions.onResolve(thread.id, false)}
      title="Reopen this thread"
    >
      <Check className="shrink-0 text-status-success-foreground" size={13} aria-hidden />
      <span className="flex shrink-0 [&>*+*]:-ml-7">
        {authors(thread).map((id) => (
          <PersonAvatar key={id} id={id} name={nameOf(id, people)} people={peopleOf(people)} size={20} />
        ))}
      </span>
      <span className="min-w-0 flex-[1_1_0] overflow-hidden text-ellipsis whitespace-nowrap text-soft-ink">
        {summary}
      </span>
      {thread.commit && (
        <span className="inline-flex shrink-0 items-center gap-4 rounded-full bg-secondary px-8 py-2 font-code text-10-5/[inherit] text-secondary-foreground">
          <GitCommitHorizontal size={12} aria-hidden />
          {shortSha(thread.commit)}
        </span>
      )}
      <span className="shrink-0">
        Resolved by {thread.resolvedBy ? nameOf(thread.resolvedBy, people) : 'the reviewer'}
      </span>
      <ChevronRight size={14} aria-hidden />
    </button>
  )
}

/** An open thread: what was said, in rounds, with a reply box and Resolve. */
function OpenThread({
  thread,
  people,
  actions,
}: {
  thread: ReviewThread
  people: ThreadPeople
  actions: ThreadActions
}) {
  const replies = Math.max(thread.messages.length - 1, 0)
  return (
    <section
      className="flex flex-col gap-10 border-border border-t border-b border-l-3 border-l-primary bg-card py-12 pr-16 pl-64"
      aria-label={`Thread on line ${thread.line ?? ''}`}
    >
      <header className="flex items-center gap-6 text-11-5/[inherit] text-muted-foreground">
        <MessageSquare size={14} aria-hidden />
        <span className="font-semibold">
          Open thread{thread.line === null ? '' : ` · line ${thread.line}`} ·{' '}
          {replies === 1 ? '1 reply' : `${replies} replies`}
        </span>
        <span className="flex-[1_1_0]" />
        {thread.state === 'non_blocking' && (
          <span className="inline-flex shrink-0 items-center gap-4 rounded-full bg-secondary px-8 py-2 font-semibold text-10-5/[inherit] text-secondary-foreground text-status-warning-foreground">
            Non-blocking note
          </span>
        )}
      </header>
      {thread.messages.map((message) => (
        <ThreadMessageRow key={message.id} message={message} thread={thread} people={people} />
      ))}
      <div className="flex items-center gap-8 [&>form]:flex-[1_1_0]">
        <Composer
          placeholder={thread.line === null ? 'Reply…' : `Reply on line ${thread.line}…`}
          onSend={(body) => actions.onReply(thread.id, body)}
        />
        <button
          type="button"
          className="inline-flex shrink-0 cursor-pointer items-center gap-6 rounded-sm border border-border bg-secondary px-14 py-9 font-semibold text-12/[inherit] text-secondary-foreground"
          onClick={() => actions.onResolve(thread.id, true)}
        >
          <Check size={13} aria-hidden />
          Resolve
        </button>
      </div>
    </section>
  )
}

function ThreadMessageRow({
  message,
  thread,
  people,
}: {
  message: ThreadMessage
  thread: ReviewThread
  people: ThreadPeople
}) {
  const employee = people.employees.find((e) => e.id === message.authorId)
  const name = nameOf(message.authorId, people)
  const role = message.authorId === BOSS ? 'BOSS' : (employee?.title.toUpperCase() ?? '')
  // A reply from anyone but the reviewer that named no commit is the assignee saying no, not a fix.
  const pushback =
    message.authorId !== people.reviewerId && message.authorId !== thread.messages[0]?.authorId && !message.commit
  return (
    <article className="flex gap-10">
      <PersonAvatar id={message.authorId} name={name} people={peopleOf(people)} size={26} />
      <div className="flex min-w-0 flex-[1_1_0] flex-col gap-3">
        <div className="flex items-center gap-8">
          <strong className="font-semibold text-12-5/[inherit] text-foreground">{name}</strong>
          {role && (
            <span
              className="font-bold text-10-5/[inherit] text-muted-foreground tracking-[0.4px] [&[data-accent]]:text-accent-soft"
              data-accent={personAccent(message.authorId, people.employees) ?? undefined}
            >
              {role}
            </span>
          )}
          <time className="text-11/[inherit] text-muted-foreground" dateTime={message.createdAt}>
            {timeOf(message.createdAt)}
          </time>
          <span className="text-11/[inherit] text-muted-foreground">· round {message.round}</span>
          {pushback && (
            <span className="inline-flex shrink-0 items-center gap-4 rounded-full bg-secondary px-8 py-2 font-semibold text-10-5/[inherit] text-secondary-foreground">
              <Undo2 size={11} aria-hidden />
              Pushed back
            </span>
          )}
          {message.commit && (
            <span className="inline-flex shrink-0 items-center gap-4 rounded-full bg-secondary px-8 py-2 font-code text-10-5/[inherit] text-secondary-foreground">
              <GitCommitHorizontal size={12} aria-hidden />
              {shortSha(message.commit)}
            </span>
          )}
          {message.url && (
            <a className="text-11/[inherit] text-muted-foreground" href={message.url} target="_blank" rel="noreferrer">
              {`On ${forgeLabelOf(message.url) ?? 'the forge'}`}
            </a>
          )}
        </div>
        <p className="m-0 whitespace-pre-wrap text-12-5/19 text-soft-ink">
          <Written text={message.body} />
        </p>
      </div>
    </article>
  )
}

/** Everyone who said something in a thread, in the order they first did. */
function authors(thread: ReviewThread): string[] {
  return [...new Set(thread.messages.map((message) => message.authorId))]
}

function nameOf(id: string, people: ThreadPeople): string {
  if (id === BOSS) return people.bossName
  return people.employees.find((e) => e.id === id)?.name ?? 'Former employee'
}

function peopleOf(people: ThreadPeople): People {
  return { employees: people.employees }
}

/** A commit as the chip writes it: the first seven characters, however long the sha came in. */
export function shortSha(sha: string): string {
  return sha.trim().slice(0, 7)
}
