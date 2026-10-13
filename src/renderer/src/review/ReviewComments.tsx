/**
 * The comment thread under a diff line and the one-line box that writes into it. Kept apart from
 * `ReviewParts` so the Files view's Changes tab can draw a diff with comments without pulling in
 * the whole review screen, and so neither imports the other (T160).
 */
import { SendHorizontal } from 'lucide-react'
import type { FormEvent, RefObject } from 'react'
import { BOSS } from '../../../shared/domain/chat'
import type { Employee } from '../../../shared/domain/staff'
import { forgeLabelOf } from '../../../shared/forges'
import type { ReviewComment } from '../../../shared/review/review-diff'
import { Written } from '../paths'
import { type People, PersonAvatar, personAccent } from '../people'

/** The comments hanging under one line, and the box to add another. */
/*
 * The three things frame ZCYGy is measured on here; `review-screen.test.ts` compiles each list and
 * checks the measurement, so a drift fails a test rather than waiting to be seen in a capture.
 */
/** The one-line composer (review.html:5652-5664): filled like the panel behind it, not a well. */
export const COMPOSER = 'flex items-center gap-8 rounded-sm border border-border bg-card px-12 py-10'
export const COMPOSER_INPUT =
  'flex-[1_1_0] resize-none border-0 bg-transparent text-13/[inherit] text-foreground placeholder:text-muted-foreground focus:outline-none'
/** A role chip takes its author's own accent, never one purple for all of them. */
export const COMMENT_ROLE =
  'text-10-5/[inherit] font-bold tracking-[0.4px] text-muted-foreground [&[data-accent]]:text-accent-soft'

export function CommentThread(props: {
  comments: ReviewComment[]
  employees: Employee[]
  bossName: string
  line: number | null
  onComment(body: string): void
}) {
  return (
    <div className="flex flex-col gap-10 border-border border-t border-b border-l-3 border-l-primary bg-card py-12 pr-16 pl-64">
      {props.comments.map((comment) => (
        <CommentRow key={comment.id} comment={comment} employees={props.employees} bossName={props.bossName} />
      ))}
      <Composer placeholder={`Reply on line ${props.line ?? ''}…`} onSend={props.onComment} />
    </div>
  )
}

export function CommentRow(props: { comment: ReviewComment; employees: Employee[]; bossName: string }) {
  const { comment } = props
  const employee = props.employees.find((e) => e.id === comment.authorId)
  const name = comment.authorId === BOSS ? props.bossName : (employee?.name ?? 'Former employee')
  const role = comment.authorId === BOSS ? 'BOSS' : (employee?.title.toUpperCase() ?? '')
  const people: People = { employees: props.employees }
  return (
    <article className="flex gap-10">
      <PersonAvatar id={comment.authorId} name={name} people={people} size={26} />
      <div className="flex min-w-0 flex-[1_1_0] flex-col gap-3">
        <div className="flex items-center gap-8">
          <strong className="font-semibold text-12-5/[inherit] text-foreground">{name}</strong>
          {role && (
            <span className={COMMENT_ROLE} data-accent={personAccent(comment.authorId, props.employees) ?? undefined}>
              {role}
            </span>
          )}
          <time className="text-11/[inherit] text-muted-foreground" dateTime={comment.createdAt}>
            {timeOf(comment.createdAt)}
          </time>
          {comment.url && (
            <a className="text-11/[inherit] text-muted-foreground" href={comment.url} target="_blank" rel="noreferrer">
              {`On ${forgeLabelOf(comment.url) ?? 'the forge'}`}
            </a>
          )}
        </div>
        <p className="m-0 whitespace-pre-wrap text-12-5/19 text-soft-ink">
          <Written text={comment.body} />
        </p>
      </div>
    </article>
  )
}

function timeOf(iso: string): string {
  const date = new Date(iso)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** One line of text with a send button, used for a line comment and for the PR comment. */
export function Composer(props: {
  placeholder: string
  value?: string | undefined
  onChange?(text: string): void
  onSend(text: string): void
  disabled?: boolean
  inputRef?: RefObject<HTMLTextAreaElement | null>
}) {
  function send(event: FormEvent) {
    event.preventDefault()
    const input = (event.currentTarget as HTMLFormElement).elements.namedItem('body') as HTMLTextAreaElement | null
    const text = (props.value ?? input?.value ?? '').trim()
    if (!text) return
    props.onSend(text)
    if (input && props.value === undefined) input.value = ''
  }
  return (
    <form className={COMPOSER} onSubmit={send}>
      <textarea
        ref={props.inputRef}
        name="body"
        rows={1}
        className={COMPOSER_INPUT}
        placeholder={props.placeholder}
        {...(props.value === undefined
          ? {}
          : { value: props.value, onChange: (e) => props.onChange?.(e.target.value) })}
      />
      <button
        type="submit"
        className="flex cursor-pointer items-center border-0 bg-transparent p-0 text-muted-foreground"
        aria-label="Send"
        disabled={props.disabled}
      >
        <SendHorizontal size={15} aria-hidden />
      </button>
    </form>
  )
}
