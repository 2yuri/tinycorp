// The design's own Board fixture (Pen frame `Izdc9` — Desktop App / Ticket Drawer), as engine
// data: the Billing Dashboard target, the cards the frame draws in Todo, Doing and Review, and
// ticket #128 — the one the drawer is open on — with its repos, labels, subtasks, branch and PR.

import type { TicketCode } from '../../../../shared/code'
import type { Company } from '../../../../shared/company'
import type { BoardSnapshot } from '../../../../shared/domain/board'
import type { Employee } from '../../../../shared/domain/staff'
import type { Plan } from '../../../../shared/planning/planning'
import { EMPTY_STACK, type Repo } from '../../../../shared/repos/repo'
import type { RestorePoint } from '../../../../shared/restore-points'
import type { Review } from '../../../../shared/review'
import type { SessionStatus } from '../../../../shared/session'
import type { TestRun } from '../../../../shared/testing'
import type { TicketRemoval } from '../../../../shared/ticket-removal'

const DAY = '2026-09-17'
const at = (time: string) => `${DAY}T${time}:00`

function person(id: string, name: string, title: string, sprite: number): Employee {
  return {
    id,
    name,
    roleId: title.toLowerCase(),
    title,
    persona: '',
    capabilities: ['code', 'review'],
    repoFilter: ['*'],
    areas: [],
    mcpServers: [],
    skills: [],
    overrides: [],
    provider: 'claude',
    permissionMode: 'skip-permissions',
    model: null,
    desk: 0,
    sprite,
    createdAt: at('08:00'),
  }
}

export const employees: Employee[] = [
  person('e-ada', 'Ada Lorne', 'Frontend', 1),
  person('e-nova', 'Nova', 'Tech Lead', 2),
  person('e-vega', 'Vega', 'Frontend', 0),
  person('e-sol', 'Sol', 'Backend', 3),
  person('e-orion', 'Orion', 'DevOps', 4),
  person('e-iris', 'Iris', 'QA', 5),
]

export const sessions: Record<string, SessionStatus> = { 'e-nova': 'busy', 'e-vega': 'busy' }

export const company: Company = {
  id: 'c-tiny',
  name: 'Tiny Corp',
  key: 'TC',
  boss: { name: 'Yuri Miguel', initials: 'YM' },
  folder: '/work/tiny',
  createdAt: at('08:00'),
}

const stack = { ...EMPTY_STACK, language: 'TypeScript', framework: 'vitest', packageManager: 'pnpm' }

export const repos: Repo[] = [
  { id: 'r-web', name: 'web-app', path: '/code/web-app', brief: '', rung: 'merge', stack, addedAt: at('08:00') },
  {
    id: 'r-api',
    name: 'billing-api',
    path: '/code/billing-api',
    brief: '',
    rung: 'merge',
    stack,
    addedAt: at('08:00'),
  },
  {
    id: 'r-infra',
    name: 'infra',
    path: '/code/infra',
    brief: '',
    rung: 'merge',
    stack: EMPTY_STACK,
    addedAt: at('08:00'),
  },
]

/** The ticket the drawer is open on, as the frame writes it. */
export const OPEN_TICKET = 128

const DESCRIPTION =
  'Repro: leave checkout open ~20 min, then pay. The silent token refresh never fires and the ' +
  'charge request 401s. Refresh before submit and cover it with a regression test.'

export const board: BoardSnapshot = {
  columns: [
    { id: 'planning', title: 'Planning', wipLimit: null, count: 2, overLimit: false },
    { id: 'todo', title: 'Ready', wipLimit: null, count: 4, overLimit: false },
    { id: 'doing', title: 'Doing', wipLimit: 3, count: 3, overLimit: false },
    { id: 'review', title: 'Review', wipLimit: null, count: 2, overLimit: false },
    { id: 'done', title: 'Done', wipLimit: null, count: 0, overLimit: false },
  ],
  targets: [{ id: 1, title: 'Billing Dashboard', description: '', dueAt: null }],
  epics: [
    { id: 1, targetId: 1, title: 'Usage and invoices', description: '', color: 'indigo' },
    { id: 2, targetId: 1, title: 'Plans and proration', description: '', color: 'violet' },
    // Still being planned, so the Planning column draws a card for it (T171, frame `Oumw5`).
    { id: 3, targetId: 1, title: 'Plan switching', description: '', color: 'amber' },
  ],
  tickets: [
    {
      id: OPEN_TICKET,
      epicId: 1,
      title: 'Checkout fails when the card token expires mid-session',
      description: DESCRIPTION,
      column: 'doing',
      assigneeId: 'e-ada',
      repos: ['r-web', 'r-api'],
      blocked: true,
      blockedReason: 'Waiting on the payments sandbox key',
      blockedBy: [],
      blocks: [],
      subtasks: [
        { id: 1, ticketId: OPEN_TICKET, title: 'Expire the token server-side', done: true, repo: 'r-api' },
        { id: 2, ticketId: OPEN_TICKET, title: 'Refresh before charging', done: false, repo: 'r-web' },
      ],
      priority: 'high',
      labels: ['bug', 'checkout', 'p1'],
      baseBranch: 'main',
    },
    card(152, 1, 'Usage chart with range picker', 'planning', null, ['r-web', 'r-api']),
    card(151, 1, 'Usage export to CSV', 'planning', null, ['r-api']),
    card(147, 3, 'Plan switcher UI with proration preview', 'todo', null, ['r-web']),
    card(148, 3, 'Proration preview endpoint', 'todo', null, ['r-api']),
    card(149, 1, 'Empty + error states for invoice list', 'todo', 'e-vega', ['r-web']),
    card(150, 3, 'Seed fixtures for usage aggregation', 'todo', null, ['r-api']),
    card(142, 1, 'Usage chart with range picker', 'doing', 'e-nova', ['r-web']),
    card(143, 1, 'Invoice history table + pagination', 'doing', 'e-vega', ['r-web']),
    card(144, 1, 'Usage aggregation nightly job', 'doing', 'e-sol', ['r-api']),
    card(139, 1, 'Invoice pagination edge cases', 'review', 'e-orion', ['r-api']),
    card(141, 1, 'Currency + locale formatting', 'review', 'e-iris', ['r-web']),
  ],
}

function card(
  id: number,
  epicId: number,
  title: string,
  column: BoardSnapshot['tickets'][number]['column'],
  assigneeId: string | null,
  repos: string[],
): BoardSnapshot['tickets'][number] {
  return {
    id,
    epicId,
    title,
    description: '',
    column,
    assigneeId,
    repos,
    blocked: false,
    blockedReason: '',
    blockedBy: [],
    blocks: [],
    subtasks: [],
    priority: 'normal',
    labels: [],
    baseBranch: null,
  }
}

/** What deleting TC-142 takes with it, as `?delete` confirms it (T275, frame `xdaOR`). */
export const removal: TicketRemoval = {
  ticketId: 142,
  code: 'TC-142',
  title: 'Usage chart with range picker',
  subtasks: 0,
  links: 0,
  worktrees: ['web-app'],
  holder: 'Nova',
}

export const code: TicketCode[] = [
  {
    ticketId: OPEN_TICKET,
    worktrees: [
      {
        ticketId: OPEN_TICKET,
        repoId: 'r-web',
        path: '/work/tiny/worktrees/128-web-app',
        branch: 'ada/128-card-token',
        base: 'main',
        createdAt: at('09:10'),
      },
    ],
    pullRequests: [
      {
        ticketId: OPEN_TICKET,
        repoId: 'r-web',
        url: 'https://github.com/tinycorp/web-app/pull/412',
        number: 412,
        openedAt: at('09:40'),
      },
    ],
  },
]

export const reviews: Review[] = [
  {
    id: 1,
    round: 1,
    rounds: 1,
    handoff: 'agents',
    roundLimit: 3,
    ticketId: OPEN_TICKET,
    reviewerId: 'boss',
    status: 'pending',
    decidedBy: null,
    comments: '',
    merge: null,
    approvalId: null,
    mergedRepoIds: [],
    mergeError: null,
    messageId: 9,
    requestedAt: at('09:47'),
    decidedAt: null,
  },
]

/** Two points on the open ticket's branch, newest first, as T118 lists them. */
export const restorePoints: RestorePoint[] = [
  {
    id: 'rp-2',
    ticketId: OPEN_TICKET,
    repoId: 'r-web',
    employeeId: 'e-ada',
    reason: 'commit',
    note: 'Refresh the token before charging',
    commit: '4f21c8ad9e',
    branch: 'ada/128-card-token',
    hadUncommitted: true,
    takenAt: at('09:38'),
  },
  {
    id: 'rp-1',
    ticketId: OPEN_TICKET,
    repoId: 'r-web',
    employeeId: 'e-ada',
    reason: 'start',
    note: 'Before the work started',
    commit: '1a2b3c4d5e',
    branch: 'ada/128-card-token',
    hadUncommitted: false,
    takenAt: at('09:10'),
  },
]

/** The plans of the Planning column (T171, frame `Oumw5`), and the approved ones Ready shows. */
export const plans: Plan[] = [
  plan({
    id: 1,
    ticketId: 152,
    status: 'waiting',
    goal: 'Customers see what they used over a chosen range.',
    questions: [answered(1, 1, 'Which ranges?'), answered(2, 2, 'Totals only?'), open(3, 3, 'Range in the URL?')],
  }),
  plan({
    id: 2,
    ticketId: 151,
    status: 'drafting',
    goal: '',
    questions: [open(4, 1, 'One file per month, or one file for the range?')],
  }),
  plan({ id: 3, epicId: 3, status: 'drafting', goal: 'Switching plans, end to end.' }),
  ...[147, 148, 149, 150].map((ticketId, i) =>
    plan({ id: 10 + i, ticketId, status: 'approved', goal: 'Approved and Ready to claim.' }),
  ),
]

function plan(fields: Partial<Plan> & { id: number; status: Plan['status'] }): Plan {
  return {
    version: 1,
    ticketId: null,
    epicId: null,
    plannerId: 'e-nova',
    goal: '',
    approach: '',
    acceptanceCriteria: [],
    repos: [],
    subtasks: [],
    risks: [],
    openQuestions: [],
    approvedBy: fields.status === 'approved' ? 'boss' : null,
    approvedAt: fields.status === 'approved' ? at('09:21') : null,
    replanBy: null,
    replanReason: null,
    replanChanges: [],
    channelId: 'ep-usage-invoices',
    threadId: 1,
    messageId: 2,
    createdAt: at('09:05'),
    questions: [],
    ...fields,
  }
}

function answered(id: number, number: number, text: string) {
  return {
    id,
    planId: 1,
    number,
    text,
    answer: 'Yes.',
    answeredBy: 'boss',
    answeredAt: at('09:09'),
    delegated: false,
    messageId: 2,
  }
}

function open(id: number, number: number, text: string) {
  return {
    id,
    planId: 1,
    number,
    text,
    answer: null,
    answeredBy: null,
    answeredAt: null,
    delegated: false,
    messageId: 2,
  }
}

/**
 * The Testing column of frame `RJa6D` (T174): TC-142 tested by Iris and now waiting on the boss,
 * TC-139 still under the agent at step 2 of 5, and TC-143 back in Doing after a failed step — the
 * chip stays on its card, which is how the board says why it came back.
 */
export const tests: TestRun[] = [
  testRun({
    id: 1,
    ticketId: 142,
    mode: 'both',
    state: 'you',
    agentId: 'e-iris',
    agentVerdict: 'pass',
    summary: 'All four criteria pass in the running app. I added an offline step for the error state.',
    steps: [
      ['Picker offers 7d, 30d, 90d and custom; 30d is the default', 'pass'],
      ['Daily totals for the range, no per-seat split', 'pass'],
      ['The range lives in the URL; a copied link reopens it', 'pass'],
      ['Empty and error states match the invoice list', 'pass'],
    ],
    checks: ['typecheck', 'test · 142', 'e2e · 6'],
  }),
  testRun({
    id: 2,
    ticketId: 139,
    mode: 'agent',
    state: 'agent',
    agentId: 'e-iris',
    agentVerdict: null,
    summary: '',
    steps: [
      ['Page 1 shows 20 invoices', 'pass'],
      ['The last page is not empty', 'pending'],
      ['A filter keeps the page', 'pending'],
      ['The count matches the header', 'pending'],
      ['An empty account says so', 'pending'],
    ],
    checks: [],
  }),
  testRun({
    id: 3,
    ticketId: 143,
    mode: 'you',
    state: 'failed',
    agentId: null,
    agentVerdict: null,
    summary: '',
    steps: [
      ['Rows keep their order across pages', 'pass'],
      ['90d shows one daily total per day, ending today', 'fail'],
    ],
    checks: [],
  }),
]

/** The board of `RJa6D`: the same cards, with two of them moved into Testing. */
export function testingBoard(): BoardSnapshot {
  const moved = board.tickets.map((ticket) =>
    ticket.id === 142 || ticket.id === 139
      ? { ...ticket, column: 'testing' as const, assigneeId: ticket.id === 142 ? 'e-vega' : 'e-orion' }
      : ticket,
  )
  // The Testing column itself: the fixture's own column list predates it, and the board draws the
  // columns it is given rather than `COLUMNS`, so the capture hands it the six the app now has.
  const columns = [
    ...board.columns.slice(0, 4),
    { id: 'testing' as const, title: 'Testing', wipLimit: null, count: 0, overLimit: false },
    ...board.columns.slice(4),
  ]
  return {
    ...board,
    columns: columns.map((column) => ({
      ...column,
      count: moved.filter((ticket) => ticket.column === column.id).length,
    })),
    tickets: moved,
  }
}

function testRun(input: {
  id: number
  ticketId: number
  mode: TestRun['mode']
  state: TestRun['state']
  agentId: string | null
  agentVerdict: TestRun['agentVerdict']
  summary: string
  steps: [string, TestRun['steps'][number]['result']][]
  checks: string[]
}): TestRun {
  return {
    id: input.id,
    ticketId: input.ticketId,
    attempt: 1,
    mode: input.mode,
    state: input.state,
    agentId: input.agentId,
    agentVerdict: input.agentVerdict,
    agentSummary: input.summary,
    checks: input.checks,
    startedAt: at('10:31'),
    finishedAt: input.state === 'agent' ? null : at('10:38'),
    steps: input.steps.map(([title, result], index) => ({
      id: input.id * 100 + index,
      runId: input.id,
      title,
      detail: '',
      criterion: index + 1,
      addedBy: null,
      result,
      note: result === 'fail' ? '90d shows 89 days — the first bar is missing, the range starts one day late.' : '',
      testedBy: result === 'pending' ? null : (input.agentId ?? 'boss'),
      testedAt: result === 'pending' ? null : at('10:36'),
      attachments: [],
    })),
  }
}
