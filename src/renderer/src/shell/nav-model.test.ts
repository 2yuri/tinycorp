import { describe, expect, it } from 'vitest'
import type { AgentPair } from '../../../shared/agent-pairs'
import type { BoardSnapshot, Ticket } from '../../../shared/domain/board'
import { BOSS, dmChannelId } from '../../../shared/domain/chat'
import type { Employee, RoleTemplate } from '../../../shared/domain/staff'
import { EMPTY_STACK, type Repo } from '../../../shared/repos/repo'
import { sameRoute, windowTitle } from '../chrome'
import { companyPlan, EMPTY_SHELL_DATA, type NavChild, navTree, type ShellData } from './nav-model'

const employee = (id: string, name: string, roleId: string, sprite = 0) => ({ id, name, roleId, sprite }) as Employee
const role = (id: string, name: string) => ({ id, name }) as RoleTemplate
const pair = (channelId: string, members: string[], lastAt: string): AgentPair => ({
  channelId,
  members,
  lastAt,
  unread: 0,
})
const ticket = (id: number, fields: Partial<Ticket> = {}) =>
  ({ id, epicId: null, column: 'todo', blocked: false, ...fields }) as Ticket

function data(fields: Partial<ShellData> = {}): ShellData {
  return { ...EMPTY_SHELL_DATA, ...fields }
}

const labels = (children: NavChild[]) =>
  children.map((c) =>
    c.kind === 'section' ? `[${c.label}]` : `${c.label}${c.count === undefined ? '' : ` ${c.count}`}`,
  )

describe('the sidebar tree', () => {
  it('lists Office, Chat, Board, Employees, Repositories, Files, Memory and Activity in order', () => {
    expect(navTree(data()).map((e) => e.label)).toEqual([
      'Office',
      'Chat',
      'Board',
      'Employees',
      'Repositories',
      'Files',
      'Memory',
      'Activity',
    ])
  })

  it('shows no counts and no Office regions for an empty Company', () => {
    const tree = navTree(data())
    expect(tree.map((e) => e.count)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ])
    expect(tree[0]!.children).toEqual([])
  })

  it('lists channels, then a DM per Employee, and draws a count on none of them', () => {
    const ada = employee('e1', 'Ada', 'backend', 2)
    const tree = navTree(
      data({
        employees: [ada],
        channels: [
          { id: 'general', kind: 'channel', name: 'general', members: [], topic: '' },
          { id: 'prs', kind: 'channel', name: 'prs', members: [], topic: '' },
          { id: dmChannelId(BOSS, 'e1'), kind: 'dm', name: '', members: [BOSS, 'e1'], topic: '' },
        ],
        unread: { prs: 3, [dmChannelId(BOSS, 'e1')]: 2 },
      }),
    )
    const chat = tree[1]!

    // Messages the boss has not read are not a queue: bold says they are there, and nothing
    // counts them on the line any more (T251).
    expect(labels(chat.children)).toEqual(['Inbox', 'general', 'prs', '[Direct messages]', 'Ada'])
    expect(chat.children[4]).toMatchObject({
      // The DM row carries the Employee, so the sidebar draws their character on their accent.
      marker: { kind: 'avatar', name: 'Ada', employeeId: 'e1', sprite: 2 },
      route: { view: 'chat', channelId: dmChannelId(BOSS, 'e1') },
    })
  })

  // T251: bold means unread, the red pill means it needs you, and they are different questions.
  it('reads unread off the read mark, and the pill off the Inbox rows', () => {
    const ada = employee('e1', 'Ada', 'backend', 2)
    const dm = dmChannelId(BOSS, 'e1')
    const tree = navTree(
      data({
        employees: [ada],
        channels: [
          { id: 'general', kind: 'channel', name: 'general', members: [], topic: '' },
          { id: 'prs', kind: 'channel', name: 'prs', members: [], topic: '' },
          { id: dm, kind: 'dm', name: '', members: [BOSS, 'e1'], topic: '' },
        ],
        // `#prs` is noisy and asks the boss nothing; `#general` holds two rows addressed to them.
        unread: { prs: 3, general: 2, [dm]: 1 },
        needsYou: { general: 2, [dm]: 1 },
        bossInboxUnread: 3,
      }),
      'chat',
    )
    const rows = tree[1]!.children.filter((child) => child.kind === 'item')

    expect(rows.map((row) => [row.label, row.unread === true, row.count ?? 0])).toEqual([
      ['Inbox', false, 3],
      ['general', true, 2],
      ['prs', true, 0],
      ['Ada', true, 1],
    ])
    expect(rows.filter((row) => row.badge).map((row) => row.label)).toEqual(['Inbox', 'general', 'Ada'])
  })

  it('adds up: the Chat row, the Inbox row and the lines under them say the same number', () => {
    const ada = employee('e1', 'Ada', 'backend')
    const dm = dmChannelId(BOSS, 'e1')
    const fields = {
      employees: [ada],
      channels: [
        { id: 'general', kind: 'channel' as const, name: 'general', members: [], topic: '' },
        { id: 'tech', kind: 'channel' as const, name: 'tech', members: [], topic: '' },
        { id: dm, kind: 'dm' as const, name: '', members: [BOSS, 'e1'], topic: '' },
      ],
      needsYou: { general: 2, tech: 1, [dm]: 1 },
      bossInboxUnread: 4,
    }
    const open = navTree(data(fields), 'chat')[1]!
    const lines = open.children.filter((child) => child.kind === 'item' && child.key !== 'inbox')

    expect(open.children[0]).toMatchObject({ key: 'inbox', count: 4, badge: true })
    expect(lines.reduce((total, line) => total + (line.kind === 'item' ? (line.count ?? 0) : 0), 0)).toBe(4)
    // Its lines are on screen, so the Chat row says nothing; away from Chat it carries the sum.
    expect(open).not.toHaveProperty('count')
    expect(navTree(data(fields), 'office')[1]).toMatchObject({ count: 4, badge: true })
  })

  it('marks the channels and DMs where the boss left a message unsent (TI-1)', () => {
    const ada = employee('e1', 'Ada', 'backend')
    const tree = navTree(
      data({
        employees: [ada],
        channels: [
          { id: 'general', kind: 'channel', name: 'general', members: [], topic: '' },
          { id: 'tech', kind: 'channel', name: 'tech', members: [], topic: '' },
        ],
        drafted: ['tech', dmChannelId(BOSS, 'e1')],
      }),
    )
    const rows = tree[1]!.children.filter((child) => child.kind === 'item')

    expect(rows.filter((row) => row.drafted).map((row) => row.label)).toEqual(['tech', 'Ada'])
  })

  // T113: what two Employees say to each other is theirs, so the rail has no Between agents section
  // however many pairs the engine hands it — only the boss's own conversations.
  it('lists no conversation between two Employees, only the boss’s own', () => {
    const ada = employee('e1', 'Ada', 'backend')
    const bo = employee('e2', 'Bo', 'frontend')
    const between = dmChannelId('e1', 'e2')
    const tree = navTree(
      data({
        employees: [ada, bo],
        channels: [{ id: between, kind: 'dm', name: '', members: ['e1', 'e2'], topic: '' }],
        agentPairs: [pair(between, ['e1', 'e2'], '2026-09-22T09:47:00Z')],
      }),
    )

    expect(labels(tree[1]!.children)).toEqual(['Inbox', '[Direct messages]', 'Ada', 'Bo'])
  })

  it('puts the boss’s Inbox above the channels, with its unread count as a badge', () => {
    const tree = navTree(data({ bossInboxUnread: 5 }))

    expect(tree[1]!.children[0]).toEqual({
      kind: 'item',
      key: 'inbox',
      label: 'Inbox',
      marker: { kind: 'icon', icon: 'inbox' },
      count: 5,
      badge: true,
      route: { view: 'chat', inbox: true },
    })
  })

  it('keeps Board, Employees and Repositories on their soft totals: those count things', () => {
    const tree = navTree(
      data({
        board: { columns: [], targets: [], epics: [], tickets: [ticket(1)] },
        employees: [employee('e1', 'Ada', 'backend')],
        repos: [{ id: 'r1', name: 'web-app', stack: EMPTY_STACK } as Repo],
        bossInboxUnread: 3,
      }),
    )

    expect(tree.filter((e) => e.badge).map((e) => e.view)).toEqual(['chat'])
    expect(tree.map((e) => [e.view, e.count])).toContainEqual(['board', 1])
  })

  it('offers Delete channel… only on a channel of the boss’s own making (T112)', () => {
    const ada = employee('e1', 'Ada', 'backend')
    const chat = navTree(
      data({
        employees: [ada],
        channels: [
          { id: 'general', kind: 'channel', name: 'general', members: [], topic: '' },
          { id: 'tech', kind: 'channel', name: 'tech', members: [], topic: '' },
          { id: 'prs', kind: 'channel', name: 'prs', members: [], topic: '' },
          { id: 'epic-4-checkout', kind: 'channel', name: 'epic-4-checkout', members: [], topic: '' },
          { id: dmChannelId(BOSS, 'e1'), kind: 'dm', name: '', members: [BOSS, 'e1'], topic: '' },
        ],
      }),
    )[1]!

    const removable = chat.children.filter((c) => c.kind === 'item' && c.remove !== undefined)
    expect(removable).toEqual([
      expect.objectContaining({
        key: 'channel:epic-4-checkout',
        remove: { label: 'Delete #epic-4-checkout', channelId: 'epic-4-checkout' },
      }),
    ])
  })

  it('leaves the Inbox count off when nothing waits', () => {
    // Off means the key is not there: a row carrying `count: undefined` is a zero the design
    // does not draw, and the sidebar would have to know the difference (T191).
    expect(navTree(data()).find((e) => e.view === 'chat')!.children[0]).not.toHaveProperty('count')
  })

  it('counts tickets and lists epics with their tickets, then the Views group', () => {
    const board: BoardSnapshot = {
      columns: [],
      targets: [],
      epics: [
        { id: 1, targetId: null, title: 'Billing', description: '', color: 'indigo' },
        { id: 2, targetId: null, title: 'Onboarding', description: '', color: 'indigo' },
      ],
      tickets: [ticket(10, { epicId: 1 }), ticket(11, { epicId: 1, blocked: true }), ticket(12, { column: 'done' })],
    }
    const tree = navTree(
      data({
        board,
        pendingApprovals: 2,
        code: [
          {
            ticketId: 11,
            worktrees: [],
            pullRequests: [{ ticketId: 11, repoId: 'r', url: 'u', number: 1, openedAt: '' }],
          },
          {
            ticketId: 12,
            worktrees: [],
            pullRequests: [{ ticketId: 12, repoId: 'r', url: 'u', number: 2, openedAt: '' }],
          },
        ],
      }),
    )
    const boardEntry = tree[2]!

    expect(boardEntry.count).toBe(3)
    expect(labels(boardEntry.children)).toEqual([
      'Billing 2',
      'Onboarding 0',
      '[Views]',
      'My approvals 2',
      'Blocked 1',
      'Open PRs 1',
    ])
    expect(boardEntry.children[0]).toMatchObject({ route: { view: 'board', epicId: 1 } })
    expect(boardEntry.children[4]).toMatchObject({ route: { view: 'board', filter: 'blocked' } })
  })

  it('counts Employees and lists every catalog role with its headcount', () => {
    const tree = navTree(
      data({
        roles: [role('backend', 'Backend'), role('hr', 'HR')],
        employees: [employee('e1', 'Ada', 'backend'), employee('e2', 'Juno', 'backend')],
      }),
    )

    expect(tree[3]!.count).toBe(2)
    expect(labels(tree[3]!.children)).toEqual(['Backend 2', 'HR 0'])
  })

  it('lets every role be edited from its row', () => {
    const tree = navTree(data({ roles: [role('hr', 'HR')] }))

    expect(tree[3]!.children).toEqual([
      expect.objectContaining({
        route: { view: 'employees', roleId: 'hr' },
        edit: { label: 'Edit role HR', route: { view: 'employees', roleId: 'hr', editRole: 'hr' } },
      }),
    ])
  })

  it('counts and lists repositories', () => {
    const checked = { ...EMPTY_STACK, test: 't' }
    const repo: Repo = { id: 'r1', name: 'web-app', path: '/w', brief: '', rung: 'merge', stack: checked, addedAt: '' }
    const infra: Repo = {
      id: 'r2',
      name: 'infra',
      path: '/i',
      brief: '',
      rung: 'merge',
      stack: EMPTY_STACK,
      addedAt: '',
    }
    const tree = navTree(data({ repos: [repo, infra] }))

    expect(tree[4]!.count).toBe(2)
    expect(tree[4]!.children).toEqual([
      expect.objectContaining({
        label: 'web-app',
        marker: { kind: 'icon', icon: 'repo' },
        route: { view: 'repositories', repoId: 'r1' },
      }),
      expect.objectContaining({ label: 'infra', hint: 'No checks yet', route: { view: 'repositories', repoId: 'r2' } }),
    ])
    expect(tree[4]!.children[0]).not.toHaveProperty('hint')
    expect(tree[4]!.children.some((child) => 'warning' in child)).toBe(false)
  })
})

describe('the Company header', () => {
  it('says how many Employees and the autonomy level', () => {
    expect(companyPlan(data({ employees: [employee('e1', 'Ada', 'x')], autonomy: 'autonomous' }))).toBe(
      '1 Employee · Autonomous',
    )
    expect(companyPlan(data())).toBe('0 Employees · Managed')
  })
})

describe('routes', () => {
  it('titles the window with the Company and the view', () => {
    expect(windowTitle('Acme', { view: 'board', epicId: 3 })).toBe('Acme — Board')
    expect(windowTitle('Acme', { view: 'settings' })).toBe('Acme — Company settings')
    expect(windowTitle(null, { view: 'office' })).toBe('tinycorp')
  })

  it('compares routes by view and child', () => {
    expect(sameRoute({ view: 'chat', channelId: 'tech' }, { view: 'chat', channelId: 'tech' })).toBe(true)
    expect(sameRoute({ view: 'chat', channelId: 'tech' }, { view: 'chat' })).toBe(false)
    expect(sameRoute({ view: 'board' }, { view: 'chat' })).toBe(false)
  })
})
