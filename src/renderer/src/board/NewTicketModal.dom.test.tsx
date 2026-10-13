// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AutonomyLevel } from '../../../shared/approvals'
import type { BoardCommand, BoardSnapshot } from '../../../shared/domain/board'
import type { Employee } from '../../../shared/domain/staff'
import { EMPTY_STACK, type Repo } from '../../../shared/repos/repo'
import { NewTicketModal } from './NewTicketModal'

const repos: Repo[] = [
  { id: 'r-web', name: 'web-app', path: '/w', brief: '', rung: 'merge', stack: EMPTY_STACK, addedAt: '' },
  { id: 'r-api', name: 'billing-api', path: '/a', brief: '', rung: 'merge', stack: EMPTY_STACK, addedAt: '' },
]

const ada = {
  id: 'e-ada',
  name: 'Ada Lorne',
  roleId: 'frontend',
  title: 'Frontend',
  persona: '',
  capabilities: ['code'],
  repoFilter: ['*'],
  overrides: [],
  provider: 'claude',
  permissionMode: 'skip-permissions',
  model: null,
  desk: 0,
  sprite: 1,
  createdAt: '',
} as unknown as Employee

const board: BoardSnapshot = {
  columns: [
    { id: 'todo', title: 'Todo', wipLimit: null, count: 0, overLimit: false },
    { id: 'doing', title: 'Doing', wipLimit: null, count: 0, overLimit: false },
    { id: 'review', title: 'Review', wipLimit: null, count: 0, overLimit: false },
    { id: 'done', title: 'Done', wipLimit: null, count: 0, overLimit: false },
  ],
  targets: [],
  epics: [],
  tickets: [],
}

let host: HTMLDivElement
let root: Root
let applied: BoardCommand[]
let closed: number

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  applied = []
  closed = 0
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function open(autonomy: AutonomyLevel = 'managed') {
  act(() =>
    root.render(
      <NewTicketModal
        board={board}
        column="todo"
        epicId={3}
        repos={repos}
        employees={[ada]}
        companyName="Tiny Corp"
        autonomy={autonomy}
        apply={async (command) => {
          applied.push(command)
          return true
        }}
        error={null}
        onClose={() => {
          closed += 1
        }}
      />,
    ),
  )
}

/** A React-controlled field only sees a value set through its own setter, then told about it. */
function type(field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value')?.set
  setter?.call(field, value)
  act(() => {
    field.dispatchEvent(new Event('input', { bubbles: true }))
    field.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

const at = <T extends Element>(selector: string) => host.querySelector<T>(selector)!
/** The control a `<label>` names — how the boss finds it, and now how the test does. */
const byLabel = <T extends Element>(label: string): T => {
  const tag = [...host.querySelectorAll('label')].find((one) => one.textContent?.trim() === label)!
  return host.querySelector<T>(`#${CSS.escape(tag.htmlFor)}`)!
}
/** The button that reads this. */
const byText = (label: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('button')].find((one) => one.textContent?.trim() === label)!
const titleField = () => at<HTMLInputElement>('[data-ui="Input Group"] input')
const chip = (name: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')].find((c) => c.textContent?.trim() === name)!
const press = (key: string, init: KeyboardEventInit = {}) =>
  act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init })))

describe('Leaving New ticket', () => {
  it('closes on Escape, on the backdrop, on the header close and on Cancel', () => {
    open()
    press('Escape')
    expect(closed).toBe(1)

    act(() => void at('[data-ui="NewTicket"]').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })))
    expect(closed).toBe(2)

    act(() => at<HTMLButtonElement>('[aria-label="Close"]').click())
    expect(closed).toBe(3)

    act(() => byText('Cancel').click())
    expect(closed).toBe(4)
    expect(applied).toEqual([])
  })

  it('stays open when the click lands inside the modal', () => {
    open()
    act(() => void at('[role="dialog"]').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })))
    expect(closed).toBe(0)
  })
})

describe('Creating a ticket', () => {
  it('creates it from ⌘↵, with the fields, the repos and the scoped epic, then closes', async () => {
    open()
    type(titleField(), 'Checkout fails when the card token expires mid-session')
    type(at<HTMLTextAreaElement>('textarea'), 'Repro: leave checkout open ~20 min, then pay.')
    act(() => chip('web-app').click())
    type(byLabel<HTMLSelectElement>('Assignee'), 'e-ada')
    type(byLabel<HTMLInputElement>('Base branch'), 'main')
    type(byLabel<HTMLSelectElement>('Priority'), 'high')

    press('Enter', { metaKey: true })
    await act(async () => {})

    expect(applied).toEqual([
      {
        kind: 'createTicket',
        input: {
          title: 'Checkout fails when the card token expires mid-session',
          description: 'Repro: leave checkout open ~20 min, then pay.',
          epicId: 3,
          column: 'todo',
          assigneeId: 'e-ada',
          repos: ['r-web'],
          priority: 'high',
          labels: [],
          baseBranch: 'main',
        },
      },
    ])
    expect(closed).toBe(1)
  })

  it('refuses a ticket with no repo, and says so on the chip row instead of creating it', async () => {
    open()
    type(titleField(), 'Nothing to work in')
    act(() => byText('Create ticket').click())
    await act(async () => {})
    expect(applied).toEqual([])
    expect(closed).toBe(0)
    expect(host.textContent).toContain('Pick at least one repo')
  })

  it('starts the work by creating it in Doing once an assignee can act on it', async () => {
    open()
    type(titleField(), 'Start it now')
    act(() => chip('web-app').click())
    const toggle = at<HTMLInputElement>('[aria-label="Start work immediately"]')
    // Nobody is assigned, so there is nobody to start.
    expect(toggle.disabled).toBe(true)

    type(byLabel<HTMLSelectElement>('Assignee'), 'e-ada')
    expect(at<HTMLInputElement>('[aria-label="Start work immediately"]').disabled).toBe(false)
    expect(host.textContent).toContain('Ada Lorne opens a worktree off the repo default')

    act(() => at<HTMLInputElement>('[aria-label="Start work immediately"]').click())
    act(() => byText('Create ticket').click())
    await act(async () => {})
    expect(applied).toHaveLength(1)
    expect(applied[0]).toMatchObject({ kind: 'createTicket', input: { column: 'doing', assigneeId: 'e-ada' } })
  })

  it('offers no way to start the work under Supervised (decision 38)', () => {
    open('supervised')
    expect(host.querySelector('[aria-label="Start work immediately"]')).toBeNull()
    expect(host.textContent).not.toContain('Start work immediately')
  })
})
