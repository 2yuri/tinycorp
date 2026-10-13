import { companyMemoryChannels } from '../../../shared/domain/channels'
import {
  isMemoryKind,
  type MemoryQuery,
  type MemorySort,
  type MemoryWrite,
} from '../../../shared/memory/company-memory'
import { attempt, type IpcHandlerRegistry, requireString } from '../../core'
import type { CompanyMemoryFacade } from './facade'

export interface CompanyMemoryIpcOptions {
  ipc: IpcHandlerRegistry
  engine: CompanyMemoryFacade
  broadcastChanged(): void
}

/** Lets the Memory screen read and edit the Company's shared pages, and follow them live (T175). */
export function registerCompanyMemoryIpc({ ipc, engine, broadcastChanged }: CompanyMemoryIpcOptions): void {
  engine.onChange(broadcastChanged)
  engine.companyMemory.onChanged(broadcastChanged)

  const memory = engine.companyMemory
  ipc.handle(companyMemoryChannels.list, (_event, query) => attempt(() => memory.list(memoryQuery(query))))
  ipc.handle(companyMemoryChannels.counts, () => attempt(() => memory.counts()))
  ipc.handle(companyMemoryChannels.get, (_event, slug) => attempt(() => memory.get(requireString(slug, 'page'))))
  ipc.handle(companyMemoryChannels.write, (_event, input) => attempt(() => memory.write(memoryWrite(input))))
  ipc.handle(companyMemoryChannels.pin, (_event, slug, pinned) =>
    attempt(() => memory.pin(requireString(slug, 'page'), pinned === true)),
  )
  ipc.handle(companyMemoryChannels.archive, (_event, slug) =>
    attempt(() => memory.archive(requireString(slug, 'page'))),
  )
  ipc.handle(companyMemoryChannels.link, (_event, a, b) =>
    attempt(() => {
      memory.link(requireString(a, 'page'), requireString(b, 'page'))
      return true as const
    }),
  )
  ipc.handle(companyMemoryChannels.history, (_event, slug) =>
    attempt(() => memory.history(requireString(slug, 'page'))),
  )
  ipc.handle(companyMemoryChannels.restore, (_event, slug, commit) =>
    attempt(() => memory.restore(requireString(slug, 'page'), requireString(commit, 'commit'))),
  )
  ipc.handle(companyMemoryChannels.fromTicket, (_event, ticket) =>
    attempt(() => memory.fromTicket(requireString(ticket, 'ticket'))),
  )
  ipc.handle(companyMemoryChannels.filePath, (_event, slug) =>
    attempt(() => memory.filePath(requireString(slug, 'page'))),
  )
  ipc.handle(companyMemoryChannels.rebuild, () => attempt(() => memory.rebuild()))
  ipc.handle(companyMemoryChannels.folder, () => attempt(() => memory.folder()))
  ipc.handle(companyMemoryChannels.coldDays, () => attempt(() => memory.coldDays()))
  ipc.handle(companyMemoryChannels.setColdDays, (_event, days) =>
    attempt(() => {
      if (!Number.isInteger(days) || (days as number) < 1) throw new Error('The cold threshold is a number of days')
      return memory.setColdDays(days as number)
    }),
  )
}

const SORTS: MemorySort[] = ['used', 'new', 'cold']

/** The screen's filter, validated: an unknown kind or a wrong type is rejected, never queried. */
function memoryQuery(value: unknown): MemoryQuery {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('The memory filter must be an object')
  const input = value as Record<string, unknown>
  const query: MemoryQuery = {}
  if (input['search'] !== undefined) {
    if (typeof input['search'] !== 'string') throw new Error('The search must be text')
    query.search = input['search']
  }
  if (input['kind'] !== undefined && input['kind'] !== null) {
    if (!isMemoryKind(input['kind'])) throw new Error(`Unknown page kind: ${String(input['kind'])}`)
    query.kind = input['kind']
  }
  if (input['repo'] !== undefined && input['repo'] !== null) {
    if (typeof input['repo'] !== 'string') throw new Error('The repo filter must be a name')
    query.repo = input['repo']
  }
  if (input['sort'] !== undefined && input['sort'] !== null) {
    if (!SORTS.includes(input['sort'] as MemorySort)) throw new Error(`Unknown sort: ${String(input['sort'])}`)
    query.sort = input['sort'] as MemorySort
  }
  if (input['archived'] !== undefined) query.archived = input['archived'] === true
  if (input['limit'] !== undefined) {
    if (!Number.isInteger(input['limit']) || (input['limit'] as number) < 1)
      throw new Error('The limit must be a count')
    query.limit = input['limit'] as number
  }
  return query
}

/** What the boss's editor saves, validated the same way. */
function memoryWrite(value: unknown): MemoryWrite {
  if (typeof value !== 'object' || value === null) throw new Error('A page is an object')
  const input = value as Record<string, unknown>
  if (!isMemoryKind(input['kind'])) throw new Error(`Unknown page kind: ${String(input['kind'])}`)
  if (input['kind'] === 'handoff') throw new Error('Handoff pages are written by the app')
  return {
    kind: input['kind'],
    title: requireString(input['title'], 'title'),
    body: requireString(input['body'], 'body'),
    ...(Array.isArray(input['sources']) && {
      sources: input['sources'].filter((s): s is string => typeof s === 'string'),
    }),
    ...(Array.isArray(input['repos']) && { repos: input['repos'].filter((r): r is string => typeof r === 'string') }),
    ...(input['mode'] === 'append' || input['mode'] === 'replace' ? { mode: input['mode'] } : {}),
  }
}
