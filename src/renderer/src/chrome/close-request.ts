/**
 * `⌘W`, in one place (T121). The menu's Close Company (#223) is the only thing bound to the key,
 * and it sends one message; this is where the renderer decides what that message closes, so the
 * menu and the views never fight over the same keystroke.
 *
 * A view registers a handler for as long as it has something of its own to close — the Files view
 * while it has tabs open. Handlers are tried newest first: the view the boss is in is the one that
 * registered last. The first to answer `true` has taken the key; when none does, the fallback
 * runs, which is closing the Company.
 */

type CloseHandler = () => boolean

const handlers: CloseHandler[] = []

/**
 * Offers a view the chance to take `⌘W`. The handler returns true when it closed something of its
 * own, false to let the key through. Returns an unsubscribe function.
 */
export function onCloseRequest(handler: CloseHandler): () => void {
  handlers.push(handler)
  return () => {
    const index = handlers.lastIndexOf(handler)
    if (index >= 0) handlers.splice(index, 1)
  }
}

/** Runs the handlers, newest first. True when one of them took the key. */
export function requestClose(): boolean {
  for (let index = handlers.length - 1; index >= 0; index -= 1) {
    if (handlers[index]!()) return true
  }
  return false
}

/**
 * Wires the menu's Close Company to the handlers: whatever the boss is in gets the key first, and
 * `fallback` — closing the Company — runs only when nothing else took it. Returns an unsubscribe.
 */
export function listenForCloseRequests(fallback: () => void): () => void {
  return (
    window.tinyCorp?.shell?.onCloseRequest?.(() => {
      if (!requestClose()) fallback()
    }) ?? (() => {})
  )
}
