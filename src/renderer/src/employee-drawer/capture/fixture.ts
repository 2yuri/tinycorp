// The design's own drawer fixture (Pen frame VkcVg), as engine data.

import type { Company } from '../../../../shared/company'
import type { BoardSnapshot } from '../../../../shared/domain/board'
import { BOSS, dmChannelId, type Message } from '../../../../shared/domain/chat'
import { PROVIDER_MODELS, PROVIDERS } from '../../../../shared/domain/providers'
import type { Employee } from '../../../../shared/domain/staff'
import type { EmployeeConversation } from '../../../../shared/employee-chats'
import type { InboxItem } from '../../../../shared/inbox'
import type { RtkView } from '../../../../shared/ipc'
import { RTK_NOT_FOUND } from '../../../../shared/rtk'
import type { SessionRouting } from '../../../../shared/session'
import type { SubSessionInfo } from '../../../../shared/sub-sessions'
import type { SubagentInfo } from '../../../../shared/subagents'

const DAY = '2026-09-17'
const at = (time: string) => `${DAY}T${time}:00`

function person(id: string, name: string, title: string, sprite: number): Employee {
  return {
    id,
    name,
    roleId: title.toLowerCase().replace(/\s+/g, '-'),
    title,
    persona: '',
    capabilities: ['plan', 'code', 'review'],
    repoFilter: ['*'],
    areas: [],
    mcpServers: [],
    skills: [],
    overrides: [],
    provider: 'claude',
    // Frames `Ysu8a` and `zOVl6` draw the strip reading `Skips permissions` (T164).
    permissionMode: 'skip-permissions',
    model: null,
    desk: 0,
    sprite,
    createdAt: at('08:00'),
  }
}

export const nova = person('nova', 'Nova', 'Tech Lead', 2)
export const vega = person('vega', 'Vega', 'Frontend', 5)
export const iris = person('iris', 'Iris', 'QA', 4)
export const atlas = person('atlas', 'Atlas', 'Backend', 1)
export const employees = [nova, vega, iris, atlas]

/**
 * The Company the drawer's inbox reads: the boss's own tile for a row they sent, and the key a
 * wake's ticket id carries (`TC` in `TC-142`). `useInbox` asks for it on every mount, whichever
 * tab is on screen, so the drawer cannot be rendered at all without it.
 */
export const company: Company = {
  id: 'c-tiny',
  name: 'Tiny Corp',
  key: 'TC',
  boss: { name: 'Yuri Miguel', initials: 'YM' },
  folder: '/work/tiny',
  createdAt: at('08:00'),
}

export const withVega = dmChannelId(nova.id, vega.id)
export const withBoss = dmChannelId(BOSS, nova.id)
export const withIris = dmChannelId(nova.id, iris.id)
const epic = 'ep-usage-invoices'

function preview(id: number, authorId: string, text: string, time: string) {
  return { id, authorId, text, createdAt: at(time) }
}

export const conversations: EmployeeConversation[] = [
  {
    channelId: withVega,
    kind: 'dm',
    name: '',
    members: [nova.id, vega.id],
    counterpartId: vega.id,
    last: preview(12, vega.id, 'Pushing the locale guard now, then it’s yours.', '09:47'),
    unread: 2,
    postable: false,
  },
  {
    channelId: withBoss,
    kind: 'dm',
    name: '',
    members: [BOSS, nova.id],
    counterpartId: BOSS,
    last: preview(9, BOSS, 'Nice work — ship it after Iris signs off.', '09:12'),
    unread: 0,
    postable: true,
  },
  {
    channelId: withIris,
    kind: 'dm',
    name: '',
    members: [iris.id, nova.id],
    counterpartId: iris.id,
    last: preview(8, iris.id, 'I’ll run the regression suite once more.', '09:33'),
    unread: 0,
    postable: false,
  },
  {
    channelId: epic,
    kind: 'channel',
    name: epic,
    members: [],
    counterpartId: null,
    last: preview(7, atlas.id, '@Yuri can you confirm the three plan tiers?', '09:20'),
    unread: 0,
    postable: true,
  },
]

function message(id: number, authorId: string, text: string, time: string): Message {
  return {
    id,
    kind: 'post',
    channelId: withVega,
    threadId: null,
    authorId,
    text,
    mentions: [],
    mentionsChannel: false,
    replyCount: 0,
    createdAt: at(time),
  }
}

export const messages: Message[] = [
  message(10, nova.id, 'The contract lands today. Can you hold the switcher until the locale guard is in?', '09:41'),
  message(12, vega.id, 'Pushing the locale guard now, then it’s yours. I’ll rebase on your branch.', '09:47'),
  message(13, nova.id, 'Perfect. I’ll review it before Iris runs the suite.', '09:49'),
]

/** The frame draws no wake list, so the Employee it opens on has none: the capture is the frame. */
export const wakes: InboxItem[] = []

/**
 * The wake list with something in it (T209). The Chats tab folds it away behind `Wakes` and the
 * frames were drawn with it empty, so `inbox.css` was drawn by no capture at all until this.
 */
export const wokenWakes: InboxItem[] = [
  {
    id: 91,
    employeeId: 'e-nova',
    kind: 'dm',
    fromId: BOSS,
    channelId: dmChannelId(BOSS, 'e-nova'),
    threadId: null,
    messageId: 412,
    ticketId: null,
    text: 'Can you take another look at the pagination before it goes out?',
    prompt: 'Can you take another look at the pagination before it goes out?',
    status: 'pending',
    attempts: 1,
    createdAt: at('09:12'),
    handledAt: null,
  },
  {
    id: 92,
    employeeId: 'e-nova',
    kind: 'assigned',
    fromId: 'e-hera',
    channelId: null,
    threadId: null,
    messageId: null,
    ticketId: 128,
    text: 'TC-128 Invoice pagination + usage totals',
    prompt: 'You have been assigned TC-128.',
    status: 'handled',
    attempts: 1,
    createdAt: at('08:40'),
    handledAt: at('08:41'),
  },
]

/** RTK on, so the terminal header draws its chip (T179, frame `p4np9V`). */
export const rtkOn: RtkView = {
  status: { state: 'found', version: '0.41.0', path: '/opt/homebrew/bin/rtk', missingIn: [] },
  settings: { enabled: true, ping: false },
  hooks: [],
}

/** What the chip says when RTK has a week behind it. */
export const rtkSavings = { cutPercent: 62, tokensNotRead: 184_000, commandsFiltered: 318 }

/**
 * The Terminal tab's strip (Pen frame CuLyV, T162): Nova, then three subagents — `tests` and
 * `migration` running, `docs` done — with `tests` picked. The frame draws them as Sessions of
 * their own; these are Claude Code's own subagents, so the worktree line is not drawn.
 */
export function subagents(now: number): SubagentInfo[] {
  const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString()
  return [
    {
      id: 'toolu_tests',
      name: 'tests',
      task: "Write tests for the usage chart's range picker",
      state: 'running',
      startedAt: ago(6),
      endedAt: null,
      now: 'pnpm vitest run usage-chart',
      filesChanged: 3,
    },
    {
      id: 'toolu_migration',
      name: 'migration',
      task: 'Add the usage_daily migration',
      state: 'running',
      startedAt: ago(4),
      endedAt: null,
      now: 'Edit src/main/engine/database.ts',
      filesChanged: 1,
    },
    {
      id: 'toolu_docs',
      name: 'docs',
      task: 'Document the range picker',
      state: 'done',
      startedAt: ago(14),
      endedAt: ago(9),
      now: null,
      filesChanged: 1,
    },
  ]
}

/**
 * The frame's strip as it was drawn (Pen frame CuLyV, T163): Nova, then three Sessions she started
 * of her own — `tests` and `migration` in their own worktrees off her branch, `docs` in hers and
 * done — with `tests` picked. The Company's cap is 5, so she holds 3 of its seats.
 */
export function subSessions(now: number): SubSessionInfo[] {
  const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString()
  const branch = 'ticket-tc-142-usage-chart'
  const base = { parentId: nova.id, ticketId: 142, repoName: 'app', parentBranch: branch, result: null }
  return [
    {
      ...base,
      id: 'sub-tests',
      name: 'tests',
      task: "Write tests for the usage chart's range picker",
      workspace: 'own',
      state: 'working',
      path: `/work/tiny/worktrees/app/${branch}+tests`,
      branch: `${branch}+tests`,
      startedAt: ago(6),
      endedAt: null,
      now: 'pnpm vitest run usage-chart',
      filesChanged: 3,
      worktreeKept: true,
      branchKept: true,
    },
    {
      ...base,
      id: 'sub-migration',
      name: 'migration',
      task: 'Add the usage_daily migration',
      workspace: 'own',
      state: 'working',
      path: `/work/tiny/worktrees/app/${branch}+migration`,
      branch: `${branch}+migration`,
      startedAt: ago(4),
      endedAt: null,
      now: 'Edit database.ts',
      filesChanged: 1,
      worktreeKept: true,
      branchKept: true,
    },
    {
      ...base,
      id: 'sub-docs',
      name: 'docs',
      task: 'Document the range picker',
      workspace: 'shared',
      state: 'done',
      path: `/work/tiny/worktrees/app/${branch}`,
      branch,
      startedAt: ago(14),
      endedAt: ago(9),
      now: null,
      filesChanged: null,
      worktreeKept: false,
      branchKept: false,
      result: 'Documented the range picker in docs/charts.md.',
    },
  ]
}

/** Nova's own terminal, which the strip swaps out for `tests`' when its chip is picked. */
export const parentReplay = ['\x1b[90m❯\x1b[0m session_start tests, migration, docs', ''].join('\r\n')

/** The frame's terminal, as the replay the drawer's terminal writes first. */
export const terminalReplay = [
  '\x1b[90m❯\x1b[0m cd ~/.tinycorp/wt/TC-142',
  '\x1b[32m✓\x1b[0m Read  src/charts/UsageChart.tsx  (218 lines)',
  '\x1b[32m✓\x1b[0m Edit  src/charts/UsageChart.tsx  +42 -11',
  '\x1b[90m❯\x1b[0m pnpm vitest run charts',
  '  \x1b[32m✓ 18 passed\x1b[0m  (2.41s)',
  '\x1b[90m❯\x1b[0m Drafting PR body from the ticket + subtasks…',
  '',
].join('\r\n')

/**
 * The handoff command frame `zOVl6` shows (T164): Nova's own Session, with the skip flag she runs
 * with. Fixture-only — the app never spells a command out in the renderer; this one stands in for
 * what the Provider adapter builds, so the capture can be compared with the frame.
 */
export const handoff = {
  command: 'claude --resume 3f2a91c4-77de-4a0b-9d13-5f0c2e8ab614 --dangerously-skip-permissions',
  shown: 'claude --resume 3f2a\u2026 --dangerously-skip-permissions',
}

/**
 * Where an Employee is working while its own Provider is out (T173, frame `tdI8o` a): on the
 * catalogue's second Provider until the first resets at 21:00 today — today, because the chip
 * writes the date in front of any other day and the frame shows a clock time.
 */
export function routedTo(): SessionRouting {
  const at = new Date()
  at.setHours(21, 0, 0, 0)
  return {
    provider: PROVIDERS[1] ?? PROVIDERS[0]!,
    model: PROVIDER_MODELS[PROVIDERS[1] ?? PROVIDERS[0]!]?.[0]?.id ?? null,
    from: PROVIDERS[0]!,
    resetsAt: at.toISOString(),
    movesBack: true,
  }
}

/**
 * RTK off, which is what the drawer's frames were drawn with: they predate T179, and the chip is
 * drawn only where the Company is really compressing.
 */
export const rtkOff: RtkView = {
  status: RTK_NOT_FOUND,
  settings: { enabled: false, ping: false },
  hooks: [],
}

/** Nova's ticket in Doing, with a checklist long enough to cover the terminal unfolded (TI-2). */
const LONG_CHECKLIST = [
  'Range picker component',
  'Wire the usage query',
  'Empty state',
  'Loading skeleton',
  'Error state with retry',
  'Keyboard navigation',
  'Screen reader labels',
  'Dark theme colours',
  'Unit tests for the range maths',
  'DOM test for the picker',
  'Design baseline',
  'Docs in the usage guide',
]

export const longTicket: BoardSnapshot = {
  columns: [],
  targets: [],
  // TC-142's epic on the board (`board/capture/fixture.ts`), drawn under the title (T274, frame `SA8tW`).
  epics: [{ id: 1, targetId: null, title: 'Usage and invoices', description: '', color: 'indigo' }],
  tickets: [
    {
      id: 142,
      epicId: 1,
      title: 'Add the usage chart’s range picker',
      description: '',
      column: 'doing',
      assigneeId: nova.id,
      repos: [],
      blocked: false,
      blockedReason: '',
      blockedBy: [],
      blocks: [],
      subtasks: LONG_CHECKLIST.map((title, i) => ({ id: i + 1, ticketId: 142, title, done: i < 4, repo: null })),
      priority: 'normal',
      labels: [],
      baseBranch: null,
    },
  ],
}
