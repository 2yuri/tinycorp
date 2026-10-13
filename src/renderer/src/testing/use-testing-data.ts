import { useEffect, useState } from 'react'
import type { TicketCode } from '../../../shared/code'
import type { Company } from '../../../shared/company'
import type { BoardSnapshot } from '../../../shared/domain/board'
import type { Employee } from '../../../shared/domain/staff'
import type { Repo } from '../../../shared/repos/repo'
import type { Review } from '../../../shared/review'
import type { RunnableRepo, TestRun } from '../../../shared/testing'
import { resources, useIpcResource } from '../ipc'

/** Everything the Testing screen reads about one ticket, kept live over IPC. */
export interface TestingData {
  board: BoardSnapshot | null
  employees: Employee[]
  repos: Repo[]
  company: Company | null
  /** The attempt under way, or the last one; null when the ticket has never been in Testing. */
  run: TestRun | null
  /** The review round behind it, for `approved by Iris`. */
  review: Review | null
  code: TicketCode | null
  /** The repos with a run command, with their run when one is up. */
  runnable: RunnableRepo[]
  /** The output of the app whose log is open, oldest line first. */
  log: string[]
  error: string | null
  loading: boolean
}

/** The half of it that is read per ticket rather than per Company. */
type TicketTestingData = Pick<TestingData, 'run' | 'runnable' | 'log' | 'error' | 'loading'>

const EMPTY_TICKET_DATA: TicketTestingData = {
  run: null,
  runnable: [],
  log: [],
  error: null,
  loading: true,
}

const value = <T>(result: { ok: true; value: T } | { ok: false; error: string }): T | null =>
  result.ok ? result.value : null

/**
 * Reads the ticket's attempt and its runnable apps, again after every testing or code change; the
 * board, the people, the repos and the worktrees are the shared channels every other screen reads
 * (T212). `logOf` names the repo whose log pane is open; its output is read with the rest so the
 * strip and the pane never disagree.
 */
export function useTestingData(ticketId: number, logOf: string | null): TestingData {
  const board = useIpcResource(resources.board)
  const employees = useIpcResource(resources.employees)
  const repos = useIpcResource(resources.repos)
  const company = useIpcResource(resources.company)
  const reviews = useIpcResource(resources.reviews)
  const code = useIpcResource(resources.code)
  const [ticket, setTicket] = useState<TicketTestingData>(EMPTY_TICKET_DATA)

  useEffect(() => {
    const api = window.tinyCorp
    let live = true
    async function refresh(): Promise<void> {
      const [run, runnable, log] = await Promise.all([
        api.tests.of(ticketId),
        api.tests.runnable(ticketId),
        logOf ? api.tests.appLog(ticketId, logOf) : Promise.resolve({ ok: true as const, value: [] as string[] }),
      ])
      if (!live) return
      const failure = [run, runnable].find((result) => !result.ok)
      setTicket({
        run: value(run) ?? null,
        runnable: value(runnable) ?? [],
        log: value(log) ?? [],
        error: failure && !failure.ok ? failure.error : null,
        loading: false,
      })
    }
    void refresh()
    const offs = [api.tests.onChanged(() => void refresh()), api.code.onChanged(() => void refresh())]
    return () => {
      live = false
      for (const off of offs) off()
    }
  }, [ticketId, logOf])

  return {
    board,
    employees,
    repos,
    company,
    review: reviews.find((review) => review.ticketId === ticketId) ?? null,
    code: code.find((entry) => entry.ticketId === ticketId) ?? null,
    ...ticket,
  }
}
