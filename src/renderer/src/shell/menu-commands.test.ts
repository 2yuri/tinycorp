/**
 * The window's side of the menu (#223): every command does the very thing the boss's own button
 * does, through the same router, the same openers and the same IPC calls.
 */
import { describe, expect, it, vi } from 'vitest'
import type { MenuCommand } from '../../../shared/app/menu'
import type { TicketCode } from '../../../shared/code'
import type { BoardSnapshot, Ticket } from '../../../shared/domain/board'
import type { Result } from '../../../shared/domain/result'
import type { Employee } from '../../../shared/domain/staff'
import type { ResumeAll, SessionInfo, SessionStatus } from '../../../shared/session'
import type { Route } from '../chrome'
import { type MenuCommandDeps, runMenuCommand, ticketToReview } from './menu-commands'

const ok = <T>(value: T): Promise<Result<T>> => Promise.resolve({ ok: true, value })
const failed = (error: string): Promise<Result<never>> => Promise.resolve({ ok: false, error })

function employee(id: string): Employee {
  return { id, name: id } as Employee
}

function session(employeeId: string, status: SessionStatus): SessionInfo {
  return { employeeId, status } as SessionInfo
}

type Overrides = Partial<Omit<MenuCommandDeps, 'sessions' | 'staff'>> & {
  sessions?: Partial<MenuCommandDeps['sessions']>
  staff?: Partial<MenuCommandDeps['staff']>
}

function deps(overrides: Overrides = {}) {
  const went: Route[] = []
  const calls: string[] = []
  const errors: (string | null)[] = []
  const base = {
    went,
    calls,
    errors,
    navigate: (route: Route) => went.push(route),
    openReview: (ticketId: number) => calls.push(`review:${ticketId}`),
    reviewTicket: () => null,
    openHire: () => calls.push('hire'),
    newCompany: () => calls.push('new-company'),
    openCompany: () => calls.push('open-company'),
    openRecent: (companyId: string) => calls.push(`open:${companyId}`),
    moveCompany: () => calls.push('move'),
    toggleLegend: () => calls.push('legend'),
    sessions: {
      list: () => ok<SessionInfo[]>([]),
      start: (id: string) => {
        calls.push(`start:${id}`)
        return ok(session(id, 'idle'))
      },
      stop: (id: string) => {
        calls.push(`stop:${id}`)
        return ok(session(id, 'off'))
      },
      pauseAll: () => {
        calls.push('pause-all')
        return ok(true)
      },
      resumeAll: () => {
        calls.push('resume-all')
        return ok<ResumeAll>({ paused: false, resumed: ['ada'], failed: [], from: 'held' })
      },
    },
    staff: { employees: () => ok<Employee[]>([]) },
    onError: (message: string | null) => errors.push(message),
  }
  return {
    ...base,
    ...overrides,
    sessions: { ...base.sessions, ...overrides.sessions },
    staff: { ...base.staff, ...overrides.staff },
  }
}

const run = (command: MenuCommand, made: ReturnType<typeof deps>) => runMenuCommand(command, made)

describe('where the Go items land', () => {
  const routes: [MenuCommand, Route][] = [
    [{ kind: 'go', target: 'office' }, { view: 'office' }],
    [{ kind: 'go', target: 'chat' }, { view: 'chat' }],
    [{ kind: 'go', target: 'board' }, { view: 'board' }],
    [{ kind: 'go', target: 'repositories' }, { view: 'repositories' }],
    [{ kind: 'go', target: 'employees' }, { view: 'employees' }],
    [{ kind: 'go', target: 'activity' }, { view: 'activity' }],
    [{ kind: 'go', target: 'profile' }, { view: 'profile' }],
    [{ kind: 'go', target: 'settings' }, { view: 'settings' }],
    // The Inbox is a chat pane, exactly as the sidebar's own Inbox row opens it (decision 43).
    [
      { kind: 'go', target: 'inbox' },
      { view: 'chat', inbox: true },
    ],
  ]

  for (const [command, route] of routes) {
    it(`${'target' in command ? command.target : command.kind} opens ${JSON.stringify(route)}`, async () => {
      const made = deps()

      await run(command, made)

      expect(made.went).toEqual([route])
    })
  }

  it('opens the Review screen on the ticket with a diff waiting, as a Review button does', async () => {
    const made = deps({ reviewTicket: () => 42 })

    await run({ kind: 'go', target: 'review' }, made)

    expect(made.calls).toEqual(['review:42'])
    expect(made.went).toEqual([])
  })

  it('shows the Board’s Open PRs when nothing has a diff to read', async () => {
    const made = deps({ reviewTicket: () => null })

    await run({ kind: 'go', target: 'review' }, made)

    expect(made.went).toEqual([{ view: 'board', filter: 'open-prs' }])
  })
})

describe('the Company items', () => {
  it('opens the Launcher’s Create step, a folder, and a Company from before', async () => {
    const made = deps()

    await run({ kind: 'new-company' }, made)
    await run({ kind: 'open-company' }, made)
    await run({ kind: 'open-recent', companyId: 'globex' }, made)
    await run({ kind: 'move-company' }, made)

    expect(made.calls).toEqual(['new-company', 'open-company', 'open:globex', 'move'])
  })
})

describe('the Team items', () => {
  it('hires the way the office header does: the Employees view, with the flow open', async () => {
    const made = deps()

    await run({ kind: 'hire' }, made)

    expect(made.went).toEqual([{ view: 'employees' }])
    expect(made.calls).toEqual(['hire'])
  })

  it('pauses and resumes with the header’s own calls', async () => {
    const made = deps()

    await run({ kind: 'pause-all' }, made)
    await run({ kind: 'resume-all' }, made)

    expect(made.calls).toEqual(['pause-all', 'resume-all'])
    expect(made.errors).toEqual([null, null])
  })

  // T217: the menu item reported nothing at all when Resume all brought nobody back.
  it('says what the button would have said when Resume all brings nobody back', async () => {
    const made = deps({
      sessions: { resumeAll: () => ok<ResumeAll>({ paused: false, resumed: [], failed: [], from: 'nobody' }) },
    })

    await run({ kind: 'resume-all' }, made)

    expect(made.errors).toEqual([expect.stringContaining('Nothing to resume')])
  })

  it('says what the button would have said when Pause all is refused', async () => {
    const made = deps({ sessions: { pauseAll: () => failed('There is no Company open') } })

    await run({ kind: 'pause-all' }, made)

    expect(made.errors).toEqual(['There is no Company open'])
  })

  it('starts only the Employees who have no Session, with the Start button’s own call', async () => {
    const made = deps({
      staff: { employees: () => ok([employee('ada'), employee('grace'), employee('bo')]) },
      sessions: { list: () => ok([session('ada', 'busy'), session('grace', 'off'), session('bo', 'parked')]) },
    })

    await run({ kind: 'start-every-session' }, made)

    expect(made.calls).toEqual(['start:grace'])
    expect(made.errors).toEqual([null])
  })

  it('stops everyone whose Session is on, and nobody else', async () => {
    const made = deps({
      sessions: { list: () => ok([session('ada', 'busy'), session('grace', 'off'), session('bo', 'parked')]) },
    })

    await run({ kind: 'stop-every-session' }, made)

    expect(made.calls).toEqual(['stop:ada', 'stop:bo'])
  })

  it('keeps going past an Employee who cannot start, and reports the first that failed', async () => {
    const start = vi.fn((id: string) =>
      id === 'ada' ? failed('Claude Code is not installed') : ok(session(id, 'idle')),
    )
    const made = deps({
      staff: { employees: () => ok([employee('ada'), employee('grace')]) },
      sessions: { list: () => ok<SessionInfo[]>([]), start },
    })

    await run({ kind: 'start-every-session' }, made)

    expect(start.mock.calls.map(([id]) => id)).toEqual(['ada', 'grace'])
    expect(made.errors).toEqual(['Claude Code is not installed'])
  })
})

describe('the Legend', () => {
  it('takes the boss to the floor the Legend explains, then opens it', async () => {
    const made = deps()

    await run({ kind: 'legend' }, made)

    expect(made.went).toEqual([{ view: 'office' }])
    expect(made.calls).toEqual(['legend'])
  })
})

describe('the ticket Review opens', () => {
  const ticket = (id: number, column: Ticket['column']): Ticket => ({ id, column }) as Ticket
  const code = (ticketId: number): TicketCode =>
    ({ ticketId, worktrees: [], pullRequests: [{ ticketId } as TicketCode['pullRequests'][number]] }) as TicketCode
  const board = (tickets: Ticket[]): BoardSnapshot => ({ tickets }) as BoardSnapshot

  it('is the one the board holds in Review, before any other with a diff', () => {
    const tickets = [ticket(1, 'doing'), ticket(2, 'review'), ticket(3, 'review')]

    expect(ticketToReview(board(tickets), [code(1), code(2), code(3)])).toBe(2)
  })

  it('falls back to a ticket with a branch or a PR wherever it sits', () => {
    expect(ticketToReview(board([ticket(7, 'doing')]), [code(7)])).toBe(7)
  })

  it('is nothing at all when no ticket has a diff and none is in Review', () => {
    expect(ticketToReview(board([ticket(1, 'todo')]), [])).toBe(null)
    expect(ticketToReview(null, [])).toBe(null)
  })
})
