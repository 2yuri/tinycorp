/**
 * The window's side of the application menu (#223). Every item that stands for a button in the app
 * sends its command here, and this does the very thing the button does: the same router, the same
 * openers, the same IPC calls. One path, so a menu item can never drift from its button.
 */

import type { MenuCommand, MenuGoTarget } from '../../../shared/app/menu'
import type { TicketCode } from '../../../shared/code'
import type { BoardSnapshot } from '../../../shared/domain/board'
import type { Result } from '../../../shared/domain/result'
import type { SessionApi, StaffApi } from '../../../shared/ipc'
import { canOpenReview } from '../../../shared/review/review-entry'
import { resumeAllProblem } from '../../../shared/session'
import type { Route } from '../chrome'

export interface MenuCommandDeps {
  /** The shell's router, which every view already goes through (T122). */
  navigate(route: Route): void
  /** The Review screen over whichever view is open, as every Review button opens it (T82). */
  openReview(ticketId: number): void
  /** The ticket `Review` opens: the one with a diff waiting, or null when nothing has one. */
  reviewTicket(): number | null
  /** The hire flow, as the office header's `Hire` opens it. */
  openHire(): void
  /** The Launcher's Create step, as the Company rail's `+` opens it. */
  newCompany(): void
  /** The folder picker and the Company in it, as the sidebar's `Open a Company…` does. */
  openCompany(): void
  /** Switching Company, as the rail does. */
  openRecent(companyId: string): void
  /** `Move…`, as Company settings' temporary-folder warning offers it (decision 45). */
  moveCompany(): void
  /** The key to the floor on the office canvas (T74). */
  toggleLegend(): void
  /** The Session calls the Start, Stop, Pause all and Resume all buttons make. */
  sessions: Pick<SessionApi, 'list' | 'start' | 'stop' | 'pauseAll' | 'resumeAll'>
  staff: Pick<StaffApi, 'employees'>
  /** Whatever the boss would have seen under the button they did not press. */
  onError(message: string | null): void
}

/** Where a Go item lands. Review is the one that depends on the board, and is handled apart. */
const ROUTES: Record<Exclude<MenuGoTarget, 'review'>, Route> = {
  office: { view: 'office' },
  chat: { view: 'chat' },
  board: { view: 'board' },
  repositories: { view: 'repositories' },
  employees: { view: 'employees' },
  activity: { view: 'activity' },
  inbox: { view: 'chat', inbox: true },
  profile: { view: 'profile' },
  settings: { view: 'settings' },
}

export async function runMenuCommand(command: MenuCommand, deps: MenuCommandDeps): Promise<void> {
  switch (command.kind) {
    case 'go':
      return go(command.target, deps)
    case 'new-company':
      return deps.newCompany()
    case 'open-company':
      return deps.openCompany()
    case 'open-recent':
      return deps.openRecent(command.companyId)
    case 'move-company':
      return deps.moveCompany()
    case 'hire':
      // What the office header's Hire button does: the Employees view, with the flow open.
      deps.navigate({ view: 'employees' })
      return deps.openHire()
    case 'pause-all':
      return report(await deps.sessions.pauseAll(), deps)
    case 'resume-all':
      return resumeAll(deps)
    case 'start-every-session':
      return startEvery(deps)
    case 'stop-every-session':
      return stopEvery(deps)
    case 'legend':
      // The Legend lives on the office canvas, so the boss is taken there to see it.
      deps.navigate({ view: 'office' })
      return deps.toggleLegend()
  }
}

function go(target: MenuGoTarget, deps: MenuCommandDeps): void {
  if (target !== 'review') return void deps.navigate(ROUTES[target])
  const ticketId = deps.reviewTicket()
  // Nothing to read: the Board's own Open PRs view is where the boss looks for one.
  if (ticketId === null) return void deps.navigate({ view: 'board', filter: 'open-prs' })
  deps.openReview(ticketId)
}

/**
 * `Resume all`, and whatever it came to (T217): the boss sees the same line under the header they
 * would have seen had they pressed the button itself.
 */
async function resumeAll(deps: MenuCommandDeps): Promise<void> {
  const resumed = await deps.sessions.resumeAll()
  deps.onError(resumed.ok ? resumeAllProblem(resumed.value) : resumed.error)
}

/** The Start button of every Employee who has no Session, pressed in desk order. */
async function startEvery(deps: MenuCommandDeps): Promise<void> {
  const [employees, sessions] = await Promise.all([deps.staff.employees(), deps.sessions.list()])
  if (!employees.ok) return deps.onError(employees.error)
  if (!sessions.ok) return deps.onError(sessions.error)
  const on = new Set(sessions.value.filter((session) => session.status !== 'off').map((s) => s.employeeId))
  let failure: string | null = null
  for (const employee of employees.value) {
    if (on.has(employee.id)) continue
    const started = await deps.sessions.start(employee.id)
    // One Employee who cannot start never stops the rest; the boss hears about the first that failed.
    if (!started.ok) failure ??= started.error
  }
  deps.onError(failure)
}

/** The Stop button of everyone whose Session is on, which is what `Pause all` acts on without pausing. */
async function stopEvery(deps: MenuCommandDeps): Promise<void> {
  const sessions = await deps.sessions.list()
  if (!sessions.ok) return deps.onError(sessions.error)
  let failure: string | null = null
  for (const session of sessions.value) {
    if (session.status === 'off') continue
    const stopped = await deps.sessions.stop(session.employeeId)
    if (!stopped.ok) failure ??= stopped.error
  }
  deps.onError(failure)
}

function report(result: Result<unknown>, deps: MenuCommandDeps): void {
  deps.onError(result.ok ? null : result.error)
}

/**
 * The ticket `Review` opens: the first the board holds in Review, and failing that the first with a
 * branch or a PR to read. The same gate the board's own Review button uses (T82).
 */
export function ticketToReview(board: BoardSnapshot | null, code: TicketCode[]): number | null {
  const tickets = board?.tickets ?? []
  const byTicket = new Map(code.map((entry) => [entry.ticketId, entry]))
  const reviewable = tickets.filter((ticket) => canOpenReview(ticket, byTicket.get(ticket.id)))
  const inReview = reviewable.find((ticket) => ticket.column === 'review')
  return (inReview ?? reviewable[0])?.id ?? null
}
