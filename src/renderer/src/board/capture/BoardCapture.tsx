// A dev-only capture of the Board with the ticket drawer or the New ticket modal open
// (`board-capture.html`), so each can be compared with `design/screens/Izdc9.png` and
// `design/screens/Y5daiS.png`. It stands in for the engine with the design's own fixture.
// Nothing here ships.
import { type ReactNode, useEffect } from 'react'
import type { TinyCorpApi } from '../../../../shared/ipc'
import { SHELL_MAIN } from '../../chrome'
import * as fixture from './fixture'

/** Nothing is ever thrown away here: the capture never goes back to a point. */
const NO_LOSS = { commits: [], uncommitted: false, stops: null }

/** A subscription that never fires: the fixture does not change while capturing. */
const never = () => () => {}
const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value })

/** `?testing` draws the board of `RJa6D`: the Testing column, with the cards that sit in it. */
function testingBoard(): boolean {
  return new URLSearchParams(window.location.search).has('testing')
}

/** Everything the Board reads, answered from the fixture. */
function stub(): TinyCorpApi {
  const board = testingBoard() ? fixture.testingBoard() : fixture.board
  return {
    board: {
      snapshot: () => Promise.resolve(board),
      apply: () => ok(board),
      ticketRemoval: () => ok(fixture.removal),
      deleteTicket: () => ok(fixture.removal),
      onChanged: never,
    },
    staff: { employees: () => ok(fixture.employees), onChanged: never },
    repos: { list: () => ok(fixture.repos), onChanged: never },
    company: { current: () => Promise.resolve(fixture.company), onChanged: never },
    sessions: {
      list: () => ok(Object.entries(fixture.sessions).map(([employeeId, status]) => ({ employeeId, status }))),
      onChanged: never,
    },
    approvals: { list: () => ok([]), level: () => ok('managed'), onChanged: never },
    reviews: { list: () => ok(fixture.reviews), securityPasses: () => ok([]), onChanged: never },
    planning: { list: () => ok(fixture.plans), replan: () => ok(fixture.plans[0]), onChanged: never },
    code: { list: () => ok(fixture.code), onChanged: never },
    tests: { list: () => ok(testingBoard() ? fixture.tests : []), onChanged: never },
    restorePoints: { of: () => ok(fixture.restorePoints), losses: () => ok(NO_LOSS), goBack: never, onChanged: never },
  } as unknown as TinyCorpApi
}

/**
 * Mounts the Board with the fixture behind it, inside the window the frame draws, and opens the
 * drawer on the ticket the frame is open on. `?ticket=<id>` opens another one, `?closed` leaves the
 * drawer shut (the board's own frame, `SZUeE`), `?foot` scrolls the body to its end, so the two
 * sections under the divider can be shot by a headless browser that cannot scroll, and `?new`
 * opens New ticket and fills it as the frame writes it (`Y5daiS`), `?plan` draws the drawer's
 * PLAN section in both of its states, as the states sheet `hZrUN` draws them (T171), and `?delete`
 * presses the drawer's Delete ticket, so its confirmation stands over the board (T275, `xdaOR`).
 */
export async function boardCapture(): Promise<ReactNode> {
  // The stub goes in before the view's modules load: they read the preload API at import time.
  window.tinyCorp = stub()
  if (new URLSearchParams(window.location.search).has('plan')) return planStates()
  const { ContentHeader } = await import('../../chrome/ContentHeader')
  const { Board } = await import('../Board')
  const { openTicket } = await import('../open-ticket')
  const query = new URLSearchParams(window.location.search)
  const creating = query.has('new')
  const ticket = query.has('closed') || creating ? null : Number(query.get('ticket') ?? fixture.OPEN_TICKET)
  const foot = query.has('foot')
  const deleting = query.has('delete')

  /** The board, with the drawer opened the way a click on a card opens it. */
  function Opened() {
    // A parent's effect runs after its children's, so the board is already listening by now.
    useEffect(() => {
      if (ticket !== null) openTicket(ticket)
      if (creating) void fillNewTicket()
      if (deleting) void pressDelete()
      if (!foot) return
      const timer = setTimeout(() => {
        const body = document.querySelector('[data-ui="DrawerBody"]')
        if (body) body.scrollTop = body.scrollHeight
      }, 400)
      return () => clearTimeout(timer)
    }, [])
    return <Board company={fixture.company} route={{ view: 'board' }} onNavigate={() => {}} />
  }

  return (
    <Frame>
      <ContentHeader title="Board" subtitle="">
        <Opened />
      </ContentHeader>
    </Frame>
  )
}

/** Presses the drawer's Delete ticket the way the boss does, once the drawer is there. */
async function pressDelete(): Promise<void> {
  for (let tries = 0; tries < 40; tries++) {
    const button = [...document.querySelectorAll('button')].find((one) => one.textContent === 'Delete ticket')
    if (button) return button.click()
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

/** The shell's rail (68) and drawer (276), so the board starts where the window puts it. */
const SHELL_WIDTH = 344

/** The title bar the drawer starts under; the drawer is fixed to the viewport, as it is in the app. */
const TITLE_BAR = 44

function Frame({ children }: { children: ReactNode }) {
  return (
    <div style={{ width: 1512, height: 944, overflow: 'hidden', background: 'var(--background)' }}>
      <div style={{ height: TITLE_BAR, background: 'var(--card)', borderBottom: '1px solid var(--border)' }} />
      <div style={{ display: 'flex', height: 944 - TITLE_BAR, overflow: 'hidden' }}>
        <div style={{ width: SHELL_WIDTH, flexShrink: 0, background: 'var(--card)' }} />
        <main className={SHELL_MAIN} style={{ display: 'flex', flex: '1 1 0', minWidth: 0, flexDirection: 'column' }}>
          {children}
        </main>
      </div>
    </div>
  )
}

/** A React-controlled field only sees a value set through its own setter, then told about it. */
function type(field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const proto = Object.getPrototypeOf(field)
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(field, value)
  field.dispatchEvent(new Event('input', { bubbles: true }))
  field.dispatchEvent(new Event('change', { bubbles: true }))
}

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms))
const at = <T extends Element>(selector: string) => document.querySelector<T>(selector)
/** The button that reads this — how the boss finds it, now that it wears no class of its own. */
const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find((one) => one.textContent?.trim() === label)
/** The control a `<label>` names, which is how the boss finds that too. */
const byLabel = <T extends Element>(root: ParentNode, label: string): T | null => {
  const tag = [...root.querySelectorAll('label')].find((one) => one.textContent?.trim() === label)
  return tag?.htmlFor ? root.querySelector<T>(`#${CSS.escape(tag.htmlFor)}`) : null
}

/**
 * Opens New ticket the way the boss does — clicking the header's action — and fills it the way the
 * boss would, with what the frame writes. No back door: every value goes in through a control.
 */
async function fillNewTicket() {
  await wait(200)
  button('New ticket')?.click()
  await wait(200)

  const form = at<HTMLFormElement>('[data-ui="NewTicket"] form')
  if (!form) return
  const title = form.querySelector<HTMLInputElement>('[data-ui="Input Group"] input')
  if (title) type(title, fixture.board.tickets[0]!.title)
  const description = form.querySelector<HTMLTextAreaElement>('textarea')
  if (description) type(description, fixture.board.tickets[0]!.description)

  // web-app and billing-api are picked; infra is not, so both chip states are in the shot.
  for (const chip of form.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')) {
    const picked = chip.textContent?.trim() !== 'infra'
    if (chip.getAttribute('aria-pressed') !== String(picked)) chip.click()
  }
  const branch = byLabel<HTMLInputElement>(form, 'Base branch')
  if (branch) type(branch, 'main')
  const assignee = byLabel<HTMLSelectElement>(form, 'Assignee')
  if (assignee) type(assignee, 'e-ada')
  const priority = byLabel<HTMLSelectElement>(form, 'Priority')
  if (priority) type(priority, 'high')

  for (const label of ['bug', 'checkout', 'p1']) {
    at<HTMLButtonElement>('[data-ui="AddLabel"]')?.click()
    await wait(60)
    const input = at<HTMLInputElement>('[aria-label="New label"]')
    if (!input) continue
    type(input, label)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    input.blur()
    await wait(60)
  }

  // Clicked only while it is off: the capture's effect runs twice under StrictMode, and a blind
  // click would turn it back off on the second pass.
  await wait(200)
  const toggle = at<HTMLInputElement>('[aria-label="Start work immediately"]')
  if (toggle && !toggle.disabled && !toggle.checked) toggle.click()
}

/**
 * The two states of the drawer's PLAN section, stacked as the states sheet draws them (`hZrUN`):
 * a plan the boss approved, and the replan an engineer asked for on top of it.
 */
async function planStates(): Promise<ReactNode> {
  // This state draws the PLAN section on its own, without `Board`, which is what pulls the
  // Tailwind setup into the bundle (T210d). Without this line the section renders unstyled.
  await import('../../ui/tailwind.css')
  const { TicketPlan } = await import('../TicketPlan')
  const ticket = fixture.board.tickets.find((t) => t.id === 147)!
  const approved = {
    ...fixture.plans.find((p) => p.ticketId === 147)!,
    acceptanceCriteria: ['a', 'b', 'c', 'd'],
    subtasks: [
      { title: 'one', repo: 'r-web' },
      { title: 'two', repo: 'r-web' },
      { title: 'three', repo: 'r-api' },
    ],
    repos: ['r-web', 'r-api'],
    goal: 'Customers see what they used over a chosen range, on the billing page.',
  }
  const replan = {
    ...approved,
    id: 99,
    version: 2,
    status: 'replan' as const,
    approvedBy: null,
    approvedAt: null,
    replanBy: 'e-vega',
    replanReason:
      'Ranges over 90 days time out on GET /usage. It needs cursor pagination and a migration in billing-api.',
    replanChanges: [
      '+ Subtask · cursor pagination on GET /usage',
      '+ Criterion · a 12-month range loads in under 2 s',
      '~ Risk · migration on the usage table',
    ],
  }
  const repoName = (id: string) => fixture.repos.find((r) => r.id === id)?.name ?? id
  const employeeName = (id: string) => fixture.employees.find((e) => e.id === id)?.name ?? id
  const facts = (plan: typeof approved) => ({
    sessions: fixture.sessions,
    approvals: [],
    reviews: [],
    code: [],
    plans: [plan],
    tests: [],
    security: [],
    companyKey: fixture.company.key,
  })
  return (
    <div style={{ width: 480, padding: 20, background: 'var(--background)' }}>
      <h2 style={{ font: '600 13px Inter, system-ui', color: 'var(--foreground)' }}>
        a · Plan approved — in the ticket drawer
      </h2>
      <TicketPlan
        ticket={{ ...ticket, assigneeId: 'e-vega' }}
        facts={facts(approved)}
        repoName={repoName}
        employeeName={employeeName}
      />
      <h2 style={{ font: '600 13px Inter, system-ui', color: 'var(--foreground)', marginTop: 28 }}>
        b · Plan changed after approval — replan requested
      </h2>
      <TicketPlan
        ticket={{ ...ticket, assigneeId: 'e-vega' }}
        facts={facts(replan)}
        repoName={repoName}
        employeeName={employeeName}
      />
    </div>
  )
}
