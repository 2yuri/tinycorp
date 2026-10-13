import { z } from 'zod'
import { parseTicketCode } from '../../shared/ticket-id'

/**
 * A ticket as an Employee names it in a tool call: the display id `TC-142`, the short `#142`, or
 * the number on its own (decision 33). Every `ticket_*` tool takes all three.
 */
export const ticketIdInput = z.union([z.number().int(), z.string()])

export const TICKET_ID_HELP = 'The ticket, as TC-142, #142 or 142.'

/** The ticket number behind what was passed; throws with the form to use when it names no ticket. */
export function ticketNumber(input: number | string, companyKey: string): number {
  const id = typeof input === 'number' ? input : parseTicketCode(input, companyKey)
  if (id === null || !Number.isInteger(id) || id <= 0) {
    throw new Error(`${JSON.stringify(String(input))} is not a ticket id; write it as TC-142 or 142`)
  }
  return id
}
