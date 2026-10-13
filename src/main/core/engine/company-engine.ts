/**
 * The composition root: the one place that knows every feature (T188, T201).
 *
 * It reads in one order: `per`, which is how any feature reaches any other for one open Company;
 * one `register(ctx, deps)` per feature, in the order their runtime chains force; the listener sets
 * more than one of them shares; and the face they add up to. It holds no state of its own and
 * decides nothing — every cache is the Company context's, and every rule belongs to the feature
 * that declared the dependency it needs. What the engine *is* to a screen is `facade.ts`, and what
 * the boss's app hands it is `options.ts`.
 */
import type { Approval } from '../../../shared/approvals'
import { recordingCapacity, recordingWakes, registerActivity } from '../../features/activity'
import { registerApprovals } from '../../features/approvals'
import { registerBoard } from '../../features/board'
import { registerCatalogue } from '../../features/catalogue'
import { registerChat } from '../../features/chat'
import { registerCode, worktreeRootOf } from '../../features/code'
import { registerCompany } from '../../features/company'
import { registerEnvironments } from '../../features/environments'
import { registerFiles } from '../../features/files'
import { type HiringFeature, registerHiring } from '../../features/hiring'
import { registerInbox } from '../../features/inbox'
import { capturingWakes, registerMemory } from '../../features/memory'
import { registerNotifications } from '../../features/notifications'
import { registerOffice } from '../../features/office'
import { registerOnboarding } from '../../features/onboarding'
import { type PlanningFeature, registerPlanning } from '../../features/planning'
import { type ReposFeature, registerRepos, ticketMergeRefusal } from '../../features/repos'
import { registerRestorePoints } from '../../features/restore-points'
import { registerReview } from '../../features/review'
import { registerRtk } from '../../features/rtk'
import { registerSandbox } from '../../features/sandbox'
import { registerSessions } from '../../features/sessions'
import { createRouting, registerStaff, type StaffFeature } from '../../features/staff'
import { registerTesting } from '../../features/testing'
import { registerUsage } from '../../features/usage'
import { createCompanyContext, type OpenCompany } from '..'
import { ignoringCompanyData } from '../company-data-ignore'
import type { CompanyEngine } from './facade'
import { type McpCallerDeps, mcpCallerOf } from './mcp-caller'
import { migrate } from './migrations'
import { type CompanyEngineOptions, withDefaults } from './options'

// The two type files next door, re-exported so every caller still names one module (T201).
export type { CompanyEngine } from './facade'
export type { McpCaller } from './mcp-caller'
export type { CompanyEngineOptions } from './options'

export function createCompanyEngine(options: CompanyEngineOptions): CompanyEngine {
  /**
   * What every `register` below is handed. Each feature's `Deps` says which of these it may read,
   * so spreading the whole bag widens nothing: what a feature can name is what it declared.
   */
  const opts = withDefaults(options)
  /** Which Companies are open, which one is current, and every cache keyed by one. */
  const ctx = createCompanyContext()

  /**
   * How one feature reaches another, for one open Company. Every entry is late-bound on purpose:
   * the features below are built in one pass and several of them call each other, so who exists
   * first must not decide who may call whom.
   */
  const per = {
    staff: (entry: OpenCompany) => staff.of(entry),
    chat: (entry: OpenCompany) => chatFeature.of(entry),
    board: (entry: OpenCompany) => boardFeature.of(entry),
    wakes: (entry: OpenCompany) => sessionsFeature.wakes(entry),
    boardAs: (entry: OpenCompany, actorId: string) => sessionsFeature.boardAs(entry, actorId),
    actingBoard: (entry: OpenCompany, actorId: string) => boardFeature.as(entry, actorId),
    routing: (entry: OpenCompany) => createRouting(() => staff.of(entry).employees.list()),
    repos: (entry: OpenCompany) => reposFeature.of(entry),
    code: (entry: OpenCompany) => codeFeature.code(entry),
    merges: (entry: OpenCompany) => codeFeature.merges(entry),
    approvals: (entry: OpenCompany) => approvalsFeature.of(entry),
    hiring: (entry: OpenCompany) => hiringFeature.of(entry),
    reviews: (entry: OpenCompany) => reviewFeature.reviews(entry),
    security: (entry: OpenCompany) => reviewFeature.security(entry),
    threads: (entry: OpenCompany) => reviewFeature.threads(entry),
    comments: (entry: OpenCompany) => reviewFeature.comments(entry),
    tests: (entry: OpenCompany) => testingFeature.tests(entry),
    appRuns: (entry: OpenCompany) => testingFeature.appRuns(entry),
    planning: (entry: OpenCompany) => planningFeature.of(entry),
    restorePoints: (entry: OpenCompany) => restorePointsFeature.of(entry),
    companyMemory: (entry: OpenCompany) => memoryFeature.companyMemory(entry.company.id),
    notes: (entry: OpenCompany, employeeId: string) => memoryFeature.notes(entry.company.id, employeeId),
    notesBudget: (companyId: string) => memoryFeature.settings(companyId).budget(),
    activity: (entry: OpenCompany) => activityFeature.context(entry),
    chatWithAsks: (entry: OpenCompany) => chatFeature.withAsks(entry),
    deliver: (companyId: string, item: Parameters<typeof inbox.deliver>[1]) => inbox.deliver(companyId, item),
  }

  const repoChecksSet = ctx.listeners()
  /** Every decided Approval, in the order the features below asked to hear about them. */
  const decided = ctx.listeners<[Approval, string]>()
  /** Whichever Company a decided Approval was made in, for the features that only want theirs. */
  const decidedIn = (act: (entry: OpenCompany, approval: Approval) => void) =>
    decided.add((approval, companyId) => {
      const entry = ctx.entryOf(companyId)
      if (entry) act(entry, approval)
    })

  const staff: StaffFeature = registerStaff(ctx, { ...opts })

  const boardFeature = registerBoard(ctx, { ...opts, ...per })
  const boardChanged = { add: boardFeature.onChange, notify: boardFeature.changed }

  const onStaffChange = (listener: () => void) => staff.employees.onChange(listener)

  const environmentsFeature = registerEnvironments(ctx, { ...opts, ...per, notify: staff.notify })
  const { environments } = environmentsFeature

  const catalogue = registerCatalogue(ctx, { ...opts, ...per, notify: staff.notify, onStaffChange })
  const syncSkillsOfCurrent = catalogue.syncWorktrees

  const reposFeature: ReposFeature = registerRepos(ctx, {
    ...opts,
    activity: () => activityFeature.context(ctx.currentEntry())(),
    worktreeRootOf: (repo) => worktreeRootOf(companyFeature.current().folder, repo),
    onRepoChecksSet: repoChecksSet.add,
    ignoringCompanyData: (registry) =>
      ignoringCompanyData(registry, () => engine.listCompanies().map((company) => company.folder)),
  })

  const chatFeature = registerChat(ctx, {
    ...opts,
    posted(entry, message) {
      const companyId = entry.company.id
      companyFeature.inboxChanged(companyId)
      chatFeature.changed()
      // A post is one event, not four (decision 36): the log, the office and the notifications all
      // read it from here rather than each watching the raw message.
      if (activityFeature.posted(entry, message)) {
        office.posted(message)
        notifications.messagePosted(companyId, message)
      }
      inbox.wake(companyId, message)
    },
    moved(companyId) {
      companyFeature.inboxChanged(companyId)
      chatFeature.changed()
    },
    inboxMoved: (companyId) => companyFeature.inboxChanged(companyId),
    asking: (companyId) => sessionsFeature.asking(companyId),
  })

  /** A Session and everything that rides on one: sub-sessions, the seat cap, restore and pause. */
  const sessionsFeature = registerSessions(ctx, {
    ...opts,
    ...per,
    onStaffChange,
    onBoardChange: boardChanged.add,
    limits: () => limits,
    rtkFor: (companyId) => rtk.hookFor(companyId),
    sandboxOn: () => sandbox.jailed(),
    onAsking: (companyId, asked) => notifications.asking(companyId, asked),
    onBudgetExhausted(posts, resetsAt) {
      // One line per Company, and the notification says it once (decision 18).
      activityFeature.budgetExhausted(posts, resetsAt)
      notifications.budgetExhausted(posts, resetsAt)
      opts.onLimitReported?.()
    },
    colleagueVoice: (entry) => chatFeature.voice(entry).colleagueVoice(),
    mcpGrants: (entry, employeeId) => catalogue.grantsFor(entry, employeeId),
    mcpSummaries: (entry, employeeId) => catalogue.serverSummaries(entry, employeeId),
    skills: (entry, employeeId) => catalogue.skillsFor(entry, employeeId),
    environments: (entry) => environmentsFeature.summary(entry),
    answerer: (companyId) => inboxFeature.answerer(companyId),
    places: () => engine.files.places(),
    changesOf: (placeId) => filesFeature.changesOf(placeId),
    asksChanged: () => chatFeature.changed(),
    channelsChanged(companyId) {
      companyFeature.inboxChanged(companyId)
      chatFeature.changed()
    },
    // Every board caller goes through a wake, so wrapping here logs the boss, Employees and flows
    // alike — and a ticket that closes earns its capture (T175).
    watchWakes: (entry, wakes) =>
      capturingWakes(recordingWakes(wakes, activityFeature.context(entry)), (ticketId, actorId) =>
        memoryFeature.captureFromTicket(entry, ticketId, actorId),
      ),
  })
  const { sessions, capacity, subSessions } = sessionsFeature

  // The log is registered after the Sessions because it follows their stream: a Session starting
  // or stopping is activity, and it takes it from the same stream the office reads.
  const activityFeature = registerActivity(ctx, { onSessionActivity: (l) => sessionsFeature.onActivity(l) })

  /** The boss's sign-ins, and what a Company does when a Provider runs out (T173). */
  const usageFeature = registerUsage(ctx, {
    ...opts,
    ...per,
    capacity,
    handoff: (entry, employeeId, move) => sessionsFeature.handoff(entry, employeeId, move),
    handoffPage: (entry, employeeId, handoff, move) => sessionsFeature.handoffPage(entry, employeeId, handoff, move),
    watch: (listener) => sessionsFeature.onRawActivity(listener),
  })
  const { limits } = usageFeature

  /**
   * A Company: the folder, opening it, moving it, forgetting it. Registered after the Sessions,
   * because closing one stops them; handed no feature, only what an open and a close mean.
   */
  const companyFeature = registerCompany(ctx, {
    ...opts,
    migrate,
    opened(entry) {
      // What the worktrees hold is reconciled on the way in, so a folder the boss moved while
      // TinyCorp was closed is not still linked into somebody's worktree (T137).
      syncSkillsOfCurrent()
      // The digest the app was closed for goes up now, if it is still worth posting (T172), and the
      // timer takes this Company's schedule into account from here on.
      void digests.run(entry.company.id)
      digests.rearm()
    },
    closing(entry) {
      const { id } = entry.company
      // Parked Employees go first, so a seat freed by a stop cannot start one of them, and this
      // Company's routing goes before a stop of its own can be routed anywhere.
      sessionsFeature.forgetParked(id)
      limits.forgetCompany(id)
      // The language servers belong to this Company's places, and go with it (T115).
      filesFeature.dispose()
      sessionsFeature.stopAll(id)
    },
    reopened: () => sessionsFeature.reopened(),
    bossInbox: (entry) => per.chat(entry).bossInbox(),
    onActivity: (listener) => sessionsFeature.onActivity(listener),
  })
  const changed = { add: companyFeature.onChange, notify: companyFeature.changed }
  changed.add(staff.notify)

  const inboxFeature = registerInbox(ctx, {
    ...opts,
    ...per,
    sessions,
    onStaffChange,
    invokeSkill: (entry, employeeId, name, prompt) => catalogue.invokeSkill(entry, employeeId, name, prompt),
  })
  const { answerers, inbox } = inboxFeature

  const memoryFeature = registerMemory(ctx, {
    ...opts,
    ...per,
    bossName: () => companyFeature.current().boss.name,
  })

  const { rtk } = registerRtk(ctx, { ...opts })
  const { sandbox } = registerSandbox(ctx, { ...opts })

  const notificationsFeature = registerNotifications(ctx, { ...per })
  const { notifications } = notificationsFeature

  const approvalsFeature = registerApprovals(ctx, {
    ...per,
    mergeRefusal: (entry, ticketId) => ticketMergeRefusal(entry.db, ticketId),
    onChanged: (companyId) => companyFeature.inboxChanged(companyId),
    // The hire or fire an Approval stands for is carried out by staffing, because only staffing
    // can say who it hired — and the line in the log needs that answer.
    onDecided: (companyId, approval) => hiringFeature.decided(ctx.requireEntry(companyId), approval),
  })
  const approvals = approvalsFeature.approvals
  approvals.onDecision((approval, companyId) => decided.notify(approval, companyId))

  const { office } = registerOffice(ctx, {
    ...per,
    sessions,
    redrawnBy: [changed.add, boardChanged.add, approvals.onChange],
  })

  const hiringFeature: HiringFeature = registerHiring(ctx, {
    ...opts,
    ...per,
    startSession: (employeeId) => sessionsFeature.startOrHold(employeeId),
    stopSession: (employeeId) => sessions.stop(employeeId),
    onChange: staff.notify,
  })

  const codeFeature = registerCode(ctx, {
    ...opts,
    ...per,
    onPullRequestOpened: (entry, opened) => notifications.pullRequestOpened(entry.company.id, opened),
    onWorktreeCreated(entry, created) {
      per.restorePoints(entry).worktreeReady(created.ticketId, created.path)
      // The assignee's granted skill folders land in the new worktree, where its product
      // reads them (T137). A folder that has moved is left out and fails nothing.
      syncSkillsOfCurrent()
    },
  })
  decidedIn((entry, approval) => per.code(entry).decided(approval))

  const restorePointsFeature = registerRestorePoints(ctx, {
    ...opts,
    ...per,
    hasGit: opts.git !== undefined,
    stopSession: (employeeId) => sessions.stop(employeeId),
    onSessionActivity: sessions.onActivity,
    onBoardChange: boardChanged.add,
    now: () => new Date(opts.now()),
  })

  /** The Files view over this Company's places (T113). Nothing polls (T160): it is told. */
  const filesFeature = registerFiles(ctx, {
    ...opts,
    ...per,
    sessions,
    invalidatedBy: [changed.add, boardChanged.add, codeFeature.facade.code.onChange, sessions.onActivity],
    beforeDiscard: (input) => per.restorePoints(ctx.currentEntry()).beforeDiscard(input),
  })

  const planningFeature: PlanningFeature = registerPlanning(ctx, {
    ...opts,
    ...per,
    onChange(entry) {
      companyFeature.inboxChanged(entry.company.id)
      boardChanged.notify()
    },
    digestPosted: (companyId, posted) => notifications.digestPosted(companyId, posted),
    onPosted(companyId) {
      companyFeature.inboxChanged(companyId)
      chatFeature.changed()
    },
  })
  const digests = planningFeature.digests

  const reviewFeature = registerReview(ctx, { ...opts, ...per })
  decidedIn((entry, approval) => per.reviews(entry).decided(approval))

  const testingFeature = registerTesting(ctx, {
    ...opts,
    ...per,
    environments: (entry, repoId) => environmentsFeature.valuesForChecks(entry, repoId),
    onTestChanged: (companyId) => companyFeature.inboxChanged(companyId),
    onBoardChange: boardChanged.add,
    boardChanged: boardFeature.changed,
  })
  // After the review flow's, and in the order they were added: a `merge` Approval is answered by
  // whichever of the two raised it, and neither touches what the other is holding.
  decidedIn((entry, approval) => per.merges(entry).decided(approval))

  const { onboarding } = registerOnboarding(ctx, {
    ...opts,
    ...per,
    startSession: (employeeId) => sessionsFeature.startOrHold(employeeId),
    onFinished: () => changed.notify(),
  })

  /** Everything an Employee reaches over MCP, each for the Company the caller belongs to. */
  const mcpDeps: McpCallerDeps = {
    ...per,
    repoChecksSet: repoChecksSet.notify,
    environments: (entry) => environmentsFeature.runs(entry),
    subSessions,
  }

  const engine: CompanyEngine = {
    ...companyFeature.facade,
    ...boardFeature.facade,
    ...chatFeature.facade,
    ...codeFeature.facade,
    ...memoryFeature.facade,
    ...notificationsFeature.facade,
    ...reviewFeature.facade,
    ...sessionsFeature.facade,
    ...testingFeature.facade,
    ...filesFeature.facade,
    ...planningFeature.facade,
    ...activityFeature.facade,

    ...staff.facade,
    ...reposFeature.facade,
    ...catalogue.facade,
    ...usageFeature.facade,
    inbox,
    answerer: answerers,
    capacity: recordingCapacity(capacity, () => activityFeature.context(ctx.currentEntry())()),
    environments,
    approvals,
    office,
    hiring: hiringFeature.hiring,
    restorePoints: restorePointsFeature.restorePoints,
    rtk,
    sandbox,
    onboarding,

    mcpCaller: (companyId, token) => mcpCallerOf(ctx, sessions, companyId, token, mcpDeps),

    close() {
      sessionsFeature.close()
      testingFeature.close()
      filesFeature.dispose()
      office.close()
      limits.close()
      inboxFeature.close()
      companyFeature.close()
      for (const { db } of ctx.open()) db.close()
      notifications.close()
      planningFeature.close()
      // Every Company, every per-Company cache and every listener set, in one call.
      ctx.clear()
    },
  }
  return engine
}
