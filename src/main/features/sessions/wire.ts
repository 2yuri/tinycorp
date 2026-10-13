import { DEFAULT_COLLEAGUE_VOICE } from '../../../shared/colleague-voice'
import type { Message } from '../../../shared/domain/chat'
import type { Provider } from '../../../shared/domain/staff'
import { askingInboxItems, type BossInboxItem } from '../../../shared/inbox/boss-inbox'
import type { Repo } from '../../../shared/repos/repo'
import type { RtkHook } from '../../../shared/rtk'
import type { SessionAsk } from '../../../shared/session'
import type { SpawnSettings } from '../../../shared/spawn-settings'
import type { CompanyContext, OpenCompany } from '../../core'
import type { GitService, SecretStore } from '../../platform'
import type { GrantedMcpServer, ProviderAdapters } from '../../providers'
import type { CompanyApprovals } from '../approvals'
import type { Board } from '../board'
import type { Chat } from '../chat'
import type { CompanyCodeFlow } from '../code'
import type { OwnFace } from '../company'
import type { NewInboxItem } from '../inbox'
import { type CompanyMemory, type EmployeeNotes, renderWake } from '../memory'
import type { CompanyRestorePoints } from '../restore-points'
import type { ReviewComments, ReviewThreads } from '../review'
import type { CompanyStaff } from '../staff'
import type { HandoffMove, UsageLimits } from '../usage'
import { type BriefChanges, type BriefPlace, type Briefs, createBriefs } from './brief'
import { createBuildStyleSettings } from './build-style'
import { type CapacityService, createCapacity } from './capacity'
import { createCavemanSettings } from './caveman'
import type {
  BuildStyleFacade,
  CapacityFacade,
  CavemanFacade,
  SessionsFacade,
  SpawnSettingsFacade,
  TerminalsFacade,
} from './facade'
import type { RoutingHandoff } from './handoff-prompt'
import type { CompanyBrief } from './instructions'
import { createPause, type PausableSessions } from './pause'
import { createRestore } from './restore'
import { type BudgetSignal, createSessions, type SessionActivity } from './sessions'
import { createSpawnSettings } from './spawn-settings'
import { createSubSessionGit, type SubSessionGit } from './sub-session-git'
import { createSubSessions, finishedPrompt, type SubSessions } from './sub-sessions'
import { createTerminals, type Terminals } from './terminals'
import { type ActingBoard, createTicketWakes, type TicketWakes } from './ticket-wakes'

/**
 * What a Session reaches for, and what it tells the rest of the app.
 *
 * Nearly every entry takes the Company it is about rather than the current one: a Session belongs
 * to a Company, and a brief, a wake or a handoff is written for that Company even while the boss is
 * looking at another. The neighbours come in whole rather than as one lambda per field, because the
 * narrowing is this feature's own business — what a brief reads off the chat is not something the
 * composition root should have to know.
 */
export interface SessionsOptions {
  /** The Company MCP server's URL for a Company, injected into every Session. */
  mcpUrl?: (companyId: string, provider: Provider) => string
  /** Makes and removes sub-sessions' own worktrees (T163). Defaults to the `git` command line. */
  subSessionGit?: SubSessionGit
  /**
   * Why a Provider's CLI cannot run an Employee right now, or null when it can (T129). Without
   * one, every start is allowed and a broken CLI is a terminal full of nothing.
   */
  refuseSession?: (provider: Provider) => string | null
}

export interface SessionsDeps extends SessionsOptions {
  providers: ProviderAdapters
  /** Where an outside MCP server's secrets are kept; read once per spawn and held nowhere (T136). */
  secrets: SecretStore
  /** Creates ticket worktrees and opens PRs; a brief says why a repo can get no PR. */
  git?: GitService
  log(line: string): void
  now(): number

  staff(entry: OpenCompany): CompanyStaff
  /**
   * Called after roles or Employees change (T268): how an edit reaches a Session that is already
   * running. Without it, a saved Employee takes effect at their next start, as it did before.
   */
  onStaffChange?(listener: () => void): () => void
  chat(entry: OpenCompany): Chat
  board(entry: OpenCompany): Board
  code(entry: OpenCompany): CompanyCodeFlow
  approvals(entry: OpenCompany): CompanyApprovals
  comments(entry: OpenCompany): ReviewComments
  threads(entry: OpenCompany): ReviewThreads
  restorePoints(entry: OpenCompany): CompanyRestorePoints
  companyMemory(entry: OpenCompany): CompanyMemory
  /** What an Employee is working on while its own Provider is out, and who it runs as (T173). */
  limits(): UsageLimits
  /** The RTK a Session of this Company is spawned with (T179), read at every spawn. */
  rtkFor(companyId: string): RtkHook | null
  /** Whether a Session of this Company starts inside ai-jail (T260), read at the same spawn. */
  sandboxOn(companyId: string): boolean

  /** Files an Inbox item for that Company. */
  deliver(companyId: string, item: NewInboxItem): void
  /** A Session stopped in its terminal to ask the boss (T165): tell them, wherever they are. */
  onAsking(companyId: string, asked: { employeeId: string; ask: SessionAsk }): void
  /** The subscription limit, as one event per Company and one notification for all of them. */
  onBudgetExhausted(posts: { companyId: string; message: Message }[], resetsAt: Date | null): void
  /** The colleague voice a brief is written in (T180). */
  colleagueVoice(entry: OpenCompany): CompanyBrief['colleagueVoice']
  /** That Employee's own notes, as the fixed-size wake a Session starts with (T193). */
  notes(entry: OpenCompany, employeeId: string): EmployeeNotes
  /** That Company's `Read at session start`, in tokens: the budget the wake is planned against. */
  notesBudget(companyId: string): number
  /** That Company's attached repos, as the brief lists them. */
  repos(entry: OpenCompany): { list(): Repo[] }
  /** The outside MCP servers this Employee holds, with their secrets, read at the spawn (T136). */
  mcpGrants(entry: OpenCompany, employeeId: string): GrantedMcpServer[]
  /** The same servers as a brief lists them: name and purpose, never a value. */
  mcpSummaries(entry: OpenCompany, employeeId: string): CompanyBrief['mcpServers']
  /** The skill folders it holds, as the brief lists them. */
  skills(entry: OpenCompany, employeeId: string): CompanyBrief['skills']
  /** What the Company keeps in each Environment, by name and never by value (T176). */
  environments(entry: OpenCompany): CompanyBrief['environments']
  /** Who answers the boss when a message addresses nobody (decision 41). */
  answerer(companyId: string): { id: string; name: string } | null
  /** Every place the Files view can open, and one place's `git status`, for a handoff. */
  places(): BriefPlace[]
  changesOf(placeId: string): BriefChanges
  /** An ask appeared or cleared: the Inbox shows one row per Session that is waiting. */
  asksChanged(): void
  /** Wraps a Company's ticket wakes in whatever else watches them: the log, and the memory capture. */
  watchWakes(entry: OpenCompany, wakes: TicketWakes): TicketWakes
  /** A channel appeared, or a wake moved what the Inbox shows. */
  channelsChanged(companyId: string): void
  /** A ticket done, or handed to someone else, takes the sub-sessions working on it (T163). */
  onBoardChange(listener: () => void): () => void
}

/** Sessions, once they are wired. */
export interface SessionsFeature {
  /** Employees' Sessions, with the Company's Pause all and Resume all over them. */
  sessions: PausableSessions
  /** Employees' live terminals: output, input and size. */
  terminals: Terminals
  /** The Company's concurrency cap, its parked Employees and the app's budget state. */
  capacity: CapacityService
  /** The Sessions Employees start of their own (T163). */
  subSessions: SubSessions
  /** That Company's ticket wakes, and the board that sends them. */
  wakes(entry: OpenCompany): TicketWakes
  /** The board every caller edits through, acting as somebody. */
  boardAs(entry: OpenCompany, actorId: string): ActingBoard
  /** One Session stopped in its terminal asking the boss, as the Inbox shows it (T165). */
  asking(companyId: string): BossInboxItem[]
  /** Starts an Employee's Session, or parks it when the Company is at its cap. */
  startOrHold(employeeId: string): void
  /** A Company reopened: the Sessions that were running when it closed start again. */
  reopened(): void
  /**
   * That Company is closing. Its parked Employees go first, so a seat freed by a stop below cannot
   * start one of them, and the two halves are separate calls because what the composition root does
   * between them — dropping the Company's routing — has to happen before a stop can be routed.
   */
  forgetParked(companyId: string): void
  /** Every Session that Company is running. */
  stopAll(companyId: string): void
  /** A handover's brief, and the Handoff page it leaves behind (T173, T175). */
  handoff(entry: OpenCompany, employeeId: string, move: HandoffMove): RoutingHandoff
  handoffPage(entry: OpenCompany, employeeId: string, handoff: RoutingHandoff, move: HandoffMove): string | null
  /** Every Session's activity, as the screens see it: the office, the log and the caches watch this. */
  onActivity(listener: (activity: SessionActivity) => void): () => void
  /**
   * The same stream before the cap masks a status — a parked Employee reads `off` here and `parked`
   * above. Only usage wants it: whether an Employee is mid-turn decides when it may be moved to
   * another Provider, and a masked status would move one in the middle of an edit (T173).
   */
  onRawActivity(listener: (activity: SessionActivity) => void): () => void
  /** The app is quitting: sub-sessions first, while their worktrees can still get a restore point. */
  close(): void
  /** The staff feature already puts the roster on the engine, so the terminals' half is the PTYs. */
  facade: SessionsFacade &
    Omit<TerminalsFacade, 'employees'> &
    OwnFace<CapacityFacade> &
    BuildStyleFacade &
    CavemanFacade &
    SpawnSettingsFacade
}

/**
 * Wires a Session and everything that hangs off one (T188, T201).
 *
 * The order below is the one chain in this feature that cannot be rearranged: a sub-session rides
 * on its parent's Session, capacity counts the Sessions, restore reads what capacity holds and
 * pause wraps restore. Each layer takes the one under it and hands on a `sessions` that has grown
 * one more behaviour, and the screens only ever see the last one.
 */
export function register(ctx: CompanyContext, deps: SessionsDeps): SessionsFeature {
  const subSessionGit = deps.subSessionGit ?? (deps.git ? createSubSessionGit() : undefined)
  const terminals = createTerminals()
  deps.onBoardChange(() => {
    for (const entry of ctx.open()) {
      try {
        subSessions.ticketsChanged(entry.company.id)
      } catch (error) {
        deps.log(`Sub-sessions: could not follow ${entry.company.name}: ${(error as Error).message}`)
      }
    }
  })
  const briefOf = (entry: OpenCompany, employeeId: string): CompanyBrief => briefs.of(entry, employeeId)
  /**
   * Lean builder, per Company (T194). It lives here rather than beside the other settings because
   * the only thing it changes is what a Session is told at spawn.
   */
  const buildStyles = ctx.perCompany((entry) => createBuildStyleSettings(entry.db))
  /** Caveman, per Company (T261). Beside the build style, and for the same reason. */
  const cavemen = ctx.perCompany((entry) => createCavemanSettings(entry.db))

  const subSessions: SubSessions = createSubSessions({
    providers: deps.providers,
    company(companyId) {
      const entry = ctx.entryOf(companyId)
      return entry ? { db: entry.db, employees: deps.staff(entry).employees.list() } : null
    },
    seats: () => capacity.seats,
    ...(subSessionGit !== undefined && { git: subSessionGit }),
    ...(deps.mcpUrl !== undefined && { mcpUrl: deps.mcpUrl }),
    mcpGrants(companyId, employee) {
      const entry = ctx.entryOf(companyId)
      return entry ? deps.mcpGrants(entry, employee.id) : []
    },
    brief(companyId, employee, sub) {
      return { ...briefOf(requireEntry(companyId), employee.id), subSession: sub }
    },
    onSpawn: terminals.track,
    beforeRemoving(companyId, point) {
      const entry = ctx.entryOf(companyId)
      if (entry) deps.restorePoints(entry).beforeRemovingSubSession(point)
    },
    finished(companyId, sub) {
      const entry = ctx.entryOf(companyId)
      if (!entry) return
      deps.deliver(companyId, {
        employeeId: sub.parentId,
        kind: 'session',
        fromId: sub.parentId,
        channelId: null,
        threadId: null,
        messageId: null,
        ticketId: sub.ticketId,
        text: `${sub.name} ${sub.state === 'done' ? 'finished' : 'stopped'}`,
        prompt: finishedPrompt(entry.company.key, sub),
      })
    },
    onBudgetExhausted: (signal: BudgetSignal) => deps.limits().reported(signal),
    log: deps.log,
    now: () => new Date(deps.now()),
  })

  /**
   * What this Company's Session is started with and cannot be told again mid-turn (T237): the
   * colleague voice, the notes budget, the build style, Caveman and the Sandbox add-on. Read here
   * rather than in each of the features, because a Session is where they meet.
   */
  function spawnSettingsOf(companyId: string): SpawnSettings {
    const entry = requireEntry(companyId)
    return {
      // A Company whose voice nothing answers writes the instructions terse, so that is what its
      // Sessions are compared against — never `undefined`, which differs from itself.
      colleagueVoice: deps.colleagueVoice(entry) ?? DEFAULT_COLLEAGUE_VOICE,
      notesBudget: deps.notesBudget(companyId),
      buildStyle: buildStyles.of(entry).buildStyle(),
      caveman: cavemen.of(entry).caveman(),
      // A string rather than a boolean, because `SpawnSettings` compares values and the strip
      // names the setting rather than printing it.
      sandbox: deps.sandboxOn(companyId) ? 'on' : 'off',
    }
  }

  function requireEntry(companyId: string): OpenCompany {
    const entry = ctx.entryOf(companyId)
    if (!entry) throw new Error(`Company ${companyId} is not open`)
    return entry
  }

  const sessionService = createSessions({
    providers: deps.providers,
    subSessions,
    current: () => {
      const entry = ctx.currentEntry()
      return { folder: entry.company.folder, db: entry.db, companyId: entry.company.id }
    },
    employees: () => deps.staff(ctx.currentEntry()).employees.list(),
    onSpawn: terminals.track,
    ...(deps.mcpUrl !== undefined && { mcpUrl: deps.mcpUrl }),
    // The keychain is read here and nowhere else: once per Session start, for the servers this
    // Employee holds, and the values go straight onto the process the adapter spawns (T136).
    mcpGrants: (where, employee) => deps.mcpGrants(requireEntry(where.companyId), employee.id),
    company(companyId) {
      const entry = ctx.entryOf(companyId)
      if (!entry) return null
      const { folder, id } = entry.company
      return { folder, db: entry.db, companyId: id, employees: deps.staff(entry).employees.list() }
    },
    onBudgetExhausted: (signal) => deps.limits().reported(signal),
    runAs: (companyId, employee) => deps.limits().runAs(companyId, employee),
    accountFor: (companyId, employee) => deps.limits().accountFor(companyId, employee),
    routingOf: (companyId, employeeId) => deps.limits().routingOf(companyId, employeeId),
    // Read at every spawn (T179): what the Company's toggle says now, not what it said when the
    // Session before this one started.
    rtkFor: (companyId) => deps.rtkFor(companyId),
    brief: (companyId, employee) => briefOf(requireEntry(companyId), employee.id),
    // The three settings a Session bakes in, read at the same moment as the brief they are written
    // into (T237), and kept beside the Session as what it is running on until it starts again.
    spawnSettings: spawnSettingsOf,
    takeResume: (_companyId, employeeId) => restore.takeResume(employeeId),
    onResumeFailed: (companyId, employeeId) => restore.prime(companyId, employeeId),
    ...(deps.refuseSession && { refuseSession: deps.refuseSession }),
    onAsking({ companyId, employeeId, ask }) {
      try {
        deps.onAsking(companyId, { employeeId, ask })
      } catch (error) {
        deps.log(`Notifications: could not say ${employeeId} is asking: ${(error as Error).message}`)
      }
    },
  })
  // An Employee's Session ending — stopped, paused, fired or crashed — takes its sub-sessions with it.
  sessionService.onActivity(({ companyId, employeeId, status }) => {
    if (status !== 'off') return
    try {
      subSessions.parentStopped(companyId, employeeId)
    } catch (error) {
      deps.log(`Sub-sessions: could not stop ${employeeId}’s: ${(error as Error).message}`)
    }
  })

  const capacity = createCapacity({
    sessions: sessionService,
    current: () => {
      const entry = ctx.currentEntry()
      return { companyId: entry.company.id, db: entry.db, employees: deps.staff(entry).employees.list() }
    },
    company(companyId) {
      const entry = ctx.entryOf(companyId)
      return entry ? { db: entry.db, chat: deps.chat(entry) } : null
    },
    companies: () =>
      ctx.open().map((entry) => ({
        id: entry.company.id,
        name: entry.company.name,
        db: entry.db,
        employees: deps.staff(entry).employees.list(),
      })),
    log: deps.log,
    onBudgetExhausted: deps.onBudgetExhausted,
    effectiveProvider: (companyId, employeeId, hired) => deps.limits().effectiveProvider(companyId, employeeId, hired),
    teamStopped: (companyId, provider) => deps.limits().teamStopped(companyId, provider),
    now: deps.now,
  })

  const restore = createRestore({
    sessions: capacity.sessions,
    paused: () => isPaused(),
    current: () => ctx.currentEntry().db,
    company(companyId) {
      const entry = ctx.entryOf(companyId)
      return entry
        ? {
            db: entry.db,
            people: deps.chat(entry).people(),
            tickets: () => deps.board(entry).snapshot().tickets,
            deliver: (item) => deps.deliver(companyId, item),
          }
        : null
    },
    log: deps.log,
  })

  const pause = createPause({
    sessions: restore.sessions,
    resume: (employeeId) => restore.resume(employeeId),
    restoring: () => restore.restoring(),
    current: () => {
      const entry = ctx.currentEntry()
      return { name: entry.company.name, db: entry.db, employees: deps.staff(entry).employees.list() }
    },
    log: deps.log,
  })
  const sessions = pause.sessions

  const spawnSettings = createSpawnSettings({
    sessions,
    employees: () => deps.staff(ctx.currentEntry()).employees.list(),
    log: deps.log,
  })
  // A saved Employee reaches the Session it is running now (T268): restarted where it stands.
  deps.onStaffChange?.(() => {
    try {
      spawnSettings.applyEdits()
    } catch (error) {
      deps.log(`Sessions: could not apply an Employee's saved changes: ${(error as Error).message}`)
    }
  })

  /**
   * Whether the current Company is paused, asked by the restore below it. It cannot throw: a folder
   * whose tables the app cannot make sense of still opens, and says so elsewhere.
   */
  function isPaused(): boolean {
    try {
      return sessions.paused()
    } catch (error) {
      deps.log(`Pause: could not tell whether the Company is paused: ${(error as Error).message}`)
      return false
    }
  }

  /**
   * The Sessions that are stopped in their terminal asking the boss (T165), as Inbox rows. Read
   * from the Sessions every time rather than stored: a row is there exactly while the ask is, so
   * nothing has to resolve it — answering in the terminal does.
   */
  function asking(companyId: string): BossInboxItem[] {
    const people = deps.chat(requireEntry(companyId)).people()
    const asks = sessions
      .list()
      .flatMap((session) => (session.asking ? [{ employeeId: session.employeeId, ask: session.asking }] : []))
    return askingInboxItems(asks, (id) => people.find((person) => person.id === id)?.name ?? 'An Employee')
  }
  // An ask appearing or clearing changes what the Inbox shows, so the Inbox is told like chat is.
  sessions.onChange(deps.asksChanged)

  const wakes = ctx.perCompany((entry) =>
    deps.watchWakes(
      entry,
      createTicketWakes({
        db: entry.db,
        board: deps.board(entry),
        people: () => deps.chat(entry).people(),
        deliver: (item) => deps.deliver(entry.company.id, item),
        channelsChanged: () => deps.channelsChanged(entry.company.id),
      }),
    ),
  )

  /**
   * What a Session is told at spawn, and what the next one is told when an Employee moves Provider
   * (T173, T175). Both are compositions of other features and nothing else, which is why they take
   * the façades they read rather than anything of this feature's.
   */
  const briefs: Briefs = createBriefs({
    employees: (entry) => deps.staff(entry).employees.list(),
    repos: (entry) => deps.repos(entry).list(),
    pullRequestRefusal: (repoPath) => deps.git?.pullRequestRefusal(repoPath) ?? null,
    columns: (entry) =>
      deps
        .board(entry)
        .snapshot()
        .columns.map(({ id, wipLimit }) => ({ id, wipLimit })),
    tickets: (entry) => deps.board(entry).snapshot().tickets,
    worktreesOf: (entry, ticketId) => deps.code(entry).of(ticketId).worktrees,
    people: (entry) => deps.chat(entry).people(),
    recentMessages: (entry, employeeId, limit) => {
      const chat = deps.chat(entry)
      return chat
        .channels()
        .filter((channel) => channel.members.includes(employeeId) || channel.id === 'general')
        .flatMap((channel) => chat.read({ channelId: channel.id, limit }))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .slice(-limit)
    },
    reviewComments: (entry, ticketId) => deps.comments(entry).list(ticketId),
    roundLimit: (entry) => deps.threads(entry).roundLimit(),
    autonomy: (entry) => deps.approvals(entry).level(),
    colleagueVoice: deps.colleagueVoice,
    buildStyle: (entry) => buildStyles.of(entry).buildStyle(),
    caveman: (entry) => cavemen.of(entry).caveman(),
    mcpServers: deps.mcpSummaries,
    skills: deps.skills,
    environments: deps.environments,
    notes: (entry, employeeId) => {
      const budget = deps.notesBudget(entry.company.id)
      const wake = deps.notes(entry, employeeId).wake(budget)
      return { text: renderWake(wake.items), total: wake.total, tokens: wake.tokens, budget, due: wake.due }
    },
    companyMemory: (entry, repoNames) => {
      const memory = deps.companyMemory(entry)
      return { folder: memory.folder, pages: memory.brief(repoNames), total: memory.counts().pages }
    },
    writeHandoffPage: (entry, page) =>
      deps.companyMemory(entry).writeHandoff({
        title: page.title,
        body: page.body,
        by: entry.company.name,
        ...(page.ticketCode && { sources: [`ticket:${page.ticketCode}`] }),
      }).slug,
    answerer: deps.answerer,
    places: deps.places,
    changesOf: deps.changesOf,
    log: deps.log,
  })

  return {
    sessions,
    terminals,
    capacity,
    subSessions,
    wakes: (entry) => wakes.of(entry),
    boardAs: (entry, actorId) => wakes.of(entry).boardAs(actorId),
    asking,
    startOrHold: (employeeId) => {
      pause.startOrHold(employeeId)
    },
    /*
     * A paused Company reopens paused (decision 38). The pause normally leaves nothing owed a
     * Session, so this used to be true by accident; a pause row that outlived its holds — an older
     * build's, or one written before `stopAll` held the reopen's own list — let a reopen start the
     * whole floor while the header still read `Resume all` (T217). What is owed stays owed, and
     * `Resume all` is what brings it back.
     */
    reopened: () => restore.reopened(),
    forgetParked: (companyId) => capacity.forgetCompany(companyId),
    stopAll(companyId) {
      const entry = ctx.entryOf(companyId)
      if (!entry) return
      for (const employee of deps.staff(entry).employees.list()) sessionService.stop(employee.id)
    },
    handoff: (entry, employeeId, move) => briefs.handoff(entry, employeeId, move),
    handoffPage: (entry, employeeId, handoff, move) => briefs.handoffPage(entry, employeeId, handoff, move),
    onActivity: (listener) => sessions.onActivity(listener),
    onRawActivity: (listener) => sessionService.onActivity(listener),
    close() {
      // The app quitting is not a pause: every Session comes back on the next open. Sub-sessions do
      // not come back: they go first, while their worktrees can still get a restore point.
      subSessions.stopAll()
      restore.sessions.stopAll()
      capacity.close()
      terminals.clear()
    },
    facade: {
      sessions,
      terminals,
      capacity,
      buildStyle: {
        get: () => buildStyles.current().buildStyle(),
        set: (style) => buildStyles.current().setBuildStyle(style),
      },
      caveman: {
        get: () => cavemen.current().caveman(),
        set: (level) => cavemen.current().setCaveman(level),
      },
      spawnSettings,
    },
  }
}
