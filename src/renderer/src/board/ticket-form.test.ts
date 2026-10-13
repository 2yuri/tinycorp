import { describe, expect, it } from 'vitest'
import type { Ticket } from '../../../shared/domain/board'
import { patchDraft, ticketChanges, ticketDraft } from './ticket-form'

const ticket: Ticket = {
  id: 142,
  epicId: 7,
  title: 'the counter speaks',
  description: 'It says how many.',
  column: 'doing',
  assigneeId: 'e-ada',
  repos: ['r-web'],
  blocked: false,
  blockedReason: '',
  blockedBy: [],
  blocks: [],
  subtasks: [],
  priority: 'normal',
  labels: ['ui'],
  baseBranch: null,
}

describe('The ticket drawer’s form', () => {
  it('opens on the ticket, with nothing picked and nothing to complain about yet', () => {
    const draft = ticketDraft(ticket)

    expect(draft.title).toBe('the counter speaks')
    expect(draft.picked).toBeNull()
    expect(draft.showRepoError).toBe(false)
    // An unclaimed ticket and a ticket with no base branch are both an empty field, not a null.
    expect(ticketDraft({ ...ticket, assigneeId: null, baseBranch: null }).assigneeId).toBe('')
    expect(ticketDraft({ ...ticket, baseBranch: null }).baseBranch).toBe('')
  })

  it('changes one field and leaves the other eleven alone', () => {
    const draft = patchDraft(ticketDraft(ticket), { title: 'the counter counts' })

    expect(draft.title).toBe('the counter counts')
    expect(draft).toEqual({ ...ticketDraft(ticket), title: 'the counter counts' })
  })

  it('writes an empty assignee and an empty base branch back as nothing, not as ""', () => {
    const draft = patchDraft(ticketDraft(ticket), { assigneeId: '  ', baseBranch: ' ' })

    expect(ticketChanges(draft, ['r-web'])).toMatchObject({ assigneeId: null, baseBranch: null })
  })

  it('carries the scope the chips are showing, which the draft need not hold yet', () => {
    // Nothing picked: the chips fall back to the ticket's own repos, and that is what Save writes.
    expect(ticketChanges(ticketDraft(ticket), ['r-web', 'r-api']).repos).toEqual(['r-web', 'r-api'])
  })

  it('carries Blocked and its reason, which the board draws on the card', () => {
    const draft = patchDraft(ticketDraft(ticket), { blocked: true, blockedReason: 'waiting on the API' })

    expect(ticketChanges(draft, ['r-web'])).toMatchObject({ blocked: true, blockedReason: 'waiting on the API' })
  })
})
