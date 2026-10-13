import type { NotificationFocusRequest } from '../../../shared/ipc'
import type { NotificationFocus } from '../../../shared/notifications'

/** How long a click waits for its Company's view to show up before it is dropped. */
const PENDING_MS = 10_000

type Kind = NotificationFocus['kind']
type FocusOf<K extends Kind> = Extract<NotificationFocus, { kind: K }>

interface Listener {
  companyId: string
  kind: Kind
  deliver(focus: NotificationFocus): void
}

const listeners = new Set<Listener>()
let pending: { request: NotificationFocusRequest; at: number } | null = null

/**
 * Hands a clicked notification to the view that shows it. The click switches Company first,
 * so the request waits until a view of that Company subscribes.
 */
export function requestNotificationFocus(request: NotificationFocusRequest): void {
  pending = { request, at: Date.now() }
  flush()
}

/** Called with every clicked notification of `kind` in `companyId`. Returns an unsubscribe function. */
export function onNotificationFocus<K extends Kind>(
  companyId: string,
  kind: K,
  listener: (focus: FocusOf<K>) => void,
): () => void {
  const entry: Listener = { companyId, kind, deliver: (focus) => listener(focus as FocusOf<K>) }
  listeners.add(entry)
  flush()
  return () => listeners.delete(entry)
}

function flush(): void {
  if (!pending) return
  if (Date.now() - pending.at > PENDING_MS) {
    pending = null
    return
  }
  const { companyId, focus } = pending.request
  const target = [...listeners].find((l) => l.companyId === companyId && l.kind === focus.kind)
  if (!target) return
  pending = null
  target.deliver(focus)
}
