import { describe, expect, it } from 'vitest'
import { parseTicketCode, ticketBranchStem, ticketCode, worktreeLabel } from './ticket-id'

describe('Ticket display ids (decision 33)', () => {
  it('writes a ticket as the Company key and its number', () => {
    expect(ticketCode('TC', 142)).toBe('TC-142')
    expect(worktreeLabel('TC', 142)).toBe('wt/TC-142')
    expect(ticketBranchStem('TC', 142)).toBe('ticket-tc-142')
  })

  it('falls back to the short form when no Company is loaded yet', () => {
    expect(ticketCode('', 142)).toBe('#142')
  })

  it('reads a ticket back from either form, and from the branch’s lowercase', () => {
    expect(parseTicketCode('TC-142', 'TC')).toBe(142)
    expect(parseTicketCode('#TC-142', 'TC')).toBe(142)
    expect(parseTicketCode('tc-142', 'TC')).toBe(142)
    expect(parseTicketCode('#142', 'TC')).toBe(142)
    expect(parseTicketCode(' 142 ', 'TC')).toBe(142)
  })

  it('refuses anything that is not one of this Company’s tickets', () => {
    expect(parseTicketCode('ZE-142', 'TC')).toBeNull()
    expect(parseTicketCode('TC-0', 'TC')).toBeNull()
    expect(parseTicketCode('TC-', 'TC')).toBeNull()
    expect(parseTicketCode('the login one', 'TC')).toBeNull()
  })
})
