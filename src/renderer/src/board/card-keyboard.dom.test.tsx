// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import type { Epic, Ticket } from '../../../shared/domain/board'
import type { Plan } from '../../../shared/planning/planning'
import type { BoardFacts } from './board-model'
import { EpicCard, TicketCard } from './TicketCard'

/**
 * A board card opens the editor when it is clicked. Until T190 that was all it did: the card is a
 * `li`, nothing focused it, and a boss working from the keyboard could reach every chip inside a
 * card and never the card itself. It is now a stop on the tab order that answers Enter and Space —
 * and only when the key landed on the card, so the chips inside it keep their own keys.
 */
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ticket: Ticket = {
  id: 42,
  epicId: null,
  title: 'Usage chart',
  description: '',
  column: 'doing',
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
}

const epic: Epic = { id: 7, targetId: null, title: 'Billing', description: '', color: 'green' }

const epicPlan: Plan = {
  version: 1,
  id: 1,
  status: 'approved',
  ticketId: null,
  epicId: 7,
  plannerId: 'e-nova',
  goal: 'Bill for what is used',
  approach: '',
  acceptanceCriteria: [],
  repos: [],
  subtasks: [],
  risks: [],
  openQuestions: [],
  approvedBy: 'boss',
  approvedAt: null,
  replanBy: null,
  replanReason: null,
  replanChanges: [],
  channelId: 'general',
  threadId: 1,
  messageId: 2,
  createdAt: '2026-09-22T09:00:00Z',
  questions: [],
}

const facts: BoardFacts = {
  sessions: {},
  approvals: [],
  reviews: [],
  code: [],
  plans: [epicPlan],
  tests: [],
  security: [],
  companyKey: 'TC',
}

let root: Root | null = null
let host: HTMLElement | null = null

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
})

function draw(node: React.ReactNode): HTMLElement {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root!.render(node))
  return host
}

const press = (node: Element, key: string) =>
  act(() => {
    node.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  })

describe('a board card on the keyboard', () => {
  it('is a tab stop that opens on Enter and on Space', () => {
    const opened: string[] = []
    const host = draw(
      <TicketCard
        ticket={ticket}
        facts={facts}
        view="full"
        repoName={(id) => id}
        employeeName={(id) => id}
        employeePerson={() => null}
        onOpen={() => opened.push('ticket')}
      />,
    )
    const card = host.querySelector('[data-ui="TicketCard"]')!

    expect(card.getAttribute('tabindex')).toBe('0')
    press(card, 'Enter')
    press(card, ' ')
    expect(opened).toEqual(['ticket', 'ticket'])
  })

  it('leaves the keys of the chips inside it alone', () => {
    const opened: string[] = []
    const host = draw(
      <TicketCard
        ticket={{ ...ticket, subtasks: [{ id: 1, ticketId: 42, title: 'a', done: false, repo: null }] }}
        facts={facts}
        view="full"
        repoName={(id) => id}
        employeeName={(id) => id}
        employeePerson={() => null}
        onOpen={() => opened.push('ticket')}
      />,
    )
    const inside = host.querySelector('[data-ui="TicketCard"] .wrap-anywhere')!

    press(inside, 'Enter')

    expect(opened).toEqual([])
  })

  it('is not a tab stop when there is nothing to open', () => {
    const host = draw(
      <TicketCard
        ticket={ticket}
        facts={facts}
        view="full"
        repoName={(id) => id}
        employeeName={(id) => id}
        employeePerson={() => null}
      />,
    )

    expect(host.querySelector('[data-ui="TicketCard"]')!.hasAttribute('tabindex')).toBe(false)
  })

  it('opens an epic card the same way', () => {
    const opened: string[] = []
    const host = draw(
      <EpicCard
        epic={epic}
        facts={facts}
        tickets={3}
        employeeName={(id) => id}
        employeePerson={() => null}
        onOpen={() => opened.push('epic')}
      />,
    )
    const card = host.querySelector('[data-ui="EpicCard"]')!

    expect(card.getAttribute('tabindex')).toBe('0')
    press(card, 'Enter')
    expect(opened).toEqual(['epic'])
  })
})
