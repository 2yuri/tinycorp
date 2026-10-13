import type { SignInStep } from '../domain/providers'
import type { Result } from '../domain/result'
import { type ProviderRuntime, runtimeLabel } from '../platform/wsl'

/**
 * The sign-in modal (T263, frames `Tmldc` and `iA8Wm`): the product's own login, run in a terminal
 * inside TinyCorp, in the place the Provider runs, with the steps beside it and TinyCorp noticing
 * when it is done.
 *
 * Nothing here ever carries a credential. The terminal is the product's; what crosses is what it
 * prints and what the boss types, exactly as an Employee's terminal does.
 */

/** Which sign-in to run: one account, or the Provider's own when it keeps a single one. */
export interface SignInRequest {
  provider: string
  /** The account to sign in, or null for the Provider's own default folder. */
  accountId: string | null
}

/** Where a sign-in stands. */
export type SignInState =
  /** The terminal is open. `step` is the index of the step the boss is on. */
  | { phase: 'waiting'; step: number }
  /** A login appeared. `who` is the address and plan, where the product says them. */
  | { phase: 'signed-in'; who: string | null }
  /** The terminal closed with no login, or could not start. */
  | { phase: 'ended'; reason: string }

/** One running sign-in, as the modal opens on it. */
export interface SignInView {
  id: string
  provider: string
  /** `Personal · runs in WSL · archlinux`: which account, and where the terminal runs. */
  sub: string
  state: SignInState
}

/** Exposed as `window.tinyCorp.signIn`. */
export interface SignInApi {
  start(request: SignInRequest): Promise<Result<SignInView>>
  write(id: string, data: string): Promise<Result<void>>
  resize(id: string, cols: number, rows: number): Promise<Result<void>>
  /** Kills the terminal. Nothing is changed: a login written before this stays where it was written. */
  cancel(id: string): Promise<Result<void>>
  onData(listener: (id: string, data: string) => void): () => void
  onState(listener: (id: string, state: SignInState) => void): () => void
}

/** What the footer says while the terminal is open. */
export const SIGN_IN_WAITING = 'Waiting for the sign-in to finish…'

/** The line TinyCorp writes under the product's own once it has seen the login. */
export const SIGN_IN_SEEN = 'TinyCorp saw the sign-in. This closes by itself.'

/** What the footer says when the terminal closed and no login appeared. */
export const SIGN_IN_ENDED = 'The terminal closed before a sign-in appeared.'

/** `Signed in as boss@example.com · Max 20×`, or plainly `Signed in` where the product names nobody. */
export function signedInLine(who: string | null): string {
  return who ? `Signed in as ${who}` : 'Signed in'
}

/** `Personal · runs in WSL · archlinux`; the label alone where the Provider runs where the app does. */
export function signInSub(label: string | null, runtime: ProviderRuntime | null): string {
  const where = runtime ? `runs in ${runtimeLabel(runtime)}` : null
  return [label, where].filter(Boolean).join(' · ')
}

/**
 * The step the boss is on, read off what the terminal has shown (with its escapes already taken
 * out): the last step whose words have
 * appeared. The first step is where every sign-in starts, and the last is never reached here —
 * TinyCorp completes it when the login appears.
 */
export function stepReached(steps: readonly SignInStep[], shown: string): number {
  const text = squeezed(shown)
  let reached = 0
  steps.slice(0, -1).forEach((step, index) => {
    if (step.seen && text.includes(squeezed(step.seen))) reached = index
  })
  return reached
}

/**
 * Lower case with no whitespace: a terminal UI may move the cursor over a gap rather than print the
 * space, so the words arrive whole and the spaces between them do not.
 */
function squeezed(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '')
}
