import { useEffect, useState } from 'react'
import type { AutonomyLevel } from '../../../shared/approvals'
import type { PullRequestDetails } from '../../../shared/code'
import { useApprovalThreads } from '../approvals'
import { resources, useIpcResource } from '../ipc'
import type { ChatData } from './chat-view'

/** How often an open PR card asks again; the engine caches the forge's answer for as long. */
const DETAILS_POLL_MS = 30_000

/** Everything the Chat view reads besides messages, from the channels every other screen reads. */
export function useChatData(): ChatData {
  const employees = useIpcResource(resources.employees)
  const board = useIpcResource(resources.board)
  const code = useIpcResource(resources.code)
  const repos = useIpcResource(resources.repos)
  const reviews = useIpcResource(resources.reviews)
  const threads = useIpcResource(resources.reviewThreads)
  const plans = useIpcResource(resources.plans)
  const tests = useIpcResource(resources.testRuns)
  const approvals = useApprovalThreads()
  const answerer = useIpcResource(resources.answerer)
  // The boss as Company settings name them (decision 38).
  const company = useIpcResource(resources.company)
  const digest = useIpcResource(resources.digestSchedule)
  return {
    employees,
    board,
    code,
    repos,
    reviews,
    tests,
    threads,
    plans,
    approvals,
    companyKey: company?.key ?? '',
    answererId: answerer ? (answerer.answererId ?? answerer.waitingForId) : null,
    // Absent until the Company is read, all three together: nothing here is a boss half known.
    ...(company !== null && {
      bossName: company.boss.name,
      bossInitials: company.boss.initials,
      bossSprite: company.boss.sprite,
    }),
    digestTimezone: digest?.timezone ?? null,
  }
}

export function useAutonomyLevel(): AutonomyLevel | null {
  return useIpcResource(resources.autonomy)
}

/** What the forge says about a ticket's PRs; null until the first answer. */
export function usePullRequestDetails(ticketId: number | null): PullRequestDetails[] | null {
  const [details, setDetails] = useState<PullRequestDetails[] | null>(null)
  useEffect(() => {
    setDetails(null)
    if (ticketId === null) return
    let live = true
    const code = window.tinyCorp.code
    const refresh = () =>
      void code.details(ticketId).then((result) => {
        if (live && result.ok) setDetails(result.value)
      })
    refresh()
    const off = code.onChanged(refresh)
    const timer = setInterval(refresh, DETAILS_POLL_MS)
    return () => {
      live = false
      off()
      clearInterval(timer)
    }
  }, [ticketId])
  return details
}
