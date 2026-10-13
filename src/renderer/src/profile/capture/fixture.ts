// The design's own Your profile fixture (Pen frame `Oykzs`), as engine data.
import type { Boss } from '../../../../shared/boss-profile'
import type { Company, CompanySummary } from '../../../../shared/company'
import { PROVIDERS } from '../../../../shared/domain/providers'
import type { RoutingSettings } from '../../../../shared/ipc'
import type { ClaudeUsage } from '../../../../shared/providers/claude-usage'
import type { ProviderPreflight } from '../../../../shared/providers/preflight'
import { noUsageEndpoint, type UsageSnapshot } from '../../../../shared/usage/provider-usage'

export {
  answerer,
  board,
  capacity,
  channels,
  employees,
  headcount,
  onboarding,
  repos,
  unread,
  update,
} from '../../settings/capture/fixture'

import { employees, companies as settingsCompanies, company as settingsCompany } from '../../settings/capture/fixture'

/** The boss in the frame: `Yuri Miguel`, `@yuri`, the second character, Available. */
export const boss: Boss = {
  name: 'Yuri Miguel',
  handle: 'yuri',
  initials: 'YM',
  email: 'boss@example.com',
  sprite: 1,
  status: 'available',
  statusUntil: null,
  sound: false,
  // The frame's Windows machine: the first Provider is in both places and the boss picked the
  // distro; the others are in one place each and there is nothing to pick.
  providerRuntimes: { claude: 'wsl:Ubuntu' },
  // Where the team runs, and what the right button does (T249): the frame's boss answered both on
  // the first launch, so the step is behind them.
  defaultRuntime: 'windows',
  rightClick: 'paste',
  windowsSetupDone: true,
}

/** How the boss reads on a Company row, straight from the profile, as the engine fills it (T79). */
const bossOnCompany = {
  name: boss.name,
  initials: boss.initials,
  handle: boss.handle,
  sprite: boss.sprite,
  status: boss.status,
}

/** The frame's `Running Tiny Corp since March`. */
export const company: Company = {
  ...settingsCompany,
  boss: bossOnCompany,
  createdAt: '2026-03-04T08:00:00',
}

export const companies: Company[] = settingsCompanies.map((entry) =>
  entry.id === company.id ? company : { ...entry, boss: bossOnCompany },
)

/** The four Companies the frame lists, with the headcounts under their names. */
export const summaries: CompanySummary[] = companies.map((entry, index) => ({
  ...entry,
  open: index === 0,
  current: index === 0,
  employees: [employees.length, 3, 5, 1][index] ?? 0,
  sessions: 0,
  lastOpenedAt: null,
  onboardingCompletedAt: null,
  missing: false,
  databaseElsewhere: false,
}))

/** Today's limit at the frame's fill: the same query the rail's usage tile reads (T78). */
export const usage: ClaudeUsage = {
  companies: [
    { companyId: company.id, companyName: company.name, concurrencyCap: 5, running: 3, parked: [] },
    { companyId: 'c-atlas', companyName: 'Atlas Studio', concurrencyCap: 3, running: 2, parked: [] },
  ],
  budget: null,
}

/**
 * What the three CLIs on the frame's machine report (T141), in the shape their own adapters
 * answer in.
 *
 * One departure from `Oykzs`: the first Provider's plan is `Max` and not `Max 20×`. It never
 * reaches the card — a Provider whose sign-ins are listed under it carries the product alone, and
 * `Max 20×` is the plan of a sign-in — but the frame's own head would read `Claude Code · Max`
 * without the list, so it is named here rather than bent.
 */
export const preflight: ProviderPreflight[] = [
  {
    provider: 'claude',
    state: 'ready',
    title: 'Claude Code is signed in',
    body: '',
    lead: '',
    commands: [],
    note: '',
    account: boss.email,
    plan: 'Max',
    checkedAt: '2026-09-22T09:00:00.000Z',
    hired: false,
    placement: {
      windows: true,
      distros: ['Ubuntu'],
      stopped: [],
      chosen: { kind: 'wsl', distro: 'Ubuntu' },
      missingAt: null,
      lookedIn: ['Windows PATH', 'WSL: Ubuntu'],
      reach: 'ok',
    },
  },
  {
    provider: 'codex',
    state: 'ready',
    title: 'Codex is signed in',
    body: '',
    lead: '',
    commands: [],
    note: '',
    account: boss.email,
    plan: 'ChatGPT Plus',
    checkedAt: '2026-09-22T09:00:00.000Z',
    hired: false,
    placement: {
      windows: false,
      distros: ['Ubuntu'],
      stopped: [],
      chosen: { kind: 'wsl', distro: 'Ubuntu' },
      missingAt: null,
      lookedIn: ['Windows PATH', 'WSL: Ubuntu'],
      reach: 'ok',
    },
  },
  {
    provider: 'opencode',
    state: 'ready',
    title: 'OpenCode is signed in',
    body: '',
    lead: '',
    commands: [],
    note: '',
    account: boss.email,
    plan: null,
    checkedAt: '2026-09-22T09:00:00.000Z',
    hired: false,
    placement: {
      windows: true,
      distros: [],
      stopped: [],
      chosen: { kind: 'windows' },
      missingAt: null,
      lookedIn: ['Windows PATH', 'WSL: Ubuntu'],
      reach: 'untested',
    },
  },
]

/** The frame's `15%`, under the one Provider that reports a number at all. */
export const USED_PERCENT = 15

/** The hour the frame's window rolls over at: `resets 21:00`, in whatever zone the shot is taken. */
export const RESETS_AT_HOUR = 21

/**
 * When the frame's window rolls over.
 *
 * The card writes the reset as a clock time, and the clock is the boss's own, so the instant is
 * built from this machine's midnight rather than pinned to one in UTC: a pinned instant reads
 * `21:00` on one runner and `14:00` on the next. The next 21:00 is always ahead of the shot, so
 * nothing here goes stale the way a fixed date does (T148).
 */
export function resetsAt(now: Date = new Date()): Date {
  const at = new Date(now)
  at.setHours(RESETS_AT_HOUR, 0, 0, 0)
  if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1)
  return at
}

/** What the CLIs report of the subscription: one Provider with numbers, and two without. */
export function providerUsage(now: Date = new Date()): UsageSnapshot {
  return {
    providers: [
      {
        id: 'claude',
        name: 'Claude',
        windows: [{ key: 'five_hour', label: '5h', percent: USED_PERCENT, resetsAt: resetsAt(now).toISOString() }],
        problem: null,
        reason: null,
        accounts: [],
      },
      {
        id: 'codex',
        name: 'Codex',
        windows: [],
        problem: 'not-connected',
        reason: noUsageEndpoint('codex'),
        accounts: [],
      },
      {
        id: 'opencode',
        name: 'OpenCode',
        windows: [],
        problem: 'not-connected',
        reason: noUsageEndpoint('opencode'),
        accounts: [],
      },
    ],
    readAt: now.toISOString(),
  }
}

/** The Providers this Company's Employees are hired on: what the Launcher's own check covers. */
export const preflightInUse: ProviderPreflight[] = preflight.filter((check) =>
  employees.some((employee) => employee.provider === check.provider),
)

/**
 * The boss's sign-ins as frame `A2lOk0` lists them (T173): two of the first Provider, one of each
 * of the rest. Labels and directories only — nothing here is, or stands in for, a credential.
 */
export const routing: RoutingSettings = {
  routing: { rules: {}, moveBack: {}, resumeAtReset: true, rotateAccounts: false, pinnedAccount: {} },
  overrides: [],
  accounts: [
    {
      id: `primary:${PROVIDERS[0]!}`,
      provider: PROVIDERS[0]!,
      label: 'Personal',
      plan: 'Max 20×',
      email: 'boss@example.com',
      configDir: '/Users/boss/.provider',
      isDefault: true,
      primary: true,
    },
    {
      id: 'acc-work',
      provider: PROVIDERS[0]!,
      label: 'Work',
      plan: 'Team',
      email: 'work@example.com',
      configDir: '/Users/boss/Library/Application Support/tinycorp/accounts/work',
      isDefault: false,
      primary: false,
    },
  ],
  oneAccountProviders: PROVIDERS.slice(1),
}
