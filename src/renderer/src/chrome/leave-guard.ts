/**
 * Leaving a view that has something to lose (T122). The Files view holds the boss's unsaved work,
 * and the shell would unmount it the moment another view is asked for, so a view registers a
 * guard here for as long as it has work the disk has not seen.
 *
 * Guards are tried newest first, the way `close-request` tries its handlers: the view the boss is
 * in is the one that registered last. A guard that takes the route answers `true` and keeps `go`
 * to run once the boss has said what to do; when none takes it, the route happens at once.
 */
import type { Route } from './routes'

/** True when the guard took the route and will run `go` itself, later or never. */
type LeaveGuard = (next: Route, go: () => void) => boolean

const guards: LeaveGuard[] = []

/** Offers a view the chance to stop the shell leaving it. Returns an unsubscribe function. */
export function onLeaveRequest(guard: LeaveGuard): () => void {
  guards.push(guard)
  return () => {
    const index = guards.lastIndexOf(guard)
    if (index >= 0) guards.splice(index, 1)
  }
}

/** Shows `next`, unless a guard takes it to ask the boss something first. */
export function requestLeave(next: Route, go: () => void): void {
  for (let index = guards.length - 1; index >= 0; index -= 1) {
    if (guards[index]!(next, go)) return
  }
  go()
}
