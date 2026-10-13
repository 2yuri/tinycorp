import type { ActivityApi } from '../activity/ipc'
import type { AgentPair } from '../agent-pairs'
import type { CrashReport } from '../app/crash'
import type { KeepAwakeMode, KeepAwakeState } from '../app/keep-awake'
import type { MenuCommand } from '../app/menu'
import type { UpdateState } from '../app/updates'
import type { ApprovalApi } from '../approvals/ipc'
import type { AttachmentLimits, AttachmentSource, OpenedAttachment } from '../attachments'
import type { Boss, BossUpdate } from '../boss-profile'
import type { BuildStyle } from '../build-style'
import type { CapacityInfo } from '../capacity'
import type { McpServersApi, SkillsApi } from '../catalogue/ipc'
import type { CavemanLevel } from '../caveman'
import type { ChannelSearch, PinnedMessage } from '../channel-extras'
import type { ChannelRemoval } from '../channel-removal'
import type { CodeApi } from '../code/ipc'
import type { ColleagueVoice } from '../colleague-voice'
import type { Company, CompanyAttention, CompanySummary, CompanyUpdate } from '../company'
import type { BoardCommand, BoardSnapshot } from '../domain/board'
import type { BossUnread, Channel, ChatQuery, Message } from '../domain/chat'
import type { Result } from '../domain/result'
import type { Draft, DraftFileBytes, DraftKey } from '../drafts'
import type { EmployeeConversation } from '../employee-chats'
import type { EnvironmentApi } from '../environments/ipc'
import type { EditorsApi, FilesApi, LanguageApi, PathsApi } from '../files/ipc'
import type { HiringApi } from '../hiring/ipc'
import type { BossInboxItem } from '../inbox/boss-inbox'
import type { AnswererApi, InboxApi } from '../inbox/ipc'
import type { CompanyMemoryApi, NotesApi } from '../memory/ipc'
import type { NotificationApi } from '../notifications/ipc'
import type { OfficeApi } from '../office/ipc'
import type { OnboardingApi } from '../onboarding/ipc'
import type { DigestApi, PlanningApi } from '../planning/ipc'
import type { CompanyFolderHints } from '../platform/company-folder'
import type { WindowsMachine } from '../platform/windows-machine'
import type { ClaudeUsage } from '../providers/claude-usage'
import type { ProviderPreflight } from '../providers/preflight'
import type { RepoApi } from '../repos/ipc'
import type { DetectedRepo } from '../repos/repo'
import type { RestorePointsApi } from '../restore-points/ipc'
import type { ReviewApi } from '../review/ipc'
import type { RtkApi } from '../rtk/ipc'
import type { SandboxApi } from '../sandbox/ipc'
import type { ResumeAll, SessionHandoff, SessionInfo } from '../session'
import type { AppliedNow, StaleSession } from '../spawn-settings'
import type { StaffApi } from '../staff/ipc'
import type { TestApi } from '../testing/ipc'
import type { TicketRemoval } from '../ticket-removal'
import type { RoutingApi, UsageApi } from '../usage/ipc'
import type { SignInApi } from '../usage/sign-in'

/**
 * What every call between the two processes carries: one `*Api` interface per area, as the
 * renderer sees it on `window.tinyCorp`. The channel each method travels under is in
 * `./domain/channels`, which imports nothing, so registering a handler costs no types (T184).
 */

export interface CreateCompanyInput {
  folder: string
  name?: string
}

/** What the renderer can ask of the Company engine. Exposed as `window.tinyCorp.company`. */
export interface CompanyApi {
  current(): Promise<Company | null>
  list(): Promise<Company[]>
  create(input: CreateCompanyInput): Promise<Result<Company>>
  open(folder: string): Promise<Result<Company>>
  switchTo(id: string): Promise<Result<Company>>
  /** Company settings: rename, key, boss profile. */
  update(update: CompanyUpdate): Promise<Result<Company>>
  /** Remove from launcher: stops its Sessions and forgets it; the folder stays untouched. */
  forget(id: string): Promise<Result<null>>
  /** Delete company: forgets it and removes its data from the folder; connected repos stay. */
  delete(id: string): Promise<Result<null>>
  /** Shows the native folder picker, opened at the boss's home. Resolves to null when cancelled. */
  pickFolder(): Promise<string | null>
  /** Asks for an image and makes it the current Company's logo (T280); null when the boss cancels. */
  chooseLogo(): Promise<Result<string | null>>
  /** Takes the current Company's logo away, so its initials show again (T280). */
  removeLogo(): Promise<Result<null>>
  /**
   * What the Create step needs to suggest a folder and to warn about one (T252): the boss's home,
   * and the folders OneDrive syncs. Read once; neither moves while the app runs.
   */
  folderHints(): Promise<CompanyFolderHints>
  /**
   * Move… (decision 45): asks for a new folder, stops the Company's Sessions, moves it there and
   * reopens it. Resolves to null when the boss cancels the picker.
   */
  move(id: string): Promise<Result<Company | null>>
  /** The folders a Company should not live in, the OS temp dir among them (see `isTemporaryFolder`). */
  temporaryRoots(): Promise<string[]>
  /** Fires with the new current Company whenever it changes. Returns an unsubscribe function. */
  onChanged(listener: (company: Company | null) => void): () => void
  /**
   * What the Company rail marks on each open Company (T145): its Inbox's unread count and whether it
   * is working. Cached in the engine; a Company that is not open has no entry.
   */
  attention(): Promise<CompanyAttention[]>
  /** Fires when an open Company's rail marks may have changed. Returns an unsubscribe function. */
  onAttentionChanged(listener: () => void): () => void
}

export type { ActivityApi } from '../activity/ipc'
export type { ApprovalApi } from '../approvals/ipc'
export type { McpServersApi, SkillsApi } from '../catalogue/ipc'
/**
 * The slices each feature owns, composed back into one contract (T186). A feature's words live
 * beside the feature — `src/shared/notifications/ipc.ts` — and are re-exported here, so preload
 * and the renderer go on importing `src/shared/ipc` and nothing else.
 */
export type { CodeApi } from '../code/ipc'
export type { EnvironmentApi, RevealedValue } from '../environments/ipc'
export type { EditorsApi, FilesApi, LanguageApi, PathsApi } from '../files/ipc'
export type { HiringApi } from '../hiring/ipc'
export type { AnswererApi, InboxApi } from '../inbox/ipc'
export type { CompanyMemoryApi, NotesApi } from '../memory/ipc'
export type { NotificationApi, NotificationFocusRequest } from '../notifications/ipc'
export type { OfficeApi } from '../office/ipc'
export type { OnboardingApi } from '../onboarding/ipc'
export type { DigestApi, PlanningApi } from '../planning/ipc'
export type { RepoApi } from '../repos/ipc'
export type { RestorePointsApi } from '../restore-points/ipc'
export type { ReviewApi } from '../review/ipc'
export type { RtkApi, RtkView } from '../rtk/ipc'
export type { SandboxApi } from '../sandbox/ipc'
export type { StaffApi } from '../staff/ipc'
export type { TestApi } from '../testing/ipc'
export type { RoutingApi, RoutingSettings, UsageApi } from '../usage/ipc'
export type { SignInApi } from '../usage/sign-in'

export interface TinyCorpApi {
  company: CompanyApi
  staff: StaffApi
  repos: RepoApi
  board: BoardApi
  sessions: SessionApi
  terminals: TerminalApi
  chat: ChatApi
  inbox: InboxApi
  notes: NotesApi
  companyMemory: CompanyMemoryApi
  capacity: CapacityApi
  usage: UsageApi
  routing: RoutingApi
  signIn: SignInApi
  environments: EnvironmentApi
  answerer: AnswererApi
  approvals: ApprovalApi
  office: OfficeApi
  rtk: RtkApi
  /** The Sandbox add-on: ai-jail around every Employee's Session (T260). */
  sandbox: SandboxApi
  mcp: McpServersApi
  skills: SkillsApi
  hiring: HiringApi
  reviews: ReviewApi
  tests: TestApi
  voice: VoiceApi
  buildStyle: BuildStyleApi
  caveman: CavemanApi
  spawnSettings: SpawnSettingsApi
  planning: PlanningApi
  code: CodeApi
  restorePoints: RestorePointsApi
  files: FilesApi
  language: LanguageApi
  paths: PathsApi
  editors: EditorsApi
  notifications: NotificationApi
  digest: DigestApi
  shell: ShellApi
  keepAwake: KeepAwakeApi
  launcher: LauncherApi
  onboarding: OnboardingApi
  activity: ActivityApi
  profile: ProfileApi
  preflight: PreflightApi
  windows: WindowsApi
  crash: CrashApi
  updates: UpdatesApi
}

/**
 * How Employees talk to each other (T180), on the Tokens tab. One Company-wide choice; what the
 * boss reads is never a setting, so nothing here reaches it. Exposed as `window.tinyCorp.voice`.
 */
export interface VoiceApi {
  colleague(): Promise<Result<ColleagueVoice>>
  setColleague(voice: ColleagueVoice): Promise<Result<ColleagueVoice>>
  /** Fires after the voice changes, and on Company switch. */
  onChanged(listener: () => void): () => void
}

/**
 * How Employees build (T194), on the Add-ons tab. One Company-wide choice, and the only one an
 * add-on has: on or off. Exposed as `window.tinyCorp.buildStyle`.
 */
export interface BuildStyleApi {
  get(): Promise<Result<BuildStyle>>
  set(style: BuildStyle): Promise<Result<BuildStyle>>
}

/**
 * How Employees answer the boss (T261), on the Add-ons tab. One Company-wide choice, and the only
 * add-on with more than two values: off, or one of three intensities. Exposed as
 * `window.tinyCorp.caveman`.
 */
export interface CavemanApi {
  get(): Promise<Result<CavemanLevel>>
  set(level: CavemanLevel): Promise<Result<CavemanLevel>>
}

/**
 * The settings written into an Employee's instructions at spawn (T237), as the three cards that
 * hold one read them. Exposed as `window.tinyCorp.spawnSettings`.
 *
 * `onChanged` fires when a Session moves, which is when somebody stops being behind; a setting the
 * boss writes is answered on the spot, so the card that writes one reads this again itself.
 */
export interface SpawnSettingsApi {
  stale(): Promise<Result<StaleSession[]>>
  /** Restarts every idle Session on an old setting; a busy one restarts when its turn ends. */
  applyNow(): Promise<Result<AppliedNow>>
  onChanged(listener: () => void): () => void
}

/** The boss's own profile, shared by every Company (T79). Exposed as `window.tinyCorp.profile`. */
export interface ProfileApi {
  get(): Promise<Result<Boss>>
  /** Your profile's Save changes: name, handle, initials, sprite, status and the sound toggle. */
  update(update: BossUpdate): Promise<Result<Boss>>
  /** Fires after the profile changes. Returns an unsubscribe function. */
  onChanged(listener: () => void): () => void
}

/**
 * What this Windows machine is: its WSL distros and whether Git for Windows' `bash.exe` is here
 * (T249). Read by the first-launch step and by Your profile's Windows rows; every other desktop
 * answers `windows: false` and neither draws anything. Exposed as `window.tinyCorp.windows`.
 */
export interface WindowsApi {
  /** Cached lookups the app has already paid for: it starts no distro and spawns nothing. */
  machine(): Promise<WindowsMachine>
  /**
   * `Check again` beside the Git Bash notice: forgets the cached `PATH` walk and looks again, for
   * the boss who has just installed Git for Windows in the other window. It starts no distro —
   * the distro listing is `Check again` on the Providers card, which is a different question.
   */
  recheck(): Promise<WindowsMachine>
}

/** The current Company's board. Exposed as `window.tinyCorp.board`. */
export interface BoardApi {
  /** Null while no Company is open. */
  snapshot(): Promise<BoardSnapshot | null>
  apply(command: BoardCommand): Promise<Result<BoardSnapshot>>
  /** What deleting a ticket would take with it; it fails with the reason a ticket stays (T275). */
  ticketRemoval(ticketId: number): Promise<Result<TicketRemoval>>
  /**
   * Deletes a ticket that holds no work, with everything that points at it, and resolves to what
   * went. The boss's own action: Employees have no such MCP tool (T275).
   */
  deleteTicket(ticketId: number): Promise<Result<TicketRemoval>>
  /** Fires with the current board after every edit and every Company change. */
  onChanged(listener: (board: BoardSnapshot | null) => void): () => void
}

/** Employees' Sessions in the current Company. Exposed as `window.tinyCorp.sessions`. */
export interface SessionApi {
  list(): Promise<Result<SessionInfo[]>>
  start(employeeId: string): Promise<Result<SessionInfo>>
  stop(employeeId: string): Promise<Result<SessionInfo>>
  /** Whether the current Company is paused (decision 38). */
  paused(): Promise<Result<boolean>>
  /** Pause all: stops every Session of the current Company until `resumeAll`. Resolves to the paused state. */
  pauseAll(): Promise<Result<boolean>>
  /**
   * Resume all: starts the paused Sessions again, parking beyond the cap. Resolves to what the
   * attempt came to (T217), so a resume that brought nobody back does not read like one that
   * brought the whole team.
   */
  resumeAll(): Promise<Result<ResumeAll>>
  /**
   * The command that opens this Employee's Session in the boss's own terminal (T164), built by its
   * Provider's adapter. Null when the Employee has no Session to resume, or its Provider cannot
   * hand one over — the drawer then draws no button and says nothing.
   */
  handoffCommand(employeeId: string): Promise<Result<SessionHandoff | null>>
  /** Fires whenever a Session's status changes. Returns an unsubscribe function. */
  onChanged(listener: () => void): () => void
}

/** Employees' live terminals. Exposed as `window.tinyCorp.terminals`. */
export interface TerminalApi {
  /**
   * Starts streaming the Employee's terminal to this window.
   * Resolves to the recent output, to write before anything `onData` delivers.
   */
  attach(employeeId: string): Promise<Result<string>>
  detach(employeeId: string): Promise<Result<null>>
  /**
   * The system clipboard as text, for a right-click that pastes (T249). The window refuses every
   * permission it is asked, so this is the only way the renderer reads a clipboard; what comes
   * back goes to xterm's own `paste`, which knows about bracketed paste and the PTY does not.
   */
  clipboard(): Promise<Result<string>>
  /** Types into the Employee's Session, e.g. keystrokes or a permission prompt answer. */
  write(employeeId: string, data: string): Promise<Result<null>>
  /** Sets the Employee's PTY size in character cells. */
  resize(employeeId: string, cols: number, rows: number): Promise<Result<null>>
  /** Fires with output of every terminal this window attached to. Returns an unsubscribe function. */
  onData(listener: (employeeId: string, data: string) => void): () => void
}

/** The current Company's chat, where the renderer always speaks as the boss. Exposed as `window.tinyCorp.chat`. */
export interface ChatApi {
  channels(): Promise<Result<Channel[]>>
  read(query: ChatQuery): Promise<Result<Message[]>>
  /** Posts as the boss. `channelId` may be a DM id from `dmChannelId(BOSS, employeeId)`. */
  post(channelId: string, text: string, attachments?: AttachmentSource[]): Promise<Result<Message>>
  reply(messageId: number, text: string, attachments?: AttachmentSource[]): Promise<Result<Message>>
  /** One attachment read for the viewer: an image comes back as a data URL (decision 37). */
  attachment(id: number): Promise<Result<OpenedAttachment>>
  /** How big a file may be and which kinds, so the composer refuses before it sends. */
  attachmentLimits(): Promise<Result<AttachmentLimits>>
  /** What the boss has and has not read, by channel id (T251). */
  unread(): Promise<Result<BossUnread>>
  /** Marks a channel read by the boss. Resolves to whether anything changed. */
  markRead(channelId: string): Promise<Result<boolean>>
  /** Everything addressed to the boss, newest first (decision 43). */
  bossInbox(): Promise<Result<BossInboxItem[]>>
  /** The conversations one Employee takes part in, newest first, with the boss's unread counts (T72). */
  conversations(employeeId: string): Promise<Result<EmployeeConversation[]>>
  /** Every DM two Employees hold with each other, newest first (T77). */
  agentPairs(): Promise<Result<AgentPair[]>>
  /** Marks every channel the boss can see read. Resolves to whether anything changed. */
  markAllRead(): Promise<Result<boolean>>
  /** What deleting a channel would take with it; it fails for a channel that cannot be deleted (T112). */
  channelRemoval(channelId: string): Promise<Result<ChannelRemoval>>
  /**
   * Deletes a channel with everything that points at it, and resolves to what went. The boss's own
   * action: Employees have no such MCP tool (T112).
   */
  deleteChannel(channelId: string): Promise<Result<ChannelRemoval>>
  /** Writes a named channel's topic; an empty one clears it (T44). */
  setTopic(channelId: string, topic: string): Promise<Result<Channel>>
  /** Sets who belongs to a named channel; an empty list means the whole Company (T44). */
  setMembers(channelId: string, memberIds: string[]): Promise<Result<Channel>>
  /** Pins a message as the boss, or unpins it (T44). */
  pin(messageId: number, pinned: boolean): Promise<Result<PinnedMessage | null>>
  /** A channel's pinned messages, newest pin first (T44). */
  pins(channelId: string): Promise<Result<PinnedMessage[]>>
  /** The channel's messages whose body contains the text, newest first (T44). */
  search(query: ChannelSearch): Promise<Result<Message[]>>
  /** The composer's unsent text and files under `key`, without files no longer on disk (TI-1). */
  draft(key: DraftKey): Promise<Result<Draft | null>>
  /** Keeps a composer's draft; an empty one deletes it. */
  saveDraft(key: DraftKey, draft: Draft): Promise<Result<null>>
  clearDraft(key: DraftKey): Promise<Result<null>>
  /** The channels and DMs holding a draft, for the sidebar's pencil. */
  draftedChannels(): Promise<Result<string[]>>
  /** A restored draft file's bytes, for sending: only a path the draft holds is read. */
  draftFile(key: DraftKey, path: string): Promise<Result<DraftFileBytes>>
  /**
   * Where a picked or dropped file is on disk, so a draft can keep it by path. Empty for a file
   * with none, such as an image pasted from the clipboard.
   */
  pathOf(file: File): string
  /** Fires after any new message and on Company switch. Returns an unsubscribe function. */
  onChanged(listener: () => void): () => void
}

/** The current Company's concurrency cap, parked Employees and budget state. Exposed as `window.tinyCorp.capacity`. */
export interface CapacityApi {
  get(): Promise<Result<CapacityInfo>>
  /** Every open Company's Sessions and the app-wide budget, across the whole subscription. */
  usage(): Promise<Result<ClaudeUsage>>
  setConcurrencyCap(cap: number): Promise<Result<CapacityInfo>>
  /** Fires after any capacity or budget change and on Company switch. Returns an unsubscribe function. */
  onChanged(listener: () => void): () => void
}

/** The app window. Exposed as `window.tinyCorp.shell`. */
export interface ShellApi {
  /**
   * `darwin`, `win32` or `linux`, read straight off the preload rather than asked for (T166). The
   * window's frame is the platform's: macOS puts its traffic lights in the bar's left slot and
   * Windows puts its own three buttons in the right one, and the shortcut a screen writes is `⌘`
   * on one and `Ctrl` on the other. Nothing else in the renderer branches on it.
   */
  platform: string
  /** Maximizes the window, or restores it when it already is. */
  toggleMaximize(): Promise<void>
  /**
   * `⌘W`, from the menu's Close Company. The renderer decides what it closes (T121): the view the
   * boss is in first, the Company when nothing else takes it. Returns an unsubscribe function.
   */
  onCloseRequest(listener: () => void): () => void
  /**
   * Every application-menu item whose work belongs to the window: the menu sends the command and
   * the window does what the button does (#223). Returns an unsubscribe function.
   */
  onMenuCommand(listener: (command: MenuCommand) => void): () => void
}

/**
 * The coffee cup on the map: whether the Mac may sleep while the office works (T99). The main
 * process owns the assertion and the boss's mode. Exposed as `window.tinyCorp.keepAwake`.
 */
export interface KeepAwakeApi {
  /** The mode, whether an assertion is held right now, and whether this platform has one. */
  get(): Promise<KeepAwakeState>
  /** The boss picked a mode in the cup's menu. */
  setMode(mode: KeepAwakeMode): Promise<Result<KeepAwakeState>>
  /** Fires whenever the mode or the hold changes. Returns an unsubscribe function. */
  onChanged(listener: (state: KeepAwakeState) => void): () => void
}

/** The two window sizes: the Launcher with no Company open (680×740) and an open Company (1512×944). */
export type WindowLayout = 'launcher' | 'company'

/** What the Launcher window needs beyond the Company API. Exposed as `window.tinyCorp.launcher`. */
export interface LauncherApi {
  /** Every known Company with its staff, running Sessions and last visit. */
  summaries(): Promise<CompanySummary[]>
  /** Whether a folder is a git repo, and the stack its files declare. */
  detectRepo(path: string): Promise<Result<DetectedRepo>>
  /** Resizes the window for the Launcher or for an open Company. */
  setWindowLayout(layout: WindowLayout): Promise<void>
}

/**
 * Whether the CLIs this Company's Employees are hired on can run one (T129, T135). The main process
 * asks each Provider in use once, before the Launcher draws, and remembers the answers, so nothing
 * here ever waits on a subprocess. Exposed as `window.tinyCorp.preflight`.
 */
export interface PreflightApi {
  /** The answers this session was started with, one per Provider in use. Never spawns anything. */
  status(): Promise<ProviderPreflight[]>
  /**
   * Every Provider in the catalogue, hired here or not, in catalogue order (T141). What Your
   * profile's Providers card draws: which CLI is on this Mac is a fact about the machine, not
   * about a Company. Cached beside {@link status} and warmed at start, so it spawns nothing.
   */
  all(): Promise<ProviderPreflight[]>
  /** `Check again`: asks every Provider in use once more and tells every window what came back. */
  recheck(): Promise<Result<ProviderPreflight[]>>
  /** Fires after a `Check again`. Returns an unsubscribe function. */
  onChanged(listener: (preflight: ProviderPreflight[]) => void): () => void
}

/**
 * What a screen that stopped drawing can say for itself (T128). The renderer knows what it caught
 * and, from a build-time define, which version it is; only the main process knows the platform it
 * runs on and where the app's log lives. Exposed as `window.tinyCorp.crash`.
 */
export interface CrashApi {
  /** `darwin`, `win32`, `linux`: the other half of the build a report names. */
  platform: string
  /** Writes what the boundary caught to the app's log, so a tester who never copies is not the only record. */
  record(report: CrashReport): Promise<void>
}

/**
 * Whether a newer build exists (T130). The check lives in the main process and the renderer only
 * draws what it found: it never fetches, and the download page is opened by the main process in
 * the system browser, never in an app window. Exposed as `window.tinyCorp.updates`.
 */
export interface UpdatesApi {
  /** The running version, the newer release if there is one, and when it was last looked for. */
  get(): Promise<UpdateState>
  /** Company settings' `Check now`: asks GitHub whatever the six-hour gate would say. */
  checkNow(): Promise<UpdateState>
  /** `Open the download page`: the release GitHub named, handed to the system browser. */
  openDownloadPage(): Promise<void>
  /** Fires when a check starts or finishes. Returns an unsubscribe function. */
  onChanged(listener: (state: UpdateState) => void): () => void
}
