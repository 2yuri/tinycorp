import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Epic, Ticket } from '../../../shared/domain/board'
import type { SecurityPass } from '../../../shared/review/security'
import { accentFor } from '../ui'
import type { BoardFacts } from './board-model'
import { TicketCard } from './TicketCard'

const ticket: Ticket = {
  id: 42,
  epicId: null,
  title: 'Usage chart with range picker',
  description: '',
  column: 'doing',
  assigneeId: 'e-nova',
  repos: ['r-web'],
  blocked: false,
  blockedReason: '',
  blockedBy: [],
  blocks: [],
  subtasks: [
    { id: 1, ticketId: 42, title: 'a', done: true, repo: null },
    { id: 2, ticketId: 42, title: 'b', done: false, repo: null },
  ],
  priority: 'normal',
  labels: [],
  baseBranch: null,
}

const noFacts: BoardFacts = {
  sessions: {},
  approvals: [],
  reviews: [],
  code: [],
  plans: [],
  tests: [],
  security: [],
  companyKey: 'TC',
}

const withPr: BoardFacts = {
  ...noFacts,
  code: [
    {
      ticketId: 42,
      worktrees: [],
      pullRequests: [{ ticketId: 42, repoId: 'r-web', url: 'https://gh/x/pull/131', number: 131, openedAt: '' }],
    },
  ],
}

function render(
  t: Ticket,
  facts: BoardFacts = noFacts,
  view: 'full' | 'mini' = 'full',
  epic: Pick<Epic, 'title' | 'color'> | null = null,
) {
  const html = renderToStaticMarkup(
    <TicketCard
      ticket={t}
      epic={epic}
      facts={facts}
      view={view}
      repoName={(id) => (id === 'r-web' ? 'web-app' : 'removed repo')}
      employeeName={(id) => (id === 'e-nova' ? 'Nova Lee' : id === 'e-vega' ? 'Vega' : id)}
      employeePerson={(id) => (id === 'e-nova' ? { id, sprite: 3 } : null)}
    />,
  )
  const text = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return { html, text }
}

describe('TicketCard', () => {
  // Decision 33: the card's id is the Company key and the ticket's number, as the frame reads it.
  it('names the ticket by its display id, and its worktree chip after it', () => {
    const doing: BoardFacts = {
      ...noFacts,
      code: [
        {
          ticketId: 42,
          worktrees: [
            { ticketId: 42, repoId: 'r-web', path: '/x', branch: 'ticket-tc-42-usage', base: 'main', createdAt: '' },
          ],
          pullRequests: [],
        },
      ],
    }
    const { html, text } = render({ ...ticket, column: 'doing' }, doing)

    expect(html).toMatch(/<span class="[^"]*font-code[^"]*">TC-42<\/span>/)
    expect(text).toContain('wt/TC-42')
  })

  it('turns the PR chip into the way into the Review screen (T75)', () => {
    const { html, text } = render({ ...ticket, column: 'review' }, withPr)

    expect(text).toContain('#131')
    // With a PR the chip reads as a number, in mono.
    expect(html).toMatch(/<button type="button" class="[^"]*font-code[^"]*" title="Review #131"/)
  })

  it('offers Review on a ticket with a branch and no PR (T82)', () => {
    const branchOnly: BoardFacts = {
      ...noFacts,
      code: [
        {
          ticketId: 42,
          worktrees: [
            { ticketId: 42, repoId: 'r-web', path: '/x', branch: 'ticket-42-usage', base: 'main', createdAt: '' },
          ],
          pullRequests: [],
        },
      ],
    }
    const { html, text } = render(ticket, branchOnly)

    expect(text).toContain('Review')
    // Without one it reads as a word, in the body face at 600.
    expect(html).toMatch(/title="Review[^"]*"/)
    expect(html).toMatch(/class="[^"]*font-\[inherit\] font-semibold[^"]*" title="Review/)
  })

  it('leaves the PR chip alone when there is a PR, and offers nothing with neither', () => {
    expect(render({ ...ticket, column: 'review' }, withPr).text).not.toContain('Review #131 Review')
    expect(render({ ...ticket, column: 'todo' }, noFacts).html).not.toMatch(/title="Review/)
  })

  it('shows the id, title, repo chip, assignee name with initials and subtask progress', () => {
    const { text } = render(ticket)
    expect(text).toBe('TC-42 Usage chart with range picker web-app NL Nova Lee 1/2')
  })

  it('gives the assignee the same accent and character they have in chat', () => {
    const { html } = render(ticket)
    expect(html).toContain(`data-accent="${accentFor('e-nova')}"`)
    expect(html).toContain('--ui-avatar-size:22px')
  })

  it('shows Unclaimed without an assignee', () => {
    const { html, text } = render({ ...ticket, assigneeId: null })
    expect(text).toContain('Unclaimed')
    // The outlined placeholder an unclaimed ticket keeps instead of an Employee's tile.
    expect(html).toContain('size-22 shrink-0 items-center justify-center rounded-full border')
  })

  it('shows the worktree chip, PR number and the status badge instead of the progress', () => {
    const facts: BoardFacts = {
      ...noFacts,
      sessions: { 'e-nova': 'busy' },
      code: [
        {
          ticketId: 42,
          worktrees: [
            { ticketId: 42, repoId: 'r-web', path: '/x', branch: 'ticket-42-usage', base: 'main', createdAt: '' },
          ],
          pullRequests: [{ ticketId: 42, repoId: 'r-web', url: 'https://x/pull/128', number: 128, openedAt: '' }],
        },
      ],
    }
    const { html, text } = render(ticket, facts)
    expect(text).toBe('TC-42 #128 Usage chart with range picker web-app wt/TC-42 NL Nova Lee Working')
    // `working` is the badge with the green dot.
    expect(html).toContain('bg-brand-success')
  })

  it('shows only the id and title when minified', () => {
    expect(render(ticket, noFacts, 'mini').text).toBe('TC-42 Usage chart with range picker')
  })

  it('shows the priority flag for a non-normal priority and label chips after the repo chips', () => {
    const { html, text } = render({ ...ticket, priority: 'urgent', labels: ['bug', 'p1'] })
    expect(text).toBe('TC-42 Urgent Usage chart with range picker web-app bug p1 NL Nova Lee 1/2')
    expect(html).toContain('text-status-error-foreground')
    expect(html.match(/class="group\/chip [^"]*gap-5 px-8 py-3 text-10-5"/g)).toHaveLength(2)
    expect(render({ ...ticket, priority: 'low' }).text).toContain('TC-42 Low Usage chart')
    expect(render(ticket).html).not.toMatch(/priority"/)
  })

  it('names the epic a ticket is in beside its id, in the epic’s own colour (T274, frame RIko3)', () => {
    const { html, text } = render({ ...ticket, epicId: 7 }, noFacts, 'full', {
      title: 'Usage and invoices',
      color: 'violet',
    })
    expect(text).toBe('TC-42 Epic: Usage and invoices Usage chart with range picker web-app NL Nova Lee 1/2')
    expect(html).toContain('<span class="size-7 shrink-0 rounded-full bg-accent" aria-hidden="true">')
    expect(html).toContain('title="Epic: Usage and invoices"')
  })

  it('keeps the slate dot on a ticket in no epic', () => {
    const { html } = render(ticket)
    expect(html).toContain('<span class="size-7 shrink-0 rounded-full bg-muted-foreground" aria-hidden="true">')
    expect(html).not.toContain('data-slot="epic-mark"')
  })

  it('draws the repos as one line, three names and a count, so a ticket on every repo stays a card (T285)', () => {
    const repos = Array.from({ length: 110 }, (_, i) => `r-${i}`)
    const { html, text } = render({ ...ticket, repos })

    expect(text.match(/removed repo/g)).toHaveLength(3)
    expect(text).toContain('removed repo, …')
    expect(text).toContain('+107')
    expect(html.match(/data-slot="card-repos"/g)).toHaveLength(1)
  })

  it('shows labels even on a ticket without repos, and none when minified', () => {
    expect(render({ ...ticket, repos: [], labels: ['bug'] }).text).toContain('range picker bug NL')
    expect(render({ ...ticket, labels: ['bug'] }, noFacts, 'mini').text).toBe('TC-42 Usage chart with range picker')
  })
})

/** A ticket whose security pass found one high thing, still open (T241). */
const pass: SecurityPass = {
  id: 1,
  ticketId: 42,
  reviewId: 1,
  reviewerId: 'e-vega',
  state: 'findings',
  reason: { kind: 'risky', classes: ['ipc'] },
  summary: 'One high on the preload.',
  overriddenBy: null,
  overrideReason: '',
  startedAt: '',
  finishedAt: '',
  findings: [
    {
      id: 1,
      passId: 1,
      severity: 'high',
      title: 'The renderer can run any shell command',
      fix: 'Take a command id.',
      threadId: 4,
      where: 'src/preload/index.ts:20',
      resolved: false,
      createdAt: '',
    },
  ],
}

describe('the security badge a card carries (T241)', () => {
  it('says what the pass makes of the ticket, and who is still reading it', () => {
    expect(render(ticket, { ...noFacts, security: [pass] }).text).toContain('Security: 1 high open')
    expect(render(ticket, { ...noFacts, security: [{ ...pass, state: 'pending', findings: [] }] }).text).toContain(
      'Security: Vega reading',
    )
    expect(render(ticket, { ...noFacts, security: [{ ...pass, state: 'clear', findings: [] }] }).text).toContain(
      'Security clear',
    )
    expect(render(ticket, { ...noFacts, security: [{ ...pass, state: 'overridden' }] }).text).toContain(
      'Security overridden',
    )
  })

  it('is absent from a ticket with no pass, and from the mini card', () => {
    expect(render(ticket).text).not.toContain('Security')
    expect(render(ticket, { ...noFacts, security: [pass] }, 'mini').text).not.toContain('Security')
  })
})

describe('A card that waits on another (T266, frame IziV6)', () => {
  const waiting: Ticket = { ...ticket, id: 150, column: 'todo', blockedBy: [138] }
  const blocker: Ticket = { ...ticket, id: 138, column: 'doing', blocks: [150] }
  const board = [waiting, blocker]
  const draw = (t: Ticket, tickets: Ticket[]) =>
    renderToStaticMarkup(
      <TicketCard
        ticket={t}
        facts={noFacts}
        tickets={tickets}
        view="full"
        repoName={() => 'web-app'}
        employeeName={(id) => id}
        employeePerson={() => null}
      />,
    )

  it('fades the one that waits and says what it waits on; the blocker says what it blocks', () => {
    const waits = draw(waiting, board)
    expect(waits).toContain('opacity-72')
    expect(waits).toMatch(/data-ui="BlockedByChip"[^>]*>.*Blocked by.*TC-138/)
    const blocks = draw(blocker, board)
    expect(blocks).not.toContain('opacity-72')
    expect(blocks).toMatch(/data-ui="BlocksChip"[^>]*>.*Blocks.*TC-150/)
  })

  it('stops waiting, and drops both chips, once the blocker is Done', () => {
    const done = [waiting, { ...blocker, column: 'done' as const }]
    const html = draw(waiting, done)
    expect(html).not.toContain('opacity-72')
    expect(html).not.toContain('BlockedByChip')
    expect(draw(done[1]!, done)).not.toContain('BlocksChip')
  })
})
