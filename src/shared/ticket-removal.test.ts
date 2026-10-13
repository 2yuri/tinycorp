import { describe, expect, it } from 'vitest'
import { deleteTicketBody, deleteTicketTitle, type TicketRemoval } from './ticket-removal'

const removal = (over: Partial<TicketRemoval> = {}): TicketRemoval => ({
  ticketId: 150,
  code: 'TC-150',
  title: 'Retry a failed charge',
  subtasks: 3,
  links: 1,
  worktrees: ['web-app'],
  holder: 'Ada',
  ...over,
})

describe('The confirmation (T275)', () => {
  it('names the ticket by its code', () => {
    expect(deleteTicketTitle(removal())).toBe('Delete TC-150?')
  })

  it('says what goes with it and who is told, as frame xdaOR reads', () => {
    expect(deleteTicketBody(removal())).toBe(
      '“Retry a failed charge” goes, with its 3 subtasks and its link to another ticket. ' +
        'Its worktree and branch in web-app go too; nothing was done in them. ' +
        'Ada is told to drop it. This cannot be undone.',
    )
  })

  it('says only the ticket goes when nothing hangs off it and nobody holds it', () => {
    expect(deleteTicketBody(removal({ subtasks: 0, links: 0, worktrees: [], holder: null }))).toBe(
      '“Retry a failed charge” goes. This cannot be undone.',
    )
  })

  it('counts one subtask, several links and several repos in words', () => {
    expect(
      deleteTicketBody(removal({ subtasks: 1, links: 2, worktrees: ['web-app', 'api', 'docs'], holder: null })),
    ).toBe(
      '“Retry a failed charge” goes, with its 1 subtask and its 2 links to other tickets. ' +
        'Its worktrees and branches in web-app, api and docs go too; nothing was done in them. ' +
        'This cannot be undone.',
    )
  })
})
