import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import type { BoardCommand, Column, Ticket } from '../../../shared/domain/board'
import { BlockedBy } from './TicketLinks'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ticket = (id: number, title: string, column: Column, links: Partial<Ticket> = {}): Ticket => ({
  id,
  epicId: null,
  title,
  description: '',
  column,
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
  ...links,
})

// Frame sLKP8: #128 waits on TC-138 (Doing) and TC-131 (Done), and TC-150 waits on #128.
const me = ticket(128, 'Checkout fails when the card token expires', 'doing', { blockedBy: [138, 131], blocks: [150] })
const board = [
  me,
  ticket(138, 'Refresh the card token', 'doing', { blocks: [128] }),
  ticket(131, 'Token expiry event', 'done', { blocks: [128] }),
  ticket(150, 'Retry a failed charge', 'todo', { blockedBy: [128] }),
  ticket(160, 'Card token audit log', 'todo'),
  ticket(170, 'Shipped long ago', 'done'),
]

let root: Root | null = null
let host: HTMLElement
afterEach(() => {
  act(() => root?.unmount())
  root = null
  host?.remove()
})

function mount(): BoardCommand[] {
  const sent: BoardCommand[] = []
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() =>
    root!.render(
      <BlockedBy
        ticket={me}
        tickets={board}
        facts={{ companyKey: 'TC' }}
        apply={async (command) => {
          sent.push(command)
          return true
        }}
      />,
    ),
  )
  return sent
}

const rows = () =>
  [...host.querySelectorAll('[data-ui="Blocker"]')].map((row) => row.textContent?.replace(/\s+/g, ' ').trim())

describe('BLOCKED BY in the ticket drawer (frame sLKP8)', () => {
  it('counts the blockers done, draws one row each with its column, and names what it blocks', () => {
    mount()
    expect(host.textContent).toContain('1 of 2 done')
    expect(rows()).toEqual(['TC-138Refresh the card tokenDoing', 'TC-131Token expiry eventDone'])
    expect([...host.querySelectorAll('[data-ui="Blocker"]')].map((row) => row.getAttribute('data-done'))).toEqual([
      'false',
      'true',
    ])
    expect(host.textContent).toContain('It starts when every blocker is Done — nobody picks it up before.')
    expect(host.querySelector('[data-ui="Blocks"]')?.textContent).toContain('TC-150Retry a failed charge')
  })

  it('removes a blocker from its row', () => {
    const sent = mount()
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Remove blocker TC-138"]')!.click())
    expect(sent).toEqual([{ kind: 'removeBlocker', id: 128, blockedById: 138 }])
  })

  it('offers only tickets it may wait on, searched by id or title, and adds the one picked', () => {
    const sent = mount()
    const add = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Add a blocker')!
    act(() => add.click())

    const offered = () => [...host.querySelectorAll('[role="option"]')].map((o) => o.textContent)
    // Not itself, not its blockers, not TC-150 (which waits on it: a loop), not the one Done.
    expect(offered()).toEqual(['TC-160Card token audit log'])

    const input = host.querySelector<HTMLInputElement>('[aria-label="Find a ticket to wait on"]')!
    const type = (value: string) =>
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
    type('TC-15')
    expect(offered()).toEqual([])
    type('audit')
    expect(offered()).toEqual(['TC-160Card token audit log'])

    act(() => host.querySelector<HTMLButtonElement>('[role="option"]')!.click())
    expect(sent).toEqual([{ kind: 'addBlocker', id: 128, blockedById: 160 }])
  })
})
