/**
 * What the glass room says about itself (T94). The table has four chairs, so an exchange bigger than
 * that walks four in and leaves the rest at their desks; the room's own count is of everyone the
 * exchange is for, seated or not, which is what keeps the floor from reading as a meeting of four.
 */
import { describe, expect, it } from 'vitest'
import type { Employee } from '../domain/staff'
import type { ChatPost } from './movement'
import { MEETING_AT_DESK_REASON, type OfficeInput, projectOffice } from './projection'
import type { RoomSlug } from './rooms'

const NOW = Date.parse('2026-09-17T12:00:00.000Z')

const employee = (name: string, desk: number): Employee => ({
  id: `id-${name}`,
  name,
  desk,
  roleId: 'backend',
  title: 'Backend',
  persona: '',
  capabilities: ['code'],
  repoFilter: [],
  areas: [],
  mcpServers: [],
  skills: [],
  provider: 'claude',
  permissionMode: 'skip-permissions',
  model: null,
  overrides: [],
  sprite: 0,
  createdAt: '2026-09-17T00:00:00.000Z',
})

const post = (channelId = 'tech'): ChatPost => ({ at: NOW, channelId, threadId: null, mentions: [] })

/** `count` Employees all talking in `#tech`: one exchange, so one meeting the whole room agrees on. */
function talking(count: number, room?: RoomSlug): OfficeInput {
  const employees = Array.from({ length: count }, (_, i) => employee(`E${i}`, i))
  return {
    employees,
    ...(room ? { room } : {}),
    sessions: Object.fromEntries(employees.map((e) => [e.id, 'busy' as const])),
    activity: Object.fromEntries(employees.map((e) => [e.id, { tool: null, posts: [post()] }])),
    now: NOW,
  }
}

describe('the meeting the glass room counts', () => {
  it('counts nobody while no exchange is in the room', () => {
    const scene = projectOffice({ employees: [employee('Ada', 0)], sessions: { 'id-Ada': 'busy' }, now: NOW })

    expect(scene.meetingCount).toBe(0)
  })

  it('counts a meeting the table seats in full', () => {
    const scene = projectOffice(talking(4))

    expect(scene.meetingCount).toBe(4)
    expect(scene.sprites.filter((s) => s.away?.place === 'meeting')).toHaveLength(4)
  })

  it('counts everyone the exchange is for, including whoever the table could not seat', () => {
    // In a room with a chair for all six of them, so the two the table turns away are at their own
    // desks rather than at the counter for want of one (T111).
    const scene = projectOffice(talking(6, 'scandi-daylight'))

    expect(scene.meetingCount).toBe(6)
    // Four walked in; the other two stayed at their own desks, still in the meeting.
    const seated = scene.sprites.filter((s) => s.away?.place === 'meeting')
    const left = scene.sprites.filter((s) => !s.away)
    expect(seated).toHaveLength(4)
    expect(left).toHaveLength(2)
    // Short, as p3YoI 2A draws it: the room carries the count, the drawer the names (T156).
    expect(left.map((s) => s.reason)).toEqual([MEETING_AT_DESK_REASON, MEETING_AT_DESK_REASON])
  })

  it('does not count a visit or a word with the boss: neither is in the glass room', () => {
    const [ada, bob] = [employee('Ada', 0), employee('Bob', 1)]
    const scene = projectOffice({
      employees: [ada, bob],
      sessions: { [ada.id]: 'busy', [bob.id]: 'busy' },
      approvals: [{ requesterId: ada.id, status: 'pending' }],
      activity: { [bob.id]: { tool: null, posts: [{ ...post('general'), mentions: [ada.id] }] } },
      now: NOW,
    })

    expect(scene.meetingCount).toBe(0)
  })
})
