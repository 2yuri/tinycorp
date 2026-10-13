import { Eye, MessagesSquare, Send } from 'lucide-react'
import { type FormEvent, useCallback, useEffect, useState } from 'react'
import type { Message } from '../../../shared/domain/chat'
import type { Employee } from '../../../shared/domain/staff'
import type { EmployeeConversation } from '../../../shared/employee-chats'
import { formatTime, nameOf, roleTag } from '../chat'
import { InboxPanel, type InboxState } from '../inbox'
import { resources, useIpcResource } from '../ipc'
import { Written } from '../paths'
import { type People, PersonAvatar, personAccent } from '../people'
import { cx, EmptyState } from '../ui'
import { conversationRows, readAlong, selectedConversation } from './chats-model'
import '../ui/tailwind.css'

const chat = window.tinyCorp.chat

/** How many messages of a conversation the drawer reads along. */
const READ_LIMIT = 30

export interface ChatsState {
  /** Newest first, as the engine orders them. */
  conversations: EmployeeConversation[]
  /** The one being read along; null while the Employee has no conversation. */
  selected: EmployeeConversation | null
  /** The selected conversation's recent messages, oldest first. */
  messages: Message[]
  employees: Employee[]
  people: People
  error: string | null
  select(channelId: string): void
  post(text: string): void
}

/** The conversations of one Employee, kept live, with the one being read along. */
export function useEmployeeChats(employeeId: string): ChatsState {
  const [conversations, setConversations] = useState<EmployeeConversation[]>([])
  const employees = useIpcResource(resources.employees)
  const [messages, setMessages] = useState<Message[]>([])
  const [picked, setPicked] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const selected = selectedConversation(conversations, picked)
  const channelId = selected?.channelId ?? null

  const refresh = useCallback(async () => {
    const result = await chat.conversations(employeeId)
    setError(result.ok ? null : result.error)
    if (result.ok) setConversations(result.value)
  }, [employeeId])

  useEffect(() => {
    void refresh()
    return chat.onChanged(() => void refresh())
  }, [refresh])

  useEffect(() => {
    if (channelId === null) return setMessages([])
    let live = true
    const read = async () => {
      const result = await chat.read({ channelId, limit: READ_LIMIT })
      if (live && result.ok) setMessages(result.value)
    }
    void read()
    const off = chat.onChanged(() => void read())
    return () => {
      // A read in flight when the conversation changes must not land on the new one.
      live = false
      off()
    }
  }, [channelId])

  return {
    conversations,
    selected,
    messages,
    employees,
    people: { employees },
    error,
    select(id) {
      setPicked(id)
      // Reading along is reading: the row's dot clears as the boss opens it.
      void chat.markRead(id)
    },
    post(text) {
      if (channelId === null) return
      void chat.post(channelId, text).then((result) => setError(result.ok ? null : result.error))
    },
  }
}

/**
 * The drawer's Chats tab (`design/html/employee-drawer-chats.html`, frame `VkcVg`): the
 * conversations list, the Wakes disclosure and the read-along pane under them.
 *
 * Several names here are kept because `ChatsPanel.test.tsx` reads the markup as a string rather than
 * as a DOM: it counts `drawer-conv__dot`, asserts `drawer-conv--open` moves between rows, and checks
 * the order of `drawer-read-along__messages`, `drawer-chats__push`, `drawer-read-only` and
 * `drawer-wakes` with `indexOf`. `drawer-conv__avatar` carries no style at all and is kept for the
 * opposite reason: the test asserts a channel row draws **no** avatar, and deleting the name would
 * make that pass for the wrong reason.
 *
 * `.drawer-conv--unread .drawer-conv__who` and `__last` were descendant rules; the row knows whether
 * it is unread, so the weight and the ink are chosen at the element instead. Two utilities for one
 * property on one element would otherwise be settled by Tailwind's own order.
 */

/* Four rows fit as the frame draws them; a longer list scrolls rather than crowd the read-along. */
const LIST = 'flex max-h-[45%] flex-col gap-2 overflow-auto border-b border-border px-10 py-12'

const CAPTION = 'mt-0 mr-0 mb-6 ml-0 font-bold text-11/[normal] uppercase tracking-[0.5px] text-muted-foreground'

/*
 * The open row takes the panel's own surface, exactly as the frame draws it — so it reads no
 * differently, and the read-along head below is what names the conversation being read.
 */
/* Two whole lists, not a list and an override: see `CHIP` in `memory/MemoryList.tsx` for why. */
const CONV =
  'drawer-conv m-0 flex w-full cursor-pointer items-center gap-9 rounded-sm border-0 bg-transparent p-8 text-left hover:bg-[color-mix(in_srgb,var(--card)_60%,transparent)] focus-visible:shadow-focus focus-visible:outline-none'

const CONV_OPEN =
  'drawer-conv m-0 flex w-full cursor-pointer items-center gap-9 rounded-sm border-0 bg-card p-8 text-left focus-visible:shadow-focus focus-visible:outline-none'

/* A channel keeps a hash tile where a DM draws the counterpart's character. */
const HASH =
  'drawer-conv__hash flex size-28 shrink-0 items-center justify-center rounded-full bg-secondary font-bold text-13/[normal] text-muted-foreground'

const WHO = 'drawer-conv__who overflow-hidden text-ellipsis whitespace-nowrap text-12-5/[normal] text-foreground'

/*
 * The list keeps role tags neutral and the read-along gives them the Employee's accent, as the frame
 * draws them: the list is a scan, the conversation is where colour tells people apart.
 */
const ROLE = 'drawer-conv__role shrink-0 font-bold text-10-5/[normal] tracking-[0.4px] text-muted-foreground'

const TIME = 'drawer-conv__time shrink-0 font-normal text-11/[normal] text-muted-foreground'

const DOT = 'drawer-conv__dot size-7 shrink-0 rounded-full bg-primary'

const LAST = 'drawer-conv__last w-full overflow-hidden text-ellipsis whitespace-nowrap font-normal text-11-5/[normal]'

/*
 * Wakes: the old Inbox list, kept under a disclosure so nothing is lost. The frame draws no such
 * list, so it sits with the conversations above the read-along, out of the pinned bar's way.
 */
const WAKES =
  'drawer-wakes max-h-[40%] shrink-0 overflow-auto border-b border-border px-14 pt-10 pb-14 [&_.inbox-panel]:mt-10'

const WAKES_SUMMARY =
  'flex cursor-pointer items-center gap-7 font-bold text-11/[normal] uppercase tracking-[0.5px] text-muted-foreground'

const WAKES_COUNT =
  'drawer-wakes__count inline-flex h-18 min-w-18 items-center justify-center rounded-full bg-secondary px-5 font-bold text-9/[normal] tracking-[0] text-soft-ink'

const READ_ALONG = 'drawer-read-along flex min-h-0 flex-1 flex-col gap-14 p-14'

const ALONG_TITLE = 'whitespace-nowrap font-semibold text-12-5/[normal] text-foreground'

const ALONG_NOTE = 'whitespace-nowrap font-normal text-11/[normal] text-muted-foreground'

/* The thread is what gives way when it grows; the head above and the bar below stay put. */
const MESSAGES = 'drawer-read-along__messages flex min-h-0 flex-col gap-14 overflow-auto'

/* A DM the boss is not in: read-only, with the way to join it. */
const READ_ONLY =
  'drawer-read-only m-0 flex shrink-0 items-center gap-9 rounded-sm bg-secondary px-12 py-10 font-normal text-11-5/[normal] text-muted-foreground [&_svg]:shrink-0'

const MSG_NAME = 'font-semibold text-12-5/[normal] text-foreground'

const MSG_ROLE = 'font-bold text-10-5/[normal] tracking-[0.4px] text-muted-foreground data-accent:text-accent-soft'

const MSG_TIME = 'font-normal text-11/[normal] text-muted-foreground'

const MSG_TEXT = 'm-0 font-normal text-12-5/19 text-soft-ink [overflow-wrap:anywhere]'

/* The composer, where the boss takes part. */
const POST =
  'drawer-post flex shrink-0 items-center gap-8 rounded-sm border border-border bg-background py-6 pr-6 pl-12'

const POST_INPUT =
  'min-w-0 flex-1 border-0 bg-transparent font-sans text-12-5/[normal] text-foreground focus:outline-none placeholder:text-muted-foreground'

const POST_SEND =
  'flex size-28 shrink-0 cursor-pointer items-center justify-center rounded-sm border-0 bg-primary p-0 text-primary-foreground disabled:cursor-default disabled:opacity-40'

/** The drawer's Chats tab (design/html/employee-drawer-chats.html): conversations, read-along, wakes. */
export function ChatsPanel(props: { chats: ChatsState; employee: Employee; inbox: InboxState }) {
  const { chats, employee } = props
  const rows = conversationRows(chats.conversations, chats.employees)
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden" role="tabpanel" data-testid="drawer-chats">
      {chats.error && (
        <p className="mt-8 mr-14 mb-0 ml-14 text-12/[normal] text-destructive" role="alert">
          {chats.error}
        </p>
      )}
      {rows.length === 0 ? (
        <EmptyState title="No conversations yet" body={`${employee.name} has not talked to anyone.`} />
      ) : (
        <>
          <div className={LIST}>
            <h4 className={CAPTION}>Conversations</h4>
            {rows.map((row) => (
              <button
                key={row.channelId}
                type="button"
                className={cx(
                  row.channelId === chats.selected?.channelId ? CONV_OPEN : CONV,
                  row.channelId === chats.selected?.channelId && 'drawer-conv--open',
                  row.unread && 'drawer-conv--unread',
                )}
                aria-current={row.channelId === chats.selected?.channelId}
                onClick={() => chats.select(row.channelId)}
              >
                {row.avatarId === null ? (
                  <span className={HASH} aria-hidden>
                    #
                  </span>
                ) : (
                  <PersonAvatar
                    id={row.avatarId}
                    name={row.title}
                    people={chats.people}
                    size={28}
                    ring
                    className="drawer-conv__avatar"
                  />
                )}
                <span className="drawer-conv__text flex min-w-0 flex-1 flex-col gap-2">
                  <span className="drawer-conv__head flex w-full items-center gap-7">
                    <span className={cx(WHO, row.unread ? 'font-semibold' : 'font-medium')}>{row.title}</span>
                    {row.role && <span className={ROLE}>{row.role}</span>}
                    <span className="drawer-conv__spacer flex-1" />
                    <span className={TIME}>{row.time}</span>
                    {row.unread && <span className={DOT} role="img" aria-label="Unread" />}
                  </span>
                  <span className={cx(LAST, row.unread ? 'text-soft-ink' : 'text-muted-foreground')}>
                    {row.preview}
                  </span>
                </span>
              </button>
            ))}
          </div>
          <Wakes inbox={props.inbox} />
          {chats.selected && <ReadAlongPane chats={chats} conversation={chats.selected} employee={employee} />}
        </>
      )}
    </section>
  )
}

/*
 * The wake list the old Inbox tab held, kept so nothing is lost. The frame does not draw it, so it
 * sits above the read-along — which keeps the read-only bar pinned at the drawer's foot — and only
 * appears once the Employee has been woken.
 */
function Wakes(props: { inbox: InboxState }) {
  const { inbox } = props
  if (inbox.pending.length + inbox.unread.length + inbox.handled.length === 0) return null
  return (
    <details className={WAKES}>
      <summary className={WAKES_SUMMARY}>
        Wakes
        {inbox.pending.length > 0 && <span className={WAKES_COUNT}>{inbox.pending.length}</span>}
      </summary>
      <InboxPanel inbox={inbox} />
    </details>
  )
}

function ReadAlongPane(props: { chats: ChatsState; conversation: EmployeeConversation; employee: Employee }) {
  const { chats, conversation } = props
  const pane = readAlong(conversation, props.employee, chats.employees)
  return (
    <div className={READ_ALONG} data-testid="drawer-read-along">
      <div className="flex shrink-0 items-center gap-8 text-muted-foreground">
        <MessagesSquare size={14} aria-hidden />
        <span className={ALONG_TITLE}>{pane.title}</span>
        <span className="flex-1" />
        {pane.note && <span className={ALONG_NOTE}>{pane.note}</span>}
      </div>
      <div className={MESSAGES}>
        {chats.messages.length === 0 && <p className="m-0 text-12/[normal] text-muted-foreground">No messages yet.</p>}
        {chats.messages.map((message) => (
          <ReadAlongMessage key={message.id} message={message} chats={chats} />
        ))}
      </div>
      <span className="drawer-chats__push flex-1" />
      {pane.banner === null ? (
        <PostBox onPost={chats.post} name={pane.title} />
      ) : (
        <p className={READ_ONLY}>
          <Eye size={14} aria-hidden />
          {pane.banner}
        </p>
      )}
    </div>
  )
}

function ReadAlongMessage(props: { message: Message; chats: ChatsState }) {
  const { message, chats } = props
  const name = nameOf(message.authorId, chats.employees)
  const role = roleTag(message.authorId, chats.employees)
  return (
    <article className="flex items-start gap-10">
      <PersonAvatar id={message.authorId} name={name} people={chats.people} size={26} ring />
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex items-center gap-8">
          <strong className={MSG_NAME}>{name}</strong>
          {role && (
            <span className={MSG_ROLE} data-accent={personAccent(message.authorId, chats.employees) ?? undefined}>
              {role}
            </span>
          )}
          <time className={MSG_TIME} dateTime={message.createdAt}>
            {formatTime(message.createdAt)}
          </time>
        </div>
        <p className={MSG_TEXT}>
          <Written text={message.text} />
        </p>
      </div>
    </article>
  )
}

/** The composer the boss gets where they take part: their own DM and every channel. */
function PostBox(props: { onPost(text: string): void; name: string }) {
  const [text, setText] = useState('')
  function submit(event: FormEvent) {
    event.preventDefault()
    const body = text.trim()
    if (!body) return
    props.onPost(body)
    setText('')
  }
  return (
    <form className={POST} onSubmit={submit}>
      <input
        className={POST_INPUT}
        value={text}
        placeholder={`Message ${props.name}…`}
        aria-label={`Message ${props.name}`}
        onChange={(event) => setText(event.target.value)}
      />
      <button type="submit" className={POST_SEND} aria-label="Send" disabled={text.trim() === ''}>
        <Send size={14} aria-hidden />
      </button>
    </form>
  )
}
