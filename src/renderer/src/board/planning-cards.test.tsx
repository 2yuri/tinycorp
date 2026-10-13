import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Epic, Ticket } from '../../../shared/domain/board'
import { type Plan, planNextStep } from '../../../shared/planning/planning'
import { type BoardFacts, needYou, planLabel, planningEpics, planQuestions, visibleTickets } from './board-model'
import { EpicCard, TicketCard } from './TicketCard'

function plan(fields: Partial<Plan> & { id: number; status: Plan['status'] }): Plan {
  return {
    version: 1,
    ticketId: null,
    epicId: null,
    plannerId: 'e-nova',
    goal: 'A range picker',
    approach: '',
    acceptanceCriteria: [],
    repos: [],
    subtasks: [],
    risks: [],
    openQuestions: [],
    approvedBy: null,
    approvedAt: null,
    replanBy: null,
    replanReason: null,
    replanChanges: [],
    channelId: 'general',
    threadId: 1,
    messageId: 2,
    createdAt: '2026-09-22T09:00:00Z',
    questions: [],
    ...fields,
  }
}

function question(number: number, answer: string | null) {
  return {
    id: number,
    planId: 1,
    number,
    text: `Question ${number}`,
    answer,
    answeredBy: answer === null ? null : 'boss',
    answeredAt: null,
    delegated: false,
    messageId: 2,
  }
}

function ticket(id: number, changes: Partial<Ticket> = {}): Ticket {
  return {
    id,
    epicId: null,
    title: 'Usage chart with range picker',
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
    ...changes,
  }
}

function facts(plans: Plan[]): BoardFacts {
  return { sessions: {}, approvals: [], reviews: [], code: [], plans, tests: [], security: [], companyKey: 'TC' }
}

const nameOf = (id: string) => (id === 'e-nova' ? 'Nova' : id)

describe('the chip a Planning card carries (frame Oumw5)', () => {
  it('names the planner and how many questions wait on the boss', () => {
    const waiting = plan({ id: 1, ticketId: 1, status: 'drafting', questions: [question(1, null)] })

    expect(planLabel(ticket(1), facts([waiting]), nameOf)).toEqual({
      tone: 'asking',
      text: 'Nova is asking you · 1 question',
    })
    expect(planQuestions(ticket(1), facts([waiting]))).toBe('Q 0/1')
  })

  it('says the plan is drafted once every question is answered', () => {
    const drafted = plan({
      id: 1,
      ticketId: 1,
      status: 'waiting',
      questions: [question(1, 'yes'), question(2, 'no'), question(3, null)],
    })
    const answered = { ...drafted, questions: drafted.questions.map((q) => ({ ...q, answer: q.answer ?? 'yes' })) }

    expect(planLabel(ticket(1), facts([answered]), nameOf)).toEqual({
      tone: 'waiting',
      text: 'Plan drafted · waiting on you',
    })
    expect(planQuestions(ticket(1), facts([drafted]))).toBe('Q 2/3')
  })

  // TI-6: the boss answered every question, the ticks went green, and the card said nothing about
  // what was still to come. The answered state is neither approval nor a decision the boss owes.
  it('says the answers are sent and the plan is still to come, in the drafting tone', () => {
    const answered = plan({
      id: 1,
      ticketId: 1,
      status: 'drafting',
      messageId: null,
      questions: [question(1, 'yes'), question(2, 'no')],
    })

    expect(planLabel(ticket(1), facts([answered]), nameOf)).toEqual({
      tone: 'answered',
      text: 'Answers sent · waiting for the plan',
    })
    expect(planNextStep(answered, 'Nova')).toBe('Waiting for the plan from Nova')
    expect(needYou([ticket(1)], facts([answered]))).toBe(0)
  })

  it('reads as a decision the boss owes only once the plan itself is drafted', () => {
    const drafted = plan({
      id: 1,
      ticketId: 1,
      status: 'waiting',
      questions: [question(1, 'yes')],
    })

    expect(planNextStep(drafted, 'Nova')).toBe('Plan ready: approve or send back')
    expect(needYou([ticket(1)], facts([drafted]))).toBe(1)
  })

  it('says the planner is drafting while nothing waits on the boss', () => {
    const drafting = plan({ id: 1, ticketId: 1, status: 'drafting' })

    expect(planLabel(ticket(1), facts([drafting]), nameOf)).toEqual({
      tone: 'drafting',
      text: 'Nova is drafting the plan',
    })
  })

  it('reads `Plan approved` on a Ready card, and nothing once it is worked', () => {
    const approved = plan({ id: 1, ticketId: 1, status: 'approved', approvedBy: 'boss' })

    expect(planLabel(ticket(1, { column: 'todo' }), facts([approved]), nameOf)).toEqual({
      tone: 'approved',
      text: 'Plan approved',
    })
    expect(planLabel(ticket(1, { column: 'doing' }), facts([approved]), nameOf)).toBeNull()
  })

  it('draws the chip on the card, and the question count beside the id', () => {
    const asking = plan({ id: 1, ticketId: 1, status: 'drafting', questions: [question(1, null)] })
    const html = renderToStaticMarkup(
      <TicketCard
        ticket={ticket(1)}
        facts={facts([asking])}
        view="full"
        repoName={(id) => id}
        employeeName={nameOf}
        employeePerson={() => null}
      />,
    )

    expect(html).toContain('Nova is asking you · 1 question')
    expect(html).toContain('Q 0/1')
  })
})

describe('the Planning column', () => {
  const epic: Epic = { id: 3, targetId: 1, title: 'Plan switching', description: '', color: 'amber' }
  const board = { columns: [], targets: [], epics: [epic], tickets: [] }
  const selection = { scope: { kind: 'all' } as const, view: null }

  it('draws a card for an epic whose plan is not approved, and drops it once it is', () => {
    const drafting = plan({ id: 5, epicId: 3, status: 'drafting' })

    expect(planningEpics(board, facts([drafting]), selection)).toEqual([epic])
    expect(planningEpics(board, facts([{ ...drafting, status: 'approved' }]), selection)).toEqual([])
  })

  it('counts what needs the boss for the column head', () => {
    const asking = plan({ id: 1, ticketId: 1, status: 'drafting', questions: [question(1, null)] })
    const drafted = plan({ id: 2, ticketId: 2, status: 'waiting' })
    const quiet = plan({ id: 3, ticketId: 3, status: 'drafting' })

    expect(needYou([ticket(1), ticket(2), ticket(3)], facts([asking, drafted, quiet]))).toBe(2)
  })

  it('draws the epic card with its planner and its ticket count', () => {
    const html = renderToStaticMarkup(
      <EpicCard
        epic={epic}
        facts={facts([plan({ id: 5, epicId: 3, status: 'drafting' })])}
        tickets={3}
        employeeName={nameOf}
        employeePerson={() => null}
      />,
    )

    expect(html).toContain('EP-3')
    expect(html).toContain('Plan switching')
    expect(html).toContain('Nova is drafting the plan')
  })
})

describe('My approvals', () => {
  it('lists a ticket whose plan waits on the boss, not one the planner is still drafting', () => {
    const waiting = plan({ id: 1, ticketId: 1, status: 'waiting' })
    const drafting = plan({ id: 2, ticketId: 2, status: 'drafting' })
    const board = { columns: [], targets: [], epics: [], tickets: [ticket(1), ticket(2)] }

    const shown = visibleTickets(board, facts([waiting, drafting]), {
      scope: { kind: 'all' },
      view: 'my-approvals',
    })

    expect(shown.map((t) => t.id)).toEqual([1])
  })
})
