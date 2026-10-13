import { CheckCheck, X } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { BOSS } from '../../../shared/domain/chat'
import type { Refs } from '../chat'
import {
  ApprovalCard,
  answererOf,
  type ChatData,
  Composer,
  companyKeyOf,
  InboxList,
  type SlashComposer,
  useChatData,
  useSlashComposer,
} from '../chat'
import { navigate } from '../chrome'
import { resources, useIpcResource } from '../ipc'
import { requestNotificationFocus } from '../notifications'
import { PersonAvatar, personAccent } from '../people'
import { EmptyState } from '../ui'
import { type DeskApproval, type DeskView, deskView } from './desk-view'
// The cards, the rows and the composer inside the panel are chat's own; the panel adds only its frame.
import '../ui/tailwind.css'
import { draftKeys } from '../../../shared/drafts'

/** The boss posts from their desk into `#general`, as the office's task bar does. */
const GENERAL = 'general'

const api = window.tinyCorp

/** Where a row of the panel sends the boss: a channel, and the thread inside it when there is one. */
export interface DeskTarget {
  channelId: string
  threadId: number | null
}

/**
 * The boss's own desk over the office floor (Pen frame `KP0yY`): what waits on their decision, what
 * is unread for them, and the shared composer. Everything comes from the engine data chat already
 * reads; the panel only arranges it.
 */
export function BossDesk(props: { companyId: string; onClose(): void }) {
  const data = useChatData()
  const approvals = useIpcResource(resources.pendingApprovals)
  // The boss's Inbox, the same rows the Chat Inbox lists (decision 43).
  const inbox = useIpcResource(resources.bossInbox)
  const [error, setError] = useState<string | null>(null)
  const view = useMemo(() => deskView(approvals, inbox, data), [approvals, inbox, data])

  const onClose = props.onClose
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  /** A row leaves the office for Chat, on the thread it is about — the route a notification takes. */
  const open = useCallback(
    (target: DeskTarget) => {
      onClose()
      navigate({ view: 'chat', channelId: target.channelId })
      requestNotificationFocus({ companyId: props.companyId, focus: { kind: 'thread', ...target } })
    },
    [onClose, props.companyId],
  )

  // An ask is answered in the terminal, so its row leaves the desk for that Employee's drawer (T165).
  const openTerminal = useCallback(
    (employeeId: string) => {
      onClose()
      requestNotificationFocus({ companyId: props.companyId, focus: { kind: 'employee', employeeId } })
    },
    [onClose, props.companyId],
  )

  const people = useMemo(() => data.employees.map(({ id, name }) => ({ id, name })), [data.employees])
  // The desk posts in `#general`; a command run from it leaves the office for the channel it opens.
  const slash = useSlashComposer({
    channelId: GENERAL,
    threadId: null,
    data,
    people,
    openChannel: (channelId) => open({ channelId, threadId: null }),
  })

  const send = useCallback(async (text: string): Promise<boolean> => {
    const result = await api.chat.post(GENERAL, text)
    setError(result.ok ? null : result.error)
    return result.ok
  }, [])

  return (
    <DeskPanel
      view={view}
      data={data}
      error={error}
      onClose={onClose}
      onOpen={open}
      onOpenTerminal={openTerminal}
      onSend={send}
      slash={slash}
    />
  )
}

/**
 * The panel itself, over what `deskView` produced: the head, `Waiting on you`, `Unread for you` and
 * the composer. Pure, so the three sections and the empty state are tested without the engine.
 */
export function DeskPanel(props: {
  view: DeskView
  data: ChatData
  error?: string | null
  onClose(): void
  onOpen(target: DeskTarget): void
  /** An `asking` row: open that Employee's drawer on the Terminal tab, where the boss answers (T165). */
  onOpenTerminal?: ((employeeId: string) => void) | undefined
  onSend(text: string): Promise<boolean>
  /** The slash commands the desk's composer runs (decision 37). */
  slash?: SlashComposer | undefined
}) {
  const { data, view } = props
  const people = useMemo(() => data.employees.map(({ id, name }) => ({ id, name })), [data.employees])
  // The desk posts in one channel only, so `#` completes tickets; naming a channel is Chat's job.
  const refs: Refs = {
    tickets: data.board?.tickets ?? [],
    channelIds: [],
    companyKey: companyKeyOf(data),
    onChannel: (channelId) => props.onOpen({ channelId, threadId: null }),
  }
  return (
    <aside className={PANEL} aria-label="Your desk">
      <header className="flex shrink-0 items-center gap-12 border-b border-b-border px-18 pt-18 pb-14">
        <PersonAvatar id={BOSS} name={data.bossName || 'You'} people={data} size={36} ring />
        <div className="flex min-w-0 flex-1 basis-0 flex-col gap-2">
          <h2 className="m-0 whitespace-nowrap font-bold text-17/normal tracking-[-0.3px]">Your desk</h2>
          <p className="m-0 whitespace-nowrap font-normal text-12/normal text-muted-foreground">{view.summary}</p>
        </div>
        <button type="button" className={CLOSE} aria-label="Close your desk" onClick={props.onClose}>
          <X size={17} aria-hidden />
        </button>
      </header>
      {/* The sections scroll under the head; the composer stays at the foot. */}
      <div className="flex min-h-0 flex-1 basis-0 flex-col gap-16 overflow-auto px-18 py-16">
        {view.empty ? (
          <EmptyState
            className="shrink-0"
            icon={CheckCheck}
            title="Nothing is waiting on you"
            body="Approvals and anything unread for you land here."
          />
        ) : (
          <>
            <Section label="Waiting on you" show={view.waiting.length > 0}>
              {view.waiting.map((waiting) => (
                <WaitingCard key={waiting.approval.id} waiting={waiting} data={data} />
              ))}
            </Section>
            <Section label="Unread for you" show={view.unread.length > 0}>
              <InboxList
                variant="compact"
                items={view.unread}
                data={data}
                openThread={null}
                onOpen={props.onOpen}
                onOpenTerminal={props.onOpenTerminal}
              />
            </Section>
          </>
        )}
      </div>
      <div className={FOOT}>
        {props.error && (
          <p className="mx-24 my-0 text-12/[normal] text-status-error-foreground" role="alert">
            {props.error}
          </p>
        )}
        <Composer
          variant="main"
          draftKey={draftKeys.desk}
          placeholder="Set a goal, or ask the team something…"
          hint={answerHint(data)}
          people={people}
          refs={refs}
          slash={props.slash}
          onSend={props.onSend}
        />
      </div>
    </aside>
  )
}

/**
 * The panel itself (Pen frame `KP0yY`: Split → Your Desk Panel): 420px over the office floor. It
 * slides over the room exactly as the Employee drawer does, so opening it never resizes the office
 * — `absolute`, not a column of the split.
 *
 * `--chat-soft` is chat's own body ink, which the cards inside the panel read. It is Slate 300 on
 * the dark room and the secondary ink on a light one; there is no token for it, so the hex stays
 * where `your-desk.css` had it, as a property set for the subtree rather than a colour drawn here.
 * The shadow is the frame's own too, and no `--elevation-*` carries it.
 */
const PANEL =
  'absolute inset-y-0 right-0 z-10 flex w-420 max-w-full shrink-0 flex-col border-l border-l-border bg-card text-foreground leading-normal shadow-[-12px_0_32px_0_#00000059] [--chat-soft:#cbd5e1] [[data-theme=light]_&]:[--chat-soft:var(--secondary-foreground)]'

/** The head's close button: the frame gives it no box of its own, only the ink that follows the hover. */
const CLOSE =
  'flex shrink-0 items-center justify-center rounded-sm border-0 bg-transparent p-0 text-muted-foreground hover:text-foreground focus-visible:shadow-focus focus-visible:outline-none'

/**
 * The foot: the shared composer, held under a body that grows. It carries the panel's own surface
 * because the body scrolls beneath it.
 *
 * The three reaches into chat's composer are the ones `your-desk.css` made by class name. T210a
 * took chat's classes away with its stylesheet, so they are made through what that composer still
 * says about itself: `data-composer`, the hook it kept for exactly this; the box, which is the one
 * child of the form the textarea is in; and the button that says `Send`. Chat's own utilities and
 * these sit in one layer now, so it is the descendant selector that settles them, not an `!`.
 */
const FOOT =
  'flex shrink-0 flex-col gap-8 bg-card px-18 pt-2 pb-16 [&_[data-composer]>div:has(textarea)]:gap-8 [&_[data-composer]>div:has(textarea)]:p-12 [&_[data-composer]_textarea]:text-13/[normal] [&_[data-composer]_[aria-label=Send]]:size-28'

/** `Hera answers`: who picks up a message of the boss that mentions nobody (decision 41, T63). */
function answerHint(data: ChatData): string {
  const answerer = answererOf(data)
  return answerer ? `${answerer.name} answers` : 'Everyone reads it'
}

/** A captioned run of the body, drawn only when it has something in it. */
function Section(props: { label: string; show: boolean; children: ReactNode }) {
  if (!props.show) return null
  return (
    <section className="flex w-full shrink-0 flex-col gap-16" aria-label={props.label}>
      <h3 className="m-0 font-bold text-11/normal text-muted-foreground uppercase tracking-[0.5px]">{props.label}</h3>
      {props.children}
    </section>
  )
}

/**
 * The card is already the panel's box, so the chat approval card inside it drops its own frame and
 * padding. That card no longer carries class names either (T210a), so it is reached by the label it
 * answers to and by its own parts: the head, the reason, and the two rows under them.
 *
 * `text-11-5` is the reason's whole rule: 11.5px on the 17px line is the scale's own. The sheet
 * also set 11.5px on the facts row, which never reached a fact — every one of them states its own
 * size — so that rule is not carried over rather than carried over dead.
 */
const CARD =
  'flex w-full shrink-0 flex-col gap-10 rounded-md border border-border bg-card p-12 [&_[aria-label=Approval]]:gap-10 [&_[aria-label=Approval]]:rounded-none [&_[aria-label=Approval]]:border-l-0 [&_[aria-label=Approval]]:bg-transparent [&_[aria-label=Approval]>header]:p-0 [&_[aria-label=Approval]>p]:p-0 [&_[aria-label=Approval]>p]:text-11-5 [&_[aria-label=Approval]>div]:flex-wrap [&_[aria-label=Approval]>div]:gap-10 [&_[aria-label=Approval]>div]:p-0'

/** One approval card, under the line that says who asked and when. */
function WaitingCard({ waiting, data }: { waiting: DeskApproval; data: ChatData }) {
  const requesterId = waiting.approval.requesterId
  return (
    <article className={CARD}>
      <div className="flex items-center gap-9 whitespace-nowrap">
        <PersonAvatar id={requesterId} name={waiting.who} people={data} size={26} ring />
        <span className="font-semibold text-12-5/normal text-foreground">{waiting.who}</span>
        {waiting.role && (
          // An Employee's role tag takes their light accent, as it does on a chat message.
          <span
            className="font-bold text-10-5/normal text-muted-foreground tracking-[0.4px] data-accent:text-accent-soft"
            data-accent={personAccent(requesterId, data.employees) ?? undefined}
          >
            {waiting.role}
          </span>
        )}
        <span className="shrink grow basis-0" />
        <time className="font-normal text-11/normal text-muted-foreground" dateTime={waiting.approval.createdAt}>
          {waiting.time}
        </time>
      </div>
      <ApprovalCard card={waiting.card} />
    </article>
  )
}
