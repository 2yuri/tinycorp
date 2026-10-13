import type { AgentPair } from '../../../shared/agent-pairs'
import type { Approval, AutonomyLevel } from '../../../shared/approvals'
import type { Boss } from '../../../shared/boss-profile'
import type { CapacityInfo } from '../../../shared/capacity'
import type { McpServerRow } from '../../../shared/catalogue/mcp-servers'
import type { SkillDescribed, SkillRow } from '../../../shared/catalogue/skills'
import type { TicketCode } from '../../../shared/code'
import type { Company } from '../../../shared/company'
import type { BoardSnapshot } from '../../../shared/domain/board'
import type { BossUnread, Channel } from '../../../shared/domain/chat'
import type { Employee, PermissionMode, RoleTemplate } from '../../../shared/domain/staff'
import type { StaffingRequest, TeamLoad } from '../../../shared/hiring'
import type { AnswererSetting } from '../../../shared/inbox/answerer'
import type { BossInboxItem } from '../../../shared/inbox/boss-inbox'
import { emptyCounts, type MemoryCounts } from '../../../shared/memory/company-memory'
import type { DigestSchedule } from '../../../shared/planning/daily-digest'
import type { Plan } from '../../../shared/planning/planning'
import { type CompanyFolderHints, NO_FOLDER_HINTS } from '../../../shared/platform/company-folder'
import type { WindowsMachine } from '../../../shared/platform/windows-machine'
import type { Repo } from '../../../shared/repos/repo'
import type { Review } from '../../../shared/review'
import type { ReviewThread } from '../../../shared/review/review-threads'
import type { SecurityPass } from '../../../shared/review/security'
import { SANDBOX_NOT_FOUND, SANDBOX_SETTINGS_DEFAULT } from '../../../shared/sandbox'
import type { SandboxView } from '../../../shared/sandbox/ipc'
import type { SessionInfo } from '../../../shared/session'
import type { StaleSession } from '../../../shared/spawn-settings'
import type { TestRun } from '../../../shared/testing'
import type { IpcResource } from './use-ipc-resource'

/**
 * Every channel the screens read, declared once.
 *
 * This is the table the renderer used to keep a copy of per screen: fifteen files read
 * `staff.employees()` and sixteen subscribed to `staff.onChanged`, so one hire cost a dozen reads
 * and a dozen renders (T212). A resource here is read once for all of them.
 *
 * **A resource subscribes to its own channel.** Where a value has no event of its own — the repos a
 * hire may be given, say — it says so on the line, and the Company switch is not that event:
 * `useIpcResource` invalidates every channel on a switch, which is what a screen used to get by
 * subscribing to `staff.onChanged` for its repos.
 */

/** Composes several unsubscribes into one. */
const all = (offs: (() => void)[]) => () => {
  for (const off of offs) off()
}

/**
 * The window coming back, as a change event.
 *
 * A checkout changes with nobody in the app — a branch pulled in a terminal, a worktree removed by
 * hand — and the engine has nothing to broadcast about it. The sidebar alone read its repos again on
 * focus before T212; here every screen that draws one does.
 */
const onRefocus = (changed: () => void) => {
  window.addEventListener('focus', changed)
  return () => window.removeEventListener('focus', changed)
}

const employees: IpcResource<Employee[]> = {
  key: 'staff.employees',
  needs: ['staff'],
  empty: [],
  read: (api) => api.staff.employees(),
  subscribe: (api, changed) => api.staff.onChanged(changed),
}

/** Employees who have left, for the Employees screen's Former list. A hire or a firing changes it. */
const formerEmployees: IpcResource<Employee[]> = {
  key: 'hiring.former',
  needs: ['hiring', 'staff'],
  empty: [],
  read: (api) => api.hiring.former(),
  subscribe: (api, changed) => api.staff.onChanged(changed),
}

const roles: IpcResource<RoleTemplate[]> = {
  key: 'staff.roles',
  needs: ['staff'],
  empty: [],
  read: (api) => api.staff.roles(),
  subscribe: (api, changed) => api.staff.onChanged(changed),
}

/** The mode a hire takes when nobody names one; null until the engine has answered (T164). */
const permissionDefault: IpcResource<PermissionMode | null> = {
  key: 'staff.permission-default',
  needs: ['staff'],
  empty: null,
  read: (api) => api.staff.permissionDefault(),
  subscribe: (api, changed) => api.staff.onChanged(changed),
}

/** What the team is carrying, for the Employees screen's hiring advice. Tickets move it too. */
const teamLoad: IpcResource<TeamLoad | null> = {
  key: 'hiring.team-load',
  needs: ['hiring', 'staff', 'board'],
  empty: null,
  read: (api) => api.hiring.teamLoad(),
  subscribe: (api, changed) => all([api.staff.onChanged(changed), api.board.onChanged(changed)]),
}

/** Employees an Employee has asked for; the boss approves one, which is why Approvals move it. */
const staffingRequests: IpcResource<StaffingRequest[]> = {
  key: 'hiring.requests',
  needs: ['hiring', 'staff', 'approvals'],
  empty: [],
  read: (api) => api.hiring.requests(),
  subscribe: (api, changed) => all([api.staff.onChanged(changed), api.approvals.onChanged(changed)]),
}

const board: IpcResource<BoardSnapshot | null> = {
  key: 'board.snapshot',
  needs: ['board'],
  empty: null,
  read: async (api) => ({ ok: true, value: await api.board.snapshot() }),
  subscribe: (api, changed) => api.board.onChanged(changed),
}

const repos: IpcResource<Repo[]> = {
  key: 'repos.list',
  needs: ['repos'],
  empty: [],
  read: (api) => api.repos.list(),
  subscribe: (api, changed) => all([api.repos.onChanged(changed), onRefocus(changed)]),
}

/** Every Approval, whatever its status: the Chat cards read the thread each one is on. */
const approvals: IpcResource<Approval[]> = {
  key: 'approvals.list',
  needs: ['approvals'],
  empty: [],
  read: (api) => api.approvals.list(),
  subscribe: (api, changed) => api.approvals.onChanged(changed),
}

/** The ones still waiting, which is what a count beside a screen's name means. */
const pendingApprovals: IpcResource<Approval[]> = {
  key: 'approvals.pending',
  needs: ['approvals'],
  empty: [],
  read: (api) => api.approvals.list('pending'),
  subscribe: (api, changed) => api.approvals.onChanged(changed),
}

/** The Company's autonomy level; null until it is read, which hides a row rather than guessing. */
const autonomy: IpcResource<AutonomyLevel | null> = {
  key: 'approvals.level',
  needs: ['approvals'],
  empty: null,
  read: (api) => api.approvals.level(),
  subscribe: (api, changed) => api.approvals.onChanged(changed),
}

const code: IpcResource<TicketCode[]> = {
  key: 'code.list',
  needs: ['code'],
  empty: [],
  read: (api) => api.code.list(),
  // A worktree is a folder like any other: the boss may have removed it while the app was behind.
  subscribe: (api, changed) => all([api.code.onChanged(changed), onRefocus(changed)]),
}

const reviews: IpcResource<Review[]> = {
  key: 'reviews.list',
  needs: ['reviews'],
  empty: [],
  read: (api) => api.reviews.list(),
  subscribe: (api, changed) => api.reviews.onChanged(changed),
}

/**
 * Every review thread of every ticket that has a round, flattened, so a `#prs` card can say how
 * many are open (T170). One read per round, and there is one round per ticket in Review.
 */
const reviewThreads: IpcResource<ReviewThread[]> = {
  key: 'reviews.threads',
  needs: ['reviews'],
  empty: [],
  read: async (api) => {
    const rounds = await api.reviews.list()
    if (!rounds.ok) return rounds
    const read = await Promise.all(rounds.value.map((round) => api.reviews.threads(round.ticketId)))
    return { ok: true, value: read.flatMap((result) => (result.ok ? result.value : [])) }
  },
  subscribe: (api, changed) => api.reviews.onChanged(changed),
}

/** The latest security pass of every ticket that has one (T241). */
const securityPasses: IpcResource<SecurityPass[]> = {
  key: 'reviews.security-passes',
  needs: ['reviews'],
  empty: [],
  read: (api) => api.reviews.securityPasses(),
  subscribe: (api, changed) => api.reviews.onChanged(changed),
}

const testRuns: IpcResource<TestRun[]> = {
  key: 'tests.list',
  needs: ['tests'],
  empty: [],
  read: (api) => api.tests.list(),
  subscribe: (api, changed) => api.tests.onChanged(changed),
}

const plans: IpcResource<Plan[]> = {
  key: 'planning.list',
  needs: ['planning'],
  empty: [],
  read: (api) => api.planning.list(),
  subscribe: (api, changed) => api.planning.onChanged(changed),
}

const sessions: IpcResource<SessionInfo[]> = {
  key: 'sessions.list',
  needs: ['sessions'],
  empty: [],
  read: (api) => api.sessions.list(),
  subscribe: (api, changed) => api.sessions.onChanged(changed),
}

/**
 * Who is still running a setting the Company has changed since their Session started (T237).
 *
 * The engine's event fires when a Session moves, which is when somebody stops being behind. The
 * boss's own change is not one of those, so the card that writes a setting reads this again itself
 * (`refreshIpcResource`) rather than the engine inventing an event for a value it already knows.
 */
const staleSessions: IpcResource<StaleSession[]> = {
  key: 'spawn-settings.stale',
  needs: ['spawnSettings'],
  empty: [],
  read: (api) => api.spawnSettings.stale(),
  subscribe: (api, changed) => api.spawnSettings.onChanged(changed),
}

/**
 * Where ai-jail stands, and whether this Company asked for it (T260).
 *
 * The drawer reads it to say when an Employee is starting without the jail the boss turned on. It
 * is `read` rather than a status of its own: the engine detects once and remembers, so every
 * screen after the first is answered from the cached lookup.
 */
const sandbox: IpcResource<SandboxView> = {
  key: 'sandbox.read',
  needs: ['sandbox'],
  empty: { status: SANDBOX_NOT_FOUND, settings: SANDBOX_SETTINGS_DEFAULT, install: [] },
  read: (api) => api.sandbox.read(),
  subscribe: (api, changed) => api.sandbox.onChanged(changed),
}

const channels: IpcResource<Channel[]> = {
  key: 'chat.channels',
  needs: ['chat'],
  empty: [],
  read: (api) => api.chat.channels(),
  subscribe: (api, changed) => api.chat.onChanged(changed),
}

/** What the boss has and has not read, by channel id: the counts and the read marks (T251). */
const unreadByChannel: IpcResource<BossUnread> = {
  key: 'chat.unread',
  needs: ['chat'],
  empty: { counts: {}, readMarks: {} },
  read: (api) => api.chat.unread(),
  subscribe: (api, changed) => api.chat.onChanged(changed),
}

/** The channels and DMs holding an unsent draft of the boss's, for the sidebar (TI-1). */
const draftedChannels: IpcResource<string[]> = {
  key: 'chat.drafted-channels',
  needs: ['chat'],
  empty: [],
  read: (api) => api.chat.draftedChannels(),
  subscribe: (api, changed) => api.chat.onChanged(changed),
}

const agentPairs: IpcResource<AgentPair[]> = {
  key: 'chat.agent-pairs',
  needs: ['chat'],
  empty: [],
  read: (api) => api.chat.agentPairs(),
  subscribe: (api, changed) => api.chat.onChanged(changed),
}

const bossInbox: IpcResource<BossInboxItem[]> = {
  key: 'chat.boss-inbox',
  needs: ['chat', 'approvals'],
  empty: [],
  read: (api) => api.chat.bossInbox(),
  // An Approval decided is one row fewer to answer, and the Approvals are not the chat's business.
  subscribe: (api, changed) => all([api.chat.onChanged(changed), api.approvals.onChanged(changed)]),
}

/** Who answers the boss's unaddressed messages (decision 41). */
const answerer: IpcResource<AnswererSetting | null> = {
  key: 'answerer.get',
  needs: ['answerer'],
  empty: null,
  read: (api) => api.answerer.get(),
  subscribe: (api, changed) => api.answerer.onChanged(changed),
}

/** The zone the digest card reads its clock times in (T172). */
const digestSchedule: IpcResource<DigestSchedule | null> = {
  key: 'digest.schedule',
  needs: ['digest'],
  empty: null,
  read: (api) => api.digest.schedule(),
  subscribe: (api, changed) => api.digest.onChanged(changed),
}

const capacity: IpcResource<CapacityInfo | null> = {
  key: 'capacity.get',
  needs: ['capacity'],
  empty: null,
  read: (api) => api.capacity.get(),
  subscribe: (api, changed) => api.capacity.onChanged(changed),
}

const mcpServers: IpcResource<McpServerRow[]> = {
  key: 'mcp.list',
  needs: ['mcp'],
  empty: [],
  read: (api) => api.mcp.list(),
  subscribe: (api, changed) => api.mcp.onChanged(changed),
}

const skills: IpcResource<SkillRow[]> = {
  key: 'skills.list',
  needs: ['skills'],
  empty: [],
  read: (api) => api.skills.list(),
  subscribe: (api, changed) => api.skills.onChanged(changed),
}

/**
 * The catalogue with what each skill says it does, for the composer's `/` palette (T264). Read once
 * for the open chat and again when the catalogue changes; a `SKILL.md` edited on disk shows after
 * the next Company switch or catalogue change, because the engine has no event for a folder.
 */
const skillsDescribed: IpcResource<SkillDescribed[]> = {
  key: 'skills.described',
  needs: ['skills'],
  empty: [],
  read: (api) => api.skills.described(),
  subscribe: (api, changed) => api.skills.onChanged(changed),
}

const memoryCounts: IpcResource<MemoryCounts> = {
  key: 'company-memory.counts',
  needs: ['companyMemory'],
  empty: emptyCounts(),
  read: (api) => api.companyMemory.counts(),
  subscribe: (api, changed) => api.companyMemory.onChanged(changed),
}

/**
 * The boss's own profile (T79), which is the same in every Company: what the terminal reads for
 * the right-click setting, and Your profile for the rest of it.
 */
const bossProfile: IpcResource<Boss | null> = {
  key: 'profile.get',
  needs: ['profile'],
  empty: null,
  read: (api) => api.profile.get(),
  subscribe: (api, changed) => api.profile.onChanged(changed),
}

/**
 * What this Windows machine is (T249): its distros and its Git Bash. It has no event of its own —
 * a machine does not change while the app is open, short of the boss installing something — so
 * `Check again` is what reads it afresh, through `publishIpcValue`.
 */
const windowsMachine: IpcResource<WindowsMachine | null> = {
  key: 'windows.machine',
  needs: ['windows'],
  empty: null,
  read: async (api) => ({ ok: true, value: await api.windows.machine() }),
  subscribe: () => () => {},
}

/**
 * Where a new Company's folder is suggested and which folders OneDrive syncs (T252). Like the
 * machine above it has no event of its own: a home folder and a sync client do not move while the
 * app is open.
 */
const folderHints: IpcResource<CompanyFolderHints> = {
  key: 'company.folder-hints',
  needs: ['company'],
  empty: NO_FOLDER_HINTS,
  read: async (api) => ({ ok: true, value: await api.company.folderHints() }),
  subscribe: () => () => {},
}

/** The current Company: the boss as settings name them, and the key a card id is written with. */
const company: IpcResource<Company | null> = {
  key: 'company.current',
  needs: ['company'],
  empty: null,
  read: async (api) => ({ ok: true, value: await api.company.current() }),
  subscribe: (api, changed) => api.company.onChanged(changed),
}

/**
 * The channels, by the name a screen names. One object rather than a loose set of exports, so a
 * screen writes `resources.employees` and never shadows it with a local `employees` of its own.
 */
export const resources = {
  agentPairs,
  answerer,
  approvals,
  autonomy,
  board,
  bossInbox,
  bossProfile,
  capacity,
  channels,
  code,
  company,
  digestSchedule,
  employees,
  folderHints,
  formerEmployees,
  mcpServers,
  memoryCounts,
  pendingApprovals,
  permissionDefault,
  plans,
  repos,
  reviewThreads,
  reviews,
  securityPasses,
  roles,
  sandbox,
  sessions,
  skills,
  skillsDescribed,
  staffingRequests,
  staleSessions,
  teamLoad,
  testRuns,
  unreadByChannel,
  draftedChannels,
  windowsMachine,
}
