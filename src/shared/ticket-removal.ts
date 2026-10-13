/** Deleting a ticket: the boss's own action, from the ticket's drawer (T275). */

/** What deleting one ticket takes with it, as the confirmation states it. */
export interface TicketRemoval {
  ticketId: number
  /** The ticket's code, `TC-142`. */
  code: string
  title: string
  subtasks: number
  /** Tickets it waits on and tickets that wait on it. */
  links: number
  /** The repos whose worktree and branch go with it; nothing was done in any of them. */
  worktrees: string[]
  /** The name of the Employee holding it, who is told it went; null when nobody holds it. */
  holder: string | null
}

/** The label of the drawer's button. */
export const DELETE_TICKET_ACTION = 'Delete ticket'

/** The confirmation's title: `Delete TC-142?`. */
export function deleteTicketTitle(removal: Pick<TicketRemoval, 'code'>): string {
  return `Delete ${removal.code}?`
}

/** The confirmation's body: the ticket, what goes with it, and who is told. */
export function deleteTicketBody(removal: TicketRemoval): string {
  const withIt = [
    removal.subtasks > 0 && `its ${plural(removal.subtasks, 'subtask')}`,
    removal.links === 1 && 'its link to another ticket',
    removal.links > 1 && `its ${removal.links} links to other tickets`,
  ].filter((part): part is string => typeof part === 'string')
  const goes = `“${removal.title}” goes${withIt.length > 0 ? `, with ${joined(withIt)}` : ''}.`
  const worktrees =
    removal.worktrees.length === 0
      ? ''
      : removal.worktrees.length === 1
        ? ` Its worktree and branch in ${removal.worktrees[0]} go too; nothing was done in them.`
        : ` Its worktrees and branches in ${joined(removal.worktrees)} go too; nothing was done in them.`
  const holder = removal.holder === null ? '' : ` ${removal.holder} is told to drop it.`
  return `${goes}${worktrees}${holder} This cannot be undone.`
}

function joined(parts: readonly string[]): string {
  return parts.length < 2 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}
