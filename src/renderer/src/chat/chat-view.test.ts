import { describe, expect, it } from 'vitest'
import type { Approval } from '../../../shared/approvals'
import type { PullRequestDetails, TicketCode } from '../../../shared/code'
import type { BoardSnapshot, Ticket } from '../../../shared/domain/board'
import { BOSS, type Channel, COMPANY_AUTHOR, dmChannelId, type Message } from '../../../shared/domain/chat'
import type { Employee } from '../../../shared/domain/staff'
import { type DailyDigest, QUIET_DAY } from '../../../shared/planning/daily-digest'
import { EMPTY_STACK, type Repo } from '../../../shared/repos/repo'
import type { Review } from '../../../shared/review'
import {
  approvalCard,
  approvalDetail,
  type ChatData,
  cardOf,
  channelHeader,
  checksSummary,
  composerHint,
  DEFAULT_READ_LIMIT,
  diffLabel,
  dueLabel,
  formatDuration,
  formatTime,
  MAX_READ_LIMIT,
  mergeBadge,
  pullRequestsOfApproval,
  readLimitFor,
  readOnlyNote,
  roleTag,
  threadTitle,
  ticketOfApproval,
  visibleChannel,
  withDayDividers,
} from './chat-view'

function employee(
  id: string,
  name: string,
  title: string,
  capabilities: Employee['capabilities'] = ['code'],
): Employee {
  return {
    id,
    name,
    roleId: title.toLowerCase(),
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
    sprite: 0,
    createdAt: '2026-09-17T08:00:00Z',
  }
}

const ada = employee('e-ada', 'Ada', 'PM', ['intake', 'plan'])
const bo = employee('e-bo', 'Bo', 'Tech Lead', ['plan', 'code', 'review'])
const cy = employee('e-cy', 'Cy', 'QA', ['review'])

function message(id: number, text: string, overrides: Partial<Message> = {}): Message {
  return {
    id,
    kind: 'post',
    channelId: 'general',
    threadId: null,
    authorId: ada.id,
    text,
    mentions: [],
    mentionsChannel: false,
    replyCount: 0,
    createdAt: '2026-09-17T09:12:00',
    ...overrides,
  }
}

function ticket(id: number, overrides: Partial<Ticket> = {}): Ticket {
  return {
    id,
    epicId: null,
    title: `Ticket ${id}`,
    description: '',
    column: 'todo',
    assigneeId: null,
    repos: [],
    blocked: false,
    blockedReason: '',
    blockedBy: [],
    blocks: [],
    subtasks: [],
    priority: 'normal',
    labels: [],
    baseBranch: null,
    ...overrides,
  }
}

const board: BoardSnapshot = {
  columns: [
    { id: 'todo', title: 'Todo', wipLimit: null, count: 3, overLimit: false },
    { id: 'doing', title: 'Doing', wipLimit: 3, count: 1, overLimit: false },
    { id: 'review', title: 'Review', wipLimit: null, count: 1, overLimit: false },
    { id: 'done', title: 'Done', wipLimit: null, count: 0, overLimit: false },
  ],
  targets: [{ id: 1, title: 'Billing', description: '', dueAt: '2026-09-18' }],
  epics: [
    { id: 10, targetId: 1, title: 'Invoices', description: 'Usage and invoices.', color: 'indigo' },
    { id: 11, targetId: 1, title: 'Plans', description: '', color: 'indigo' },
    { id: 12, targetId: null, title: 'Loose', description: '', color: 'indigo' },
  ],
  tickets: [
    ticket(1, { epicId: 10, assigneeId: bo.id }),
    ticket(2, { epicId: 10, assigneeId: cy.id }),
    ticket(3, { epicId: 11, assigneeId: bo.id }),
    ticket(4, { epicId: 11, column: 'doing', assigneeId: bo.id, repos: ['r-web'] }),
    ticket(5, { epicId: 12, column: 'review', assigneeId: bo.id, repos: ['r-web'], title: 'Invoice pagination' }),
  ],
}

const web: Repo = {
  id: 'r-web',
  name: 'web-app',
  path: '/code/web',
  brief: '',
  rung: 'merge',
  stack: { ...EMPTY_STACK, language: 'TypeScript', framework: 'vitest', packageManager: 'pnpm' },
  addedAt: '',
}

const code: TicketCode[] = [
  {
    ticketId: 4,
    worktrees: [{ ticketId: 4, repoId: 'r-web', path: '/w/4', branch: 'ticket-4-x', base: 'main', createdAt: '' }],
    pullRequests: [],
  },
  {
    ticketId: 5,
    worktrees: [{ ticketId: 5, repoId: 'r-web', path: '/w/5', branch: 'ticket-5-x', base: 'main', createdAt: '' }],
    pullRequests: [{ ticketId: 5, repoId: 'r-web', url: 'https://gh/pull/128', number: 128, openedAt: '' }],
  },
]

function approval(overrides: Partial<Approval> = {}): Approval {
  return {
    id: 7,
    action: 'merge',
    requesterId: bo.id,
    subject: '#5 Invoice pagination',
    ticketId: 5,
    pullRequest: null,
    reason: '',
    status: 'pending',
    decisionReason: null,
    channelId: 'general',
    messageId: 40,
    createdAt: '',
    decidedAt: null,
    ...overrides,
  }
}

function review(overrides: Partial<Review> = {}): Review {
  return {
    id: 1,
    round: 1,
    rounds: 1,
    handoff: 'ready',
    roundLimit: 3,
    ticketId: 5,
    reviewerId: cy.id,
    status: 'approved',
    decidedBy: cy.id,
    comments: '',
    merge: 'waiting',
    approvalId: 7,
    mergedRepoIds: [],
    mergeError: null,
    messageId: 30,
    requestedAt: '',
    decidedAt: null,
    ...overrides,
  }
}

function data(overrides: Partial<ChatData> = {}): ChatData {
  return {
    employees: [ada, bo, cy],
    board,
    code,
    repos: [web],
    approvals: new Map([[40, approval()]]),
    reviews: [review()],
    answererId: ada.id,
    ...overrides,
  }
}

describe('role tags', () => {
  it('reads BOSS for the boss, the title for an Employee, and adds INTAKE for the intake holder', () => {
    const people = [ada, bo]
    expect(roleTag(BOSS, people)).toBe('BOSS')
    expect(roleTag(ada.id, people)).toBe('PM · INTAKE')
    expect(roleTag(bo.id, people)).toBe('TECH LEAD')
    expect(roleTag(COMPANY_AUTHOR, people)).toBe('SYSTEM')
    expect(roleTag('gone', people)).toBe('')
  })
})

describe('day dividers', () => {
  const now = new Date('2026-09-17T15:00:00')

  it('puts a divider before the first message of each day', () => {
    const items = withDayDividers(
      [
        message(1, 'a', { createdAt: '2026-09-15T10:00:00' }),
        message(2, 'b', { createdAt: '2026-09-16T10:00:00' }),
        message(3, 'c', { createdAt: '2026-09-17T09:00:00' }),
        message(4, 'd', { createdAt: '2026-09-17T09:30:00' }),
      ],
      now,
    )
    expect(items.map((i) => (i.kind === 'day' ? i.label : i.message.id))).toEqual([
      expect.stringMatching(/Sep/),
      1,
      'Yesterday',
      2,
      'Today',
      3,
      4,
    ])
  })

  it('formats times as 24-hour HH:MM', () => {
    expect(formatTime('2026-09-17T09:05:00')).toBe('09:05')
    expect(formatTime('2026-09-17T21:40:00')).toBe('21:40')
  })
})

describe('jumping to a message the list may not hold (T44)', () => {
  it('reads the usual page while nothing is being jumped to', () => {
    expect(readLimitFor(null)).toBe(DEFAULT_READ_LIMIT)
  })

  it('reads everything the engine allows while a jump is held, so a narrower page cannot lose it', () => {
    expect(readLimitFor(7)).toBe(MAX_READ_LIMIT)
    expect(readLimitFor(41)).toBe(MAX_READ_LIMIT)
  })
})

describe('channel header', () => {
  const channels: Channel[] = [
    { id: 'general', kind: 'channel', name: 'general', members: [], topic: '' },
    { id: 'tech', kind: 'channel', name: 'tech', members: [], topic: '' },
    { id: 'epic-10-invoices', kind: 'channel', name: 'epic-10-invoices', members: [ada.id, bo.id], topic: '' },
  ]

  it('shows #general to everyone, with the wake rule as its topic', () => {
    const header = channelHeader('general', channels, data())
    expect(header).toEqual({
      title: '# general',
      members: 'Boss + 3 Employees',
      memberIds: [BOSS, ada.id, bo.id, cy.id],
      topic: 'Company-wide. One teammate answers; @mention to ask someone specific.',
    })
  })

  it('names the answerer in other named channels', () => {
    expect(channelHeader('tech', channels, data()).topic).toBe(
      'Everyone reads it. A message from you that mentions nobody goes to Ada.',
    )
    expect(channelHeader('tech', channels, data({ answererId: null })).topic).toBe(
      'Everyone reads it. Mention someone to wake them.',
    )
  })

  it('lists an epic channel’s members and uses the epic description as its topic', () => {
    expect(channelHeader('epic-10-invoices', channels, data())).toEqual({
      title: '# epic-10-invoices',
      members: 'Boss + 2 Employees',
      memberIds: [BOSS, ada.id, bo.id],
      topic: 'Usage and invoices.',
    })
  })

  it('shows the boss’s own topic in place of anything the view would say (T44)', () => {
    const written: Channel[] = [
      { id: 'general', kind: 'channel', name: 'general', members: [], topic: 'Goals, and nothing else.' },
      { id: 'tech', kind: 'channel', name: 'tech', members: [], topic: '' },
      { id: 'epic-10-invoices', kind: 'channel', name: 'epic-10-invoices', members: [ada.id], topic: 'Ship it.' },
    ]

    expect(channelHeader('general', written, data()).topic).toBe('Goals, and nothing else.')
    expect(channelHeader('epic-10-invoices', written, data()).topic).toBe('Ship it.')
    expect(channelHeader('tech', written, data()).topic).toBe(
      'Everyone reads it. A message from you that mentions nobody goes to Ada.',
    )
  })

  it('counts a channel’s own members in the badge and the stack (T44)', () => {
    const narrowed: Channel[] = [{ id: 'tech', kind: 'channel', name: 'tech', members: [bo.id], topic: '' }]

    expect(channelHeader('tech', narrowed, data())).toMatchObject({
      members: 'Boss + 1 Employee',
      memberIds: [BOSS, bo.id],
    })
  })

  it('names the other side of a DM', () => {
    const header = channelHeader(dmChannelId(BOSS, bo.id), channels, data())
    expect(header).toEqual({
      title: 'Bo',
      members: 'Direct message',
      memberIds: [BOSS, bo.id],
      topic: 'Tech Lead · every message here wakes Bo.',
    })
    expect(channelHeader(dmChannelId(ada.id, bo.id), channels, data()).title).toBe('Ada ↔ Bo')
  })
})

describe('composer hint', () => {
  it('says who picks up a goal, and that #general wakes everyone', () => {
    expect(composerHint('tech', data())).toBe('Ada will answer')
    expect(composerHint('general', data())).toBe('Everyone reads it · Ada will answer')
    expect(composerHint('general', data({ answererId: null }))).toBe('Everyone reads it')
    expect(composerHint(dmChannelId(BOSS, bo.id), data())).toBe('Bo will read it')
    expect(composerHint('tech', data({ answererId: null }))).toBe('Mention someone to wake them')
  })
})

describe('the read-only note', () => {
  it('names who to DM to take part: one Employee in the drawer, both of a pair in chat', () => {
    expect(readOnlyNote(['Nova'])).toBe('Their conversation. DM Nova to join in.')
    expect(readOnlyNote(['Nova', 'Vega'])).toBe('Their conversation. DM Nova or Vega to join in.')
  })
})

describe('message attachments', () => {
  it('shows a target card when a message references tickets of one target', () => {
    const card = cardOf(message(20, 'Created #1, #2, #3 and #4.'), data())
    expect(card).toEqual({
      kind: 'target',
      targetId: 1,
      title: 'Billing',
      due: 'Fri',
      epics: [
        { id: 10, title: 'Invoices', who: ['Bo', 'Cy'], tickets: 2 },
        { id: 11, title: 'Plans', who: ['Bo'], tickets: 2 },
      ],
      foot: '3 tickets in Todo · WIP limit 3 on Doing',
    })
  })

  it('shows the target card under the message that announces the target, naming no ticket (T151)', () => {
    const said = message(24, 'Got it. I turned that into one target with two epics and six tickets.', { targetId: 1 })
    expect(cardOf(said, data())).toMatchObject({ kind: 'target', targetId: 1, title: 'Billing', due: 'Fri' })
    expect(cardOf({ ...said, targetId: 9 }, data())).toBeNull()
  })

  it('says when a target is due from the day it was announced', () => {
    const thursday = new Date(2026, 8, 17, 9, 12)
    expect(dueLabel('2026-09-17', thursday)).toBe('today')
    expect(dueLabel('2026-09-18', thursday)).toBe('Fri')
    expect(dueLabel('2026-09-23', thursday)).toBe('Wed')
    expect(dueLabel('2026-09-24', thursday)).toBe('Sep 24')
    expect(dueLabel('2026-09-10', thursday)).toBe('Sep 10')
    expect(dueLabel('2027-01-05', thursday)).toBe('Jan 5, 2027')
  })

  it('shows chips for the worktree, repo and stack of the one ticket a message references', () => {
    expect(cardOf(message(21, 'Claimed #4, worktree is up.'), data())).toEqual({
      kind: 'chips',
      chips: [
        { icon: 'branch', label: 'wt/#4' },
        { icon: 'repo', label: 'web-app' },
        { icon: 'stack', label: 'pnpm + vitest' },
      ],
    })
    expect(cardOf(message(22, 'Looking at #1.'), data())).toBeNull()
    expect(cardOf(message(23, 'Nothing here.'), data())).toBeNull()
  })

  it('shows a PR card with a waiting badge on a pending merge approval', () => {
    const root = message(40, '@boss Approval needed: may I merge? #5 Invoice pagination', { replyCount: 2 })
    expect(cardOf(root, data())).toEqual({
      kind: 'pr',
      waiting: true,
      ticketId: 5,
      pullRequests: [{ repo: 'web-app', number: 128, url: 'https://gh/pull/128', title: 'Invoice pagination' }],
      reviewer: 'Cy · QA approved',
      replies: 2,
      handoff: 'ready',
      round: 'Round 1',
    })
  })

  it('shows the PR card for a merge approval by the ticket it names, whatever its subject says', () => {
    const root = message(40, '@boss Approval needed: may I merge? PR 128 on web-app')
    const asked = approval({ subject: 'PR 128 on web-app', ticketId: 5 })
    expect(cardOf(root, data({ approvals: new Map([[40, asked]]) }))).toMatchObject({
      kind: 'pr',
      ticketId: 5,
      pullRequests: [{ repo: 'web-app', number: 128 }],
    })
    const unnamed = approval({ subject: '#5 Invoice pagination', ticketId: null })
    expect(cardOf(root, data({ approvals: new Map([[40, unnamed]]) }))).toMatchObject({
      kind: 'approval',
      title: 'Merge · #5 Invoice pagination',
    })
  })

  it('shows only the PR a merge approval names', () => {
    const two: TicketCode[] = [
      {
        ticketId: 5,
        worktrees: [],
        pullRequests: [
          { ticketId: 5, repoId: 'r-web', url: 'https://gh/pull/128', number: 128, openedAt: '' },
          { ticketId: 5, repoId: 'r-api', url: 'https://gh/api/pull/7', number: 7, openedAt: '' },
        ],
      },
    ]
    const api = { ...web, id: 'r-api', name: 'api' }
    const named = approval({ pullRequest: { repoId: 'r-api', number: 7 } })
    const facts = data({ code: two, repos: [web, api], approvals: new Map([[40, named]]) })

    expect(pullRequestsOfApproval(named, facts)).toEqual([two[0]!.pullRequests[1]])
    expect(cardOf(message(40, 'x'), facts)).toMatchObject({ pullRequests: [{ repo: 'api', number: 7 }] })
    expect(pullRequestsOfApproval(approval(), facts)).toHaveLength(2)
  })

  it('shows a PR card on a review round message, without a waiting badge', () => {
    const round = message(30, 'Review requested from Cy for #5 Invoice pagination', {
      authorId: COMPANY_AUTHOR,
      channelId: 'prs',
    })
    expect(cardOf(round, data())).toMatchObject({ kind: 'pr', waiting: false, ticketId: 5 })
    expect(cardOf(round, data({ reviews: [review({ status: 'pending', decidedBy: null })] }))).toMatchObject({
      reviewer: 'Waiting for Cy',
    })
    expect(cardOf(round, data({ reviews: [review({ status: 'changes_requested' })] }))).toMatchObject({
      reviewer: 'Cy · QA requested changes',
    })
  })

  it('shows the generic approval card on a kind that has no PR, pending and decided', () => {
    const root = message(41, 'Billing is short a reviewer, so I’d like a QA engineer.', { replyCount: 1 })
    const hire = approval({
      id: 8,
      action: 'hire',
      subject: 'a new QA named Iris',
      ticketId: null,
      reason: 'Nobody can review the invoices epic.',
      messageId: 41,
    })
    expect(cardOf(root, data({ approvals: new Map([[41, hire]]) }))).toEqual({
      kind: 'approval',
      approvalId: 8,
      action: 'hire',
      status: 'pending',
      waiting: true,
      title: 'Hire · a new QA named Iris',
      reason: 'Nobody can review the invoices epic.',
      facts: [],
      replies: 1,
      reviewTicketId: null,
    })

    const decided = { ...hire, status: 'approved' as const, decidedAt: '2026-09-17T18:02:00', decisionReason: 'Go' }
    expect(cardOf(root, data({ approvals: new Map([[41, decided]]) }))).toMatchObject({
      status: 'approved',
      waiting: false,
      facts: [
        { icon: 'approved', label: 'Approved by you · 18:02' },
        { icon: 'note', label: 'Go' },
      ],
    })

    const sentBack = { ...hire, status: 'rejected' as const, decidedAt: '2026-09-17T18:02:00' }
    expect(cardOf(root, data({ approvals: new Map([[41, sentBack]]) }))).toMatchObject({
      facts: [
        { icon: 'rejected', label: 'Sent back by you · 18:02' },
        { icon: 'note', label: 'No reason given' },
      ],
    })
  })

  it('titles a merge with no PR as the local merge it is (decision 44)', () => {
    const root = message(42, 'The repo has no remote, so I’d merge #5 into main locally.')
    const local = approval({ id: 9, action: 'merge', ticketId: 5, messageId: 42 })
    const noPulls = data({ code: [{ ticketId: 5, worktrees: [], pullRequests: [] }] })

    expect(approvalCard(local, root, noPulls).title).toBe('Merge locally · #5 Invoice pagination')
    expect(approvalDetail(local, noPulls).kindLabel).toBe('Merge locally')
    expect(approvalDetail(local, data()).kindLabel).toBe('Merge')
    // Without a PR the card is the only way to the change, so it carries the ticket's Review (T82).
    expect(approvalCard(local, root, noPulls).reviewTicketId).toBe(5)
  })

  it('puts the ticket’s repos on the card, and the ticket only when the subject does not name it', () => {
    const root = message(42, 'The repo has no remote, so I’d merge #5 into main locally.')
    const local = approval({ id: 9, action: 'merge', ticketId: 5, messageId: 42 })
    expect(approvalCard(local, root, data()).facts).toEqual([{ icon: 'repo', label: 'web-app' }])

    const worded = approval({ id: 9, action: 'other', subject: 'the release window', ticketId: 5, messageId: 42 })
    expect(approvalCard(worded, root, data()).facts).toEqual([
      { icon: 'ticket', label: '#5 Invoice pagination' },
      { icon: 'repo', label: 'web-app' },
    ])
  })
})

describe('approval detail', () => {
  it('opens the card up for the thread panel: who asked, the ticket, the repos', () => {
    const detail = approvalDetail(approval({ reason: 'It is reviewed and green.' }), data())
    expect(detail).toEqual({
      kindLabel: 'Merge',
      title: 'Merge · #5 Invoice pagination',
      reason: 'It is reviewed and green.',
      waiting: true,
      rows: [
        { icon: 'who', label: 'Asked by Bo', meta: 'Tech Lead' },
        { icon: 'ticket', label: 'Ticket · #5 Invoice pagination', meta: 'Review' },
        { icon: 'repo', label: 'Repos · web-app', meta: '1 of 1' },
      ],
    })
  })

  it('names every kind and adds the decision once it is made', () => {
    const hire = approval({ action: 'hire', subject: 'a new QA named Iris', ticketId: null })
    expect(approvalDetail(hire, data())).toMatchObject({
      kindLabel: 'Hire',
      title: 'Hire · a new QA named Iris',
      rows: [{ icon: 'who', label: 'Asked by Bo', meta: 'Tech Lead' }],
    })

    const sentBack = {
      ...hire,
      status: 'rejected' as const,
      decisionReason: 'Not this week',
      decidedAt: '2026-09-17T18:02:00',
    }
    expect(approvalDetail(sentBack, data()).rows).toContainEqual({
      icon: 'rejected',
      label: 'Sent back by you · 18:02',
      meta: '',
    })
    expect(approvalDetail(sentBack, data()).waiting).toBe(false)
  })
})

describe('PR details', () => {
  const details = (overrides: Partial<PullRequestDetails> = {}): PullRequestDetails => ({
    ticketId: 5,
    repoId: 'r-web',
    url: 'u',
    number: 128,
    title: 'Invoice pagination',
    state: 'open',
    head: 'ticket-5-x',
    base: 'main',
    additions: 142,
    deletions: 38,
    changedFiles: 6,
    mergeable: 'mergeable',
    checks: [
      { name: 'build', workflow: 'CI', state: 'passing', durationMs: 28_000 },
      { name: 'tests', workflow: 'CI', state: 'passing', durationMs: 64_000 },
      { name: 'deploy', workflow: 'CD', state: 'skipped', durationMs: null },
    ],
    ...overrides,
  })

  it('sums lines and summarises checks across a ticket’s PRs', () => {
    expect(diffLabel([details(), details({ additions: 8, deletions: 2 })])).toBe('+150 −40')
    expect(checksSummary([details()])).toEqual({ state: 'passing', label: '2/2 checks green' })
    expect(
      checksSummary([details({ checks: [{ name: 'a', workflow: '', state: 'failing', durationMs: 1 }] })]),
    ).toEqual({ state: 'failing', label: '1/1 checks failing' })
    expect(
      checksSummary([details({ checks: [{ name: 'a', workflow: '', state: 'pending', durationMs: null }] })]),
    ).toEqual({ state: 'pending', label: '0/1 checks green' })
    expect(checksSummary([details({ checks: [] })])).toEqual({ state: 'none', label: 'No checks' })
  })

  it('formats check durations like the design', () => {
    expect(formatDuration(6_000)).toBe('6s')
    expect(formatDuration(28_400)).toBe('28s')
    expect(formatDuration(64_000)).toBe('1m 04s')
    expect(formatDuration(3_725_000)).toBe('1h 02m')
    expect(formatDuration(null)).toBe('')
  })

  it('labels the merge state', () => {
    expect(mergeBadge(details())).toEqual({ variant: 'success', label: 'Mergeable' })
    expect(mergeBadge(details({ mergeable: 'conflicting' }))).toEqual({ variant: 'danger', label: 'Conflicts' })
    expect(mergeBadge(details({ mergeable: 'unknown' }))).toEqual({ variant: 'neutral', label: 'Checking' })
    expect(mergeBadge(details({ state: 'merged' }))).toEqual({ variant: 'primary', label: 'Merged' })
    expect(mergeBadge(details({ state: 'closed' }))).toEqual({ variant: 'neutral', label: 'Closed' })
    expect(mergeBadge(details({ checks: [{ name: 'a', workflow: '', state: 'failing', durationMs: 1 }] }))).toEqual({
      variant: 'danger',
      label: 'Checks failing',
    })
  })
})

describe('threads', () => {
  it('titles an approval thread and says who opened it where', () => {
    const root = message(40, 'x', { authorId: bo.id })
    expect(threadTitle(root, approval(), data())).toEqual({
      title: 'Approval thread',
      origin: '#general · opened by Bo',
    })
    expect(threadTitle(message(9, 'x', { authorId: BOSS, channelId: 'tech' }), undefined, data())).toEqual({
      title: 'Thread',
      origin: '#tech · opened by you',
    })
    expect(
      threadTitle(message(9, 'x', { authorId: bo.id, channelId: dmChannelId(BOSS, bo.id) }), undefined, data()).origin,
    ).toBe('Bo · opened by Bo')
  })

  it('finds the ticket an approval is about', () => {
    expect(ticketOfApproval(approval())).toBe(5)
    expect(ticketOfApproval(approval({ subject: 'PR 7 on api', ticketId: 5 }))).toBe(5)
    expect(ticketOfApproval(approval({ subject: '#5 Invoice pagination', ticketId: null }))).toBeNull()
  })
})

describe('The channel the view shows (T112)', () => {
  const channels: Channel[] = [
    { id: 'general', kind: 'channel', name: 'general', members: [], topic: '' },
    { id: 'epic-4-checkout', kind: 'channel', name: 'epic-4-checkout', members: [], topic: '' },
  ]

  it('is the one the sidebar picked, while it is there', () => {
    expect(visibleChannel('epic-4-checkout', channels)).toBe('epic-4-checkout')
  })

  it('lands on #general once that channel is deleted', () => {
    expect(visibleChannel('epic-4-checkout', channels.slice(0, 1))).toBe('general')
  })

  it('waits for the channels to load before it moves anyone', () => {
    expect(visibleChannel('epic-4-checkout', [])).toBe('epic-4-checkout')
  })

  it('leaves a DM alone: one opens before its first message is stored', () => {
    expect(visibleChannel(dmChannelId(BOSS, 'e-ada'), channels)).toBe(dmChannelId(BOSS, 'e-ada'))
  })
})

describe('the daily digest card (T172)', () => {
  const digest: DailyDigest = {
    day: '2026-09-22',
    since: '2026-09-21T18:00:00',
    until: '2026-09-22T18:00:00',
    shipped: [{ ticketId: 138, title: 'Invoice pagination', where: 'billing-api #128', url: 'u', who: 'Orion' }],
    inReview: [{ ticketId: 142, title: 'Usage chart', where: '', readyForYou: true }],
    blocked: [],
    waiting: [{ id: 'm147', ticketId: 147, text: 'Approve', kind: 'Merge', channelId: 'general', threadId: 147 }],
    usage: [{ id: 'claude', name: 'Claude', percent: 68, window: '5h', resets: '21:00', problem: '' }],
    tomorrow: [{ ticketId: 148, title: 'Invoice email template', who: 'Vega' }],
    footer: 'Posted by TinyCorp · no usage spent · every weekday at 18:00',
  }

  it('is the whole message: no ticket reference in the text can put another card under it', () => {
    const card = cardOf(message(20, 'TC-1 shipped', { kind: 'digest', digest }), data({ companyKey: 'TC' }))

    expect(card?.kind).toBe('digest')
  })

  it('leaves out a section with nothing in it, and writes every ticket id with the Company key', () => {
    const card = cardOf(message(20, '', { kind: 'digest', digest }), data({ companyKey: 'TC' }))
    if (card?.kind !== 'digest') throw new Error('Expected the digest card')

    expect(card.left.map((section) => section.id)).toEqual(['shipped', 'inReview'])
    expect(card.right.map((section) => section.id)).toEqual(['waiting', 'tomorrow'])
    expect(card.left[0]!.rows[0]!.code).toBe('TC-138')
    expect(card.left[1]!.rows[0]!.ready).toBe(true)
    expect(card.right[1]!.rows[0]!.meta).toBe('Ready · Vega')
    expect(card.title).toBe('Daily digest · Tue 22 Sep · 18:00')
    expect(card.since).toBe('Since yesterday 18:00')
    expect(card.quiet).toBeNull()
  })

  it('says one line and draws no section on a day with nothing in it', () => {
    const quiet = { ...digest, shipped: [], inReview: [], waiting: [], tomorrow: [] }
    const card = cardOf(message(20, '', { kind: 'digest', digest: quiet }), data({ companyKey: 'TC' }))
    if (card?.kind !== 'digest') throw new Error('Expected the digest card')

    expect(card.quiet).toBe(QUIET_DAY)
    expect([...card.left, ...card.right]).toEqual([])
    // Usage is still read: a quiet day still spent whatever the team spent.
    expect(card.usage).toHaveLength(1)
  })
})
