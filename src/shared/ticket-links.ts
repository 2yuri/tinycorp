/**
 * A ticket that waits on another (T266): the link, what waiting means, and the one sentence a loop
 * is refused with. Plain data, so the engine refuses with the same rule the drawer's picker hides
 * by, and the card, the drawer and the tools all say the same thing about who waits on whom.
 */
import type { Ticket } from './domain/board'

type Linked = Pick<Ticket, 'id' | 'column' | 'blockedBy'>

/** The blockers of `ticket` that are not Done yet; a ticket waits while there is one. */
export function openBlockers<T extends Linked>(ticket: Pick<Ticket, 'blockedBy'>, tickets: readonly T[]): T[] {
  return ticket.blockedBy.flatMap((id) => tickets.find((t) => t.id === id && t.column !== 'done') ?? [])
}

/** Whether `ticket` waits: any blocker that is not Done. Nobody picks up a ticket that waits. */
export function waits(ticket: Pick<Ticket, 'blockedBy'>, tickets: readonly Linked[]): boolean {
  return openBlockers(ticket, tickets).length > 0
}

/**
 * Whether `blocker` already waits on `ticket`, directly or through others — so making `ticket`
 * wait on `blocker` would close a loop. `blockedBy` answers a ticket's own blockers.
 */
export function wouldLoop(ticket: number, blocker: number, blockedBy: (id: number) => readonly number[]): boolean {
  if (ticket === blocker) return true
  const seen = new Set<number>()
  const stack = [blocker]
  while (stack.length > 0) {
    const id = stack.pop()!
    if (id === ticket) return true
    if (seen.has(id)) continue
    seen.add(id)
    stack.push(...blockedBy(id))
  }
  return false
}

/** `TC-138 already waits on TC-150 — that would be a loop.`, in the ids the caller writes. */
export function loopRefusal(blockerCode: string, ticketCode: string): string {
  return `${blockerCode} already waits on ${ticketCode} — that would be a loop.`
}

/**
 * Why a ticket that waits cannot start, naming what it waits on and the way out:
 * `TC-150 waits on TC-138 and TC-131, which are not Done yet. Remove the blockers to start it now.`
 */
export function waitingRefusal(ticketCode: string, blockerCodes: readonly string[]): string {
  const names =
    blockerCodes.length === 1
      ? blockerCodes[0]
      : `${blockerCodes.slice(0, -1).join(', ')} and ${blockerCodes[blockerCodes.length - 1]}`
  const one = blockerCodes.length === 1
  return `${ticketCode} waits on ${names}, which ${one ? 'is' : 'are'} not Done yet. Remove ${one ? 'the blocker' : 'the blockers'} to start it now.`
}

/**
 * The tickets the move of `moved` into Done set free: each one it blocks with no blocker left
 * open. Read after the move, with the board as it is now.
 */
export function unblockedBy<T extends Linked>(moved: Pick<Ticket, 'blocks'>, tickets: readonly T[]): T[] {
  return moved.blocks.flatMap((id) => {
    const found = tickets.find((t) => t.id === id)
    return found && found.column !== 'done' && !waits(found, tickets) ? [found] : []
  })
}

/**
 * What the drawer's `+ Add a blocker` offers `ticket`: every other ticket of the board that is not
 * Done, not already a blocker, and not one that would close a loop.
 */
export function blockerCandidates<T extends Linked>(
  ticket: Pick<Ticket, 'id' | 'blockedBy'>,
  tickets: readonly T[],
): T[] {
  const blockedBy = (id: number) => tickets.find((t) => t.id === id)?.blockedBy ?? []
  return tickets.filter(
    (t) => t.column !== 'done' && !ticket.blockedBy.includes(t.id) && !wouldLoop(ticket.id, t.id, blockedBy),
  )
}
