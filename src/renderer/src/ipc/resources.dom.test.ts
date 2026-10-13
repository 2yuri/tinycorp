// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { TinyCorpApi } from '../../../shared/ipc'
import { resources } from './resources'
import type { IpcResource } from './use-ipc-resource'

/**
 * What every channel reads, and after which events it reads again.
 *
 * This table is the bug T212 found written down: the Chat view read its repos again on
 * `staff.onChanged` and `code.onChanged` and never on `repos.onChanged`, so a repo added or renamed
 * from the Repositories screen did not reach the `#repo` chips until somebody was hired. A resource
 * subscribes to its own channel; where a value really does move with another feature — a hire needs
 * the team's load read again — the row says so and the line in `resources.ts` says why.
 *
 * A Company switch is nobody's row: `useIpcResource` invalidates every channel on one.
 */
const CHANNELS: Record<string, { reads: string; after: readonly string[]; onRefocus?: true }> = {
  'answerer.get': { reads: 'answerer.get', after: ['answerer'] },
  'approvals.level': { reads: 'approvals.level', after: ['approvals'] },
  'approvals.list': { reads: 'approvals.list', after: ['approvals'] },
  'approvals.pending': { reads: 'approvals.list(pending)', after: ['approvals'] },
  'board.snapshot': { reads: 'board.snapshot', after: ['board'] },
  'capacity.get': { reads: 'capacity.get', after: ['capacity'] },
  'chat.agent-pairs': { reads: 'chat.agentPairs', after: ['chat'] },
  'chat.boss-inbox': { reads: 'chat.bossInbox', after: ['chat', 'approvals'] },
  'chat.channels': { reads: 'chat.channels', after: ['chat'] },
  'chat.drafted-channels': { reads: 'chat.draftedChannels', after: ['chat'] },
  'chat.unread': { reads: 'chat.unread', after: ['chat'] },
  'code.list': { reads: 'code.list', after: ['code'], onRefocus: true },
  'company-memory.counts': { reads: 'companyMemory.counts', after: ['companyMemory'] },
  'company.current': { reads: 'company.current', after: ['company'] },
  // A home folder and a sync client do not move while the app is open (T252).
  'company.folder-hints': { reads: 'company.folderHints', after: [] },
  'digest.schedule': { reads: 'digest.schedule', after: ['digest'] },
  'hiring.former': { reads: 'hiring.former', after: ['staff'] },
  'hiring.requests': { reads: 'hiring.requests', after: ['staff', 'approvals'] },
  'hiring.team-load': { reads: 'hiring.teamLoad', after: ['staff', 'board'] },
  'mcp.list': { reads: 'mcp.list', after: ['mcp'] },
  'planning.list': { reads: 'planning.list', after: ['planning'] },
  'sandbox.read': { reads: 'sandbox.read', after: ['sandbox'] },
  'profile.get': { reads: 'profile.get', after: ['profile'] },
  'repos.list': { reads: 'repos.list', after: ['repos'], onRefocus: true },
  'reviews.list': { reads: 'reviews.list', after: ['reviews'] },
  'reviews.security-passes': { reads: 'reviews.securityPasses', after: ['reviews'] },
  'reviews.threads': { reads: 'reviews.list', after: ['reviews'] },
  'sessions.list': { reads: 'sessions.list', after: ['sessions'] },
  'skills.described': { reads: 'skills.described', after: ['skills'] },
  'skills.list': { reads: 'skills.list', after: ['skills'] },
  'spawn-settings.stale': { reads: 'spawnSettings.stale', after: ['spawnSettings'] },
  'staff.employees': { reads: 'staff.employees', after: ['staff'] },
  'staff.permission-default': { reads: 'staff.permissionDefault', after: ['staff'] },
  'staff.roles': { reads: 'staff.roles', after: ['staff'] },
  'tests.list': { reads: 'tests.list', after: ['tests'] },
  // A machine does not change while the app is open; `Check again` is what reads it again (T249).
  'windows.machine': { reads: 'windows.machine', after: [] },
}

/** A bridge that answers every call with an empty list and writes down what was asked of it. */
function recorder(): { asked: string[]; watched: string[]; api: TinyCorpApi } {
  const asked: string[] = []
  const watched: string[] = []
  const api = new Proxy(
    {},
    {
      get: (_target, area: string) =>
        new Proxy(
          {},
          {
            get:
              (_inner, method: string) =>
              (...args: unknown[]) => {
                if (method === 'onChanged') {
                  watched.push(area)
                  return () => {}
                }
                asked.push(args.length === 0 ? `${area}.${method}` : `${area}.${method}(${args.join(',')})`)
                return Promise.resolve({ ok: true, value: [] })
              },
          },
        ),
    },
  ) as TinyCorpApi
  return { asked, watched, api }
}

const catalogue = Object.values(resources) as IpcResource<unknown>[]

describe('the channels the screens read', () => {
  it('gives every channel one key of its own', () => {
    const keys = catalogue.map((resource) => resource.key)

    expect(new Set(keys).size).toBe(keys.length)
    expect(keys.toSorted()).toEqual(Object.keys(CHANNELS).toSorted())
  })

  it.each(catalogue.map((resource) => [resource.key, resource] as const))(
    '%s reads and listens where the table says',
    async (key, resource) => {
      const expected = CHANNELS[key]
      if (!expected) throw new Error(`No row for ${key}`)
      const { asked, watched, api } = recorder()

      const focus = vi.spyOn(window, 'addEventListener')

      await resource.read(api)
      const off = resource.subscribe(api, () => {})

      expect(asked).toEqual([expected.reads])
      expect(watched).toEqual([...expected.after])
      expect(focus.mock.calls.map(([event]) => event)).toEqual(expected.onRefocus ? ['focus'] : [])
      off()
      focus.mockRestore()
    },
  )

  /**
   * The bug itself (T212). A repo added, renamed or removed changes what every `#repo` chip and
   * every hire form offers, and `repos:changed` is the event that says so.
   */
  it('reads the repos again when the repos change, and not only when somebody is hired', () => {
    const { watched, api } = recorder()

    resources.repos.subscribe(api, () => {})

    expect(watched).toEqual(['repos'])
    expect(watched).not.toContain('staff')
  })
})
