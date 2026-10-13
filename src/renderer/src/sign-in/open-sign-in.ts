import type { SignInRequest } from '../../../shared/usage/sign-in'

const EVENT = 'tinycorp:open-sign-in'

/**
 * Asks the sign-in modal to open (T263), from wherever `Sign in` is offered: the preflight card,
 * Your profile's Providers card, the Usage popover. One modal for the whole window, mounted once.
 */
export function openSignIn(request: SignInRequest): void {
  window.dispatchEvent(new CustomEvent<SignInRequest>(EVENT, { detail: request }))
}

/** Called for every request to open the modal. Returns an unsubscribe function. */
export function onOpenSignIn(listener: (request: SignInRequest) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<SignInRequest>).detail)
  window.addEventListener(EVENT, handler)
  return () => window.removeEventListener(EVENT, handler)
}
