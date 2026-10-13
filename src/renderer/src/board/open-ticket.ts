const EVENT = 'tinycorp:open-ticket'

/** Asks the board to open a ticket, e.g. from a `#12` link in chat. */
export function openTicket(id: number): void {
  window.dispatchEvent(new CustomEvent<number>(EVENT, { detail: id }))
}

/** Called with the id of every ticket someone asks to open. Returns an unsubscribe function. */
export function onOpenTicket(listener: (id: number) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<number>).detail)
  window.addEventListener(EVENT, handler)
  return () => window.removeEventListener(EVENT, handler)
}
