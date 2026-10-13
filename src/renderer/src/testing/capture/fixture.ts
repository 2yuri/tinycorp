// The design's own Testing fixture (Pen frames `BRzY6` and `vKIwf`), as engine data: TC-142 in
// `web-app`, the four criteria its plan set, Iris's pass on all four, and the boss's own third step
// failing on 90d — the state the frame is drawn in.

import type { TicketCode } from '../../../../shared/code'
import type { Company } from '../../../../shared/company'
import type { BoardSnapshot } from '../../../../shared/domain/board'
import type { Employee } from '../../../../shared/domain/staff'
import { EMPTY_STACK, type Repo } from '../../../../shared/repos/repo'
import type { Review } from '../../../../shared/review'
import type { AppRun, RunnableRepo, TestRun, TestStep } from '../../../../shared/testing'

// Today, so the clock reads `10:36` as the frame does rather than `Sep 22, 10:36`: every time here
// is a time of day, and a capture taken on another day would otherwise carry a date the frame has not.
const DAY = new Date().toISOString().slice(0, 10)
const at = (time: string) => `${DAY}T${time}:00`

export const TICKET = 142

function person(id: string, name: string, title: string, sprite: number): Employee {
  return {
    id,
    name,
    roleId: title.toLowerCase(),
    title,
    persona: '',
    capabilities: title === 'QA' ? ['review', 'test', 'code'] : ['code'],
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
  person('e-iris', 'Iris', 'QA', 4),
  person('e-vega', 'Vega', 'Frontend', 1),
  person('e-atlas', 'Atlas', 'PM', 0),
  person('e-nova', 'Nova', 'Tech Lead', 2),
  person('e-orion', 'Orion', 'DevOps', 3),
]

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
]

export const board: BoardSnapshot = {
  columns: [],
  targets: [],
  epics: [],
  tickets: [
    {
      id: TICKET,
      epicId: null,
      title: 'Usage chart with range picker',
      description: '',
      column: 'testing',
      assigneeId: 'e-vega',
      repos: ['r-web'],
      blocked: false,
      blockedReason: '',
      blockedBy: [],
      blocks: [],
      subtasks: [],
      priority: 'normal',
      labels: [],
      baseBranch: 'main',
    },
  ],
}

export const code: TicketCode[] = [
  {
    ticketId: TICKET,
    worktrees: [
      {
        ticketId: TICKET,
        repoId: 'r-web',
        path: '/work/tiny/worktrees/web-app/wt-TC-142',
        branch: 'feat/usage-range-picker',
        base: 'main',
        createdAt: at('09:10'),
      },
    ],
    pullRequests: [
      {
        ticketId: TICKET,
        repoId: 'r-web',
        url: 'https://github.com/tinycorp/web-app/pull/91',
        number: 91,
        openedAt: at('09:40'),
      },
    ],
  },
]

/** The round Iris approved at 10:16, which is what sent the ticket into Testing. */
export const review: Review = {
  id: 1,
  ticketId: TICKET,
  round: 1,
  rounds: 1,
  reviewerId: 'e-iris',
  status: 'approved',
  decidedBy: 'e-iris',
  comments: 'Reads well; the range in the URL is the right call.',
  merge: null,
  approvalId: null,
  mergedRepoIds: [],
  mergeError: null,
  messageId: 10,
  requestedAt: at('10:02'),
  decidedAt: at('10:16'),
  handoff: 'ready',
  roundLimit: 3,
}

function step(input: {
  id: number
  title: string
  detail: string
  criterion: number | null
  addedBy?: string | null
  result: TestStep['result']
  note?: string
  testedBy?: string
  at?: string
  shots?: number
}): TestStep {
  return {
    id: input.id,
    runId: 1,
    title: input.title,
    detail: input.detail,
    criterion: input.criterion,
    addedBy: input.addedBy ?? null,
    result: input.result,
    note: input.note ?? '',
    testedBy: input.result === 'pending' ? null : (input.testedBy ?? 'boss'),
    testedAt: input.result === 'pending' ? null : (input.at ?? at('10:36')),
    attachments: Array.from({ length: input.shots ?? 0 }, (_, index) => ({
      id: input.id * 10 + index,
      stepId: input.id,
      name: `tc142-90d.png`,
      size: 84_000,
      createdAt: at('10:41'),
    })),
  }
}

/** The attempt the frame is drawn on: Iris passed all four, and the boss has failed step 3 since. */
export const run: TestRun = {
  id: 1,
  ticketId: TICKET,
  attempt: 1,
  mode: 'both',
  state: 'you',
  agentId: 'e-iris',
  agentVerdict: 'pass',
  agentSummary: 'All four criteria pass in the running app. I added an offline step for the error state.',
  checks: ['typecheck', 'test · 142', 'e2e · 6'],
  startedAt: at('10:31'),
  finishedAt: null,
  steps: [
    step({
      id: 1,
      title: 'Picker offers 7d, 30d, 90d and a custom range; 30d is the default',
      detail: 'Open Billing → Usage. Check the four options and which one is selected on first load.',
      criterion: 1,
      result: 'pass',
      note: '30d selected on first open',
    }),
    step({
      id: 2,
      title: 'The range lives in the URL; a copied link reopens the same view',
      detail: 'Pick 7d, copy the URL, open it in a new window.',
      criterion: 3,
      result: 'pass',
      at: at('10:38'),
    }),
    step({
      id: 3,
      title: 'Pick 90d: the chart shows one daily total per day, ending today',
      detail: 'Count the bars, hover the first and last. Compare with the totals in the invoice list.',
      criterion: 2,
      result: 'fail',
      note: '90d shows 89 days — the first bar is missing, the range starts one day late.',
      at: at('10:41'),
      shots: 1,
    }),
    step({
      id: 4,
      title: 'Empty and error states match the invoice list',
      detail: 'Switch to an account with no usage, then stop billing-api.',
      criterion: 4,
      addedBy: 'e-iris',
      result: 'pending',
    }),
  ],
}

/** The app the boss started from this screen at 10:34. */
export const app: AppRun = {
  ticketId: TICKET,
  repoId: 'r-web',
  repoName: 'web-app',
  command: 'pnpm dev',
  cwd: '/work/tiny/worktrees/web-app/wt-TC-142',
  port: 5173,
  url: 'http://localhost:5173',
  state: 'running',
  startedAt: at('10:34'),
  startedBy: 'boss',
  exitCode: null,
  lastLine: 'VITE v5.4  ready in 412 ms  →  Local: http://localhost:5173/billing',
  lines: 24,
}

export const runnable: RunnableRepo[] = [
  {
    repoId: 'r-web',
    repoName: 'web-app',
    command: 'pnpm dev',
    cwd: app.cwd,
    port: 5173,
    url: 'http://localhost:5173',
    run: app,
  },
]

export const log: string[] = [
  '> web-app@0.0.0 dev',
  '> vite',
  '',
  'VITE v5.4  ready in 412 ms',
  '  ➜  Local:   http://localhost:5173/billing',
  '  ➜  Network: use --host to expose',
]

/** The three states of the evidence card, as `vKIwf` draws them. */
export const evidence = {
  // Card a is the moment the agent hands over: its four passes, and nothing of the boss's yet.
  both: { ...run, steps: run.steps.map(passed) },
  agent: { ...run, mode: 'agent' as const, state: 'passed' as const, steps: run.steps.map(passed) },
  failed: {
    ...run,
    mode: 'agent' as const,
    state: 'failed' as const,
    agentVerdict: 'fail' as const,
    agentSummary: 'Criterion 2 fails on 90d. Sent it back to Vega with the screenshot.',
    steps: run.steps.map((entry) => (entry.result === 'pending' ? passed(entry) : entry)),
  },
}

function passed(entry: TestStep): TestStep {
  return { ...entry, result: 'pass', testedBy: 'e-iris', testedAt: at('10:36'), note: '' }
}
