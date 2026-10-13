import { hiringChannels } from '../../../shared/domain/channels'
import { attempt, type IpcHandlerRegistry, isRecord, requireString } from '../../core'
import type { HiringFacade } from './wire'

export interface HiringIpcOptions {
  ipc: IpcHandlerRegistry
  engine: HiringFacade
}

/**
 * Lets the renderer read team load and fire or rehire as the boss. Holds no state; hires and fires
 * change the staff, so the renderer listens to staff changes.
 */
export function registerHiringIpc({ ipc, engine }: HiringIpcOptions): void {
  ipc.handle(hiringChannels.teamLoad, () => attempt(() => engine.hiring.teamLoad()))
  ipc.handle(hiringChannels.former, () => attempt(() => engine.hiring.former()))
  ipc.handle(hiringChannels.requests, () => attempt(() => engine.hiring.requests()))
  ipc.handle(hiringChannels.fire, (_event, employeeId, reason) =>
    attempt(() => {
      if (reason !== undefined && typeof reason !== 'string') throw new Error('A reason must be text')
      return engine.hiring.fire(requireString(employeeId, 'Employee id'), reason)
    }),
  )
  ipc.handle(hiringChannels.setRequestModel, (_event, requestId, model) =>
    attempt(() => {
      if (typeof requestId !== 'number') throw new Error('Missing hire proposal id')
      if (model !== null && typeof model !== 'string') throw new Error('A model must be text or null')
      return engine.hiring.setRequestModel(requestId, model)
    }),
  )
  ipc.handle(hiringChannels.rehire, (_event, employeeId) =>
    attempt(() => engine.hiring.rehire(requireString(employeeId, 'Employee id'))),
  )
  ipc.handle(hiringChannels.updateProposal, (_event, requestId, patch) =>
    attempt(() => {
      if (typeof requestId !== 'number') throw new Error('A hire request id must be a number')
      if (!isRecord(patch)) throw new Error('A proposal edit must be an object')
      return engine.hiring.updateProposal(requestId, patch)
    }),
  )
  ipc.handle(hiringChannels.suggestName, (_event, exclude) =>
    attempt(() => {
      if (exclude !== undefined && !(Array.isArray(exclude) && exclude.every((n) => typeof n === 'string'))) {
        throw new Error('Names to avoid must be a list of strings')
      }
      return engine.hiring.suggestName(exclude)
    }),
  )
  ipc.handle(hiringChannels.headcount, () => attempt(() => engine.hiring.headcount()))
  ipc.handle(hiringChannels.setMaxHeadcount, (_event, max) =>
    attempt(() => engine.hiring.setMaxHeadcount(max === null ? null : (max as number))),
  )
}
