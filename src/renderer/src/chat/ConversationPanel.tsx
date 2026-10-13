import { ArrowUpRight, MessagesSquare, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { Approval } from '../../../shared/approvals'
import type { AttachmentSource } from '../../../shared/attachments'
import type { Mentionable, Message } from '../../../shared/domain/chat'
import { cx, EmptyState } from '../ui'
import { Composer, type SlashComposer } from './Composer'
import { type ChatData, withDayDividers } from './chat-view'
import type { Conversation } from './conversation'
import { type Refs, ReplyRow } from './Messages'
import { ApprovalBlock } from './ThreadPanel'

/** One of the panel's flat icon buttons, as the thread panel draws them. */
const TOOL =
  'inline-flex shrink-0 cursor-pointer items-center justify-center rounded-[4px] border-0 bg-transparent p-0 text-muted-foreground hover:not-disabled:text-foreground disabled:cursor-default focus-visible:shadow-focus focus-visible:outline-none'

/**
 * The message the row was about, one step up from the panel it is on.
 *
 * Frame `JRSDX` fills it with `--muted`, which in the Dark theme is `#1e293b` — the same value as
 * `--card`, the panel's own fill, so the frame's highlight draws nothing at all (measured off the
 * export; both are `#1e293b`). This is the next step that is really a step: the same wash the shell
 * puts under a row you are pointing at, which is how the Inbox's own open row reads as open.
 */
const OPENED = 'bg-[color-mix(in_srgb,var(--secondary)_60%,transparent)]'

/** A day divider, and the New divider that is the same rule in `--destructive` (frame `JRSDX`). */
const DIVIDER = 'flex shrink-0 items-center gap-10 px-16 py-10'

/**
 * The Inbox's right-hand panel: the whole conversation the opened row lives in, not the one message
 * it is (T251). A row that is a decision keeps the PR card and its Approve / Send back above it.
 *
 * The panel is anchored to the bottom, the way a chat is: with less to show than the panel is tall
 * the newest message still sits above the composer rather than floating at the top.
 */
export function ConversationPanel(props: {
  conversation: Conversation
  data: ChatData
  people: Mentionable[]
  refs: Refs
  /** The slash commands the box runs, on the conversation the boss is looking at (decision 37). */
  slash?: SlashComposer | undefined
  /** The pending Approval whose card and actions sit above the conversation; null leaves them out. */
  approval?: Approval | null | undefined
  onSend(text: string, attachments: AttachmentSource[]): Promise<boolean>
  /** Leaves the Inbox for the channel or thread this conversation is, in Chat itself. */
  onOpenInChat(): void
  onClose(): void
}) {
  const { conversation } = props
  return (
    <aside className="flex w-368 shrink-0 flex-col border-border border-l bg-card" aria-label={conversation.title}>
      <header className="flex h-64 shrink-0 items-center gap-10 border-border border-b px-16 py-0">
        <div className="flex min-w-0 shrink grow basis-0 flex-col gap-1">
          <strong className="truncate font-bold text-14/[normal] text-foreground">{conversation.title}</strong>
          <span className="truncate font-normal text-11/[normal] text-muted-foreground">{conversation.origin}</span>
        </div>
        <button
          type="button"
          className={TOOL}
          aria-label="Open in Chat"
          title="Open in Chat"
          onClick={props.onOpenInChat}
        >
          <ArrowUpRight size={17} aria-hidden />
        </button>
        <button type="button" className={TOOL} aria-label="Close" title="Close" onClick={props.onClose}>
          <X size={17} aria-hidden />
        </button>
      </header>
      {props.approval && (
        <div className="flex shrink-0 flex-col gap-14 border-border border-b p-16">
          <ApprovalBlock approval={props.approval} data={props.data} />
        </div>
      )}
      {conversation.messages.length === 0 ? (
        <div className="flex min-h-0 shrink grow basis-0 flex-col justify-center gap-14 overflow-auto p-16">
          <EmptyState
            icon={MessagesSquare}
            title="Nothing open"
            body="Open a row in the Inbox to read the conversation it is in."
          />
        </div>
      ) : (
        <Body conversation={conversation} data={props.data} people={props.people} refs={props.refs} />
      )}
      <div className="flex shrink-0 px-16 pt-0 pb-16">
        <Composer
          key={conversation.draftKey}
          variant="reply"
          draftKey={conversation.draftKey}
          placeholder={conversation.placeholder}
          people={props.people}
          refs={props.refs}
          slash={props.slash}
          onSend={props.onSend}
        />
      </div>
    </aside>
  )
}

function Body(props: { conversation: Conversation; data: ChatData; people: Mentionable[]; refs: Refs }) {
  const { conversation } = props
  const opened = useRef<HTMLDivElement>(null)
  // The panel opens on the message the row was about, wherever in the conversation it sits.
  useEffect(() => {
    void opened.current?.scrollIntoView({ block: 'center' })
  }, [])
  return (
    <div className="flex min-h-0 shrink grow basis-0 flex-col overflow-auto py-8">
      <div className="mt-auto flex flex-col">
        {withDayDividers(conversation.messages).map((item) =>
          item.kind === 'day' ? (
            <Divider key={item.key} label={item.label} />
          ) : (
            <Row
              key={item.message.id}
              message={item.message}
              conversation={conversation}
              data={props.data}
              people={props.people}
              refs={props.refs}
              openedRef={item.message.id === conversation.messageId ? opened : undefined}
            />
          ),
        )}
      </div>
    </div>
  )
}

function Row(props: {
  message: Message
  conversation: Conversation
  data: ChatData
  people: Mentionable[]
  refs: Refs
  openedRef?: React.RefObject<HTMLDivElement | null> | undefined
}) {
  const { message, conversation } = props
  const opened = message.id === conversation.messageId
  return (
    <>
      {message.id === conversation.firstUnreadId && <Divider label="New" fresh />}
      <div
        ref={props.openedRef}
        className={cx('scroll-m-24 px-16 py-7', opened && OPENED)}
        data-ui={opened ? 'Opened Message' : undefined}
      >
        <ReplyRow message={message} data={props.data} people={props.people} refs={props.refs} />
      </div>
    </>
  )
}

/** `Yesterday` in the muted ink, and `New` in `--destructive`: the line the boss stopped reading at. */
function Divider({ label, fresh }: { label: string; fresh?: boolean }) {
  return (
    <div className={DIVIDER} data-ui={fresh ? 'New Divider' : 'Day Divider'}>
      <span className={cx('h-1 shrink grow basis-0', fresh ? 'bg-destructive' : 'bg-border')} aria-hidden />
      <span
        className={cx(
          'whitespace-nowrap text-10-5/[normal]',
          fresh ? 'font-bold text-destructive' : 'font-semibold text-muted-foreground',
        )}
      >
        {label}
      </span>
      <span className={cx('h-1 shrink grow basis-0', fresh ? 'bg-destructive' : 'bg-border')} aria-hidden />
    </div>
  )
}
