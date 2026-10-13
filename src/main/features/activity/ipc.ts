import { type ActivityGroup, type ActivityQuery, isActivityGroup } from '../../../shared/activity'
import { activityChannels } from '../../../shared/domain/channels'
import { attempt, type IpcHandlerRegistry } from '../../core'
import type { ActivityFacade } from './wire'

export interface ActivityIpcOptions {
  ipc: IpcHandlerRegistry
  engine: ActivityFacade
  broadcastChanged(): void
}

/** Lets the renderer read the Company's activity log and follow it live. Holds no state. */
export function registerActivityIpc({ ipc, engine, broadcastChanged }: ActivityIpcOptions): void {
  engine.onChange(broadcastChanged)
  engine.activity.onChange(broadcastChanged)

  ipc.handle(activityChannels.list, (_event, query) => attempt(() => engine.activity.list(activityQuery(query))))
  ipc.handle(activityChannels.actors, () => attempt(() => engine.activity.actors()))
}

/** The renderer's filter, validated: an unknown group or a wrong type is rejected, never queried. */
function activityQuery(value: unknown): ActivityQuery {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('The activity filter must be an object')
  const input = value as Record<string, unknown>
  const query: ActivityQuery = {}
  if (input['groups'] !== undefined) {
    if (!Array.isArray(input['groups'])) throw new Error('Kind filters must be a list')
    const groups: ActivityGroup[] = []
    for (const group of input['groups']) {
      if (!isActivityGroup(group)) throw new Error(`Unknown kind filter: ${String(group)}`)
      groups.push(group)
    }
    query.groups = groups
  }
  if (input['actorId'] !== undefined) {
    if (typeof input['actorId'] !== 'string') throw new Error('The Employee filter must be an id')
    query.actorId = input['actorId']
  }
  if (input['search'] !== undefined) {
    if (typeof input['search'] !== 'string') throw new Error('The search must be text')
    query.search = input['search']
  }
  if (input['limit'] !== undefined) {
    if (!Number.isInteger(input['limit']) || (input['limit'] as number) < 1)
      throw new Error('The limit must be a count')
    query.limit = input['limit'] as number
  }
  return query
}
