import { useCallback, useEffect, useState } from 'react'
import { BOSS, dmMembers } from '../../../shared/domain/chat'
import type { InboxItem, WakeKind } from '../../../shared/inbox'
import { ticketCode } from '../../../shared/ticket-id'
import { resources, useIpcResource } from '../ipc'
import { Written } from '../paths'
import { type People, PersonAvatar } from '../people'
import { cx } from '../ui'

const api = window.tinyCorp.inbox

/** Handled items older than this many are not shown. */
const HANDLED_SHOWN = 20

const KIND_LABEL: Record<WakeKind, string> = {
  dm: 'DM',
  mention: '@mention',
  ticket: '#ticket',
  channel: '@channel',
  epic: 'epic',
  approval: 'Approval',
  assigned: 'assigned',
  intake: 'intake',
  resume: 'restart',
  review: 'review',
  general: 'someone else answers',
  thread: 'thread',
  session: 'your Session',
  planning: 'planning',
  testing: 'testing',
  unblocked: 'unblocked',
  deleted: 'deleted',
}

/** What the panel knows of the boss, so an item they sent draws their own tile. */
type BossTile = Pick<People, 'bossInitials' | 'bossSprite'>

export interface InboxState {
  pending: InboxItem[]
  /** Messages someone else answers, filed to read and never pushed (decision 41). Newest first. */
  unread: InboxItem[]
  /** Newest first, at most the last few. */
  handled: InboxItem[]
  error: string | null
  nameOf(id: string): string
  /** Who the rows are from, so each one draws its sender's avatar. */
  people: People
  /** The Company key a row's ticket id carries, `TC` in `TC-142`; blank until the Company is read. */
  companyKey: string
}

/** An Employee's inbox, kept live: what waits for its next idle turn, and what was delivered. */
export function useInbox(employeeId: string): InboxState {
  const [items, setItems] = useState<InboxItem[]>([])
  const employees = useIpcResource(resources.employees)
  // Items from the boss draw the character they chose in Your profile (T79).
  const company = useIpcResource(resources.company)
  const bossTile: BossTile = { bossInitials: company?.boss.initials, bossSprite: company?.boss.sprite }
  const companyKey = company?.key ?? ''
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const result = await api.list(employeeId)
    setError(result.ok ? null : result.error)
    if (result.ok) setItems(result.value)
  }, [employeeId])

  useEffect(() => {
    setItems([])
    void refresh()
    return api.onChanged(() => void refresh())
  }, [refresh])

  return {
    pending: items.filter((item) => item.status === 'pending'),
    unread: items
      .filter((item) => item.status === 'unread')
      .reverse()
      .slice(0, HANDLED_SHOWN),
    handled: items
      .filter((item) => item.status === 'handled')
      .reverse()
      .slice(0, HANDLED_SHOWN),
    error,
    nameOf: (id) => (id === BOSS ? 'boss' : (employees.find((e) => e.id === id)?.name ?? 'former employee')),
    people: { employees, ...bossTile },
    companyKey,
  }
}

/** The inbox's pending and handled items. */
export function InboxPanel({ inbox }: { inbox: InboxState }) {
  return (
    <section className="flex flex-col gap-16 font-sans leading-[normal]" data-testid="inbox-panel">
      {inbox.error && (
        <p className="m-0 text-destructive" role="alert">
          {inbox.error}
        </p>
      )}
      <InboxList title="Pending" items={inbox.pending} empty="Nothing waiting." inbox={inbox} />
      <InboxList title="Unread" items={inbox.unread} empty="Nothing to read." inbox={inbox} />
      <InboxList title="Handled" items={inbox.handled} empty="Nothing delivered yet." inbox={inbox} />
    </section>
  )
}

function InboxList(props: { title: string; items: InboxItem[]; empty: string; inbox: InboxState }) {
  return (
    <section>
      <h4 className="m-0 mb-8 font-semibold text-12/[normal] text-foreground">{props.title}</h4>
      {props.items.length === 0 && <p className="m-0 text-12/[normal] text-muted-foreground">{props.empty}</p>}
      <ul className="m-0 flex list-none flex-col gap-8 p-0">
        {props.items.map((item) => (
          <li
            key={item.id}
            className={cx(
              'flex flex-col gap-6 rounded-sm border border-border border-l-2 bg-card px-12 py-10',
              item.status === 'handled' ? 'border-l-border' : 'border-l-primary',
            )}
            title={item.prompt}
          >
            <div className="flex flex-wrap items-center gap-6 text-11-5/[normal] text-muted-foreground">
              <PersonAvatar
                id={item.fromId}
                name={props.inbox.nameOf(item.fromId)}
                people={props.inbox.people}
                size={20}
              />
              <span className="rounded-full bg-secondary px-7 py-2 font-semibold text-10-5/[normal] text-foreground">
                {KIND_LABEL[item.kind]}
              </span>
              <span>
                from <strong className="font-semibold text-foreground">{props.inbox.nameOf(item.fromId)}</strong>{' '}
                {where(item, props.inbox.companyKey)}
              </span>
              <time className="ml-auto font-code text-11/[normal]" dateTime={item.handledAt ?? item.createdAt}>
                {clock(item.handledAt ?? item.createdAt)}
              </time>
            </div>
            <div
              className={cx(
                'line-clamp-3 overflow-hidden whitespace-pre-wrap text-12/[normal] [overflow-wrap:anywhere]',
                item.status === 'handled' ? 'text-muted-foreground' : 'text-foreground',
              )}
            >
              <Written text={item.text} />
            </div>
            {item.status === 'pending' && item.attempts > 0 && (
              <div className="text-11/[normal] text-muted-foreground">Pushed {item.attempts}×, not accepted yet.</div>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

function where(item: InboxItem, companyKey: string): string {
  if (item.channelId === null) return item.ticketId === null ? '' : `on ${ticketCode(companyKey, item.ticketId)}`
  const place = dmMembers(item.channelId) ? 'in a DM' : `in #${item.channelId}`
  return item.threadId === null ? place : `${place}, in a thread`
}

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
