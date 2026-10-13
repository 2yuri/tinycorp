/**
 * Hiring's slice of the IPC contract (T186). `src/shared/ipc/index.ts` composes the slices into
 * `TinyCorpApi`, so preload and the renderer keep importing one contract.
 */

import type { Result } from '../domain/result'
import type { Employee } from '../domain/staff'
import type { Headcount, ProposalPatch, StaffingRequest, TeamLoad } from './index'

/**
 * The current Company's team load and former Employees; firing and rehiring as the boss.
 * Hires and fires change the staff: listen with `staff.onChanged`. Exposed as `window.tinyCorp.hiring`.
 */
export interface HiringApi {
  teamLoad(): Promise<Result<TeamLoad>>
  former(): Promise<Result<Employee[]>>
  /** Stops the Employee's Session, unassigns their open tickets and frees their desk; keeps their memory. */
  fire(employeeId: string, reason?: string): Promise<Result<Employee>>
  rehire(employeeId: string): Promise<Result<Employee>>
  /** Hire and fire requests, oldest first; pending ones pair with an Approval by `approvalId`. */
  requests(): Promise<Result<StaffingRequest[]>>
  /** Edits the Employee a pending new-hire request proposes; approval hires the edited one. */
  updateProposal(requestId: number, patch: ProposalPatch): Promise<Result<StaffingRequest>>
  /** A random name nobody in the Company has, nor any of `exclude`, from the engine's name generator. */
  suggestName(exclude?: string[]): Promise<Result<string>>
  headcount(): Promise<Result<Headcount>>
  /** A whole number from 1, or null for unlimited. */
  setMaxHeadcount(max: number | null): Promise<Result<Headcount>>
  /** Changes the model of a pending hire proposal; null is the provider's default. */
  setRequestModel(requestId: number, model: string | null): Promise<Result<StaffingRequest>>
}
