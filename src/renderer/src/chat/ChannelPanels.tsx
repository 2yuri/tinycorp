import { Pin, PinOff, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  EVERYONE_LABEL,
  normalizeTopic,
  type PinnedMessage,
  pinnedLabel,
  searchLabel,
  searchSnippet,
  TOPIC_MAX,
} from '../../../shared/channel-extras'
import { BOSS, type Message } from '../../../shared/domain/chat'
import type { Employee } from '../../../shared/domain/staff'
import { PersonAvatar } from '../people'
import { Button, Checkbox, EmptyState, Search, Textarea } from '../ui'
import { type ChatData, formatTime, nameOf } from './chat-view'

/** Which panel the header's icons opened over the conversation, or none. */
export type ChannelPanel = 'about' | 'pins' | 'search'

/** The frame every panel shares: a title, a close button and its own body. */
function Panel(props: { title: string; onClose(): void; children: React.ReactNode }) {
  const frame = useRef<HTMLDivElement>(null)
  // Escape closes it, as it closes the thread panel and the ticket drawer.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') props.onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  useEffect(() => {
    frame.current?.focus()
  }, [])

  return (
    <div
      className="absolute top-12 right-16 z-20 flex max-h-[min(60%,520px)] w-[min(420px,calc(100%-32px))] flex-col rounded-md border border-border bg-popover text-popover-foreground shadow-menu focus:outline-none"
      role="dialog"
      aria-label={props.title}
      tabIndex={-1}
      ref={frame}
    >
      <header className="flex shrink-0 items-center gap-8 border-border border-b pt-14 pr-12 pb-10 pl-16">
        <h2 className="m-0 flex-auto font-semibold text-13/[1.3]">{props.title}</h2>
        <button
          type="button"
          className="flex size-26 shrink-0 cursor-pointer items-center justify-center rounded-sm border-none bg-transparent p-0 text-muted-foreground hover:bg-[color-mix(in_srgb,var(--secondary)_70%,transparent)] hover:text-popover-foreground"
          aria-label="Close"
          onClick={props.onClose}
        >
          <X size={16} aria-hidden />
        </button>
      </header>
      <div className="flex flex-auto flex-col gap-4 overflow-y-auto px-12 pt-10 pb-12">{props.children}</div>
    </div>
  )
}

/** A message as a panel row: who wrote it, when, and its body — clicking it goes to the message. */
function MessageRow(props: {
  message: Message
  data: ChatData
  query?: string
  onJump(): void
  action?: React.ReactNode
}) {
  const { message, data } = props
  const who = message.authorId === BOSS ? data.bossName || 'You' : nameOf(message.authorId, data.employees)
  const snippet = searchSnippet(message.text, props.query ?? '')
  return (
    <div className="flex items-start gap-4">
      <button
        type="button"
        className="flex min-w-0 flex-auto cursor-pointer gap-10 rounded-sm border-none bg-transparent p-8 text-left hover:bg-[color-mix(in_srgb,var(--secondary)_60%,transparent)]"
        onClick={props.onJump}
      >
        <PersonAvatar id={message.authorId} name={who} people={data} size={26} ring />
        <span className="flex min-w-0 flex-auto flex-col gap-2">
          <span className="flex items-baseline gap-8">
            <strong className="font-semibold text-12/[normal]">{who}</strong>
            <time className="text-11/[normal] text-muted-foreground" dateTime={message.createdAt}>
              {formatTime(message.createdAt)}
            </time>
            {message.threadId !== null && <span className="text-11/[normal] text-muted-foreground">in a thread</span>}
          </span>
          <span className="overflow-hidden text-ellipsis whitespace-nowrap text-12/[1.5] text-muted-foreground">
            {snippet.before}
            {snippet.match && (
              <mark className="rounded-[3px] bg-status-warning text-status-warning-foreground">{snippet.match}</mark>
            )}
            {snippet.after}
          </span>
        </span>
      </button>
      {props.action}
    </div>
  )
}

/** What the header's pin icon opens: the channel's pinned messages, newest pin first. */
export function PinnedPanel(props: {
  pins: PinnedMessage[]
  data: ChatData
  onJump(message: Message): void
  onUnpin(messageId: number): void
  onClose(): void
}) {
  return (
    <Panel title={pinnedLabel(props.pins.length)} onClose={props.onClose}>
      {props.pins.length === 0 ? (
        <EmptyState
          icon={Pin}
          title="Nothing pinned yet"
          body="Pin a message and everyone in the channel keeps it: a decision, the plan, the link people keep asking for."
        />
      ) : (
        props.pins.map((pin) => (
          <MessageRow
            key={pin.id}
            message={pin}
            data={props.data}
            onJump={() => props.onJump(pin)}
            action={
              <button
                type="button"
                className="mt-8 flex size-30 shrink-0 cursor-pointer items-center justify-center rounded-sm border-none bg-transparent p-0 text-muted-foreground hover:bg-[color-mix(in_srgb,var(--secondary)_70%,transparent)] hover:text-popover-foreground"
                aria-label={`Unpin ${nameOf(pin.authorId, props.data.employees)}’s message`}
                title="Unpin"
                onClick={() => props.onUnpin(pin.id)}
              >
                <PinOff size={15} aria-hidden />
              </button>
            }
          />
        ))
      )}
    </Panel>
  )
}

/** What the header's search icon opens: a box over this channel's messages, and where each one is. */
export function SearchPanel(props: {
  text: string
  results: Message[]
  data: ChatData
  onText(text: string): void
  onJump(message: Message): void
  onClose(): void
}) {
  return (
    <Panel title={searchLabel(props.results.length, props.text)} onClose={props.onClose}>
      <Search
        autoFocus
        placeholder="Search this channel…"
        value={props.text}
        onChange={(event) => props.onText(event.currentTarget.value)}
      />
      {props.results.map((message) => (
        <MessageRow
          key={message.id}
          message={message}
          data={props.data}
          query={props.text}
          onJump={() => props.onJump(message)}
        />
      ))}
    </Panel>
  )
}

/** What the header's member badge opens: the topic and the member list, both the boss's to set. */
export function AboutPanel(props: {
  title: string
  topic: string
  /** The channel's own member ids; empty means the whole Company. */
  memberIds: string[]
  employees: Employee[]
  onTopic(topic: string): void
  onMembers(memberIds: string[]): void
  onClose(): void
}) {
  const [topic, setTopic] = useState(props.topic)
  const everyone = props.memberIds.length === 0
  const chosen = new Set(props.memberIds)

  /** Turning `Everyone` off writes the roster out, so taking one person out means something. */
  function toggleEveryone(on: boolean) {
    props.onMembers(on ? [] : props.employees.map((e) => e.id))
  }

  function toggle(employeeId: string, on: boolean) {
    const next = props.employees.map((e) => e.id).filter((id) => (id === employeeId ? on : chosen.has(id)))
    props.onMembers(next)
  }

  return (
    <Panel title={`About ${props.title}`} onClose={props.onClose}>
      <Textarea
        label="Topic"
        rows={2}
        maxLength={TOPIC_MAX}
        placeholder="What this channel is for…"
        helper={`Shown under the channel name. ${TOPIC_MAX - topic.length} characters left.`}
        value={topic}
        onChange={(event) => setTopic(event.currentTarget.value)}
      />
      <div className="-mt-8 flex justify-end">
        <Button size="sm" disabled={normalizeTopic(topic) === props.topic} onClick={() => props.onTopic(topic)}>
          Save topic
        </Button>
      </div>
      <h3 className="mx-0 mt-14 mb-6 font-semibold text-11/[normal] text-muted-foreground uppercase tracking-[0.06em]">
        Members
      </h3>
      <Checkbox
        label={EVERYONE_LABEL}
        checked={everyone}
        onChange={(event) => toggleEveryone(event.currentTarget.checked)}
      />
      {props.employees.map((employee) => (
        <Checkbox
          key={employee.id}
          label={`${employee.name} · ${employee.title}`}
          checked={everyone || chosen.has(employee.id)}
          disabled={everyone}
          onChange={(event) => toggle(employee.id, event.currentTarget.checked)}
        />
      ))}
      {props.employees.length === 0 && (
        <p className="m-0 text-12/[normal] text-muted-foreground">Nobody works here yet.</p>
      )}
    </Panel>
  )
}
