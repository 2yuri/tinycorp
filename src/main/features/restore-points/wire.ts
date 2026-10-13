import type { CompanyContext, OpenCompany } from '../../core'
import type { ActivityContext } from '../activity'
import type { CompanyChanged } from '../company'
import type { SessionActivity } from '../sessions'
import {
  type CompanyRestorePoints,
  createRestorePoints,
  type RestorePointsOptions as PointsOptions,
  type RestorePoints,
} from './restore-points'
import { createRestoreGit, type RestoreGit } from './restore-points-git'

/** What taking a point, and going back to one, needs of the rest of the app. */
/** What the boss's app hands in, and a test leaves out. */
export interface RestorePointsOptions {
  /**
   * Reads and puts back a worktree for restore points. Defaults to the `git` command line when the
   * app has a git service at all; without one nothing is recorded, because a Company with no git
   * service has no worktrees either.
   */
  restoreGit?: RestoreGit
}

export interface RestorePointsDeps extends RestorePointsOptions {
  log(line: string): void
  /** Whether this app has a git service at all; without one there is nothing to snapshot. */
  hasGit: boolean
  /** Stops the Employee's Session, before any worktree is touched. */
  stopSession(employeeId: string): void
  /**
   * Every Session's activity. A commit in a ticket worktree only shows in the hooks its Session
   * sends, so every hook is a moment to look: the point is taken from the worktree itself,
   * whatever made the commit.
   */
  onSessionActivity(listener: (activity: SessionActivity) => void): () => void
  /** A ticket that closed, or a point past the retention: nothing here grows without bound. */
  onBoardChange(listener: () => void): () => void
  /** How the activity log names who acted, for what the confirmation says will stop. */
  activity(entry: OpenCompany): () => ActivityContext
  /** Now, so a test can age a point past the retention without waiting a week. */
  now(): Date
  /** How long a point is kept, in days. */
  retentionDays?: PointsOptions['retentionDays']
}

/** What the ticket drawer reads, and what tells it a point was taken or dropped. */
export type RestorePointsView = RestorePoints & {
  /** Called after a point is taken or dropped, in any open Company. Returns an unsubscribe function. */
  onChange(listener: () => void): () => void
}

/** The restore-points feature, once it is wired. */
export interface RestorePointsFeature {
  /** The ticket drawer's own reads, over whichever Company is current. */
  restorePoints: RestorePointsView
  /** That Company's points, made the first time they are asked for. */
  of(entry: OpenCompany): CompanyRestorePoints
}

/**
 * Wires a worktree's snapshots to the Companies the app has open (T118, T186).
 *
 * One set per open Company, because the rows and the captured work both live under that Company
 * (decision 45: never in a repo). The engine goes on telling it when a Session hooked, when a
 * worktree was made and when the board moved — three moments only the engine can see.
 */
export function register(ctx: CompanyContext, deps: RestorePointsDeps): RestorePointsFeature {
  const git = deps.restoreGit ?? (deps.hasGit ? createRestoreGit() : undefined)
  const changed = ctx.listeners()
  // A commit in a ticket worktree only shows in the hooks its Session sends, so every hook is a
  // moment to look: the point is taken from the worktree itself, whatever made the commit.
  deps.onBoardChange(() => {
    for (const entry of ctx.open()) {
      try {
        byCompany.of(entry).sweep()
      } catch (error) {
        deps.log(`Restore points: could not sweep ${entry.company.name}: ${(error as Error).message}`)
      }
    }
  })
  deps.onSessionActivity((activity) => {
    const entry = ctx.entryOf(activity.companyId)
    if (!entry || activity.hook === null) return
    try {
      byCompany.of(entry).noticedWork(activity.employeeId)
    } catch (error) {
      deps.log(`Restore points: could not follow ${activity.employeeId}: ${(error as Error).message}`)
    }
  })
  const byCompany = ctx.perCompany((entry) =>
    createRestorePoints({
      db: entry.db,
      folder: entry.company.folder,
      ...(git && { git }),
      ...(deps.retentionDays !== undefined && { retentionDays: deps.retentionDays }),
      stopSession: deps.stopSession,
      nameOf: (employeeId) => deps.activity(entry)().nameOf(employeeId),
      now: deps.now,
      onChange: () => changed.notify(),
      log: deps.log,
    }),
  )

  const current = () => byCompany.current()

  return {
    of: (entry) => byCompany.of(entry),

    restorePoints: {
      of: (ticketId) => current().of(ticketId),
      losses: (id) => current().losses(id),
      goBack: (id) => current().goBack(id),
      onChange: (listener) => changed.add(listener),
    },
  }
}

/** The ticket drawer's restore-point face. */
export interface RestorePointsFacade extends CompanyChanged {
  /** The current Company's restore points: the ticket drawer's list and its way back (T118). */
  restorePoints: RestorePointsView
}
