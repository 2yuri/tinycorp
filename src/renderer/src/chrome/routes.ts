import type { MemoryKind } from '../../../shared/memory/company-memory'

/** The views the shell's router switches between, in sidebar order. */
// `settings` and `profile` are drawn apart from the tree, at the drawer's foot.
export const VIEWS = [
  'office',
  'chat',
  'board',
  'employees',
  'repositories',
  'files',
  'memory',
  'activity',
  'settings',
  'profile',
] as const
export type ViewId = (typeof VIEWS)[number]

export const VIEW_LABEL: Record<ViewId, string> = {
  office: 'Office',
  chat: 'Chat',
  board: 'Board',
  employees: 'Employees',
  repositories: 'Repositories',
  files: 'Files',
  memory: 'Memory',
  activity: 'Activity',
  settings: 'Company settings',
  profile: 'Your profile',
}

/** The Board's saved views in the sidebar. The Board view (D04) applies them. */
export const BOARD_FILTERS = ['my-approvals', 'blocked', 'open-prs'] as const
export type BoardFilter = (typeof BOARD_FILTERS)[number]

/** Company settings' own tabs. Decisions 3, 18, 31 and 38 dropped the design's other four. */
export const SETTINGS_TABS = [
  'general',
  'office',
  'routing',
  'tokens',
  'addons',
  'environments',
  'integrations',
] as const
export type SettingsTab = (typeof SETTINGS_TABS)[number]

export const SETTINGS_TAB_LABEL: Record<SettingsTab, string> = {
  general: 'General',
  office: 'Office',
  routing: 'Usage & routing',
  environments: 'Environments',
  tokens: 'Tokens',
  addons: 'Add-ons',
  integrations: 'Integrations',
}

/** Where the shell is: a view, and optionally the sidebar child picked inside it. */
export type Route =
  | { view: 'office' | 'activity' | 'profile' }
  | { view: 'settings'; tab?: SettingsTab }
  /** `inbox` opens the boss's Inbox in place of a channel's messages (decision 43). */
  | { view: 'chat'; channelId?: string; inbox?: boolean }
  | { view: 'board'; epicId?: number; targetId?: number; filter?: BoardFilter }
  /**
   * `editRole` opens a role in the Employees view's editor. `roles` opens the Roles list itself and
   * `new` opens the New role dialog over it (T240).
   */
  | { view: 'employees'; roleId?: string; editRole?: string }
  | { view: 'repositories'; repoId?: string }
  /**
   * The Files view over one place (a repo or a ticket worktree), optionally on one file (T113) and
   * on the line a path written elsewhere named (T114). `outside` is the whole path of a file
   * nowhere the Company owns, which opens as a tab of its own (T121).
   */
  | { view: 'files'; placeId?: string; path?: string; line?: number; outside?: string }
  /**
   * The Company memory (T175), optionally on one page. `ticket` is the Activity line's own way in:
   * the list cut to the pages one closed ticket wrote.
   */
  | { view: 'memory'; slug?: string; kind?: MemoryKind; ticket?: string }

export const HOME: Route = { view: 'office' }

/** The centred title bar text: `<Company> — <View>`, or the app name with no Company open. */
export function windowTitle(companyName: string | null, route: Route): string {
  return companyName ? `${companyName} — ${VIEW_LABEL[route.view]}` : 'tinycorp'
}

/** `Tiny Corp — Review TC-142` while the Review screen is open over a view (T75). */
export function reviewWindowTitle(company: { name: string; key: string }, ticketId: number): string {
  return `${company.name} — Review ${company.key}-${ticketId}`
}

/** The window's title while the Testing screen is open (frame `BRzY6`). */
export function testingWindowTitle(company: { name: string; key: string }, ticketId: number): string {
  return `${company.name} — Test ${company.key}-${ticketId}`
}

/** True when both routes name the same view and the same child. */
export function sameRoute(a: Route, b: Route): boolean {
  if (a.view !== b.view) return false
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...keys].every((key) => (a as Record<string, unknown>)[key] === (b as Record<string, unknown>)[key])
}
