import { Pin, PinOff } from 'lucide-react'
import { type ReactNode, useEffect, useRef } from 'react'
import { APP_NAME } from '../../../shared/app/app-name'
import type { Ticket } from '../../../shared/domain/board'
import { BOSS, CHANNEL_MENTION, type Mentionable, type Message } from '../../../shared/domain/chat'
import { hashSegments } from '../../../shared/ticket-refs'
import { urlSegments } from '../../../shared/url-links'
import { openTicket } from '../board'
import { LogoIcon } from '../brand'
import { Written } from '../paths'
import { PersonAvatar, personAccent } from '../people'
import { cx } from '../ui'
import { WaitingBadge } from './ApprovalCard'
import { AttachedFiles } from './Attachments'
import { MessageCard } from './Cards'
import { type ChatData, cardOf, formatTime, nameOf, roleTag, withDayDividers } from './chat-view'
import { MessageImages } from './MessageImages'
import { UrlLink } from './UrlLink'
import { useStickToBottom } from './use-stick-to-bottom'

/**
 * The design's soft body ink in chat: Slate 300 on the dark theme, the secondary ink on light.
 * `ui/tokens.css` has no token for it — the stylesheet carried it as a `--chat-soft` custom
 * property with a `[data-theme='light']` override, and this is that pair, per element.
 */
const SOFT = "text-[#cbd5e1] [[data-theme='light']_&]:text-secondary-foreground"

/**
 * A ticket or channel reference inside a message. The stylesheet opened with `all: unset`, which
 * cannot be translated as `[all:unset]`: Tailwind emits an arbitrary property *after* every named
 * utility, so it would wipe the colour and the font beside it rather than precede them. These are
 * the declarations `all: unset` actually changes on a `button` — chiefly `display: inline`, so the
 * reference flows with the sentence it is in.
 */
const REF =
  'inline m-0 cursor-pointer border-0 bg-transparent p-0 font-code font-normal text-[0.9em] text-foreground [appearance:none] [text-align:inherit] hover:text-status-info-foreground hover:underline focus-visible:rounded-[4px] focus-visible:shadow-focus'

/** `N replies` under a message, and the `Reply` that only a hover reveals. */
const REPLIES =
  'cursor-pointer border-0 bg-transparent p-0 font-semibold text-12/[normal] hover:text-foreground focus-visible:rounded-[4px] focus-visible:shadow-focus'

/** What a reference can point at: the board's tickets and the named channels. */
export interface Refs {
  tickets: Ticket[]
  channelIds: string[]
  /** The Company key ticket references carry, `TC` in `TC-142`; blank before the Company is read. */
  companyKey: string
  onChannel(id: string): void
}

/** A channel's top-level messages, with day dividers, rich cards and a way into each thread. */
export function MessageList(props: {
  messages: Message[]
  data: ChatData
  people: Mentionable[]
  refs: Refs
  activeThread: number | null
  onOpenThread(id: number): void
  /** The ids of this channel's pinned messages (T44). */
  pinnedIds?: Set<number>
  /** Pins or unpins one, as the boss (T44). */
  onPin?: ((messageId: number, pinned: boolean) => void) | undefined
  /** A message a pin or a search result jumped to: it scrolls into view and is marked (T44). */
  focusId?: number | null
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const focused = useRef<HTMLElement>(null)
  // A jump wins over the scroll to the end: it runs when the focus lands, and again once a longer
  // page brings a message that was older than the one loaded — never on every refresh after that.
  const focusId = props.focusId ?? null
  const hasFocus = focusId !== null && props.messages.some((m) => m.id === focusId)
  useStickToBottom(scroller, content, props.messages.at(-1)?.id ?? null, hasFocus)
  // biome-ignore lint/correctness/useExhaustiveDependencies: a fresh jump scrolls again even when the message was already on the page.
  useEffect(() => {
    if (hasFocus) void focused.current?.scrollIntoView({ block: 'center' })
  }, [focusId, hasFocus])

  return (
    <div ref={scroller} className="flex min-h-0 shrink grow basis-0 flex-col overflow-auto px-24 pt-18 pb-8">
      <div ref={content} className="flex shrink-0 flex-col gap-16">
        {props.messages.length === 0 && <p className="m-0 text-14/[normal] text-muted-foreground">No messages yet.</p>}
        {withDayDividers(props.messages).map((item) =>
          item.kind === 'day' ? (
            <div key={item.key} className="flex shrink-0 items-center gap-12 px-0 py-4">
              <hr className="m-0 h-1 shrink grow basis-0 border-0 bg-border" />
              <span className="whitespace-nowrap font-semibold text-11/[normal] text-muted-foreground">
                {item.label}
              </span>
              <hr className="m-0 h-1 shrink grow basis-0 border-0 bg-border" />
            </div>
          ) : (
            <MessageRow
              key={item.message.id}
              message={item.message}
              data={props.data}
              people={props.people}
              refs={props.refs}
              active={props.activeThread === item.message.id}
              onOpenThread={() => props.onOpenThread(item.message.id)}
              pinned={props.pinnedIds?.has(item.message.id) ?? false}
              onPin={props.onPin}
              focused={focusId === item.message.id}
              focusRef={focusId === item.message.id ? focused : undefined}
            />
          ),
        )}
      </div>
    </div>
  )
}

function MessageRow(props: {
  message: Message
  data: ChatData
  people: Mentionable[]
  refs: Refs
  active: boolean
  onOpenThread(): void
  pinned: boolean
  onPin?: ((messageId: number, pinned: boolean) => void) | undefined
  focused: boolean
  focusRef?: React.RefObject<HTMLElement | null> | undefined
}) {
  const { message: m, data } = props
  // The digest is the app talking, not the Company: it signs itself with the app's own mark (T172).
  const digest = m.kind === 'digest'
  const name = digest ? APP_NAME : m.authorId === BOSS ? data.bossName || 'You' : nameOf(m.authorId, data.employees)
  const card = cardOf(m, data)
  const waiting =
    (card?.kind === 'pr' || card?.kind === 'approval' || card?.kind === 'plan' || card?.kind === 'questions') &&
    card.waiting
  const role = digest ? 'APP' : roleTag(m.authorId, data.employees)
  return (
    <article
      ref={props.focusRef}
      className={cx(
        'group flex shrink-0 scroll-m-24 items-start gap-12',
        props.focused &&
          '-mx-10 -my-6 rounded-sm bg-[color-mix(in_srgb,var(--color-warning-foreground)_10%,transparent)] px-10 py-6 shadow-[inset_2px_0_0_var(--color-warning-foreground)]',
      )}
    >
      {digest ? (
        <LogoIcon className="shrink-0" role="img" aria-hidden={false} aria-label={APP_NAME} />
      ) : (
        <PersonAvatar id={m.authorId} name={name} people={data} size={34} ring />
      )}
      <div className="flex min-w-0 shrink grow basis-0 flex-col items-start gap-5">
        <div className="flex items-center gap-8 whitespace-nowrap">
          <strong className="font-bold text-14/[normal] text-foreground">{name}</strong>
          {role && (
            <span
              className="font-semibold text-11/[normal] text-muted-foreground tracking-[0.3px] [&[data-accent]]:text-accent-soft"
              data-accent={personAccent(m.authorId, data.employees) ?? undefined}
            >
              {role}
            </span>
          )}
          <time className="font-normal text-11/[normal] text-muted-foreground" dateTime={m.createdAt}>
            {formatTime(m.createdAt)}
          </time>
          {waiting && <WaitingBadge />}
          {props.pinned && (
            <span className="inline-flex items-center gap-3 font-semibold text-10/[normal] text-muted-foreground uppercase tracking-[0.04em]">
              <Pin size={11} aria-hidden />
              Pinned
            </span>
          )}
          {props.onPin && !digest && (
            <button
              type="button"
              className={cx(
                'flex size-22 cursor-pointer items-center justify-center rounded-sm border-none bg-transparent p-0 text-muted-foreground hover:bg-[color-mix(in_srgb,var(--secondary)_70%,transparent)] hover:text-foreground focus-visible:opacity-100',
                props.pinned ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
              )}
              aria-label={props.pinned ? `Unpin ${name}’s message` : `Pin ${name}’s message`}
              aria-pressed={props.pinned}
              title={props.pinned ? 'Unpin' : 'Pin to this channel'}
              onClick={() => props.onPin?.(m.id, !props.pinned)}
            >
              {props.pinned ? <PinOff size={13} aria-hidden /> : <Pin size={13} aria-hidden />}
            </button>
          )}
          {!hasCard(card) && !digest && m.replyCount === 0 && (
            <button
              type="button"
              className={cx(
                REPLIES,
                'opacity-0 focus-visible:opacity-100 group-hover:opacity-100',
                props.active ? 'text-foreground' : 'text-muted-foreground',
              )}
              onClick={props.onOpenThread}
            >
              Reply
            </button>
          )}
        </div>
        {m.text && !digest && (
          <p className={cx('m-0 w-full whitespace-pre-wrap font-normal text-14/22 [overflow-wrap:anywhere]', SOFT)}>
            <MessageText text={m.text} people={props.people} refs={props.refs} />
          </p>
        )}
        {m.text && !digest && <MessageImages text={m.text} />}
        {m.attachments && m.attachments.length > 0 && <AttachedFiles attachments={m.attachments} />}
        {card && <MessageCard card={card} onOpenThread={props.onOpenThread} />}
        {!hasCard(card) && !digest && m.replyCount > 0 && (
          <button
            type="button"
            className={cx(REPLIES, props.active ? 'text-foreground' : 'text-muted-foreground')}
            onClick={props.onOpenThread}
          >
            {m.replyCount} {m.replyCount === 1 ? 'reply' : 'replies'}
          </button>
        )}
      </div>
    </article>
  )
}

/** Cards that carry their own way into the thread, so the row does not add a second one. */
function hasCard(card: ReturnType<typeof cardOf>): boolean {
  return card?.kind === 'pr' || card?.kind === 'approval'
}

/** A reply in the thread panel: a smaller row. */
export function ReplyRow(props: {
  message: Message
  data: ChatData
  people: Mentionable[]
  refs: Refs
  /** The reply a notification opened the thread on: marked, the way a jump in the channel is (T287). */
  focused?: boolean
}) {
  const { message: m, data } = props
  const name = m.authorId === BOSS ? data.bossName || 'You' : nameOf(m.authorId, data.employees)
  const role = roleTag(m.authorId, data.employees)
  return (
    <article
      data-message-id={m.id}
      className={cx(
        'flex shrink-0 scroll-m-16 items-start gap-10',
        props.focused &&
          '-mx-8 -my-4 rounded-sm bg-[color-mix(in_srgb,var(--color-warning-foreground)_10%,transparent)] px-8 py-4 shadow-[inset_2px_0_0_var(--color-warning-foreground)]',
      )}
    >
      <PersonAvatar id={m.authorId} name={name} people={data} size={26} ring />
      <div className="flex min-w-0 shrink grow basis-0 flex-col gap-3">
        <div className="flex items-center gap-7 whitespace-nowrap">
          <strong className="font-bold text-12/[normal] text-foreground">{name}</strong>
          {role && (
            <span
              className="font-semibold text-10/[normal] text-muted-foreground [&[data-accent]]:text-accent-soft"
              data-accent={personAccent(m.authorId, data.employees) ?? undefined}
            >
              {role}
            </span>
          )}
          <time className="font-normal text-10/[normal] text-muted-foreground" dateTime={m.createdAt}>
            {formatTime(m.createdAt)}
          </time>
        </div>
        {m.text && (
          <p className={cx('m-0 whitespace-pre-wrap font-normal text-12-5/19 [overflow-wrap:anywhere]', SOFT)}>
            <MessageText text={m.text} people={props.people} refs={props.refs} />
          </p>
        )}
        {m.text && <MessageImages text={m.text} />}
        {m.attachments && m.attachments.length > 0 && <AttachedFiles attachments={m.attachments} />}
      </div>
    </article>
  )
}

/**
 * What an Employee wrote: every path in it is a link (T114), and what is left is the `#12`s, the
 * `#channel`s and the `@names` chat has always drawn.
 */
export function MessageText({ text, people, refs }: { text: string; people: Mentionable[]; refs: Refs }) {
  return <Written text={text} plain={(part, key) => <span key={key}>{linkify(part, people, refs)}</span>} />
}

/**
 * Turns a web address into a link that opens or copies it (T290), `#12` into a link to the ticket
 * and `#tech` into a link to the channel, then highlights mentions. The web links go first, so a
 * `#157` inside one stays part of the address.
 */
export function linkify(text: string, people: Mentionable[], refs: Refs): ReactNode[] {
  return urlSegments(text).flatMap((part, p): ReactNode[] =>
    part.url !== undefined ? [<UrlLink key={`u${p}`} url={part.url} />] : refsOf(part.text, people, refs, p),
  )
}

/** `#12`, `#tech` and `@names` in a run of text with no web link in it. */
function refsOf(text: string, people: Mentionable[], refs: Refs, part: number): ReactNode[] {
  return hashSegments(text, refs.channelIds, refs.companyKey).map((segment, n) => {
    const i = `${part}.${n}`
    const ticket = segment.ticketId === undefined ? undefined : refs.tickets.find((t) => t.id === segment.ticketId)
    if (ticket) {
      return (
        <button key={i} type="button" className={REF} title={ticket.title} onClick={() => openTicket(ticket.id)}>
          {segment.text}
        </button>
      )
    }
    if (segment.channelId !== undefined) {
      const channelId = segment.channelId
      return (
        <button key={i} type="button" className={REF} onClick={() => refs.onChannel(channelId)}>
          {segment.text}
        </button>
      )
    }
    return <span key={i}>{highlight(segment.text, people)}</span>
  })
}

/**
 * The `@Name` pattern for a list of people, built once for that list.
 *
 * `highlight` runs on every segment of every message on every render, and the pattern only depends
 * on who is in the channel — one array the chat view holds still across renders. The map is a memo
 * of a pure function keyed on that array, weak so a Company the boss has left is collected (T211).
 */
const MENTIONS = new WeakMap<Mentionable[], RegExp>()

function mentionPattern(people: Mentionable[]): RegExp {
  const known = MENTIONS.get(people)
  if (known) return known
  const names = [...people.map((p) => p.name), CHANNEL_MENTION, BOSS]
    .sort((a, b) => b.length - a.length)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_.])(@(?:${names.join('|')}))(?![\\p{L}\\p{N}_])`, 'giu')
  MENTIONS.set(people, pattern)
  return pattern
}

/** Wraps `@Name` and `@channel` in the text in a highlight. */
function highlight(text: string, people: Mentionable[]): ReactNode[] {
  return text.split(mentionPattern(people)).map((part, i) =>
    i % 2 === 1 ? (
      <mark key={i} className="rounded-[4px] bg-transparent font-semibold text-status-info-foreground">
        {part}
      </mark>
    ) : (
      part
    ),
  )
}
