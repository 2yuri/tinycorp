/**
 * Planning's slice of the IPC contract (T186), the daily digest with it. `src/shared/ipc/index.ts`
 * composes the slices into `TinyCorpApi`, so preload and the renderer keep importing one contract.
 */

import type { Result } from '../domain/result'
import type { DigestSchedule, DigestScheduleUpdate } from './daily-digest'
import type { Plan, PlanSubject } from './planning'

/**
 * The current Company's daily digest (T172): when it posts and where. What it says is written by
 * the engine and read from chat like any other message. Exposed as `window.tinyCorp.digest`.
 */
export interface DigestApi {
  schedule(): Promise<Result<DigestSchedule>>
  /** Changes part of the schedule; absent fields stay as they are. */
  setSchedule(update: DigestScheduleUpdate): Promise<Result<DigestSchedule>>
  /** Fires after the schedule changes, after a digest posts, and on Company switch. */
  onChanged(listener: () => void): () => void
}

/**
 * The current Company's plans (T171), read and decided as the boss: answering the planner's
 * questions, approving a plan (which moves its ticket to Ready), asking for changes, and keeping
 * the version that was approved when a replan is asked for. Exposed as `window.tinyCorp.planning`.
 */
export interface PlanningApi {
  /** The newest version of every plan in the Company. */
  list(): Promise<Result<Plan[]>>
  /** Every version of one ticket's or epic's plan, oldest first. */
  versions(subject: PlanSubject): Promise<Result<Plan[]>>
  /** Writes the boss's answer under one question. */
  answer(questionId: number, text: string): Promise<Result<Plan>>
  /** "Let … decide": hands one question back to the planner. */
  delegate(questionId: number): Promise<Result<Plan>>
  /** Approve plan → Ready. */
  approve(planId: number): Promise<Result<Plan>>
  requestChanges(planId: number, comments: string): Promise<Result<Plan>>
  /** Keep v1: drops a replan and leaves the approved version standing. */
  keep(planId: number): Promise<Result<Plan>>
  /** Replan, as the boss: sends an approved ticket back to Planning with a reason. */
  replan(ticketId: number, reason: string): Promise<Result<Plan>>
  /** Fires after any plan, question or answer changes, and on Company switch. */
  onChanged(listener: () => void): () => void
}
