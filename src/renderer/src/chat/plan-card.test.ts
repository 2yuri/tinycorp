import { describe, expect, it } from 'vitest'
import type { Message } from '../../../shared/domain/chat'
import type { Plan } from '../../../shared/planning/planning'
import * as fixture from './capture/fixture'
import { type ChatData, cardOf } from './chat-view'

const data: ChatData = {
  employees: fixture.employees,
  companyKey: 'TC',
  board: fixture.board,
  code: [],
  repos: fixture.repos,
  approvals: new Map(),
  reviews: [],
  plans: fixture.plans,
}

const message = (id: number): Message => fixture.planningMessages.find((m) => m.id === id)!

describe('the Plan card (frame D1E2lt)', () => {
  it('hangs under the message that posted it, with its goal, criteria, subtasks and risks', () => {
    const card = cardOf(message(202), data)

    expect(card).toMatchObject({
      kind: 'plan',
      title: 'Plan · TC-142 Usage chart with range picker',
      by: 'Draft 1 · by Nova',
      status: 'waiting',
      waiting: true,
      repos: ['web-app', 'billing-api'],
      foot: 'Engineers can’t claim it until approved',
      nextStep: 'Plan ready: approve or send back',
    })
    expect(card).toMatchObject({ kind: 'plan' })
    if (card?.kind !== 'plan') throw new Error('not a plan card')
    expect(card.criteria).toHaveLength(4)
    expect(card.subtasks.map((s) => s.repo)).toEqual(['billing-api', 'web-app', 'web-app'])
    expect(card.openQuestions[0]).toContain('assumed yes')
  })

  it('reads as the boss’s own approval once it is approved, and offers no decision', () => {
    const approved = cardOf(message(202), { ...data, plans: [fixture.approvedPlan] })

    expect(approved).toMatchObject({
      kind: 'plan',
      status: 'approved',
      waiting: false,
      foot: 'Approved — it is Ready to claim',
    })
    if (approved?.kind !== 'plan') throw new Error('not a plan card')
    expect(approved.by).toMatch(/^v1 · approved by you · \d\d:\d\d$/)
  })

  it('draws what a replan changes, and waits on the boss again (frame hZrUN)', () => {
    const replan = cardOf({ ...message(202), id: 203 }, { ...data, plans: [fixture.replanPlan] })

    expect(replan).toMatchObject({
      kind: 'plan',
      status: 'replan',
      by: 'v1 → v2',
      waiting: true,
      replan: { by: 'Vega', changes: fixture.replanPlan.replanChanges },
      foot: 'Back in Planning until you decide',
    })
  })
})

describe('the questions card (frame D1E2lt)', () => {
  it('numbers them, shows the answers inline and waits while one is open', () => {
    const card = cardOf(message(201), data)

    expect(card).toMatchObject({ kind: 'questions', asker: 'Nova', waiting: true })
    if (card?.kind !== 'questions') throw new Error('not a questions card')
    expect(card.questions.map((q) => [q.number, q.answeredBy])).toEqual([
      [1, 'you'],
      [2, 'you'],
      [3, null],
    ])
  })

  // TI-6: every question answered, the plan not yet posted, and the card was a column of green
  // ticks that read as an approved plan. It has to say what it is waiting for (frame `dvg9E`).
  it('ends on “Answers sent · waiting for the plan” while the plan is still to come', () => {
    const answered: Plan = {
      ...fixture.plans[0]!,
      status: 'drafting',
      messageId: null,
      questions: fixture.plans[0]!.questions.map((q) => ({ ...q, answer: q.answer ?? 'Yes.', answeredBy: 'boss' })),
    }

    const card = cardOf(message(201), { ...data, plans: [answered] })

    expect(card).toMatchObject({
      kind: 'questions',
      waiting: false,
      sent: { state: 'Answers sent · waiting for the plan', by: 'Nova is writing it' },
    })
  })

  it('says nothing about answers being sent once the plan itself is posted', () => {
    const drafted: Plan = {
      ...fixture.plans[0]!,
      questions: fixture.plans[0]!.questions.map((q) => ({ ...q, answer: q.answer ?? 'Yes.', answeredBy: 'boss' })),
    }

    expect(cardOf(message(201), { ...data, plans: [drafted] })).toMatchObject({ sent: null })
  })

  it('stops waiting once every question is answered', () => {
    const answered: Plan = {
      ...fixture.plans[0]!,
      questions: fixture.plans[0]!.questions.map((q) => ({ ...q, answer: q.answer ?? 'yes', answeredBy: 'boss' })),
    }

    expect(cardOf(message(201), { ...data, plans: [answered] })).toMatchObject({ waiting: false })
  })
})
