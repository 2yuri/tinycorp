import { BOSS } from '../../../shared/domain/chat'
import type { Employee } from '../../../shared/domain/staff'
import { type AppRun, canPass, type TestRun, type TestStep, testCounts, testSummary } from '../../../shared/testing'
import { ticketCode } from '../../../shared/ticket-id'

/** `TC-142 · Usage chart with range picker`, the Testing screen's title (frame `BRzY6`). */
export function testingTitle(companyKey: string, ticketId: number, title: string): string {
  return `${ticketCode(companyKey, ticketId)} · ${title}`
}

/** `Testing · waiting on you`, or who it is waiting on — the badge beside the title. */
export function testingBadge(run: TestRun | null, agentName: string | null): string {
  if (!run) return 'Testing'
  if (run.state === 'passed') return 'Testing · passed'
  if (run.state === 'failed') return 'Testing · back to Doing'
  if (run.state === 'agent') return `Testing · ${agentName ?? 'the QA agent'} is on it`
  return 'Testing · waiting on you'
}

/**
 * The header's line under the title: the PRs, the worktree branch and where the review got to
 * (`web-app #91 · wt/TC-142 · feat/usage-range-picker → main · approved by Iris · merge waits for
 * testing`).
 */
export function testingSubtitle(input: {
  prs: { repoName: string; number: number | null }[]
  worktree: { branch: string; base: string; path: string } | null
  approvedBy: string | null
  run: TestRun | null
}): string {
  const parts: string[] = []
  for (const pr of input.prs) parts.push(`${pr.repoName}${pr.number === null ? '' : ` #${pr.number}`}`)
  if (input.worktree) parts.push(`${input.worktree.branch} → ${input.worktree.base}`)
  if (input.approvedBy) parts.push(`approved by ${input.approvedBy}`)
  if (input.run && input.run.state !== 'passed') parts.push('merge waits for testing')
  return parts.join(' · ')
}

/** `2 passed · 1 failed · 1 to test`, the script header's count. */
export const scriptSummary = testSummary

/** `TEST SCRIPT · 4 STEPS`, and where the steps came from. */
export function scriptSource(run: TestRun | null, agentName: string | null): string {
  const added = (run?.steps ?? []).some((step) => step.addedBy !== null && step.addedBy !== BOSS)
  return added && agentName ? `from the plan’s criteria + ${agentName}` : 'from the plan’s criteria'
}

/** `Criterion 2`, `Criterion 4 · step added by Iris`, or `Added by you` — the tag under a step. */
export function stepTag(step: TestStep, nameOf: (id: string) => string): string {
  const criterion = step.criterion === null ? '' : `Criterion ${step.criterion}`
  if (step.addedBy === null) return criterion
  const added = step.addedBy === BOSS ? 'step added by you' : `step added by ${nameOf(step.addedBy)}`
  return criterion ? `${criterion} · ${added}` : added.charAt(0).toUpperCase() + added.slice(1)
}

/** `Passed by you · 10:36`, `Failed by Iris · 10:41`, or null while nobody has said. */
export function stepVerdictLine(
  step: TestStep,
  nameOf: (id: string) => string,
  clock: (iso: string) => string,
): string | null {
  if (step.result === 'pending' || step.testedBy === null) return null
  const who = step.testedBy === BOSS ? 'you' : nameOf(step.testedBy)
  const when = step.testedAt ? ` · ${clock(step.testedAt)}` : ''
  return `${step.result === 'pass' ? 'Passed' : 'Failed'} by ${who}${when}`
}

/** Whether the boss may record steps right now: the attempt is theirs and still open. */
export function bossCanTest(run: TestRun | null): boolean {
  return run !== null && run.state === 'you'
}

/** Whether `Pass testing → ready to merge` is live. */
export function canPassNow(run: TestRun | null): boolean {
  return bossCanTest(run) && canPass(run!)
}

/** Why the Pass button is off, for its tooltip; null when it is on. */
export function passRefusal(run: TestRun | null): string | null {
  if (!run) return 'This ticket is not in Testing'
  if (run.state === 'agent') return 'The QA agent is still testing it'
  if (run.state !== 'you') return 'Testing is over'
  const counts = testCounts(run)
  if (counts.failed > 0 && counts.pending > 0) return `${counts.failed} failed and ${counts.pending} still to test`
  if (counts.failed > 0) return `${counts.failed} failed`
  if (counts.pending > 0) return `${counts.pending} still to test`
  return null
}

/** `1 failed · 1 to test`, the line beside `Merge waits for Testing to pass` in the action bar. */
export function actionBarLine(run: TestRun | null): string {
  if (!run) return ''
  const counts = testCounts(run)
  const parts: string[] = []
  if (counts.failed > 0) parts.push(`${counts.failed} failed`)
  if (counts.pending > 0) parts.push(`${counts.pending} to test`)
  if (parts.length === 0) parts.push(`${counts.passed} of ${counts.total} passed`)
  return parts.join(' · ')
}

/** `running on localhost:5173 · from wt/TC-142 · started 10:34 by you`. */
export function runMeta(
  run: AppRun | null,
  nameOf: (id: string) => string,
  clock: (iso: string) => string,
): string | null {
  if (!run) return null
  const who = run.startedBy === BOSS ? 'you' : nameOf(run.startedBy)
  const where = run.port === null ? 'running' : `running on localhost:${run.port}`
  if (run.state !== 'running') {
    return run.exitCode === null ? 'stopped' : `stopped · exit ${run.exitCode}`
  }
  return `${where} · started ${clock(run.startedAt)} by ${who}`
}

/**
 * The panel's mode strip (frame `BRzY6`): `Both — Iris tests first, then you confirm`. It names the
 * agent this attempt really has, rather than the setting's own wording, because that is who the
 * boss is waiting on.
 */
export function modeLine(run: Pick<TestRun, 'mode'> | null, agentName: string | null): string {
  if (!run) return 'Nobody tests this ticket’s repos'
  const who = agentName ?? 'the QA agent'
  if (run.mode === 'both') return `Both — ${who} tests first, then you confirm`
  if (run.mode === 'agent') return `QA agent — ${who}’s pass is the go-ahead`
  if (run.mode === 'you') return 'You — nothing merges until you pass it'
  return 'Nobody — this one merges straight after review'
}

/** Names as the screen writes them: the boss is `you`, an Employee is its own name. */
export function namerFor(employees: readonly Employee[], bossName: string): (id: string) => string {
  return (id) => (id === BOSS ? bossName : (employees.find((e) => e.id === id)?.name ?? 'former employee'))
}
