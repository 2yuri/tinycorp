import { parseTicketCode, ticketCode } from '../../../shared/ticket-id'
import type { ShellData } from './nav-model'

/** What the drawer's search can find: the design's placeholder promises Employees and tickets. */
export type SearchHit =
  | { kind: 'employee'; key: string; id: string; label: string; sub: string }
  | { kind: 'ticket'; key: string; id: number; label: string; sub: string }

/** Long enough that one keystroke does not list the whole Company. */
const MIN_QUERY = 2

/** As many rows as fit under the field without covering the navigation. */
const LIMIT = 8

/**
 * The drawer's search (design/html/company-settings.html: Company Drawer › Search). Employees first,
 * then tickets, each in the order the shell already lists them; an exact `TC-142`, `#142` or `142`
 * puts that ticket top.
 */
export function searchShell(query: string, data: ShellData, companyKey: string): SearchHit[] {
  const text = query.trim().toLowerCase()
  if (text.length < MIN_QUERY) return []
  const id = parseTicketCode(text, companyKey)

  const employees = data.employees
    .filter((employee) => `${employee.name} ${employee.title}`.toLowerCase().includes(text))
    .map((employee): SearchHit => {
      const { id: employeeId, name, title } = employee
      return { kind: 'employee', key: `e:${employeeId}`, id: employeeId, label: name, sub: title }
    })

  const tickets = (data.board?.tickets ?? [])
    .filter((ticket) => ticket.id === id || ticket.title.toLowerCase().includes(text))
    .map((ticket): SearchHit => {
      return {
        kind: 'ticket',
        key: `t:${ticket.id}`,
        id: ticket.id,
        label: ticket.title,
        sub: ticketCode(companyKey, ticket.id),
      }
    })
    .sort((a, b) => Number(b.id === id) - Number(a.id === id))

  return id === null ? [...employees, ...tickets].slice(0, LIMIT) : [...tickets, ...employees].slice(0, LIMIT)
}

/** What the drawer says when a query finds nothing. */
export function noResults(query: string): string {
  return `No Employee or ticket matches “${query.trim()}”.`
}
