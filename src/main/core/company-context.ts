import type { DatabaseSync } from 'node:sqlite'
import type { Company } from '../../shared/company'

/**
 * Which Companies are open, which one the boss is looking at, and everything the app keeps per
 * Company.
 *
 * Every feature is wired against this and nothing else about the app. It exists for one reason: a
 * cache keyed by Company id is only correct if it is emptied when that Company closes, and before
 * T188 there were twenty of those maps, each with its own `dispose(companyId)` and each remembered
 * by hand in `closeCompany`. One forgotten line is a Company that is shut but still answering
 * (#410), and it is invisible — the stale value works perfectly until the folder it is about has
 * moved. So no feature keeps its own map any more: it asks for one here, and closing the Company
 * empties every one of them at once.
 *
 * It holds no IO, opens no database and knows no feature. The engine puts Companies in and takes
 * them out; everyone else reads.
 */

/** One open Company: the row as the app shows it, and the database its rows live in. */
export interface OpenCompany {
  company: Company
  db: DatabaseSync
}

/**
 * A value kept per open Company: made the first time it is asked for, and dropped when that Company
 * closes. Nothing here can outlive the Company it is about.
 */
export interface PerCompany<T> {
  /** The value for this Company, made now if it has none. */
  of(entry: OpenCompany): T
  /** The same, by id. Throws when that Company is not open. */
  ofId(companyId: string): T
  /** The value for the Company the boss is looking at. Throws when none is open. */
  current(): T
  /** What has already been made for this Company, without making one. */
  peek(companyId: string): T | undefined
  /** Every value made so far, for a sweep across the open Companies. */
  made(): T[]
}

/**
 * A set of callbacks, kept for as long as the app is open.
 *
 * Not per Company: a listener is a screen or a feature watching for a change *anywhere*, and it
 * reads whichever Company is current when it hears one. What makes this worth a type is that
 * `add` hands back the unsubscribe every caller was writing by hand, and that `clear()` on close
 * is one call rather than sixteen.
 */
export interface Listeners<Args extends readonly unknown[] = []> {
  /** Adds a listener. Returns the function that takes it off again. */
  add(listener: (...args: Args) => void): () => void
  /** Calls every listener, in the order they were added. */
  notify(...args: Args): void
  /** How many are listening. */
  size(): number
}

/** What every feature is wired against. */
export interface CompanyContext {
  /** Every open Company, in the order they were opened. */
  open(): OpenCompany[]
  /** Their ids, for a feature that sweeps them. */
  ids(): string[]
  /** The Company the boss is looking at, or null when none is open. */
  currentId(): string | null
  /** The open Company with this id, or null. */
  entryOf(companyId: string): OpenCompany | null
  /** The same, or a refusal: what a feature handed one id at a time uses. */
  requireEntry(companyId: string): OpenCompany
  /** The Company the boss is looking at. Throws when none is open. */
  currentEntry(): OpenCompany
  /** The same, or null, for a read that is allowed to find nothing. */
  currentOrNull(): OpenCompany | null
  /** The open Company whose folder is this one, or null. */
  openedAt(folder: string): OpenCompany | null
  /**
   * A cache keyed by Company. `dispose` is called with the value when that Company closes, for one
   * that holds something of its own — a process, a watcher, a handle.
   */
  perCompany<T>(factory: (entry: OpenCompany) => T, dispose?: (value: T) => void): PerCompany<T>
  /** A set of listeners that lasts as long as the app. */
  listeners<Args extends readonly unknown[] = []>(): Listeners<Args>

  /** A Company was opened, or reopened after a move: it goes in, and becomes the current one. */
  opened(entry: OpenCompany): void
  /** An already-open Company becomes the one the boss is looking at. */
  switchTo(companyId: string): void
  /** Replaces the row of an open Company, after a rename or a boss-profile change. */
  reread(companyId: string, company: Company): void
  /**
   * A Company closed. It goes, and so does every value every cache holds for it. Returns whether it
   * was the one the boss was looking at, because that is what decides who has to be told.
   */
  close(companyId: string): boolean
  /** The app is quitting: every Company, every cache and every listener goes. */
  clear(): void
}

export function createCompanyContext(): CompanyContext {
  const open = new Map<string, OpenCompany>()
  let currentId: string | null = null
  /** Every cache asked for, in the order it was asked for, so closing sweeps all of them. */
  const caches: { forget(companyId: string): void; clear(): void }[] = []
  const listenerSets: { clear(): void }[] = []

  function entryOf(companyId: string): OpenCompany | null {
    return open.get(companyId) ?? null
  }

  function requireEntry(companyId: string): OpenCompany {
    const entry = open.get(companyId)
    if (!entry) throw new Error('That Company is not open')
    return entry
  }

  function currentOrNull(): OpenCompany | null {
    return currentId === null ? null : (open.get(currentId) ?? null)
  }

  function currentEntry(): OpenCompany {
    const entry = currentOrNull()
    if (!entry) throw new Error('No Company is open')
    return entry
  }

  return {
    open: () => [...open.values()],
    ids: () => [...open.keys()],
    currentId: () => currentId,
    entryOf,
    requireEntry,
    currentEntry,
    currentOrNull,

    openedAt: (folder) => [...open.values()].find((entry) => entry.company.folder === folder) ?? null,

    perCompany<T>(factory: (entry: OpenCompany) => T, dispose?: (value: T) => void): PerCompany<T> {
      const values = new Map<string, T>()
      const of = (entry: OpenCompany): T => {
        const found = values.get(entry.company.id)
        if (found !== undefined) return found
        const made = factory(entry)
        values.set(entry.company.id, made)
        return made
      }
      caches.push({
        forget(companyId) {
          const found = values.get(companyId)
          if (found === undefined) return
          values.delete(companyId)
          dispose?.(found)
        },
        clear() {
          for (const value of values.values()) dispose?.(value)
          values.clear()
        },
      })
      return {
        of,
        ofId: (companyId) => of(requireEntry(companyId)),
        current: () => of(currentEntry()),
        peek: (companyId) => values.get(companyId),
        made: () => [...values.values()],
      }
    },

    listeners<Args extends readonly unknown[] = []>(): Listeners<Args> {
      const set = new Set<(...args: Args) => void>()
      listenerSets.push({ clear: () => set.clear() })
      return {
        add(listener) {
          set.add(listener)
          return () => set.delete(listener)
        },
        notify(...args) {
          for (const listener of set) listener(...args)
        },
        size: () => set.size,
      }
    },

    opened(entry) {
      open.set(entry.company.id, entry)
      currentId = entry.company.id
    },

    switchTo(companyId) {
      requireEntry(companyId)
      currentId = companyId
    },

    reread(companyId, company) {
      const entry = open.get(companyId)
      if (entry) entry.company = company
    },

    close(companyId) {
      open.delete(companyId)
      const wasCurrent = currentId === companyId
      if (wasCurrent) currentId = null
      // Every cache, not the ones somebody remembered: that is the whole point of this file.
      for (const cache of caches) cache.forget(companyId)
      return wasCurrent
    },

    clear() {
      for (const cache of caches) cache.clear()
      for (const set of listenerSets) set.clear()
      open.clear()
      currentId = null
    },
  }
}
