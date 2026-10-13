import type { DatabaseSync } from 'node:sqlite'
import type { AutonomyLevel } from '../../../shared/approvals'
import { BOSS, dmChannelId, type Message } from '../../../shared/domain/chat'
import { type Employee, resolveAnswerer } from '../../../shared/domain/staff'
import {
  goalInstruction,
  type OnboardingDraft,
  type OnboardingFinish,
  type OnboardingOutcome,
  type OnboardingProgress,
  parseOnboardingDraft,
} from '../../../shared/onboarding'
import type { Migration } from '../../core'
import type { Chat } from '../chat'
import type { RoleCatalog, Staff } from '../staff'

/**
 * When the setup wizard was finished (or skipped). Companies made before the wizard existed count
 * as finished, so it never opens for them.
 */
export const ONBOARDING_MIGRATION: Migration = {
  name: 'company-onboarding-completed',
  sql: `
  ALTER TABLE company ADD COLUMN onboarding_completed_at TEXT;
  UPDATE company SET onboarding_completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
`,
}

/**
 * Where the boss left the wizard, so reopening the app comes back to the same step (T59). The
 * backfill hands every Company that already existed a completion mark: one that has been in use
 * since before the wizard persisted anything must not be sent back through it. A Company being
 * created runs its migrations before its row is inserted, so the same statement leaves it alone.
 */
export const ONBOARDING_PROGRESS_MIGRATION: Migration = {
  name: 'company-onboarding-progress',
  sql: `
  ALTER TABLE company ADD COLUMN onboarding_step TEXT;
  ALTER TABLE company ADD COLUMN onboarding_preset TEXT;
  ALTER TABLE company ADD COLUMN onboarding_roster TEXT;
  ALTER TABLE company ADD COLUMN onboarding_goal TEXT;
  UPDATE company
     SET onboarding_completed_at = COALESCE(onboarding_completed_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
`,
}

/** The current Company's setup wizard, run once after Create Company (decision 39). */
export interface Onboarding {
  /** When the wizard was finished, or null while it has not been. */
  completedAt(): string | null
  /** Whether the wizard is still owed and where it resumes; what the renderer routes on (T59). */
  progress(): OnboardingProgress
  /**
   * Records the step and draft the boss is on, so the app reopens there. A wizard already finished
   * keeps nothing: a save that arrives after Finish is ignored rather than reviving the draft.
   */
  save(draft: OnboardingDraft): void
  /**
   * Hires the roster, starts Sessions and hands the goal to the answerer, then marks the
   * wizard finished. Throws, hiring nobody, when a hire is invalid or the wizard was finished before.
   */
  finish(input: OnboardingFinish): OnboardingOutcome
}

/** An open Company, as the wizard sees one: where it writes, and what Finish sets off. */
export interface OnboardingCompany {
  db: DatabaseSync
  /** The Company's roles; the wizard creates the ones its roster needs and no others (T240). */
  roles: RoleCatalog
  employees: Staff
  chat: Chat
  autonomy: AutonomyLevel
  /** Starts a Session, parking it beyond the cap or holding it while the Company is paused. */
  start(employeeId: string): void
}

export interface OnboardingOptions {
  /** The current Company; throws when none is open. */
  current(): OnboardingCompany
  /** Called after the wizard is marked finished. */
  onFinished(): void
  log(line: string): void
}

/** The completion mark of a Company's database, tolerating one that predates the column. */
export function readOnboardingCompletedAt(db: DatabaseSync, createdAt: string): string | null {
  const row = db.prepare('SELECT * FROM company').get() as { onboarding_completed_at?: string | null } | undefined
  if (!row) return null
  // A database that was never migrated this far is a Company from before the wizard.
  return row.onboarding_completed_at === undefined ? createdAt : row.onboarding_completed_at
}

export function createOnboarding({ current, onFinished, log }: OnboardingOptions): Onboarding {
  function completedAt(db: DatabaseSync): string | null {
    const row = db.prepare('SELECT onboarding_completed_at AS at FROM company').get() as
      | { at: string | null }
      | undefined
    return row?.at ?? null
  }

  /** The draft as it was stored, or null when there is none or it no longer reads. */
  function draft(db: DatabaseSync): OnboardingDraft | null {
    const row = db
      .prepare(
        `SELECT onboarding_step AS step, onboarding_preset AS preset,
                onboarding_roster AS roster, onboarding_goal AS goal FROM company`,
      )
      .get() as { step: string | null; preset: string | null; roster: string | null; goal: string | null } | undefined
    if (!row?.step) return null
    let roster: unknown
    try {
      roster = JSON.parse(row.roster ?? '[]')
    } catch {
      return null
    }
    return parseOnboardingDraft({ step: row.step, preset: row.preset, roster, goal: row.goal ?? '' })
  }

  return {
    completedAt: () => completedAt(current().db),

    progress() {
      const { db } = current()
      const at = completedAt(db)
      return { completedAt: at, draft: at === null ? draft(db) : null }
    },

    save(input) {
      const company = current()
      const { db } = company
      if (completedAt(db) !== null) return
      // The roster the boss is building is what this Company will hold: the roles arrive as soon as
      // a seat names one, so the Repositories step that comes next has them to hand a repo to
      // (T240). A seat taken back out leaves its role behind, marked \"Not used\" in the Roles list.
      company.roles.ensure(input.roster.map((seat) => seat.roleId))
      db.prepare(
        `UPDATE company SET onboarding_step = ?, onboarding_preset = ?, onboarding_roster = ?, onboarding_goal = ?`,
      ).run(input.step, input.preset, JSON.stringify(input.roster), input.goal)
    },

    finish({ hires, goal }) {
      const company = current()
      const { db } = company
      if (completedAt(db) !== null) throw new Error('Setup is already finished for this Company')

      const hired: Employee[] = []
      db.exec('BEGIN')
      try {
        company.roles.ensure(hires.map((hire) => hire.roleId))
        for (const hire of hires) hired.push(company.employees.create(hire))
        // The draft goes with the completion: nothing is left to resume, and nothing to hire twice.
        db.prepare(
          `UPDATE company SET onboarding_completed_at = ?, onboarding_step = NULL,
             onboarding_preset = NULL, onboarding_roster = NULL, onboarding_goal = NULL`,
        ).run(new Date().toISOString())
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }

      // Decision 41: the answerer chain, so a roster without an intake holder still has one voice.
      const intake = resolveAnswerer(company.employees.list()).first
      // Supervised asks before anyone starts work, so only the intake holder clocks in to plan the goal.
      const toStart = company.autonomy === 'supervised' ? (intake ? [intake] : []) : hired
      const started: string[] = []
      for (const employee of toStart) {
        try {
          company.start(employee.id)
          started.push(employee.id)
        } catch (error) {
          log(`Setup: could not start ${employee.name}: ${(error as Error).message}`)
        }
      }

      const text = goal?.trim() ?? ''
      let goalMessage: Message | null = null
      if (text && intake) {
        goalMessage = company.chat.post({
          authorId: BOSS,
          channelId: dmChannelId(BOSS, intake.id),
          text: goalInstruction(text),
        })
      } else if (text) {
        // Nobody was hired: the goal waits in #general and becomes the first hire's first item.
        goalMessage = company.chat.post({ authorId: BOSS, channelId: 'general', text })
      }

      onFinished()
      return {
        hired,
        started,
        intakeId: text && intake ? intake.id : null,
        goalMessage,
      }
    },
  }
}
