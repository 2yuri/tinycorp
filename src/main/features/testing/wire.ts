import type { Plan } from '../../../shared/planning/planning'
import type { CompanyContext, OpenCompany } from '../../core'
import type { OwnFace } from '../company'
import { type AppRuns, type AppRunsOptions, createAppRuns } from './app-runs'
import type { TestingFacade } from './facade'
import { type CompanyTests, createTestFlow, type TestFlowOptions } from './test-flow'

/**
 * What Testing reaches for, one Company at a time.
 *
 * Every one of these is a function of the Company, because Testing is wired once and then serves
 * whichever Companies the boss has open. The types are read off the two factories' own options, so
 * this interface can never drift from what they actually take.
 */
export interface TestingDeps extends TestingOptions {
  log(line: string): void
  /** That ticket's worktrees, which is where a run command and a screenshot land. */
  code(entry: OpenCompany): AppRunsOptions['code']
  chat(entry: OpenCompany): TestFlowOptions['chat']
  /** The board acting as `actorId`, so a move wakes whoever it concerns. */
  boardAs(entry: OpenCompany, actorId: string): ReturnType<TestFlowOptions['board']>
  /** Files an inbox item for that Company. */
  deliver(companyId: string, item: Parameters<TestFlowOptions['deliver']>[0]): void
  /** Who holds each capability there, so a tester who is not the assignee can be found. */
  routing(entry: OpenCompany): { tester(assigneeId: string): string | null }
  /** That Company's plans, for the acceptance criteria a script starts from (T171). */
  planning(entry: OpenCompany): { of(target: { kind: 'ticket' | 'epic'; id: number }): Plan | null }
  /** Testing passed: review's merge is what was waiting on it. */
  reviews(entry: OpenCompany): { testingPassed(ticketId: number): void }
  /** The Company's Environments, for a repo whose default one is available to checks (T176). */
  environments(entry: OpenCompany, repoId: string): ReturnType<NonNullable<AppRunsOptions['environment']>>
  /** A ticket left Testing, anywhere, and takes its attempt and its running app with it. */
  onBoardChange(listener: () => void): () => void
  /** A ticket moved, because entering or leaving Testing is a board move of its own. */
  boardChanged(): void
  /**
   * An attempt, a step or a screenshot changed. It is not the same event as a run changing: this
   * one also moves a ticket and files an inbox item, so the board and the Inbox redraw with it.
   */
  onTestChanged(companyId: string): void
}

/** What the boss's app hands in, and a test leaves out. */
export interface TestingOptions {
  /**
   * How `Run it` starts a repo's run command (T174). Defaults to the platform shell; a test hands
   * in a fake, so no suite anywhere starts a real dev server.
   */
  spawnRun?: AppRunsOptions['spawnRun']
  /**
   * Where the team runs (T259). `Run it` starts the repo's own command in the ticket's worktree, and
   * when that worktree is inside a distro the command has to be too: `pnpm dev` needs the
   * `node_modules` that was installed in there, and a port it opens is reached through `localhost`
   * either way. Left out, it runs on this machine, which is every Mac and every Linux desktop.
   */
  teamRuntime?: AppRunsOptions['runtime']
}

/** The Testing feature, once it is wired. */
export interface TestingFeature {
  /** That Company's Testing stage, made the first time it is asked for. */
  tests(entry: OpenCompany): CompanyTests
  /** The Company the boss is looking at, for the screens and the IPC module. */
  currentTests(): CompanyTests
  /** That Company's `Run it` processes. */
  appRuns(entry: OpenCompany): AppRuns
  currentAppRuns(): AppRuns
  /** The app is quitting: everything still running is stopped first, then dropped. */
  close(): void
  facade: OwnFace<TestingFacade>
}

/**
 * Wires the Testing stage and the apps it runs (T174, T186).
 *
 * The two are one feature because they call each other: a ticket entering Testing may start an app,
 * and a ticket leaving it stops one. Each is made per Company and lazily, so neither has to exist
 * before the other.
 */
export function register(ctx: CompanyContext, deps: TestingDeps): TestingFeature {
  const changed = ctx.listeners()
  // A ticket dragged out of Testing — to Doing, to Done, anywhere — takes its running app with it.
  deps.onBoardChange(() => boardMoved())
  const runsByCompany = ctx.perCompany(
    (entry) => {
      const runs = createAppRuns({
        db: entry.db,
        code: deps.code(entry),
        ...(deps.spawnRun && { spawnRun: deps.spawnRun }),
        ...(deps.teamRuntime && { runtime: deps.teamRuntime }),
        environment: (repoId) => deps.environments(entry, repoId),
        log: deps.log,
      })
      runs.onChange(() => changed.notify())
      return runs
    },
    // Closing a Company — Remove from launcher, a move, a delete — is not a pause either: the dev
    // servers it started are children of this process, and dropping the cache without killing them
    // leaves them holding their ports for as long as the app is up (T201).
    (runs) => runs.stopAll(),
  )

  const testsByCompany = ctx.perCompany((entry) => {
    const companyId = entry.company.id
    return createTestFlow({
      db: entry.db,
      chat: deps.chat(entry),
      folder: entry.company.folder,
      code: deps.code(entry),
      board: (actorId) => deps.boardAs(entry, actorId),
      deliver: (item) => deps.deliver(companyId, item),
      tester: (assigneeId) => deps.routing(entry).tester(assigneeId),
      // A ticket under an epic is worked to the epic's plan when it has none of its own (T171),
      // so that is where its acceptance criteria come from too.
      planOf: (ticketId, epicId) =>
        deps.planning(entry).of({ kind: 'ticket', id: ticketId }) ??
        (epicId === null ? null : deps.planning(entry).of({ kind: 'epic', id: epicId })),
      runs: runsByCompany.of(entry),
      onPassed: (ticketId) => deps.reviews(entry).testingPassed(ticketId),
      onChange() {
        deps.onTestChanged(companyId)
        changed.notify()
        deps.boardChanged()
      },
    })
  })

  function boardMoved(): void {
    for (const entry of ctx.open()) {
      try {
        const rows = entry.db.prepare("SELECT id FROM ticket WHERE column_id = 'testing'").all() as { id: number }[]
        runsByCompany.of(entry).stopUnless(rows.map((row) => row.id))
      } catch (error) {
        deps.log(`Testing: could not stop what ${entry.company.name} was running: ${(error as Error).message}`)
      }
    }
  }

  const current = () => testsByCompany.current()
  const runs = () => runsByCompany.current()

  return {
    tests: (entry) => testsByCompany.of(entry),
    appRuns: (entry) => runsByCompany.of(entry),
    currentTests: current,
    currentAppRuns: runs,

    facade: {
      tests: {
        of: (ticketId) => current().of(ticketId),
        list: () => current().list(),
        addStep: (input) => current().addStep(input),
        setStep: (input) => current().setStep(input),
        attach: (input) => current().attach(input),
        attachmentPath: (id) => current().attachmentPath(id),
        openAttachment: (id) => current().openAttachment(id),
        pass: (ticketId) => current().pass(ticketId),
        reportBug: (input) => current().reportBug(input),
        refusal: (ticketId) => current().refusal(ticketId),
        settings: () => current().settings.settings(),
        setMode: (mode) => current().settings.setMode(mode),
        setRepo: (repoId, changes) => current().settings.setRepo(repoId, changes),
        onChange: (listener) => changed.add(listener),
      },
      /**
       * The current Company's runs, member by member rather than the object: the screens hold the
       * face for as long as the app is open, and which Company is current changes under them.
       */
      appRuns: {
        runnable: (ticketId) => runs().runnable(ticketId),
        of: (ticketId) => runs().of(ticketId),
        start: (input) => runs().start(input),
        stop: (ticketId, repoId) => runs().stop(ticketId, repoId),
        log: (ticketId, repoId) => runs().log(ticketId, repoId),
        stopTicket: (ticketId) => runs().stopTicket(ticketId),
        stopUnless: (ticketIds) => runs().stopUnless(ticketIds),
        stopAll: () => runs().stopAll(),
        onChange: (listener) => runs().onChange(listener),
      },
    },

    close() {
      // The app quitting is not a pause, but a child process does not come back on its own: every
      // run is killed here, or it outlives the app that started it. The context empties the caches.
      for (const runs of runsByCompany.made()) runs.stopAll()
    },
  }
}
