import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Ticket } from '../../../shared/domain/board'
import { TicketCard } from './TicketCard'

const ticket: Ticket = {
  id: 42,
  epicId: null,
  title: 'Add the usage chart',
  description: '',
  column: 'doing',
  assigneeId: 'ada',
  repos: [],
  blocked: false,
  blockedReason: '',
  blockedBy: [],
  blocks: [],
  subtasks: [
    { id: 1, ticketId: 42, title: 'Range picker', done: true, repo: null },
    { id: 2, ticketId: 42, title: 'Wire the query', done: true, repo: null },
    { id: 3, ticketId: 42, title: 'Empty state', done: false, repo: null },
  ],
  priority: 'normal',
  labels: [],
  baseBranch: null,
}

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

describe('TicketCard', () => {
  it('shows the id, title, column, checklist and progress', () => {
    const html = renderToStaticMarkup(<TicketCard ticket={ticket} companyKey="TC" onToggle={() => {}} />)

    expect(text(html)).toBe('TC-42 Add the usage chart Doing Range picker Wire the query Empty state Subtasks 2 / 3')
    expect(html.match(/type="checkbox"[^>]*checked=""/g)).toHaveLength(2)
    expect(html.match(/type="checkbox"/g)).toHaveLength(3)
    expect(html).toContain('aria-valuenow="67"')
  })

  it('names the epic the ticket is in, on a line under its title (T274, frame SA8tW)', () => {
    const epic = { title: 'Usage and invoices', color: 'indigo' as const }
    const html = renderToStaticMarkup(<TicketCard ticket={{ ...ticket, epicId: 3 }} companyKey="TC" epic={epic} />)

    expect(text(html)).toBe(
      'TC-42 Add the usage chart Doing Epic: Usage and invoices Range picker Wire the query Empty state Subtasks 2 / 3',
    )
    expect(html).toContain('rounded-full bg-primary')
    expect(renderToStaticMarkup(<TicketCard ticket={ticket} companyKey="TC" epic={null} />)).not.toContain('epic-mark')
  })

  it('says why a ticket is blocked, and is read-only without a toggle', () => {
    const html = renderToStaticMarkup(
      <TicketCard ticket={{ ...ticket, blocked: true, blockedReason: 'needs the API key' }} companyKey="TC" />,
    )

    expect(text(html)).toContain('Blocked: needs the API key')
    expect(html.match(/disabled=""/g)).toHaveLength(3)
  })
})
