const EVENT = 'tinycorp:open-review'

/** Which ticket's review to open, and which repo's PR to start on. */
export interface ReviewTarget {
  ticketId: number
  /** The repo to show first; the first repo with a diff when left out. */
  repoId?: string
}

/** Asks the shell to open the Review screen, e.g. from a board card or the `#prs` message. */
export function openReview(target: ReviewTarget): void {
  window.dispatchEvent(new CustomEvent<ReviewTarget>(EVENT, { detail: target }))
}

/** Called with every review someone asks to open. Returns an unsubscribe function. */
export function onOpenReview(listener: (target: ReviewTarget) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<ReviewTarget>).detail)
  window.addEventListener(EVENT, handler)
  return () => window.removeEventListener(EVENT, handler)
}
