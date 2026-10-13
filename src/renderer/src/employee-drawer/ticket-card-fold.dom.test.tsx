import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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
    { id: 2, ticketId: 42, title: 'Wire the query', done: false, repo: null },
  ],
  priority: 'normal',
  labels: [],
  baseBranch: null,
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  window.localStorage.clear()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function mount(fields: Partial<Ticket> = {}, foldable = true) {
  act(() => root.render(<TicketCard ticket={{ ...ticket, ...fields }} companyKey="TC" foldable={foldable} />))
}

const toggle = () => host.querySelector<HTMLButtonElement>('button[aria-expanded]')
const rows = () => host.querySelectorAll('li').length

describe('the ticket card under the terminal (TI-2)', () => {
  it('starts folded to its title and progress', () => {
    mount()

    expect(rows()).toBe(0)
    expect(toggle()?.getAttribute('aria-expanded')).toBe('false')
    expect(toggle()?.textContent).toContain('1 / 2')
  })

  it('opens and folds from the Subtasks row, and names the list it controls', () => {
    mount()

    act(() => toggle()?.click())
    expect(rows()).toBe(2)
    expect(toggle()?.getAttribute('aria-expanded')).toBe('true')
    expect(host.querySelector('ul')?.id).toBe(toggle()?.getAttribute('aria-controls'))

    act(() => toggle()?.click())
    expect(rows()).toBe(0)
  })

  it('comes back the way the boss left it', () => {
    mount()
    act(() => toggle()?.click())
    act(() => root.render(null))

    mount()
    expect(rows()).toBe(2)
  })

  it('has nothing to fold without subtasks', () => {
    mount({ subtasks: [] })

    expect(toggle()).toBeNull()
    expect(host.textContent).toContain('0 / 0')
  })

  it('shows the whole list on the Ticket tab', () => {
    mount({}, false)

    expect(rows()).toBe(2)
    expect(toggle()).toBeNull()
  })
})
