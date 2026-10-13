// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Ticket } from '../../../shared/domain/board'
import type { Plan } from '../../../shared/planning/planning'
import type { BoardFacts } from './board-model'
import { TicketPlan } from './TicketPlan'

/**
 * PLAN in the ticket drawer. TI-6: the boss answered every question, and the drawer said `Drafted
 * by Nova` over a neutral `Planning` badge — a plan that did not exist yet, described as written,
 * with nothing saying what the ticket was waiting for (T233).
 */
;(window as unknown as { tinyCorp: unknown }).tinyCorp = { planning: {} }

function plan(fields: Partial<Plan>): Plan {
  return {
    id: 1,
    version: 1,
    ticketId: 42,
    epicId: null,
    plannerId: 'e-nova',
    goal: 'Customers see what they used over a chosen range.',
    approach: '',
    acceptanceCriteria: [],
    repos: [],
    subtasks: [],
    risks: [],
    openQuestions: [],
    status: 'drafting',
    approvedBy: null,
    approvedAt: null,
    replanBy: null,
    replanReason: null,
    replanChanges: [],
    channelId: 'general',
    threadId: 1,
    messageId: null,
    createdAt: '2026-09-25T09:00:00Z',
    questions: [],
    ...fields,
  }
}

const answered = {
  id: 1,
  planId: 1,
  number: 1,
  text: 'Which ranges?',
  answer: '7, 30 and 90.',
  answeredBy: 'boss',
  answeredAt: '2026-09-25T09:10:00Z',
  delegated: false,
  messageId: 2,
}

const ticket = {
  id: 42,
  epicId: null,
  title: 'Usage chart',
  description: '',
  column: 'planning',
  assigneeId: null,
  repos: [],
  blocked: false,
  blockedReason: '',
  blockedBy: [],
  blocks: [],
  subtasks: [],
  priority: 'normal',
  labels: [],
  baseBranch: null,
} as Ticket

function draw(one: Plan): string {
  const facts: BoardFacts = {
    sessions: {},
    approvals: [],
    reviews: [],
    code: [],
    plans: [one],
    tests: [],
    security: [],
  }
  return renderToStaticMarkup(
    <TicketPlan ticket={ticket} facts={facts} repoName={(id) => id} employeeName={() => 'Nova'} />,
  )
}

describe('the drawer’s PLAN block', () => {
  it('says the answers are sent and the plan is still to come, never that it is drafted', () => {
    const html = draw(plan({ questions: [answered] }))

    expect(html).toContain('Answers sent to Nova')
    expect(html).toContain('Answers sent')
    expect(html).toContain('Waiting for the plan from Nova')
    expect(html).not.toContain('Drafted by')
  })

  it('says the decision is the boss’s once the plan is drafted', () => {
    const html = draw(plan({ status: 'waiting', messageId: 9, questions: [answered] }))

    expect(html).toContain('Drafted by Nova')
    expect(html).toContain('Waiting on you')
    expect(html).toContain('Plan ready: approve or send back')
  })

  it('says nothing is next once the plan is approved', () => {
    const html = draw(plan({ status: 'approved', approvedBy: 'boss', messageId: 9 }))

    expect(html).toContain('Approved by you')
    expect(html).not.toContain('Plan ready')
    expect(html).not.toContain('Waiting for the plan')
  })
})
