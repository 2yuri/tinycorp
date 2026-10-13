const EVENT = 'tinycorp:toggle-legend'

/** Set by a request nobody has taken yet, e.g. while the Office view is still mounting. */
let pending = false

/** Asks the office canvas to show or hide its Legend, as the View menu's own item does (#223). */
export function toggleLegend(): void {
  pending = true
  window.dispatchEvent(new CustomEvent(EVENT))
}

/**
 * Called whenever someone asks to show or hide the Legend, including a request made just before
 * subscribing — the menu asks for it while the Office view is still opening. Returns an unsubscribe.
 */
export function onToggleLegend(listener: () => void): () => void {
  const handler = () => {
    if (!pending) return
    pending = false
    listener()
  }
  handler()
  window.addEventListener(EVENT, handler)
  return () => window.removeEventListener(EVENT, handler)
}
