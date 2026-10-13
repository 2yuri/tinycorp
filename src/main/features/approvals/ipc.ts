import { type ApprovalDecision, type ApprovalStatus, isAutonomyLevel } from '../../../shared/approvals'
import { approvalChannels } from '../../../shared/domain/channels'
import { attempt, type IpcHandlerRegistry, isRecord } from '../../core'
import type { ApprovalsFacade } from './wire'

export interface ApprovalIpcOptions {
  ipc: IpcHandlerRegistry
  engine: ApprovalsFacade
  broadcastChanged(): void
}

const STATUSES: readonly ApprovalStatus[] = ['pending', 'approved', 'rejected']

/** Lets the renderer set the autonomy level and decide Approvals as the boss. Holds no state. */
export function registerApprovalIpc({ ipc, engine, broadcastChanged }: ApprovalIpcOptions): void {
  engine.onChange(broadcastChanged)
  engine.approvals.onChange(broadcastChanged)

  ipc.handle(approvalChannels.level, () => attempt(() => engine.approvals.level()))
  ipc.handle(approvalChannels.setLevel, (_event, level) =>
    attempt(() => {
      if (!isAutonomyLevel(level)) throw new Error(`Unknown autonomy level: ${String(level)}`)
      return engine.approvals.setLevel(level)
    }),
  )
  ipc.handle(approvalChannels.list, (_event, status) =>
    attempt(() => {
      if (status !== undefined && !STATUSES.includes(status as ApprovalStatus)) {
        throw new Error(`Unknown approval status: ${String(status)}`)
      }
      return engine.approvals.list(status === undefined ? {} : { status: status as ApprovalStatus })
    }),
  )
  ipc.handle(approvalChannels.decide, (_event, id, decision) =>
    attempt(() => engine.approvals.decide(requireId(id), parseDecision(decision))),
  )
}

function requireId(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1) throw new Error('Missing approval id')
  return value as number
}

function parseDecision(value: unknown): ApprovalDecision {
  if (!isRecord(value) || typeof value['approve'] !== 'boolean') throw new Error('Missing decision')
  if (value['reason'] !== undefined && typeof value['reason'] !== 'string') throw new Error('A reason must be text')
  return { approve: value['approve'], ...(value['reason'] !== undefined && { reason: value['reason'] }) }
}
