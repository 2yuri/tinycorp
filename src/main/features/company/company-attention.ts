import type { CompanyAttention } from '../../../shared/company'
import { type BossInboxItem, bossInboxUnread } from '../../../shared/inbox/boss-inbox'
import type { SessionActivity } from '../sessions'

export interface CompanyAttentionOptions {
  /** The open Companies, in rail order, each with a way to read its Inbox. Never a closed one. */
  open(): { companyId: string; bossInbox(): BossInboxItem[] }[]
  /** Every Session status change of any open Company. */
  onActivity(listener: (activity: SessionActivity) => void): () => void
}

export interface CompanyAttentionTracker {
  /** One entry per open Company. A count is read from the database only after it was invalidated. */
  list(): CompanyAttention[]
  /** Something the Inbox reads changed in this Company: its count is read again when next asked. */
  inboxChanged(companyId: string): void
  /** Fires when an entry may have changed. Returns an unsubscribe function. */
  onChange(listener: () => void): () => void
  close(): void
}

/**
 * What the Company rail marks (T145), kept cheap enough to answer for every open Company on every
 * change: the waiting count is the Inbox's own, cached until that Company's chat, read marks or
 * Approvals move; whether it is working comes from the Session stream and never reads a database.
 */
export function createCompanyAttention({ open, onActivity }: CompanyAttentionOptions): CompanyAttentionTracker {
  const waiting = new Map<string, number>()
  /** Every busy Session, as `companyId employeeId`. */
  const busy = new Set<string>()
  /** Every Session stopped in its terminal asking the boss (T165), keyed the same way. */
  const asking = new Set<string>()
  const listeners = new Set<() => void>()

  function emit(): void {
    for (const listener of listeners) listener()
  }

  function working(companyId: string): boolean {
    for (const key of busy) if (key.startsWith(`${companyId} `)) return true
    return false
  }

  function asks(companyId: string): number {
    let count = 0
    for (const key of asking) if (key.startsWith(`${companyId} `)) count++
    return count
  }

  const stop = onActivity(({ companyId, employeeId, status, asking: ask }) => {
    const before = working(companyId)
    const asksBefore = asks(companyId)
    const key = `${companyId} ${employeeId}`
    if (status === 'busy') busy.add(key)
    else busy.delete(key)
    // An ask is not in the chat the Inbox count is read from: it lives on the Session, so it is
    // counted from the same stream, and it waits on the boss like any Inbox row.
    if (ask && status !== 'off') asking.add(key)
    else asking.delete(key)
    // A hook tick that leaves the Company as busy and as asking as it was says nothing new.
    if (working(companyId) !== before || asks(companyId) !== asksBefore) emit()
  })

  return {
    list() {
      const companies = open()
      const ids = new Set(companies.map((c) => c.companyId))
      // A Company that closed takes its cached count with it.
      for (const id of waiting.keys()) if (!ids.has(id)) waiting.delete(id)
      return companies.map(({ companyId, bossInbox }) => {
        let count = waiting.get(companyId)
        if (count === undefined) {
          count = bossInboxUnread(bossInbox())
          waiting.set(companyId, count)
        }
        return { companyId, waiting: count + asks(companyId), working: working(companyId) }
      })
    },

    inboxChanged(companyId) {
      waiting.delete(companyId)
      emit()
    },

    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    close() {
      stop()
      waiting.clear()
      busy.clear()
      asking.clear()
      listeners.clear()
    },
  }
}
