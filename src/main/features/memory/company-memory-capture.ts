import type { Ticket } from '../../../shared/domain/board'
import type { MemoryCaptureResult, MemoryKind, MemoryWrite } from '../../../shared/memory/company-memory'
import type { Plan } from '../../../shared/planning/planning'
import type { ReviewThread } from '../../../shared/review/review-threads'
import { threadAnchor } from '../../../shared/review/review-threads'
import type { TicketWakes } from '../sessions'

/**
 * Capture, with no model (T175). When a ticket reaches Done the app writes memory pages from what
 * the ticket already holds: the approved plan, the review threads, the failures a thread names and
 * the commit that answered it. It is templating — the same ticket writes the same pages, word for
 * word — and every page links back to where its words came from.
 *
 * Nothing here calls a Provider, and nothing here invents a sentence: every quoted line is quoted.
 */

/** What a finished ticket gives the capture. All of it is already in the Company's database. */
export interface FinishedTicket {
  ticket: Pick<Ticket, 'id' | 'title' | 'description' | 'repos'>
  /** `TC-142`. */
  code: string
  /** Repo names in the boss's words, by repo id, so a page names `billing-api` and not an id. */
  repoNames: Record<string, string>
  /** The approved plan, or null when the ticket was worked without one. */
  plan: Plan | null
  threads: ReviewThread[]
  /** An Employee's or the boss's name, by id, for quoting a thread. */
  nameOf(id: string): string
  /** Who the capture is attributed to; the app itself, not an Employee. */
  by: string
}

/** The words a thread has to use for its resolution to read as a test failure and its fix. */
const FAILURE_TERMS = [
  'fail',
  'failing',
  'failed',
  'failure',
  'flake',
  'flaky',
  'red',
  'timeout',
  'timed out',
  'hangs',
  'hung',
  'crash',
  'green again',
]

/** One page the capture would write, before it is written. */
export interface CapturedPage extends MemoryWrite {
  /** Where it came from, in the words the Activity line uses: `the plan`, `review threads`… */
  from: string
}

/**
 * Everything a finished ticket writes, in a fixed order: the plan first, then each review thread in
 * the order it was opened. Pure — the store writes what this returns.
 */
export function capturePages(finished: FinishedTicket): CapturedPage[] {
  const pages: CapturedPage[] = []
  const repos = finished.ticket.repos.map((id) => finished.repoNames[id] ?? id)
  const decision = decisionPage(finished, repos)
  if (decision) pages.push(decision)
  for (const thread of finished.threads) {
    const page = threadPage(finished, thread, repos)
    if (page) pages.push(page)
  }
  return pages
}

/** The approved plan, as a Decision. A ticket with no approved plan writes none. */
function decisionPage(finished: FinishedTicket, repos: string[]): CapturedPage | null {
  const { plan, code, ticket } = finished
  if (!plan || plan.status !== 'approved') return null
  const body = [
    plan.goal.trim(),
    '',
    '## Decision',
    '',
    ...(plan.approach.trim() ? [plan.approach.trim(), ''] : []),
    ...(plan.acceptanceCriteria.length > 0
      ? ['What it had to do:', '', ...plan.acceptanceCriteria.map((line) => `- ${line}`), '']
      : []),
    '## Why',
    '',
    `Decided on ${code} — ${ticket.title}. The plan was approved${
      plan.approvedBy ? ` by ${finished.nameOf(plan.approvedBy)}` : ''
    }${plan.approvedAt ? ` on ${plan.approvedAt.slice(0, 10)}` : ''}, and this is what it said.`,
    ...(plan.risks.length > 0 ? ['', 'Risks it named:', '', ...plan.risks.map((line) => `- ${line}`)] : []),
  ]
    .join('\n')
    .trim()
  return {
    kind: 'decision',
    title: planTitle(plan, ticket),
    body,
    repos,
    sources: [`ticket:${code}`],
    mode: 'replace',
    from: 'the plan',
  }
}

/** The plan's own goal names the page, cut at its first sentence; the ticket's title backs it up. */
function planTitle(plan: Plan, ticket: Pick<Ticket, 'title'>): string {
  const first = plan.goal.split(/(?<=[.!?])\s/)[0]?.trim() ?? ''
  const cleaned = first.replace(/[.!?]+$/, '').trim()
  return cleaned.length >= 8 && cleaned.length <= 80 ? cleaned : ticket.title
}

/**
 * A resolved review thread, as a Convention or a Gotcha:
 *
 * - it names a failure and was answered with a commit → a **Gotcha**, with the fix;
 * - the assignee answered without a commit and the reviewer resolved it anyway — a pushback the
 *   reviewer accepted → a **Convention**.
 *
 * Anything else is a thread that changed a line and taught nobody anything, and writes no page.
 */
function threadPage(finished: FinishedTicket, thread: ReviewThread, repos: string[]): CapturedPage | null {
  if (thread.state !== 'resolved' || thread.messages.length < 2) return null
  const opener = thread.messages[0]!
  const answer = thread.messages[thread.messages.length - 1]!
  const failure = namesFailure(thread.messages.map((message) => message.body).join('\n'))
  const kind: MemoryKind | null = failure && thread.commit ? 'gotcha' : thread.commit ? null : 'convention'
  if (!kind) return null
  const where = threadAnchor(thread)
  const quoted = thread.messages
    .map((message) => `> **${finished.nameOf(message.authorId)}** — ${message.body.trim().replace(/\n/g, '\n> ')}`)
    .join('\n>\n')
  const body = [
    kind === 'gotcha'
      ? `${where} failed on ${finished.code}, and this is what it took to get it green.`
      : `${where} came up in review on ${finished.code}, and the reviewer accepted the answer. Do it this way.`,
    '',
    '## The thread',
    '',
    quoted,
    '',
    '## Why',
    '',
    kind === 'gotcha'
      ? `Fixed in ${thread.commit}. ${finished.nameOf(answer.authorId)} answered ${finished.nameOf(opener.authorId)}, and the thread was resolved.`
      : `${finished.nameOf(answer.authorId)} pushed back and ${finished.nameOf(thread.resolvedBy ?? opener.authorId)} resolved the thread without a change. It is the rule now.`,
  ].join('\n')
  return {
    kind,
    title: threadTitle(finished, thread, kind),
    body,
    repos: thread.repoId ? [finished.repoNames[thread.repoId] ?? thread.repoId] : repos,
    sources: [
      `ticket:${finished.code}`,
      `review:${finished.code} thread ${thread.id}`,
      ...(thread.commit ? [`commit:${thread.commit}`] : []),
    ],
    mode: 'replace',
    from: kind === 'gotcha' ? 'testing' : 'review threads',
  }
}

/**
 * What the page is called, from the thread's own anchor. Deterministic, and never a sentence the
 * app made up about the code: the file and the ticket, so two captures of the same thread collide
 * on the same slug and the second one updates the first.
 */
function threadTitle(finished: FinishedTicket, thread: ReviewThread, kind: MemoryKind): string {
  const file = thread.path ? thread.path.split('/').pop()! : finished.ticket.title
  return kind === 'gotcha' ? `${file} fails on ${finished.code}` : `${file} convention from ${finished.code}`
}

function namesFailure(text: string): boolean {
  const flat = text.toLowerCase()
  return FAILURE_TERMS.some((term) => flat.includes(term))
}

/** The one Activity line a closed ticket earns, from what was really written. */
export function captureResult(
  code: string,
  written: { slug: string; title: string; kind: MemoryKind; created: boolean }[],
  pages: readonly CapturedPage[],
): MemoryCaptureResult {
  return { ticket: code, pages: written, from: [...new Set(pages.map((page) => page.from))] }
}

/**
 * The board, with a ticket reaching Done also writing the Company's memory. Wraps `TicketWakes` the
 * way the activity log does, so it does not matter who moved the ticket — the boss, an Employee
 * over MCP, or the merge that closed it.
 */
export function capturingWakes(wakes: TicketWakes, capture: (ticketId: number, actorId: string) => void): TicketWakes {
  return {
    ...wakes,
    boardAs(actorId) {
      const board = wakes.boardAs(actorId)
      return {
        ...board,
        moveTicket(id, column, index) {
          const ticket = board.moveTicket(id, column, index)
          if (ticket.column === 'done') capture(ticket.id, actorId)
          return ticket
        },
      }
    },
  }
}
