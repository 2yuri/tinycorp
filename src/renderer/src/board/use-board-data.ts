import { useMemo } from 'react'
import type { AutonomyLevel } from '../../../shared/approvals'
import type { BoardSnapshot } from '../../../shared/domain/board'
import type { Employee } from '../../../shared/domain/staff'
import { resources, useIpcResource } from '../ipc'
import type { BoardFacts } from './board-model'

export interface BoardData {
  board: BoardSnapshot | null
  facts: BoardFacts
  employees: Employee[]
  /** The Company's autonomy level, or null until it is read; New ticket hides a row under it. */
  autonomy: AutonomyLevel | null
}

/** The board snapshot and the facts that decorate it, kept live. `companyKey` writes the card ids. */
export function useBoardData(companyKey: string): BoardData {
  const board = useIpcResource(resources.board)
  const employees = useIpcResource(resources.employees)
  const autonomy = useIpcResource(resources.autonomy)
  const sessions = useIpcResource(resources.sessions)
  const approvals = useIpcResource(resources.pendingApprovals)
  const reviews = useIpcResource(resources.reviews)
  const code = useIpcResource(resources.code)
  const plans = useIpcResource(resources.plans)
  const tests = useIpcResource(resources.testRuns)
  const security = useIpcResource(resources.securityPasses)

  const facts: BoardFacts = useMemo(
    () => ({
      sessions: Object.fromEntries(sessions.map((session) => [session.employeeId, session.status])),
      approvals,
      reviews,
      code,
      plans,
      tests,
      security,
      companyKey,
    }),
    [sessions, approvals, reviews, code, plans, tests, security, companyKey],
  )

  return { board, facts, employees, autonomy }
}
