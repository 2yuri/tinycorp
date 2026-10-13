// The design's own Company settings fixture (Pen frame `QgXdU`), as engine data.

import type { UpdateState } from '../../../../shared/app/updates'
import type { CapacityInfo } from '../../../../shared/capacity'
import type { McpImportPreview } from '../../../../shared/catalogue/mcp-import'
import type { McpServerRow } from '../../../../shared/catalogue/mcp-servers'
import type { McpFoundGroup } from '../../../../shared/catalogue/mcp-sources'
import type { SkillFoundGroup } from '../../../../shared/catalogue/skill-sources'
import type { SkillRow } from '../../../../shared/catalogue/skills'
import type { Company } from '../../../../shared/company'
import type { BoardSnapshot, Ticket } from '../../../../shared/domain/board'
import type { BossUnread, Channel } from '../../../../shared/domain/chat'
import { PROVIDER_SHORT_NAME, PROVIDERS } from '../../../../shared/domain/providers'
import type { Employee } from '../../../../shared/domain/staff'
import {
  type EnvironmentSettings,
  type EnvVariable,
  type ImportPreview,
  REVEAL_FOOTER,
} from '../../../../shared/environments'
import type { Headcount } from '../../../../shared/hiring'
import type { AnswererSetting } from '../../../../shared/inbox/answerer'
import type { RoutingSettings, RtkView } from '../../../../shared/ipc'
import { emptyCounts, type MemoryCounts } from '../../../../shared/memory/company-memory'
import type { OnboardingProgress } from '../../../../shared/onboarding'
import { DEFAULT_DIGEST_SCHEDULE, type DigestSchedule } from '../../../../shared/planning/daily-digest'
import { EMPTY_STACK, type Repo } from '../../../../shared/repos/repo'
import type { SandboxView } from '../../../../shared/sandbox/ipc'
import { SPAWN_SETTINGS, type StaleSession } from '../../../../shared/spawn-settings'
import type { TestSettings } from '../../../../shared/testing'
import { notConnected, noUsageEndpoint, type UsageSnapshot } from '../../../../shared/usage/provider-usage'

const AT = '2026-09-17T08:00:00'

function person(id: string, name: string, title: string, capabilities: Employee['capabilities']): Employee {
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
    sprite: 0,
    createdAt: AT,
  }
}

/** The eight the drawer counts in the frame; Hera holds `intake`, so Automatic resolves to her. */
export const employees: Employee[] = [
  person('e-hera', 'Hera', 'PM', ['intake', 'plan']),
  person('e-nova', 'Nova', 'Tech Lead', ['plan', 'code', 'review']),
  person('e-iris', 'Iris', 'QA', ['review']),
  person('e-atlas', 'Atlas', 'Frontend', ['code']),
  person('e-orion', 'Orion', 'Backend', ['code']),
  person('e-vega', 'Vega', 'DevOps', ['code']),
  person('e-juno', 'Juno', 'HR', ['hire']),
  person('e-lyra', 'Lyra', 'Frontend', ['code']),
]

export const company: Company = {
  id: 'c-tiny',
  name: 'Tiny Corp',
  key: 'TC',
  boss: { name: 'Yuri Miguel', initials: 'YM' },
  folder: '/work/tiny',
  createdAt: AT,
}

/** A Company past its setup wizard: without the mark, `App` draws the wizard instead (T59). */
export const onboarding: OnboardingProgress = { completedAt: AT, draft: null }

/** The three the rail shows beside Tiny Corp in the frame. */
export const companies: Company[] = [
  company,
  { ...company, id: 'c-atlas', name: 'Atlas Studio', key: 'AS', folder: '/work/atlas' },
  { ...company, id: 'c-lumen', name: 'Lumen Retail', key: 'LR', folder: '/work/lumen' },
  { ...company, id: 'c-north', name: 'North Vane', key: 'NV', folder: '/work/north' },
]

const stack = { ...EMPTY_STACK, language: 'TypeScript', framework: 'vitest', packageManager: 'pnpm' }

/** The four frame `FuDXm` lists for this Company — the fourth is why `QgXdU` draws Override for
    another repo under the three that have one. */
export const repos: Repo[] = [
  { id: 'r-web', name: 'web-app', path: '/code/web', brief: '', rung: 'merge', stack, addedAt: AT },
  { id: 'r-api', name: 'billing-api', path: '/code/api', brief: '', rung: 'merge', stack, addedAt: AT },
  { id: 'r-infra', name: 'infra', path: '/code/infra', brief: '', rung: 'merge', stack: EMPTY_STACK, addedAt: AT },
  { id: 'r-pay', name: 'payments-web', path: '/code/payments-web', brief: '', rung: 'merge', stack, addedAt: AT },
]

export const channels: Channel[] = [
  { id: 'general', kind: 'channel', name: 'general', members: [], topic: '' },
  { id: 'tech', kind: 'channel', name: 'tech', members: [], topic: '' },
  { id: 'prs', kind: 'channel', name: 'prs', members: [], topic: '' },
]

/** The drawer's `12` unread, spread over the three channels, and where the boss stopped reading. */
export const unread: BossUnread = { counts: { general: 5, tech: 4, prs: 3 }, readMarks: {} }

function ticket(id: number): Ticket {
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
  }
}

/** The drawer's `31` tickets. */
export const board: BoardSnapshot = {
  columns: [
    { id: 'todo', title: 'Todo', wipLimit: null, count: 31, overLimit: false },
    { id: 'doing', title: 'Doing', wipLimit: 3, count: 0, overLimit: false },
    { id: 'review', title: 'Review', wipLimit: null, count: 0, overLimit: false },
    { id: 'done', title: 'Done', wipLimit: null, count: 0, overLimit: false },
  ],
  targets: [],
  epics: [],
  tickets: Array.from({ length: 31 }, (_, i) => ticket(i + 1)),
}

export const capacity: CapacityInfo = { concurrencyCap: 5, running: 5, parked: ['e-lyra'], budget: null, outages: [] }

export const headcount: Headcount = { current: employees.length, max: 12 }

/** Automatic, resolving to Hera: the frame reads `Automatic · Hera (PM)`. */
export const answerer: AnswererSetting = {
  overrideId: null,
  automaticId: 'e-hera',
  answererId: 'e-hera',
  waitingForId: null,
  stale: null,
  skipped: [],
}

/**
 * Testing before merge, as frame `YatUW` card c draws it: the Company asks for Both, web-app takes
 * the default and runs on 5173, billing-api is the agent's alone, and infra is tested by nobody.
 *
 * Every repo of the Company has a row here, as `createTestingSettings` returns one — so
 * payments-web, which nobody has overridden, is the repo the Override for another repo picker in
 * `QgXdU` has to offer.
 */
export const testing: TestSettings = {
  mode: 'both',
  repos: [
    { repoId: 'r-web', mode: null, runCommand: 'pnpm dev', port: 5173 },
    { repoId: 'r-api', mode: 'agent', runCommand: 'pnpm test:e2e', port: null },
    { repoId: 'r-infra', mode: 'nobody', runCommand: '', port: null },
    { repoId: 'r-pay', mode: null, runCommand: '', port: null },
  ],
}

/** The daily digest as a new Company keeps it: on, weekdays at 18:00, in #general (T172, `b9EZF`). */
export const digest: DigestSchedule = { ...DEFAULT_DIGEST_SCHEDULE, days: [...DEFAULT_DIGEST_SCHEDULE.days] }

/** A newer build on GitHub (T130), so the capture shows the line and the `This build` row. */
export const update: UpdateState = {
  // The build frame `Oykzs` writes at the foot of Your profile.
  current: '0.4.2',
  // No newer build: the frames draw no update chip in the title bar, and a chip that only the
  // capture has shifts the whole title bar away from every frame it is compared with (T192).
  available: null,
  checkedAt: '2026-09-18T12:05:00Z',
  checking: false,
}

/**
 * What the Company memory holds, for the drawer's `Memory · 42` row. The frames draw the count on
 * every tab, so a stub that answers `emptyCounts()` loses it on all of them (T192).
 */
export const memoryCounts: MemoryCounts = {
  ...emptyCounts(),
  pages: 42,
  byKind: { decision: 11, convention: 9, gotcha: 8, architecture: 6, glossary: 5, handoff: 3 },
  cold: 2,
  contradictions: 2,
}

/** A Company that has written nothing yet: the drawer's Memory row carries no count. */
export const emptyMemoryCounts: MemoryCounts = emptyCounts()

/** Nobody has said anything yet, so no channel is bold and none carries a pill. */
export const noUnread: BossUnread = { counts: {}, readMarks: {} }

/** A board nobody has filed a ticket on: the drawer's Board row carries no count either. */
export const emptyBoard: BoardSnapshot = {
  columns: board.columns.map((column) => ({ ...column, count: 0 })),
  targets: [],
  epics: [],
  tickets: [],
}

/**
 * The scan the Import from Claude Code frame (`qSIIY`) draws (T235): the boss's own servers, one
 * of each kind that matters — a plain command, one that takes an environment variable, one with a
 * bearer token, and one this Company already has.
 */
export const mcpImportPreview: McpImportPreview = {
  source: 'claude',
  path: '/Users/boss/.claude.json',
  servers: [
    {
      name: 'pencil',
      transport: 'stdio',
      target: '…/Pen.app/…/mcp-server-darwin-arm64 --app desktop',
      secretNames: [],
      hasToken: false,
      chosen: true,
      problem: null,
    },
    {
      name: 'linear',
      transport: 'http',
      target: 'https://mcp.linear.app/mcp',
      secretNames: [],
      hasToken: true,
      chosen: true,
      problem: null,
    },
    {
      name: 'github',
      transport: 'stdio',
      target: 'npx -y @modelcontextprotocol/server-github',
      secretNames: ['GITHUB_PERSONAL_ACCESS_TOKEN'],
      hasToken: false,
      chosen: true,
      problem: null,
    },
    {
      name: 'clickup',
      transport: 'http',
      target: 'https://mcp.clickup.com/mcp',
      secretNames: [],
      hasToken: false,
      chosen: false,
      problem: 'already in the catalogue',
    },
  ],
}

/**
 * What Found on this machine draws (T242, frame `mPqN9`): three tools, one of them holding a
 * server this Company already has. Nothing here is read from a real config — this is the scan.
 */
export const mcpFound: McpFoundGroup[] = [
  {
    source: 'claude-code',
    path: '/Users/boss/.claude.json',
    servers: [
      {
        name: 'linear',
        transport: 'http',
        target: 'https://mcp.linear.app/mcp',
        secretNames: [],
        hasToken: true,
        added: true,
        problem: null,
      },
    ],
  },
  {
    source: 'codex',
    path: '/Users/boss/.codex/config.toml',
    servers: [
      {
        name: 'context7',
        transport: 'http',
        target: 'https://mcp.context7.com/mcp',
        secretNames: [],
        hasToken: false,
        added: false,
        problem: null,
      },
    ],
  },
  {
    source: 'cursor',
    path: '/Users/boss/.cursor/mcp.json',
    servers: [
      {
        name: 'supabase',
        transport: 'http',
        target: 'https://mcp.supabase.com/mcp',
        secretNames: [],
        hasToken: true,
        added: false,
        problem: null,
      },
    ],
  },
]

/**
 * The skill folders frame `LBKv1` draws: the shared folder every installer writes to, with the
 * links from Claude Code's own on them, and the seven Claude Code really holds itself.
 */
export const skillsFound: SkillFoundGroup[] = [
  {
    source: 'shared',
    path: '/Users/boss/.agents/skills',
    elsewhere: 0,
    skills: [
      {
        name: 'ai-sdk',
        path: '/Users/boss/.agents/skills/ai-sdk',
        description: 'Answer questions about the AI SDK and help build AI-powered features.',
        seenBy: ['Claude Code'],
        added: false,
        problem: null,
      },
      {
        name: 'agent-browser',
        path: '/Users/boss/.agents/skills/agent-browser',
        description: 'Drive a real browser to test a page the way a person would.',
        seenBy: ['Claude Code'],
        added: true,
        problem: null,
      },
      ...Array.from({ length: 76 }, (_, at) => ({
        name: `skill-${at + 3}`,
        path: `/Users/boss/.agents/skills/skill-${at + 3}`,
        description: 'One of the folders behind “Show all 78”, which the frame draws shut.',
        seenBy: [],
        added: false,
        problem: null,
      })),
    ],
  },
  {
    source: 'claude-code',
    path: '/Users/boss/.claude/skills',
    elsewhere: 79,
    skills: [
      {
        name: 'typescript-expert',
        path: '/Users/boss/.claude/skills/typescript-expert',
        description: 'Type-level TypeScript, performance and migrations.',
        seenBy: [],
        added: false,
        problem: null,
      },
      ...Array.from({ length: 6 }, (_, at) => ({
        name: `own-${at + 2}`,
        path: `/Users/boss/.claude/skills/own-${at + 2}`,
        description: 'One of the folders behind “Show all 7”.',
        seenBy: [],
        added: false,
        problem: null,
      })),
    ],
  },
]

/** The catalogue the Integrations frame (`uApL8`) draws: two http servers with tokens, one stdio without. */
export const mcpServers: McpServerRow[] = [
  {
    id: 'mcp-linear',
    name: 'linear',
    transport: 'http',
    url: 'https://mcp.linear.app/mcp',
    command: '',
    args: [],
    env: {},
    secretEnv: '',
    secretNames: [],
    headers: {},
    headerSecretNames: [],
    hasSecret: true,
    employees: 4,
  },
  {
    id: 'mcp-playwright',
    name: 'playwright',
    transport: 'stdio',
    url: '',
    command: 'npx',
    args: ['@playwright/mcp@latest'],
    env: {},
    secretEnv: '',
    secretNames: [],
    headers: {},
    headerSecretNames: [],
    hasSecret: false,
    employees: 2,
  },
  {
    id: 'mcp-sentry',
    name: 'sentry',
    transport: 'http',
    url: 'https://mcp.sentry.dev/mcp',
    command: '',
    args: [],
    env: {},
    secretEnv: '',
    secretNames: [],
    headers: {},
    headerSecretNames: [],
    hasSecret: true,
    employees: 1,
  },
]

/** The skills the Integrations frame (`uApL8`) draws: two folders under home, one inside a repo. */
export const skills: SkillRow[] = [
  {
    id: 'sk-review',
    name: 'review-checklist',
    path: '/Users/yuri/skills/review-checklist',
    missing: false,
    employees: 4,
  },
  {
    id: 'sk-deploy',
    name: 'deploy-runbook',
    path: '/Users/yuri/skills/deploy-runbook',
    missing: false,
    employees: 2,
  },
  {
    id: 'sk-pen',
    name: 'pen-handoff',
    path: '/Users/yuri/code/tinycorp/design/skills/pen-handoff',
    missing: false,
    employees: 1,
  },
]

/**
 * Usage & routing as frame `bB6VX` draws it (T173): the Company continues on the second Provider
 * when the first runs out, two Employees override the rule, and there are two sign-ins of the
 * first Provider — the second one added by the boss, so the Accounts card has a list to draw.
 *
 * Nothing here is a credential. A stored account is a label and a directory, and the login inside
 * it belongs to the product's own CLI.
 */
export const routing: RoutingSettings = {
  routing: {
    // The frame's own field: `Codex · GPT-6-Sol` with the `high` badge, which is the catalogue
    // entry `gpt-6-sol-deep`. A null model draws `default` and no badge, which the frame never does.
    rules: { [PROVIDERS[0]!]: { kind: 'continue', provider: PROVIDERS[1]!, model: 'gpt-6-sol-deep' } },
    moveBack: { [PROVIDERS[0]!]: true },
    resumeAtReset: true,
    rotateAccounts: false,
    pinnedAccount: {},
  },
  overrides: [
    { employeeId: 'e-iris', name: 'Iris', routing: { rule: { kind: 'wait' }, pinnedAccount: {} } },
    {
      employeeId: 'e-atlas',
      name: 'Ada',
      routing: { rule: null, pinnedAccount: { [PROVIDERS[0]!]: 'acc-work' } },
    },
  ],
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
    {
      id: `primary:${PROVIDERS[1]!}`,
      provider: PROVIDERS[1]!,
      label: 'Personal',
      plan: 'Plus',
      email: 'boss@example.com',
      configDir: '/Users/boss/.other',
      isDefault: true,
      primary: true,
    },
  ],
  oneAccountProviders: PROVIDERS.slice(2),
}

/**
 * The frame's `resets 21:00`, today: the meter writes the date in front of any other day, and a
 * capture shot in March would then read `Sep 17, 21:00` instead of the frame's clock time.
 */
function resetsAt(): string {
  const at = new Date()
  at.setHours(21, 0, 0, 0)
  return at.toISOString()
}

/**
 * What the first Provider reports, so the Accounts card draws the frame's bar rather than a dash.
 *
 * 15%, which is what the drawer's Usage row reads in all thirteen frames. Frame `bB6VX` writes
 * `68% · resets 21:00` beside the first sign-in while its own drawer still reads 15%, and one
 * window cannot be both: the drawer takes the highest of a Provider's meters and the Accounts card
 * takes the same Provider's first. The drawer is on every frame, so the drawer's number wins.
 */
export const providerUsage: UsageSnapshot = {
  readAt: `${AT}Z`,
  providers: PROVIDERS.map((id, index) =>
    index === 0
      ? {
          id,
          name: PROVIDER_SHORT_NAME[id],
          accounts: [],
          windows: [{ key: 'five_hour', label: '5h', percent: 15, resetsAt: resetsAt() }],
          problem: null,
          reason: null,
        }
      : notConnected(id, noUsageEndpoint(id)),
  ),
}

/**
 * The Environments tab's own fixture (frame `zpvHQ`): prod, with the frame's seven variables,
 * their repo scopes and who last used each. No value is here, because none ever crosses to the
 * renderer — the tab draws dots, and Reveal is a call (T176).
 */
function variable(
  name: string,
  repoIds: string[],
  lastUsed: EnvVariable['lastUsed'],
  environment: EnvVariable['environment'] = 'prod',
): EnvVariable {
  return { id: `v-${name.toLowerCase()}`, environment, name, repoIds, lastUsed }
}

/** The frame's LAST USED column: a clock time today, yesterday, and a few days back. */
function usedAt(daysAgo: number, hour = 18, minute = 12): string {
  const at = new Date()
  at.setDate(at.getDate() - daysAgo)
  at.setHours(hour, minute, 0, 0)
  return at.toISOString()
}

export const environments: EnvironmentSettings = {
  environments: [
    { id: 'dev', askEveryUse: false, availableToChecks: true, variableCount: 7 },
    { id: 'staging', askEveryUse: false, availableToChecks: true, variableCount: 7 },
    { id: 'prod', askEveryUse: true, availableToChecks: true, variableCount: 7 },
  ],
  variables: [
    variable('DATABASE_URL', ['r-api'], { employeeId: 'e-orion', at: usedAt(0) }),
    variable('STRIPE_SECRET_KEY', ['r-api'], { employeeId: 'e-orion', at: usedAt(3) }),
    variable('REDIS_URL', ['r-api', 'r-web'], { employeeId: 'e-vega', at: usedAt(1) }),
    variable('SENTRY_DSN', ['r-web'], { employeeId: 'e-iris', at: usedAt(2) }),
    variable('MAIL_API_KEY', ['r-api'], null),
    variable('JWT_SIGNING_KEY', ['r-api', 'r-web'], { employeeId: 'e-orion', at: usedAt(5) }),
    variable('STORAGE_SECRET', ['r-infra'], { employeeId: 'e-nova', at: usedAt(9) }),
  ],
  repos: [
    { id: 'r-api', name: 'billing-api', defaultEnvironment: 'prod' },
    { id: 'r-web', name: 'web-app', defaultEnvironment: 'staging' },
    { id: 'r-infra', name: 'infra', defaultEnvironment: 'dev' },
  ],
  storedAt: 'Stored in this Mac\u2019s keychain, as TinyCorp / Tiny Corp. Never in a repo, the database or a log.',
  revealFooter: REVEAL_FOOTER,
  storageProblem: null,
}

/** The Import .env preview of frame `aD50i` (c): keys with a note each, and not one value. */
export const envImportPreview: ImportPreview = {
  file: 'web-app/.env.local',
  environment: 'staging',
  keys: [
    { name: 'DATABASE_URL', chosen: true, skipReason: null, note: 'new', problem: null },
    { name: 'REDIS_URL', chosen: true, skipReason: null, note: 'new', problem: null },
    { name: 'SENTRY_DSN', chosen: true, skipReason: null, note: 'new', problem: null },
    { name: 'STRIPE_SECRET_KEY', chosen: true, skipReason: null, note: 'replaces staging\u2019s', problem: null },
    { name: 'NEXT_PUBLIC_APP_URL', chosen: false, skipReason: 'public \u2014 skipped', note: 'new', problem: null },
    { name: 'NODE_ENV', chosen: false, skipReason: 'not a secret \u2014 skipped', note: 'new', problem: null },
  ],
}

/*
 * The states a real Company is in that the frames do not draw (T181).
 *
 * The fixture above is the frame's Company: eight Employees, three repos, two sign-ins, seven
 * variables. Every real Company starts as none of that, and the settings tabs were never once
 * captured against it — so the empty state shipped undesigned twice. These are what
 * `?data=empty` and `?data=long` hand the same stub.
 */

/**
 * A Company on its first day: nobody hired, nothing attached, nothing signed in.
 *
 * It keeps the frame's own name and key, because frame `hGQxG` does: the empty state is Tiny Corp
 * with nothing in it yet, not a second Company, and a different name would put a different word
 * in the switcher, the page's subtitle, the Team card and the Delete button of every pair.
 */
export const emptyCompany: Company = { ...company, folder: '/work/new' }

export const emptyCapacity: CapacityInfo = {
  concurrencyCap: 3,
  running: 0,
  parked: [],
  budget: null,
  outages: [],
}

export const emptyHeadcount: Headcount = { current: 0, max: null }

export const emptyAnswerer: AnswererSetting = {
  overrideId: null,
  automaticId: null,
  answererId: null,
  waitingForId: null,
  stale: null,
  skipped: [],
}

export const emptyTesting: TestSettings = { mode: 'both', repos: [] }

/** No rule set, no override, and the one sign-in the CLI's own directory already holds. */
export const emptyRouting: RoutingSettings = {
  routing: { rules: {}, moveBack: {}, resumeAtReset: true, rotateAccounts: false, pinnedAccount: {} },
  overrides: [],
  accounts: [],
  oneAccountProviders: routing.oneAccountProviders,
}

export const emptyEnvironments: EnvironmentSettings = {
  environments: [
    { id: 'dev', askEveryUse: false, availableToChecks: true, variableCount: 0 },
    { id: 'staging', askEveryUse: false, availableToChecks: true, variableCount: 0 },
    { id: 'prod', askEveryUse: true, availableToChecks: true, variableCount: 0 },
  ],
  variables: [],
  repos: [],
  storedAt: environments.storedAt,
  revealFooter: REVEAL_FOOTER,
  storageProblem: null,
}

/** Nothing the boss has added yet: the Integrations tab with both of its lists empty. */
export const noMcpServers: McpServerRow[] = []
export const noSkills: SkillRow[] = []

/** A name that is as long as a Company name gets (frame `PqC4p`), for every row that holds one. */
export const longCompany: Company = {
  ...company,
  id: 'c-long',
  name: 'Northwind Logistics & Freight Holdings',
  key: 'NL',
}

/**
 * A Company in a folder that can vanish on restart (decision 45): what the boss gets after
 * clicking through the wizard without choosing one. Its warning is the whole of `company-move.css`
 * and no frame draws it (T209).
 */
export const temporaryCompany: Company = {
  ...company,
  id: 'c-temporary',
  folder: '/private/var/folders/t9/tinycorp-untitled/Tiny Corp',
}

/**
 * RTK as frame `L0glbm` draws it: found, on, and all three Providers hooked. The `how` line of each
 * row is the adapter's own — the renderer never writes one — so the fixture reads them from the
 * same place the engine does.
 */
export const rtk: RtkView = {
  status: { state: 'found', version: '0.41.0', path: '/opt/homebrew/bin/rtk', missingIn: [] },
  settings: { enabled: true, ping: false },
  // The rows the engine builds from each adapter. A fixture may name a product; nothing that
  // ships may (`no-provider-names.test.ts`).
  hooks: [
    {
      provider: 'claude',
      name: 'Claude Code',
      how: 'Bash hook · rewrites git status → rtk git status',
      keepsApprovals: true,
    },
    { provider: 'codex', name: 'Codex', how: 'Bash hook · same rewrite', keepsApprovals: true },
    { provider: 'opencode', name: 'OpenCode', how: 'Plugin · tool.execute.before', keepsApprovals: true },
  ],
}

/** What the frame's Saved this week reads. An estimate, and the card says so on its face. */
export const rtkSavings = { cutPercent: 71, tokensNotRead: 1_800_000, commandsFiltered: 4212 }

/** `Read at session start`, as the frame draws it: the middle of the three (T193). */
export const notesBudget = 4_000

/** A Company on its first day: RTK is on the machine and has filtered nothing for this Company. */
export const emptyRtk: RtkView = { ...rtk, settings: { enabled: true, ping: false } }

/** The three other states of frame `p4np9V`, which a headless capture cannot produce for itself. */
export const rtkMissing: RtkView = {
  ...rtk,
  status: { state: 'missing', version: null, path: null, missingIn: [] },
}

export const rtkTooOld: RtkView = {
  ...rtk,
  status: { state: 'too-old', version: '0.31.0', path: '/opt/homebrew/bin/rtk', missingIn: [] },
}

export const rtkInWsl: RtkView = {
  ...rtk,
  status: {
    state: 'missing-in-wsl',
    version: '0.41.0',
    path: 'C:\\Users\\yuri\\.local\\bin\\rtk.exe',
    missingIn: ['Ubuntu'],
  },
}

/**
 * Who is still running the settings their Session was spawned with (T237), as frames `L0glbm`,
 * `Cg3a8` and `ttODp` draw the note: two the boss can restart now and one mid-turn.
 *
 * Every one of them is behind on all three, so the note is drawn on each of the three cards that
 * has one — the same picture whichever tab the harness opens.
 */
export const staleSessions: StaleSession[] = [
  { employeeId: 'e-nova', name: 'Nova', busy: false, settings: [...SPAWN_SETTINGS] },
  { employeeId: 'e-iris', name: 'Iris', busy: false, settings: [...SPAWN_SETTINGS] },
  { employeeId: 'e-vega', name: 'Vega', busy: true, settings: [...SPAWN_SETTINGS] },
]

/**
 * The Sandbox add-on as frame `fBHiz` draws it: on, with ai-jail found and its version and path
 * beside it (T260).
 */
export const sandbox: SandboxView = {
  status: { state: 'found', version: '0.6.1', path: '/opt/homebrew/bin/ai-jail', lookedIn: ['PATH'] },
  settings: { enabled: true },
  install: [],
}

/**
 * The same card on a computer with no ai-jail, as frame `gJyAJ` draws it: the toggle refused, the
 * line the boss runs, and where we looked.
 */
export const emptySandbox: SandboxView = {
  status: { state: 'missing', version: null, path: null, lookedIn: ['PATH'] },
  settings: { enabled: false },
  install: [{ label: 'macOS', command: 'brew tap akitaonrails/tap && brew install ai-jail' }],
}
