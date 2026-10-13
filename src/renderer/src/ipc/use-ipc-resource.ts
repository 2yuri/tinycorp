import { useCallback, useSyncExternalStore } from 'react'
import type { Result } from '../../../shared/domain/result'
import type { TinyCorpApi } from '../../../shared/ipc'

/**
 * One channel's worth of engine state as the renderer reads it: how to read it, and every event
 * after which what was read is stale.
 *
 * A resource is a module constant, declared once in `./resources`, so every reader of a channel
 * names the same object — which is what lets them share one store, one subscription and one read.
 */
export interface IpcResource<T> {
  /** The cache key. One store, one subscription and one read in flight per key. */
  key: string
  /**
   * The areas of the bridge this resource names.
   *
   * With any of them missing there is nothing to read and nothing to listen to. A unit test and a
   * capture harness run a screen over a bridge holding only the areas that screen asks of it
   * (`vitest.setup.ts`), which is why every screen reads the real one through `?.`; a resource says
   * which areas it is, so one store per channel is the only place that has to check.
   */
  needs: readonly (keyof TinyCorpApi)[]
  /** What a reader sees before the first answer, and again once nobody is looking. */
  empty: T
  read(api: TinyCorpApi): Promise<Result<T>>
  /** Every event after which `read` would answer something else. */
  subscribe(api: TinyCorpApi, changed: () => void): () => void
}

/** What a reader gets back: the last answer, whether one is still out, and the last refusal. */
export interface IpcSnapshot<T> {
  value: T
  /** True until the first answer about the Company that is open now. */
  loading: boolean
  /** The engine's own words when the last read was refused, else null. */
  error: string | null
}

interface Store<T> {
  readonly resource: IpcResource<T>
  /** The snapshot of a store with nothing in it; `snapshot` goes back to this object, by identity. */
  readonly initial: IpcSnapshot<T>
  /** Replaced, never edited — `useSyncExternalStore` re-renders on identity. */
  snapshot: IpcSnapshot<T>
  readonly listeners: Set<() => void>
  /** Bumped by every read and every invalidation; an answer from an older one is dropped. */
  generation: number
  /** The resource's unsubscribe while somebody is looking, else null. */
  stop: (() => void) | null
}

/** Every store there is, by key. A store outlives its readers; what it holds does not. */
const stores = new Map<string, Store<unknown>>()

function storeFor<T>(resource: IpcResource<T>): Store<T> {
  const found = stores.get(resource.key)
  // The key is the whole agreement: a store is made from one resource and read back by the same
  // key, and `resources.dom.test.ts` holds every key in the catalogue to one resource.
  if (found) return found as Store<T>
  const initial: IpcSnapshot<T> = { value: resource.empty, loading: true, error: null }
  const made: Store<T> = { resource, initial, snapshot: initial, listeners: new Set(), generation: 0, stop: null }
  stores.set(resource.key, made as Store<unknown>)
  return made
}

function publish<T>(store: Store<T>, snapshot: IpcSnapshot<T>): void {
  store.snapshot = snapshot
  for (const listener of store.listeners) listener()
}

/** Forgets what was read and drops whatever read is in flight. */
function invalidate<T>(store: Store<T>): void {
  store.generation += 1
  publish(store, store.initial)
}

function refresh<T>(store: Store<T>): void {
  store.generation += 1
  const generation = store.generation
  const api = bridge(store.resource)
  if (!api) {
    publish(store, { value: store.resource.empty, loading: false, error: null })
    return
  }
  void store.resource.read(api).then((result) => {
    // A Company switch, or a newer read, has overtaken this one: what it answers is about a
    // Company that is not on the screen any more.
    if (store.generation !== generation) return
    const next: IpcSnapshot<T> = result.ok
      ? { value: result.value, loading: false, error: null }
      : // The last good value stays on the screen with the refusal beside it, rather than the
        // screen emptying because one read failed.
        { value: store.snapshot.value, loading: false, error: result.error }
    if (!same(store.snapshot, next)) publish(store, next)
  })
}

/**
 * Whether what came back is what is already on screen (T211).
 *
 * Every event on a channel reads it again, and most answers are the answer that is drawn: seven
 * sources fire on one engine change, and a message that closes a ticket is chat, board and code. A
 * value is plain IPC data — it crossed the process boundary — built the same way on every read, so
 * its JSON says it, and dropping the equal ones is a render saved in every reader of that channel.
 */
function same<T>(a: IpcSnapshot<T>, b: IpcSnapshot<T>): boolean {
  return a.loading === b.loading && a.error === b.error && JSON.stringify(a.value) === JSON.stringify(b.value)
}

/**
 * One `company.onChanged` for the whole renderer, and the id it last saw.
 *
 * Every hot channel's own event fires on a Company switch except `repos:changed`, which the engine
 * broadcasts only when a repo is added, changed or removed — which is why two screens used to read
 * their repos on `staff.onChanged` and get the switch by accident (T212). Invalidating every
 * channel from here is what makes a channel's own event enough.
 */
let companyWatch: (() => void) | null = null
/**
 * The Company the values in hand belong to, or `undefined` before the first event.
 *
 * Company settings' Save fires the same event as a switch, so the id is what tells them apart and a
 * rename leaves the screens alone. The first event is read as a switch whatever it carries: nothing
 * yet says which Company the reads already out were about.
 */
let openCompany: string | null | undefined

function watchCompany(api: TinyCorpApi): void {
  // A bridge with no `company` is a screen drawn over a stub of its own areas, which never switches.
  if (companyWatch || api.company === undefined) return
  companyWatch = api.company.onChanged((company) => {
    const next = company?.id ?? null
    const switched = openCompany !== next
    openCompany = next
    for (const store of stores.values()) {
      if (switched) invalidate(store)
      if (store.listeners.size > 0) refresh(store)
    }
  })
}

function listen<T>(store: Store<T>, listener: () => void): () => void {
  store.listeners.add(listener)
  const api = bridge(store.resource)
  if (store.listeners.size === 1 && api) {
    store.stop = store.resource.subscribe(api, () => refresh(store))
    watchCompany(api)
  }
  if (store.listeners.size === 1) refresh(store)
  return () => {
    store.listeners.delete(listener)
    if (store.listeners.size === 0) sleep(store)
  }
}

function sleep<T>(store: Store<T>): void {
  store.stop?.()
  store.stop = null
  // Nothing is read while nobody is looking, so nothing is kept: a screen opened again reads
  // again, rather than drawing the Company that was open the last time it was.
  invalidate(store)
  if ([...stores.values()].every((one) => one.listeners.size === 0)) {
    companyWatch?.()
    companyWatch = null
    openCompany = undefined
  }
}

/** The bridge, or null where it does not hold every area this resource names. */
function bridge<T>(resource: IpcResource<T>): TinyCorpApi | null {
  const api: TinyCorpApi | undefined = window.tinyCorp
  if (!api) return null
  return resource.needs.every((area) => api[area] !== undefined) ? api : null
}

/**
 * The channel's last answer, whether one is still out, and the engine's words if it was refused.
 *
 * Exported for the reader that has something to say about a wait or a refusal; there is none yet,
 * so what the screens use is `useIpcResource` below.
 */
export function useIpcSnapshot<T>(resource: IpcResource<T>): IpcSnapshot<T> {
  const store = storeFor(resource)
  const subscribe = useCallback((listener: () => void) => listen(store, listener), [store])
  const snapshot = useCallback(() => store.snapshot, [store])
  // The third reader is for a render with no browser behind it — a test that draws a screen to a
  // string. Nothing is read there, so what it sees is the same snapshot a first mount starts from.
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

/**
 * A channel read once however many components read it, and kept fresh from its own change events.
 *
 * The first reader of a resource subscribes and reads; the rest join what is already there, and the
 * last one to go drops it. So a staff change is one `staff.employees()` and one re-render, not one
 * of each per screen that draws a name (T212). What comes back is the value — `resource.empty` until
 * the engine has answered — because that is all a screen draws.
 */
export function useIpcResource<T>(resource: IpcResource<T>): T {
  return useIpcSnapshot(resource).value
}

/**
 * Reads a channel again now, for a command whose effect the engine broadcasts nothing about.
 *
 * Company settings are written and answered on the spot, so a card that changes one knows before
 * any event does that who is still on the old setting has changed (T237). Everything with an event
 * of its own uses it: this is not a way around a missing subscription.
 */
export function refreshIpcResource<T>(resource: IpcResource<T>): void {
  refresh(storeFor(resource))
}

/**
 * What a command has already answered, put straight into the store.
 *
 * `board.apply` hands back the board it just wrote, so the card the boss dragged lands where they
 * dropped it instead of waiting for the engine's broadcast to travel back round. The broadcast still
 * arrives and is still read; this only saves the wait.
 */
export function publishIpcValue<T>(resource: IpcResource<T>, value: T): void {
  const store = storeFor(resource)
  // Whatever read is in flight is about a board older than this one.
  store.generation += 1
  publish(store, { value, loading: false, error: null })
}
