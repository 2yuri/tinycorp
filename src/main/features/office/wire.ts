import type { OfficeFacts } from '../../../shared/office/projection'
import type { CompanyContext, OpenCompany } from '../../core'
import { createOffice, type Office, type OfficeOptions, type OfficeService } from './office'

/**
 * What the office watches. Sessions are the only feature it reads: who is running, what tool they
 * are on, and when that changes. Everything else — a post, a board move, an Approval — arrives as a
 * call on the returned service, so the office subscribes to nothing it cannot see.
 */
export interface OfficeDeps {
  sessions: OfficeOptions['sessions']
  /** What is waiting on the boss there, and the board a blocked desk is read off. */
  approvals(entry: OpenCompany): { list(filter: { status: 'pending' }): OfficeFacts['approvals'] }
  board(entry: OpenCompany): { snapshot(): { tickets: OfficeFacts['tickets'] } }
  /**
   * Everything that changes what a desk shows but is not Session activity: the Company switching,
   * the board moving, an Approval landing. The office subscribes to none of them itself.
   */
  redrawnBy: readonly ((listener: () => void) => unknown)[]
}

/**
 * The office feature, once it is wired.
 *
 * Nothing is kept per Company: the office draws whichever Company is current and holds only live
 * Session activity, which sessions already drop when a Session stops.
 */
export interface OfficeFeature {
  office: OfficeService
}

/**
 * Wires the office to the Company the boss is looking at (T186).
 *
 * The engine goes on feeding it posts and `notify()`, because those are events the office cannot
 * subscribe to itself.
 */
export function register(ctx: CompanyContext, deps: OfficeDeps): OfficeFeature {
  const office = createOffice({
    sessions: deps.sessions,
    current: () => {
      const entry = ctx.currentEntry()
      return {
        db: entry.db,
        approvals: deps.approvals(entry).list({ status: 'pending' }),
        tickets: deps.board(entry).snapshot().tickets,
      }
    },
  })
  for (const watch of deps.redrawnBy) watch(office.notify)
  return { office }
}

/** The office screen's face. */
export interface OfficeFacade {
  /** What the current Company's office shows: Session status, tools, chat posts, approvals, blocked tickets. */
  office: Office
}
