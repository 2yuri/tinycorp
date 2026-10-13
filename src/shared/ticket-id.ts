/**
 * A ticket's id as the design writes it: the Company key and the ticket's per-Company number,
 * `TC-142` (decision 33). The number is the ticket's own id — every Company keeps its board in its
 * own database, so the ids already run from 1 in creation order. `#142` stays the short form in
 * chat, and everything that reads an id takes both.
 */

/**
 * `TC-142`: how a ticket is named on cards, in chat, in notifications and in every tool answer.
 * Without a key — a Company not loaded yet — it falls back to the short form, never to `-142`.
 */
export function ticketCode(companyKey: string, ticketId: number): string {
  return companyKey ? `${companyKey}-${ticketId}` : `#${ticketId}`
}

/** The worktree chip on a Doing card and in a code card: `wt/TC-142`. */
export function worktreeLabel(companyKey: string, ticketId: number): string {
  return `wt/${ticketCode(companyKey, ticketId)}`
}

/** The stem of a ticket's branch, `ticket-tc-142`; the title's slug follows it. */
export function ticketBranchStem(companyKey: string, ticketId: number): string {
  return `ticket-${ticketCode(companyKey, ticketId).toLowerCase()}`
}

const TICKET_NUMBER = /^[1-9]\d*$/

/** Regex-safe: a key is 2–4 uppercase letters, but nothing here depends on that holding. */
function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')
}

/**
 * The ticket `text` names — `TC-142`, `#TC-142`, `#142` or `142` — or null when it names none.
 * The key is matched without regard to case, so a branch's `tc-142` reads back.
 */
export function parseTicketCode(text: string, companyKey: string): number | null {
  const token = text.trim().replace(/^#/, '')
  const prefix = `${companyKey.toLowerCase()}-`
  const number = token.toLowerCase().startsWith(prefix) ? token.slice(prefix.length) : token
  return TICKET_NUMBER.test(number) ? Number(number) : null
}

/** `TC-142`, or `#TC-142`, wherever it stands alone in running text, for a Company keyed `TC`. */
export function ticketCodePattern(companyKey: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}_&/-])#?${escaped(companyKey)}-([1-9]\\d*)(?![\\p{L}\\p{N}_-])`, 'giu')
}
