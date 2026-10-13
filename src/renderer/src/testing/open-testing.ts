const EVENT = 'tinycorp:open-testing'

/** Which ticket's test run to open. */
export interface TestingTarget {
  ticketId: number
}

/** Asks the shell to open the Testing screen, e.g. from a board card, the Inbox or `#prs`. */
export function openTesting(target: TestingTarget): void {
  window.dispatchEvent(new CustomEvent<TestingTarget>(EVENT, { detail: target }))
}

/** Called with every test run someone asks to open. Returns an unsubscribe function. */
export function onOpenTesting(listener: (target: TestingTarget) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<TestingTarget>).detail)
  window.addEventListener(EVENT, handler)
  return () => window.removeEventListener(EVENT, handler)
}
