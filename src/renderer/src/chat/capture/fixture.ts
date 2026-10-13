// The design's own chat fixture (Pen `rPfPD` and the approval cards frame `ItWn6`), as engine data.
import type { Approval } from '../../../../shared/approvals'
import type { PinnedMessage } from '../../../../shared/channel-extras'
import type { PullRequestDetails, TicketCode } from '../../../../shared/code'
import type { Company } from '../../../../shared/company'
import type { BoardSnapshot } from '../../../../shared/domain/board'
import { type Channel, COMPANY_AUTHOR, dmChannelId, type Message } from '../../../../shared/domain/chat'
import type { Employee } from '../../../../shared/domain/staff'
import { type BossInboxItem, messageRowId } from '../../../../shared/inbox/boss-inbox'
import {
  type DailyDigest,
  DEFAULT_DIGEST_SCHEDULE,
  type DigestSchedule,
} from '../../../../shared/planning/daily-digest'
import type { Plan } from '../../../../shared/planning/planning'
import { EMPTY_STACK, type Repo } from '../../../../shared/repos/repo'
import type { Review } from '../../../../shared/review'

const DAY = '2026-09-17'

/** The epic channel the planning frame (`D1E2lt`) is drawn in. */
export const PLANNING_CHANNEL = 'ep-usage-invoices'

/** The DM the Inbox's DM row opens (T251, frame `JRSDX`). */
export const VEGA_DM = dmChannelId('boss', 'e-vega')

function at(time: string): string {
  return `${DAY}T${time}:00`
}

function person(
  id: string,
  name: string,
  title: string,
  capabilities: Employee['capabilities'],
  sprite: number,
): Employee {
  return {
    id,
    name,
    roleId: title.toLowerCase().replace(/\s+/g, '-'),
    title,
    persona: '',
    capabilities,
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

// The sprites the design's frames draw for each of them (`face-0`, `face-2`, `face-3`, `face-4`).
export const employees: Employee[] = [
  person('e-atlas', 'Atlas', 'PM', ['intake', 'plan'], 0),
  person('e-nova', 'Nova', 'Tech Lead', ['plan', 'code', 'review'], 2),
  person('e-orion', 'Orion', 'DevOps', ['code'], 3),
  person('e-hera', 'Hera', 'HR', ['hire'], 4),
  person('e-vega', 'Vega', 'Backend', ['code'], 1),
  person('e-sol', 'Sol', 'Frontend', ['code'], 5),
]

/** The DM whose palette lists Orion's skills first (`DhY2y`, T264). */
export const ORION_DM = dmChannelId('boss', 'e-orion')

/** The three skills frame `DhY2y` lists, with what each one's `SKILL.md` says it does. */
export const orionSkills = [
  {
    id: 's-checks',
    name: 'review-checklist',
    description: 'The checks this team runs before a pull request',
    missing: false,
  },
  { id: 's-runbook', name: 'deploy-runbook', description: 'How a release goes out, step by step', missing: false },
  { id: 's-handoff', name: 'pen-handoff', description: 'Hand a design off from Pen to code', missing: false },
]

/** The staff with Orion holding them, for the palette-with-skills capture. */
export const employeesWithSkills: Employee[] = employees.map((e) =>
  e.id === 'e-orion' ? { ...e, skills: orionSkills.map((s) => s.id) } : e,
)

/** The hiring catalog `/hire` completes against in the palette capture. */
export const roles = [
  { id: 'r-pm', name: 'Product manager' },
  { id: 'r-frontend', name: 'Frontend engineer' },
  { id: 'r-backend', name: 'Backend engineer' },
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
  { id: 'r-web', name: 'web-app', path: '/code/web', brief: '', rung: 'merge', stack, addedAt: '' },
  { id: 'r-api', name: 'billing-api', path: '/code/api', brief: '', rung: 'merge', stack, addedAt: '' },
]

export const board: BoardSnapshot = {
  columns: [
    { id: 'todo', title: 'Todo', wipLimit: null, count: 6, overLimit: false },
    { id: 'doing', title: 'Doing', wipLimit: 3, count: 2, overLimit: false },
    { id: 'review', title: 'Review', wipLimit: null, count: 1, overLimit: false },
    { id: 'done', title: 'Done', wipLimit: null, count: 3, overLimit: false },
  ],
  // Due the Friday of the week the boss asked in (Thursday 17 September).
  targets: [{ id: 1, title: 'Billing Dashboard', description: '', dueAt: '2026-09-18' }],
  epics: [
    { id: 10, targetId: 1, title: 'Usage & invoices', description: '', color: 'indigo' },
    { id: 11, targetId: 1, title: 'Plan switching', description: '', color: 'indigo' },
  ],
  tickets: [
    {
      id: 142,
      epicId: 10,
      title: 'Usage chart with range picker',
      description: '',
      column: 'doing',
      assigneeId: 'e-nova',
      repos: ['r-web'],
      blocked: false,
      blockedReason: '',
      blockedBy: [],
      blocks: [],
      subtasks: [],
      priority: 'normal',
      labels: [],
      baseBranch: null,
    },
    {
      id: 128,
      epicId: 10,
      title: 'Invoice pagination + usage totals',
      description: '',
      column: 'review',
      assigneeId: 'e-vega',
      repos: ['r-api'],
      blocked: false,
      blockedReason: '',
      blockedBy: [],
      blocks: [],
      subtasks: [],
      priority: 'normal',
      labels: [],
      baseBranch: null,
    },
  ],
}

/** The target's other four tickets, still in Todo: the target card counts six across its two epics. */
board.tickets.push(
  todo(143, 10, 'Invoice history table', 'e-nova', 'r-web'),
  todo(144, 10, 'Usage export endpoint', 'e-vega', 'r-api'),
  todo(145, 11, 'Plan picker', 'e-sol', 'r-web'),
  todo(146, 11, 'Proration preview', 'e-sol', 'r-web'),
)

function todo(
  id: number,
  epicId: number,
  title: string,
  assigneeId: string,
  repo: string,
): BoardSnapshot['tickets'][number] {
  return {
    id,
    epicId,
    title,
    description: '',
    column: 'todo',
    assigneeId,
    repos: [repo],
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

export const code: TicketCode[] = [
  {
    ticketId: 142,
    worktrees: [{ ticketId: 142, repoId: 'r-web', path: '/w/142', branch: 'wt/TC-142', base: 'main', createdAt: '' }],
    pullRequests: [],
  },
  {
    ticketId: 128,
    worktrees: [],
    pullRequests: [{ ticketId: 128, repoId: 'r-api', url: 'https://gh/api/pull/128', number: 128, openedAt: '' }],
  },
]

export const details: PullRequestDetails[] = [
  {
    ticketId: 128,
    repoId: 'r-api',
    url: 'https://gh/api/pull/128',
    number: 128,
    title: 'Invoice pagination + usage totals',
    state: 'open',
    head: 'feat/invoice-pagination',
    base: 'main',
    additions: 142,
    deletions: 38,
    changedFiles: 6,
    mergeable: 'mergeable',
    checks: [
      { name: 'build', workflow: 'pnpm build', state: 'passing', durationMs: 48_000 },
      { name: 'test', workflow: 'pnpm test', state: 'passing', durationMs: 64_000 },
      { name: 'lint', workflow: 'pnpm lint', state: 'passing', durationMs: 6_000 },
    ],
  },
]

export const reviews: Review[] = [
  {
    id: 1,
    round: 1,
    rounds: 1,
    handoff: 'ready',
    roundLimit: 3,
    ticketId: 128,
    reviewerId: 'e-nova',
    status: 'approved',
    decidedBy: 'e-nova',
    comments: '',
    merge: 'waiting',
    approvalId: 1,
    mergedRepoIds: [],
    mergeError: null,
    messageId: 90,
    requestedAt: at('09:20'),
    decidedAt: at('09:28'),
  },
]

/** The pending merge of `rPfPD`, and the pending hire the generic card was drawn for. */
export const approvals: Approval[] = [
  {
    id: 1,
    action: 'merge',
    requesterId: 'e-orion',
    subject: 'TC-128 Invoice pagination + usage totals',
    ticketId: 128,
    pullRequest: { repoId: 'r-api', number: 128 },
    reason: 'Nova approved it and all three checks are green.',
    status: 'pending',
    decisionReason: null,
    channelId: 'general',
    messageId: 4,
    createdAt: at('09:31'),
    decidedAt: null,
  },
  {
    id: 3,
    action: 'env_run',
    requesterId: 'e-orion',
    subject: 'pnpm db:migrate with prod',
    ticketId: null,
    pullRequest: null,
    reason: 'In wt/TC-151 on billing-api, with DATABASE_URL.',
    status: 'pending',
    decisionReason: null,
    channelId: 'general',
    messageId: 8,
    createdAt: at('21:04'),
    decidedAt: null,
  },
  {
    id: 2,
    action: 'hire',
    requesterId: 'e-hera',
    subject: 'a new QA engineer named Iris',
    ticketId: null,
    pullRequest: null,
    reason: 'Reviews invoices PRs against acceptance criteria and writes repro steps.',
    status: 'pending',
    decisionReason: null,
    channelId: 'general',
    messageId: 5,
    createdAt: at('09:40'),
    decidedAt: null,
  },
]

export const channels: Channel[] = [
  {
    id: 'general',
    kind: 'channel',
    name: 'general',
    members: [],
    topic: 'Company-wide. One teammate answers; @mention to ask someone specific.',
  },
  { id: 'tech', kind: 'channel', name: 'tech', members: [], topic: '' },
  {
    id: PLANNING_CHANNEL,
    kind: 'channel',
    name: PLANNING_CHANNEL,
    members: [],
    topic: 'Planning TC-142 · Nova asks, you answer, the plan goes to Ready when you approve it.',
  },
  { id: 'prs', kind: 'channel', name: 'prs', members: [], topic: '' },
  { id: VEGA_DM, kind: 'dm', name: '', members: ['boss', 'e-vega'], topic: '' },
  { id: ORION_DM, kind: 'dm', name: '', members: ['boss', 'e-orion'], topic: '' },
]

function post(
  id: number,
  authorId: string,
  time: string,
  text: string,
  replyCount = 0,
  mentions: string[] = [],
): Message {
  return {
    id,
    kind: 'post',
    channelId: 'general',
    threadId: null,
    authorId,
    text,
    mentions,
    mentionsChannel: false,
    replyCount,
    createdAt: at(time),
  }
}

export const messages: Message[] = [
  post(
    1,
    'boss',
    '09:12',
    'Billing dashboard has to ship this week — usage charts, invoice history and a plan switcher. ' +
      'Repos are web-app and billing-api.',
  ),
  {
    ...post(
      2,
      'e-atlas',
      '09:12',
      'Got it. I turned that into one target with two epics and six tickets. Nova is on the API contract first.',
    ),
    targetId: 1,
  },
  post(
    3,
    'e-nova',
    '09:14',
    'Claimed TC-142. Worktree is up on web-app, running the repo stack (pnpm + vitest). PR opens when the suite is green. Design: https://pen.dev/acme/billing-dashboard.',
  ),
  post(
    4,
    'e-orion',
    '09:31',
    'PR #128 on billing-api is reviewed and green. Autonomy is Managed, so the merge needs your call.',
    2,
    ['boss'],
  ),
  post(
    5,
    'e-hera',
    '09:40',
    'Billing is short a reviewer, so I’d like to bring on a QA engineer for the invoices epic.',
    1,
    ['boss'],
  ),
  // The `env_run` card of frame `aD50i` (a): prod asks before every use, so the migration waits.
  post(8, 'e-orion', '21:04', 'TC-151’s migration is ready. It needs prod to run.', 0, ['boss']),
]

/**
 * The chat with files in it (T38): one message carrying a screenshot and a log, so the inline
 * preview and the file chip can be looked at beside the design's chip row.
 */
export const withAttachments: Message[] = [
  ...messages,
  {
    ...post(9, 'e-nova', '09:46', 'Totals are off by a cent on the yearly plan. Screenshot and the failing run:'),
    attachments: [
      { id: 1, messageId: 9, name: 'usage-totals.png', size: 184320, createdAt: at('09:46') },
      { id: 2, messageId: 9, name: 'vitest-run.log', size: 5120, createdAt: at('09:46') },
    ],
  },
]

/**
 * A message with two paths written in it (T114), so `paths.css` is drawn by a baseline state. The
 * design's own thread has none, and a path link is the one thing in a message the surrounding view
 * does not draw itself.
 */
export const withPaths: Message[] = [
  ...messages,
  post(
    10,
    'e-nova',
    '09:48',
    'The rounding is in src/format/currency.ts:19, and the failing case is in src/format/currency.test.ts.',
  ),
]

/** The replies of each approval thread, as the design's panels show them. */
export const threads: Record<number, Message[]> = {
  4: [
    messages[3]!,
    {
      ...post(6, 'e-nova', '09:33', 'Reviewed it. The totals query is covered and the migration is reversible.'),
      threadId: 4,
    },
    { ...post(7, 'e-orion', '09:35', 'Staging has been running this branch since 08:40 with no errors.'), threadId: 4 },
  ],
  5: [
    messages[4]!,
    {
      ...post(8, 'e-nova', '09:42', 'Agreed. I can’t cover invoices review and the API contract this week.'),
      threadId: 5,
    },
  ],
}

const PAST = '2026-09-16'

function dm(id: number, authorId: string, day: string, time: string, text: string): Message {
  return { ...post(id, authorId, time, text), id, channelId: VEGA_DM, createdAt: `${day}T${time}:00` }
}

/**
 * The whole DM, not the one message the row is about: yesterday's two, this morning's, and the two
 * the boss has not read. `dmReadMark` is where they stopped reading, which is where the New divider
 * goes — message 51, so 52 is the first thing under it.
 */
export const vegaDm: Message[] = [
  dm(50, 'boss', PAST, '18:02', 'Can you take the invoice export next? The CSV should match the usage table.'),
  dm(51, 'e-vega', PAST, '18:10', 'On it — I’ll branch off main once the pagination PR lands.'),
  dm(52, 'e-vega', DAY, '08:41', 'Pagination landed. Starting the export now.'),
  dm(53, 'e-vega', DAY, '09:02', 'Quick one: are refunds in scope this week, or only invoices?'),
  dm(54, 'e-vega', DAY, '09:53', 'Export is up as a draft. Do you want the totals per team or per repo?'),
]

export const dmReadMark = 51

/**
 * The boss's Inbox as the design's Inbox frame (`c4qHR`) lists it. The approval row is the merge of
 * `rPfPD` (message 4), so it carries the real Approve / Send back actions.
 */
export const bossInbox: BossInboxItem[] = [
  row(4, 'approval', 'general', 'e-orion', '09:31', 'PR #128 on billing-api is reviewed and green.', 1),
  row(
    41,
    'thread',
    'general',
    'e-nova',
    '09:35',
    'Contract matches the web-app ticket. Safe to merge before TC-142 lands.',
  ),
  row(42, 'mention', 'tech', 'e-atlas', '09:20', '@boss can you confirm the three plan tiers this week?'),
  row(53, 'dm', VEGA_DM, 'e-vega', '09:02', 'Quick one: are refunds in scope this week, or only invoices?'),
  row(44, 'waiting', 'tech', COMPANY_AUTHOR, '08:55', 'Waiting for capacity: Hera will answer when a slot frees.'),
  row(
    45,
    'thread',
    'prs',
    'e-nova',
    '09:10',
    'Regression suite is green on #139, pagination edges covered.',
    null,
    PAST,
  ),
  row(46, 'mention', 'general', 'e-hera', '09:05', '@boss hire a QA engineer for the billing epic.', null, PAST),
]

function row(
  messageId: number,
  kind: BossInboxItem['kind'],
  channelId: string,
  fromId: string,
  time: string,
  text: string,
  approvalId: number | null = null,
  day = DAY,
): BossInboxItem {
  return {
    id: messageRowId(messageId),
    messageId,
    kind,
    channelId,
    threadId: messageId,
    fromId,
    text,
    createdAt: `${day}T${time}:00`,
    unread: day === DAY,
    approvalId,
    planId: null,
    testRunId: null,
  }
}

/** The boss pinned the goal, so #general keeps it whatever the scroll does (T44). */
export const pins: PinnedMessage[] = [{ ...messages[0]!, pinnedBy: 'boss', pinnedAt: `${DAY}T09:13:00` }]

function planningPost(id: number, authorId: string, time: string, text: string, mentions: string[] = []): Message {
  return {
    id,
    kind: 'post',
    channelId: PLANNING_CHANNEL,
    threadId: null,
    authorId,
    text,
    mentions,
    mentionsChannel: false,
    replyCount: 0,
    createdAt: at(time),
  }
}

/** The planning thread of `D1E2lt`: the system line, Nova's questions, and the Plan card. */
export const planningMessages: Message[] = [
  planningPost(
    200,
    COMPANY_AUTHOR,
    '09:05',
    'You created TC-142 · Usage chart with range picker — it starts in Planning.',
  ),
  planningPost(
    201,
    'e-nova',
    '09:06',
    'Before this goes to Ready, three questions. Answer inline — I’ll draft the plan from whatever you give me.',
    ['boss'],
  ),
  planningPost(202, 'e-nova', '09:14', 'Drafted the plan from your two answers. I assumed yes on question 3.', [
    'boss',
  ]),
]

/** TC-142's plan, waiting on the boss with one question still open (`D1E2lt`). */
export const plans: Plan[] = [
  {
    id: 1,
    version: 1,
    ticketId: 142,
    epicId: null,
    plannerId: 'e-nova',
    goal: 'Customers see what they used over a chosen range, on the billing page.',
    approach:
      'Add from/to to GET /usage in billing-api, then a RangePicker and chart in web-app reading the range from the URL.',
    acceptanceCriteria: [
      'Picker offers 7d, 30d, 90d and a custom range; 30d is the default',
      'The chart shows daily totals for the range, no per-seat split',
      'The range lives in the URL; a copied link reopens the same view',
      'Empty and error states match the invoice list',
    ],
    repos: ['r-web', 'r-api'],
    subtasks: [
      { title: 'from/to on GET /usage', repo: 'r-api' },
      { title: 'RangePicker with presets + custom', repo: 'r-web' },
      { title: 'Chart + range in the URL', repo: 'r-web' },
    ],
    risks: ['Custom ranges over a year hit the nightly aggregate (TC-144), which is still Blocked'],
    openQuestions: ['Q3 range in the URL — assumed yes. Say no and I’ll drop criterion 3.'],
    status: 'waiting',
    approvedBy: null,
    approvedAt: null,
    replanBy: null,
    replanReason: null,
    replanChanges: [],
    channelId: PLANNING_CHANNEL,
    threadId: 200,
    messageId: 202,
    createdAt: at('09:05'),
    questions: [
      {
        id: 1,
        planId: 1,
        number: 1,
        text: 'Which ranges — 7 / 30 / 90 days, or a custom date range too?',
        answer: '7, 30, 90 days and custom. Default to 30.',
        answeredBy: 'boss',
        answeredAt: at('09:09'),
        delegated: false,
        messageId: 201,
      },
      {
        id: 2,
        planId: 1,
        number: 2,
        text: 'Totals only, or a breakdown per seat?',
        answer: 'Totals. Per-seat is a later ticket.',
        answeredBy: 'boss',
        answeredAt: at('09:11'),
        delegated: false,
        messageId: 201,
      },
      {
        id: 3,
        planId: 1,
        number: 3,
        text: 'Keep the range in the URL so a link reopens the same view?',
        answer: null,
        answeredBy: null,
        answeredAt: null,
        delegated: false,
        messageId: 201,
      },
    ],
  },
]

/**
 * The plan of `dvg9E`: every question answered and nothing drafted yet. This is the state TI-6
 * read as an approved plan, so it is the one the harness keeps drawing (T233).
 */
export const answeredPlan: Plan = {
  ...plans[0]!,
  status: 'drafting',
  messageId: null,
  openQuestions: [],
  questions: plans[0]!.questions.map((q) => ({
    ...q,
    answer: q.answer ?? 'Yes — the range belongs in the URL.',
    answeredBy: q.answeredBy ?? 'boss',
    answeredAt: q.answeredAt ?? at('09:12'),
  })),
}

/** The thread of `dvg9E`: the questions are all answered and the plan has not been posted. */
export const answeredMessages: Message[] = planningMessages.slice(0, 2)

/** The same plan after approval, and the replan Vega asked for on top of it (`hZrUN`). */
export const approvedPlan: Plan = {
  ...plans[0]!,
  status: 'approved',
  approvedBy: 'boss',
  approvedAt: at('09:21'),
  openQuestions: [],
  questions: plans[0]!.questions.map((q) => ({
    ...q,
    answer: q.answer ?? 'Yes.',
    answeredBy: q.answeredBy ?? 'boss',
  })),
}

export const replanPlan: Plan = {
  ...approvedPlan,
  id: 2,
  version: 2,
  status: 'replan',
  approvedBy: null,
  approvedAt: null,
  replanBy: 'e-vega',
  replanReason:
    'Ranges over 90 days time out on GET /usage. It needs cursor pagination and a migration in billing-api.',
  replanChanges: [
    '+ Subtask · cursor pagination on GET /usage',
    '+ Criterion · a 12-month range loads in under 2 s',
    '~ Risk · migration on the usage table',
  ],
  messageId: 203,
}
/** The day the daily digest frame `N47ud` is written for: Tuesday 22 September. */
const DIGEST_DAY = '2026-09-22'

/** The schedule behind the digest card and the settings card: the default, in this Mac's own hours. */
export const digestSchedule: DigestSchedule = {
  ...DEFAULT_DIGEST_SCHEDULE,
  days: [...DEFAULT_DIGEST_SCHEDULE.days],
}

/**
 * The digest of frame `N47ud`, as the engine stores one. The times are written without a zone, so
 * the card reads `Tue 22 Sep · 18:00` wherever the capture is taken.
 */
export const digest: DailyDigest = {
  day: DIGEST_DAY,
  since: '2026-09-21T18:00:00',
  until: `${DIGEST_DAY}T18:00:00`,
  shipped: [
    {
      ticketId: 138,
      title: 'Invoice pagination',
      where: 'billing-api #128',
      url: 'https://example.invalid/pr/128',
      who: 'Orion',
    },
    {
      ticketId: 141,
      title: 'Usage totals endpoint',
      where: 'billing-api #131',
      url: 'https://example.invalid/pr/131',
      who: 'Orion',
    },
    {
      ticketId: 140,
      title: 'Plan badge in header',
      where: 'web-app #87',
      url: 'https://example.invalid/pr/87',
      who: 'Vega',
    },
  ],
  inReview: [
    { ticketId: 142, title: 'Usage chart with range picker', where: '', readyForYou: true },
    { ticketId: 144, title: 'Invoice PDF download', where: 'Iris reviewing · web-app #89', readyForYou: false },
  ],
  blocked: [{ ticketId: 146, title: 'Proration on plan switch', reason: 'Needs a Stripe test key in billing-api' }],
  waiting: [
    {
      id: 'm147',
      ticketId: 147,
      text: 'Approve Nova’s plan · Plan switching',
      kind: 'Plan · 4 steps',
      channelId: 'general',
      threadId: 147,
    },
    {
      id: 'm143',
      ticketId: 143,
      text: 'Vega asks to run pnpm add recharts',
      kind: 'Permission',
      channelId: 'general',
      threadId: 143,
    },
  ],
  usage: [
    { id: 'claude', name: 'Claude', percent: 68, window: '5h', resets: '21:00', problem: '' },
    { id: 'codex', name: 'Codex', percent: 22, window: '5h', resets: '23:10', problem: '' },
  ],
  tomorrow: [
    { ticketId: 148, title: 'Invoice email template', who: 'Vega' },
    { ticketId: 149, title: 'Usage alerts at 80%', who: 'Orion' },
    { ticketId: 150, title: 'Regression suite for billing', who: 'Iris' },
  ],
  footer: 'Posted by TinyCorp · no usage spent · every weekday at 18:00',
}

/** `#general` on the evening of the digest (T172, frame `N47ud`): the boss's goal, then the card. */
export const withDigest: Message[] = [
  { ...post(1, 'boss', '09:12', messages[0]!.text), createdAt: `${DIGEST_DAY}T09:12:00` },
  {
    id: 20,
    kind: 'digest',
    channelId: 'general',
    threadId: null,
    authorId: COMPANY_AUTHOR,
    text: '3 shipped, 2 in review, 1 blocked. 2 things wait on you. Claude at 68%, resets 21:00.',
    mentions: [],
    mentionsChannel: false,
    replyCount: 0,
    createdAt: `${DIGEST_DAY}T18:00:00`,
    digest,
  },
]
