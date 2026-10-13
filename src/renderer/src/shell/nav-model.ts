import type { AgentPair } from '../../../shared/agent-pairs'
import type { AutonomyLevel } from '../../../shared/approvals'
import { AUTONOMY_LABEL } from '../../../shared/approvals'
import { canDeleteChannel, deleteChannelAction } from '../../../shared/channel-removal'
import type { TicketCode } from '../../../shared/code'
import type { BoardSnapshot } from '../../../shared/domain/board'
import { BOSS, type Channel, dmChannelId } from '../../../shared/domain/chat'
import type { Employee, RoleTemplate } from '../../../shared/domain/staff'
import { hasChecks, type Repo } from '../../../shared/repos/repo'
import { type Route, VIEW_LABEL, VIEWS, type ViewId } from '../chrome'

/** What the shell reads from the engine for the current Company. */
export interface ShellData {
  employees: Employee[]
  roles: RoleTemplate[]
  channels: Channel[]
  /** Every DM two Employees hold with each other, newest first (T77). */
  agentPairs: AgentPair[]
  /** The boss's unread messages by channel id. */
  unread: Record<string, number>
  /**
   * How many unread Inbox rows each conversation holds, by channel id (T251). It is the Inbox's own
   * count cut by channel, so the rail, the Inbox row and the lines under Chat always add up.
   */
  needsYou: Record<string, number>
  /** The channels and DMs where the boss left a message unsent (TI-1). */
  drafted: string[]
  /** How many Inbox rows the boss has not read (decision 43). */
  bossInboxUnread: number
  board: BoardSnapshot | null
  repos: Repo[]
  code: TicketCode[]
  pendingApprovals: number
  autonomy: AutonomyLevel
  /** How many live pages the Company memory holds, for the `Memory · 42` row (T175). */
  memoryPages: number
}

export const EMPTY_SHELL_DATA: ShellData = {
  employees: [],
  roles: [],
  channels: [],
  agentPairs: [],
  unread: {},
  needsYou: {},
  drafted: [],
  bossInboxUnread: 0,
  board: null,
  repos: [],
  code: [],
  pendingApprovals: 0,
  autonomy: 'managed',
  memoryPages: 0,
}

/** An Employee as a marker draws them: their character on their own accent. */
export interface MarkerFace {
  name: string
  employeeId: string
  sprite: number
}

/** How a child row is marked on its left. */
export type ChildMarker =
  | { kind: 'hash' }
  | { kind: 'dot' }
  | ({ kind: 'avatar' } & MarkerFace)
  /** Two overlapping faces: the pair a Between agents row stands for. */
  | { kind: 'pair'; faces: [MarkerFace, MarkerFace] }
  | { kind: 'icon'; icon: 'inbox' | 'blocked' | 'pull-request' | 'repo' }

export type NavChild =
  | { kind: 'section'; key: string; label: string }
  | {
      kind: 'item'
      key: string
      label: string
      marker: ChildMarker
      count?: number
      /** Draws the count as the design's filled pill, for a count that asks for the boss. */
      badge?: true
      /** `09:47` at the right of the row: when the conversation last moved. */
      time?: string
      /** Something landed since the boss last looked, so the row reads in `--foreground`. */
      unread?: true
      /** The boss left a message unsent here, so the row carries the draft mark (TI-1). */
      drafted?: true
      /** A warning icon on the right, with its explanation. */
      warning?: string
      /** A soft info icon on the right, with its explanation; nothing is wrong. */
      hint?: string
      route: Route
      /** A secondary action on the row, shown on hover (e.g. edit a role template). */
      edit?: { label: string; route: Route }
      /** A destructive action on the row, shown on hover: deleting the channel it stands for (T112). */
      remove?: { label: string; channelId: string }
    }

export interface NavEntry {
  view: ViewId
  label: string
  count?: number
  /** Draws the count as the Needs You pill rather than a soft total (T251). */
  badge?: true
  children: NavChild[]
}

/**
 * The sidebar tree. Every count and child comes from engine data; Settings is drawn apart.
 *
 * `openView` is the view whose children the drawer is showing, or null when none are. Only Chat
 * reads it: with its lines on screen each of them carries its own Needs You pill and the row above
 * them says nothing, and with them away the Chat row carries the whole Inbox count, so the boss in
 * the Office is not left reading the rail for it (T251).
 */
export function navTree(data: ShellData, openView: ViewId | null = null): NavEntry[] {
  const tickets = data.board?.tickets ?? []
  const entries: Record<ViewId, NavEntry> = {
    // The engine has no office regions yet, so Office has no children.
    office: entry('office', {}, []),
    chat: entry('chat', openView === 'chat' ? {} : needsYouBadge(data.bossInboxUnread), chatChildren(data)),
    board: entry('board', positive(tickets.length), boardChildren(data)),
    employees: entry('employees', positive(data.employees.length), employeeChildren(data)),
    repositories: entry('repositories', positive(data.repos.length), repoChildren(data)),
    // The places the Files view opens come from the engine, not the sidebar: it has no children.
    files: entry('files', {}, []),
    // Memory's own screen holds its filters; the row only carries the count (frame `E40vSb`).
    memory: entry('memory', positive(data.memoryPages), []),
    activity: entry('activity', {}, []),
    settings: entry('settings', {}, []),
    profile: entry('profile', {}, []),
  }
  // Company settings sits below the tree and Your profile in the drawer's boss row.
  return VIEWS.filter((view) => view !== 'settings' && view !== 'profile').map((view) => entries[view])
}

/** `8 Employees · Managed` under the Company name. */
export function companyPlan(data: ShellData): string {
  const n = data.employees.length
  return `${n} ${n === 1 ? 'Employee' : 'Employees'} · ${AUTONOMY_LABEL[data.autonomy]}`
}

function chatChildren(data: ShellData): NavChild[] {
  // Everything addressed to the boss, above the channels (decision 43). It is the sum of the lines
  // under it, because both are the same Inbox rows counted the same way (T251).
  const inbox: NavChild = {
    kind: 'item',
    key: 'inbox',
    label: 'Inbox',
    marker: { kind: 'icon', icon: 'inbox' },
    ...needsYouBadge(data.bossInboxUnread),
    route: { view: 'chat', inbox: true },
  }
  // Delete channel… rides along on a channel of the boss's own making; `#general`, `#tech` and
  // `#prs` are the Company's own and offer nothing (T112).
  const named: NavChild[] = data.channels
    .filter((c) => c.kind === 'channel')
    .map((c) => ({
      kind: 'item',
      key: `channel:${c.id}`,
      label: c.name,
      marker: { kind: 'hash' },
      ...needsYouBadge(data.needsYou[c.id] ?? 0),
      ...unreadMark(data, c.id),
      ...(data.drafted.includes(c.id) && { drafted: true }),
      route: { view: 'chat', channelId: c.id },
      ...(canDeleteChannel(c) && { remove: { label: deleteChannelAction(c.name), channelId: c.id } }),
    }))
  // A DM with every current Employee, so the boss can start one from here (the boss's own only:
  // a conversation between two Employees is not the rail's to list — see below, T113).
  const dms: NavChild[] = data.employees.map((e) => {
    const id = dmChannelId(BOSS, e.id)
    return {
      kind: 'item',
      key: `dm:${e.id}`,
      label: e.name,
      marker: { kind: 'avatar', name: e.name, employeeId: e.id, sprite: e.sprite },
      ...needsYouBadge(data.needsYou[id] ?? 0),
      ...unreadMark(data, id),
      ...(data.drafted.includes(id) && { drafted: true }),
      route: { view: 'chat', channelId: id },
    }
  })
  // The boss's own conversations only. What two Employees say to each other is theirs: the office
  // shows the visit while it happens and the Activity log keeps the record, but the chat rail is
  // not a list of other people's DMs (the boss, T113).
  return [inbox, ...named, ...section('dms', 'Direct messages', dms)]
}

/**
 * Whether anything landed in the conversation since the boss last looked, which is what draws its
 * label bold (T251). Bold means unread; the red pill means it needs you, and they are not the same
 * question: a channel can be noisy with nothing addressed to the boss in it.
 */
function unreadMark(data: ShellData, channelId: string): { unread?: true } {
  return (data.unread[channelId] ?? 0) > 0 ? { unread: true } : {}
}

/** A labelled group of rows, or nothing at all when it has none. */
function section(key: string, label: string, rows: NavChild[]): NavChild[] {
  return rows.length === 0 ? [] : [{ kind: 'section', key, label }, ...rows]
}

function boardChildren(data: ShellData): NavChild[] {
  const tickets = data.board?.tickets ?? []
  const epics: NavChild[] = (data.board?.epics ?? []).map((epic) => ({
    kind: 'item',
    key: `epic:${epic.id}`,
    label: epic.title,
    marker: { kind: 'dot' },
    count: tickets.filter((t) => t.epicId === epic.id).length,
    route: { view: 'board', epicId: epic.id },
  }))
  const open = new Set(tickets.filter((t) => t.column !== 'done').map((t) => t.id))
  // Tickets, as the Board's Open PRs filter shows them.
  const openPrs = data.code.filter((c) => open.has(c.ticketId) && c.pullRequests.length > 0).length
  return [
    ...epics,
    { kind: 'section', key: 'views', label: 'Views' },
    {
      kind: 'item',
      key: 'view:my-approvals',
      label: 'My approvals',
      marker: { kind: 'icon', icon: 'inbox' },
      count: data.pendingApprovals,
      route: { view: 'board', filter: 'my-approvals' },
    },
    {
      kind: 'item',
      key: 'view:blocked',
      label: 'Blocked',
      marker: { kind: 'icon', icon: 'blocked' },
      count: tickets.filter((t) => t.blocked).length,
      route: { view: 'board', filter: 'blocked' },
    },
    {
      kind: 'item',
      key: 'view:open-prs',
      label: 'Open PRs',
      marker: { kind: 'icon', icon: 'pull-request' },
      count: openPrs,
      route: { view: 'board', filter: 'open-prs' },
    },
  ]
}

function employeeChildren(data: ShellData): NavChild[] {
  return data.roles.map((role) => ({
    kind: 'item',
    key: `role:${role.id}`,
    label: role.name,
    marker: { kind: 'dot' },
    count: data.employees.filter((e) => e.roleId === role.id).length,
    route: { view: 'employees', roleId: role.id },
    edit: { label: `Edit role ${role.name}`, route: { view: 'employees', roleId: role.id, editRole: role.id } },
  }))
}

function repoChildren(data: ShellData): NavChild[] {
  return data.repos.map((repo) => ({
    kind: 'item',
    key: `repo:${repo.id}`,
    label: repo.name,
    marker: { kind: 'icon', icon: 'repo' },
    ...(!hasChecks(repo.stack) && { hint: 'No checks yet' }),
    route: { view: 'repositories', repoId: repo.id },
  }))
}

function entry(view: ViewId, count: { count?: number; badge?: true }, children: NavChild[]): NavEntry {
  return { view, label: VIEW_LABEL[view], ...count, children }
}

/** The count a row draws, or no count at all: a zero is a pill the design does not draw. */
function positive(n: number): { count?: number } {
  return n > 0 ? { count: n } : {}
}

/** The red Needs You pill a line carries while something on it waits, or nothing at all (T251). */
function needsYouBadge(n: number): { count?: number; badge?: true } {
  return n > 0 ? { count: n, badge: true } : {}
}
