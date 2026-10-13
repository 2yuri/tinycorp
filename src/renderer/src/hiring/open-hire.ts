const EVENT = 'tinycorp:open-hire'

/** Set by a request nobody has taken yet, e.g. while the Employees view is still mounting. */
let pending: { roleId?: string } | null = null

/**
 * Asks the Employees screen to open the hire flow, e.g. from the office header. With a `roleId`
 * the flow opens on that role of the catalog, as `/hire <role>` asks (decision 37).
 */
export function openHire(roleId?: string): void {
  pending = roleId === undefined ? {} : { roleId }
  window.dispatchEvent(new CustomEvent(EVENT))
}

/**
 * Called whenever someone asks to open the hire flow, including a request made just before
 * subscribing. Returns an unsubscribe function.
 */
export function onOpenHire(listener: (request: { roleId?: string }) => void): () => void {
  const handler = () => {
    if (!pending) return
    const request = pending
    pending = null
    listener(request)
  }
  handler()
  window.addEventListener(EVENT, handler)
  return () => window.removeEventListener(EVENT, handler)
}
