import { describe, expect, it } from 'vitest'
import { BOSS, dmChannelId } from '../domain/chat'
import type { Employee } from '../domain/staff'
import type { SessionStatus } from '../session'
import { CELL, cellOf, findPath, inside, officeLayout, visitorSpot, walkable, walkPath } from './layout'
import { type ChatPost, EXCHANGE_MS, TAIL_MS } from './movement'
import { isReadingTool, NO_DESK_REASON, type OfficeInput, projectOffice } from './projection'

const NOW = Date.parse('2026-09-17T12:00:00.000Z')

function employee(name: string, desk: number): Employee {
  return {
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
  }
}

const ada = employee('Ada', 0)
const bob = employee('Bob', 1)

function office(input: Partial<OfficeInput> & { status?: SessionStatus } = {}) {
  const { status = 'idle', ...rest } = input
  return projectOffice({
    employees: [ada, bob],
    sessions: { [ada.id]: status, [bob.id]: 'idle' },
    now: NOW,
    ...rest,
  })
}
const adaIn = (scene: ReturnType<typeof office>) => scene.sprites[0]!

describe('Working and Reading', () => {
  it('shows Working while a busy Session runs a write tool', () => {
    for (const tool of ['Edit', 'Write', 'Bash', 'mcp__company__ticket_move']) {
      const sprite = adaIn(office({ status: 'busy', activity: { [ada.id]: { tool, posts: [] } } }))
      expect(sprite.state, tool).toBe('working')
    }
  })

  it('shows Reading while a busy Session runs a read-only tool', () => {
    for (const tool of ['Read', 'Grep', 'Glob', 'WebFetch', 'mcp__company__board_list', 'mcp__company__chat_read']) {
      const sprite = adaIn(office({ status: 'busy', activity: { [ada.id]: { tool, posts: [] } } }))
      expect(sprite.state, tool).toBe('reading')
    }
  })

  it('shows Working while busy before any tool runs', () => {
    expect(adaIn(office({ status: 'busy' })).state).toBe('working')
  })

  it('shows Idle for an idle Session, whatever tool it ran last', () => {
    const sprite = adaIn(office({ status: 'idle', activity: { [ada.id]: { tool: 'Read', posts: [] } } }))

    expect(sprite.state).toBe('idle')
    expect(sprite.bubble).toBeUndefined()
    expect(sprite.away).toBeUndefined()
  })

  it('knows read-only tools by name, with or without an MCP prefix', () => {
    expect(['Read', 'LS', 'NotebookRead', 'mcp__company__team_load'].every(isReadingTool)).toBe(true)
    expect(['Edit', 'MultiEdit', 'NotebookEdit', 'mcp__company__chat_post', ''].some(isReadingTool)).toBe(false)
  })
})

describe('Talking, with a cause on screen (T74)', () => {
  const post = (channelId: string, extra: Partial<ChatPost> = {}, ago = 1_000): ChatPost => ({
    at: NOW - ago,
    channelId,
    threadId: null,
    mentions: [],
    ...extra,
  })
  const posted = (employee: Employee, ...posts: ChatPost[]) => ({
    [employee.id]: { tool: 'mcp__company__chat_post', posts },
  })

  it('keeps an Employee who posts in a channel alone at their own desk', () => {
    const scene = office({ status: 'busy', activity: posted(ada, post('tech')) })

    expect(adaIn(scene).state).toBe('working')
    expect(adaIn(scene).away).toBeUndefined()
    expect(scene.nextChangeAt).toBeNull()
  })

  it('sits two Employees of one exchange at the meeting table, each naming the other', () => {
    const scene = office({
      status: 'busy',
      activity: { ...posted(ada, post('tech', {}, 5_000)), ...posted(bob, post('tech')) },
    })

    expect(adaIn(scene)).toMatchObject({ state: 'talking', reason: 'In a meeting with Bob' })
    expect(scene.sprites[1]).toMatchObject({ state: 'talking', reason: 'In a meeting with Ada' })
    for (const sprite of scene.sprites) {
      expect(sprite.away).toMatchObject({ place: 'meeting', seated: true })
      expect(scene.layout.meeting).toContainEqual({
        x: sprite.away!.x,
        y: sprite.away!.y,
        facing: sprite.away!.facing,
      })
    }
    const spots = scene.sprites.map((s) => `${s.away!.x},${s.away!.y}`)
    expect(new Set(spots).size).toBe(2)
  })

  it('ends the meeting when the exchange does, and says when that happens', () => {
    const meeting = { ...posted(ada, post('tech', {}, 0)), ...posted(bob, post('tech', {}, 0)) }
    const over = EXCHANGE_MS + TAIL_MS

    const live = office({ status: 'busy', activity: meeting })
    expect(live.nextChangeAt).toBe(NOW + over)

    const done = projectOffice({
      employees: [ada, bob],
      sessions: { [ada.id]: 'busy', [bob.id]: 'busy' },
      activity: meeting,
      now: NOW + over,
    })
    expect(done.sprites.map((s) => s.state)).toEqual(['working', 'working'])
    expect(done.sprites.every((s) => s.away === undefined)).toBe(true)
    expect(done.nextChangeAt).toBeNull()
  })

  it('walks whoever opened a DM to the other Employee\u2019s desk, standing up', () => {
    const dm = dmChannelId(ada.id, bob.id)
    const scene = office({ status: 'busy', activity: posted(ada, post(dm)) })

    expect(adaIn(scene)).toMatchObject({ state: 'talking', reason: 'Talking to Bob' })
    expect(adaIn(scene).away).toEqual({ ...visitorSpot(scene.layout.seats[1]!), place: 'desk' })
    expect(adaIn(scene).away!.seated).toBeUndefined()
  })

  it('walks an Employee who DMs the boss to the boss desk', () => {
    const scene = office({ activity: posted(ada, post(dmChannelId(ada.id, BOSS))) })

    expect(adaIn(scene)).toMatchObject({ state: 'talking', reason: 'Talking to you' })
    expect(adaIn(scene).away).toEqual({ ...visitorSpot(scene.layout.boss), place: 'boss' })
  })

  it('names the room when three are in it', () => {
    const cy = employee('Cy', 2)
    const scene = projectOffice({
      employees: [ada, bob, cy],
      sessions: { [ada.id]: 'busy', [bob.id]: 'busy', [cy.id]: 'busy' },
      activity: {
        ...posted(ada, post('tech', {}, 6_000)),
        ...posted(bob, post('tech', {}, 4_000)),
        ...posted(cy, post('tech', {}, 2_000)),
      },
      now: NOW,
    })

    expect(scene.sprites[0]!.reason).toBe('In a meeting with Bob and Cy')
  })

  it('gives a meeting bigger than the table its chairs, and leaves the rest at their desks', () => {
    const team = Array.from({ length: 6 }, (_, i) => employee(`E${i}`, i))
    const scene = projectOffice({
      employees: team,
      sessions: Object.fromEntries(team.map((e) => [e.id, 'busy' as const])),
      activity: Object.fromEntries(
        team.map((e, i) => [e.id, { tool: null, posts: [post('tech', {}, 6_000 - i * 100)] }]),
      ),
      now: NOW,
    })

    const seated = scene.sprites.filter((s) => s.away?.place === 'meeting')
    expect(seated).toHaveLength(scene.layout.meeting.length)
    expect(new Set(seated.map((s) => `${s.away!.x},${s.away!.y}`)).size).toBe(seated.length)
    expect(scene.sprites.filter((s) => !s.away).every((s) => s.state === 'talking')).toBe(true)
  })

  it('keeps the boss desk for one visitor and leaves the next one seated', () => {
    const scene = projectOffice({
      employees: [ada, bob],
      sessions: { [ada.id]: 'busy', [bob.id]: 'busy' },
      activity: {
        ...posted(ada, post(dmChannelId(ada.id, BOSS))),
        ...posted(bob, post(dmChannelId(bob.id, BOSS))),
      },
      now: NOW,
    })

    expect(scene.sprites[0]!.away).toMatchObject({ place: 'boss' })
    expect(scene.sprites[1]!.state).toBe('talking')
    expect(scene.sprites[1]!.away).toBeUndefined()
  })
})

describe('projectOffice with nowhere to be', () => {
  it('leaves an Employee at their own desk', () => {
    const scene = projectOffice({ employees: [ada], sessions: { [ada.id]: 'idle' }, now: NOW })

    expect(scene.sprites[0]!.away).toBeUndefined()
    expect(scene.sprites[0]!.seat).toEqual(scene.layout.seats[ada.desk])
  })

  it('gives whoever shares a desk a free desk of their own, not the coffee counter (T74)', () => {
    const twin = { ...bob, desk: ada.desk }
    const scene = projectOffice({
      employees: [ada, twin],
      sessions: { [ada.id]: 'busy', [twin.id]: 'busy' },
      now: NOW,
    })

    expect(scene.sprites[0]!.seat).toEqual(scene.layout.seats[ada.desk])
    expect(scene.sprites[1]!.away).toBeUndefined()
    expect(scene.sprites[1]!.seat!.uid).not.toBe(scene.sprites[0]!.seat!.uid)
    expect(scene.layout.seats).toContainEqual(scene.sprites[1]!.seat)
  })

  it('falls back to the coffee counter only once every desk is taken', () => {
    const team = Array.from({ length: 40 }, (_, i) => ({ ...employee(`E${i}`, 0), id: `id-E${i}` }))
    const scene = projectOffice({
      employees: team,
      sessions: Object.fromEntries(team.map((e) => [e.id, 'busy' as const])),
      now: NOW,
    })

    const waiting = scene.sprites.filter((s) => s.away?.place === 'coffee')
    expect(waiting.length).toBeGreaterThan(0)
    expect(waiting.every((s) => s.reason === NO_DESK_REASON)).toBe(true)
    expect(scene.sprites.filter((s) => !s.away).length).toBe(scene.layout.seats.length)
  })

  it('sends the Employee past the last desk to the counter, with no chair of their own (T101)', () => {
    const seats = officeLayout().seats.length
    const team = Array.from({ length: seats + 2 }, (_, i) => employee(`E${i}`, i))
    const scene = projectOffice({
      employees: team,
      sessions: Object.fromEntries(team.map((e) => [e.id, 'busy' as const])),
      now: NOW,
    })

    // The room is the painting: it seats what it seats and grows nothing under it for the rest.
    expect(scene.layout.height).toBe(scene.layout.painting.height)
    expect(scene.sprites.filter((s) => s.seat)).toHaveLength(seats)

    const waiting = scene.sprites.filter((s) => !s.seat)
    expect(waiting).toHaveLength(2)
    for (const one of waiting) {
      expect(one.reason).toBe(NO_DESK_REASON)
      expect(one.away?.place).toBe('coffee')
      expect(scene.layout.coffee).toContainEqual({ x: one.away!.x, y: one.away!.y, facing: one.away!.facing })
    }
  })

  it('leaves an Off Employee past the last desk out of the counter and its label', () => {
    const seats = officeLayout().seats.length
    const team = Array.from({ length: seats + 1 }, (_, i) => employee(`E${i}`, i))
    const scene = projectOffice({
      employees: team,
      sessions: Object.fromEntries(team.slice(0, seats).map((e) => [e.id, 'busy' as const])),
      now: NOW,
    })

    const last = scene.sprites.at(-1)!
    expect(last).toMatchObject({ state: 'off' })
    expect(last.away).toBeUndefined()
    expect(last.seat).toBeUndefined()
    expect(scene.counterLabel).toBeNull()
  })

  it('keeps an Off Employee out of the coffee area, desk or no desk', () => {
    const twin = { ...bob, desk: ada.desk }
    const scene = projectOffice({ employees: [ada, twin], sessions: { [ada.id]: 'idle' }, now: NOW })

    expect(scene.sprites.map((s) => [s.state, s.away?.place])).toEqual([
      ['idle', undefined],
      ['off', undefined],
    ])
  })
})

describe('Waiting on you and Blocked', () => {
  it('sends the Employee to the boss desk with a "!" while an approval is pending (T74)', () => {
    const sprite = adaIn(
      office({
        status: 'busy',
        approvals: [
          { requesterId: bob.id, status: 'pending' },
          { requesterId: ada.id, status: 'pending' },
        ],
      }),
    )

    expect(sprite).toMatchObject({ state: 'waiting', bubble: '!', reason: 'Waiting on you' })
    expect(sprite.away).toMatchObject({ place: 'boss' })
  })

  it('clears the "!" once the approval is decided', () => {
    const sprite = adaIn(office({ approvals: [{ requesterId: ada.id, status: 'approved' }] }))

    expect(sprite.state).toBe('idle')
    expect(sprite.bubble).toBeUndefined()
  })

  it('keeps a busy Session at its desk, working, while a ticket it holds is blocked (T273)', () => {
    const sprite = adaIn(
      office({ status: 'busy', tickets: [{ assigneeId: ada.id, blocked: true, column: 'planning' }] }),
    )

    expect(sprite).toMatchObject({ state: 'working', reason: 'Working' })
    expect(sprite.bubble).toBeUndefined()
    expect(sprite.away).toBeUndefined()
  })

  it('shows Blocked with a "?" in the coffee area while a ticket they hold is blocked and their Session has stopped', () => {
    const scene = office({
      status: 'idle',
      tickets: [
        { assigneeId: ada.id, blocked: true, column: 'doing' },
        { assigneeId: bob.id, blocked: false, column: 'doing' },
      ],
    })

    expect(adaIn(scene)).toMatchObject({ state: 'blocked', bubble: '?', away: { place: 'coffee' } })
    expect(scene.layout.coffee).toContainEqual(
      expect.objectContaining({ x: adaIn(scene).away!.x, y: adaIn(scene).away!.y }),
    )
    expect(scene.sprites[1]!.state).toBe('idle')
  })

  it('ignores blocked tickets that are done or held by someone else', () => {
    const sprite = adaIn(
      office({
        tickets: [
          { assigneeId: ada.id, blocked: true, column: 'done' },
          { assigneeId: bob.id, blocked: true, column: 'doing' },
        ],
      }),
    )

    expect(sprite.state).toBe('idle')
  })

  it('puts waiting before blocked, and blocked before talking', () => {
    const talking = {
      [ada.id]: {
        tool: null,
        posts: [{ at: NOW, channelId: dmChannelId(ada.id, bob.id), threadId: null, mentions: [] }],
      },
    }
    const blocked = [{ assigneeId: ada.id, blocked: true, column: 'doing' as const }]
    const pending = [{ requesterId: ada.id, status: 'pending' as const }]

    expect(adaIn(office({ activity: talking, tickets: blocked })).state).toBe('blocked')
    expect(adaIn(office({ activity: talking, tickets: blocked, approvals: pending })).state).toBe('waiting')
  })
})

describe('Off', () => {
  it('leaves the chair empty, with no bubble, whatever else is true', () => {
    const sprite = adaIn(
      office({
        status: 'off',
        approvals: [{ requesterId: ada.id, status: 'pending' }],
        tickets: [{ assigneeId: ada.id, blocked: true, column: 'doing' }],
      }),
    )
    expect(sprite).toMatchObject({ state: 'off' })
    expect(sprite.bubble).toBeUndefined()
    expect(sprite.away).toBeUndefined()
  })
})

describe('Parked and Out of budget (decision 35)', () => {
  it('sends the Employee to the coffee area, with no bubble, whatever else is true', () => {
    for (const status of ['parked', 'out_of_budget'] as const) {
      const scene = office({
        status,
        approvals: [{ requesterId: ada.id, status: 'pending' }],
        tickets: [{ assigneeId: ada.id, blocked: true, column: 'doing' }],
        activity: {
          [ada.id]: { tool: 'Edit', posts: [{ at: NOW, channelId: 'tech', threadId: null, mentions: [bob.id] }] },
        },
      })
      const sprite = adaIn(scene)
      expect(sprite, status).toMatchObject({ state: status, away: { place: 'coffee' } })
      expect(sprite.bubble).toBeUndefined()
      const { x, y, facing } = sprite.away!
      expect(scene.layout.coffee).toContainEqual({ x, y, facing })
    }
  })

  it('gives a whole out-of-budget team, and anyone blocked, their own spot at the coffee area', () => {
    const team = Array.from({ length: 7 }, (_, i) => employee(`E${i}`, i))
    const scene = projectOffice({
      employees: team,
      sessions: Object.fromEntries(team.map((e, i) => [e.id, i === 6 ? 'idle' : 'out_of_budget'])),
      tickets: [{ assigneeId: team[6]!.id, blocked: true, column: 'doing' }],
      now: NOW,
    })

    expect(scene.sprites.map((s) => s.away?.place)).toEqual(Array(7).fill('coffee'))
    const tiles = scene.sprites.map((s) => `${s.away!.x},${s.away!.y}`)
    expect(new Set(tiles).size).toBe(7)
  })

  it('walks from any desk to every coffee spot', () => {
    const layout = officeLayout()
    const grid = walkable(layout)
    for (const seat of layout.seats) {
      for (const goal of layout.coffee) {
        expect(walkPath(seat, goal, grid).length, `${seat.uid} → ${goal.x},${goal.y}`).toBeGreaterThan(0)
      }
    }
  })
})

describe('Boss desk and office rooms', () => {
  it('counts the approvals waiting on the boss desk', () => {
    expect(office().pendingApprovals).toBe(0)
    expect(
      office({
        status: 'off',
        approvals: [
          { requesterId: ada.id, status: 'pending' },
          { requesterId: bob.id, status: 'pending' },
          { requesterId: bob.id, status: 'rejected' },
        ],
      }).pendingApprovals,
    ).toBe(2)
  })

  it('has a boss desk, a meeting room and a coffee area that stay put as the office grows', () => {
    const small = officeLayout()
    const large = officeLayout()

    expect(small.boss).toEqual(large.boss)
    expect(small.meeting).toEqual(large.meeting)
    expect(small.coffee).toEqual(large.coffee)
    expect(small.logo).toEqual(large.logo)
  })

  it('puts the meeting spots inside the glass meeting room and the coffee spots by the kitchen', () => {
    const layout = officeLayout()

    expect(layout.meeting.length).toBeGreaterThanOrEqual(4)
    for (const spot of layout.meeting) expect(inside(spot, layout.meetingArea), `${spot.x},${spot.y}`).toBe(true)
    // The kitchen corner is the painting's right side, in front of the fridge and counter.
    for (const spot of layout.coffee) expect(spot.x, `${spot.x},${spot.y}`).toBeGreaterThan(700)
  })

  it('keeps every standing spot on the floor and off the furniture', () => {
    const layout = officeLayout()
    const grid = walkable(layout)
    const spots = [...layout.coffee, ...layout.meeting, visitorSpot(layout.boss), ...layout.seats.map(visitorSpot)]
    for (const spot of spots) {
      const { col, row } = cellOf(spot)
      expect(grid[row]?.[col], `${spot.x},${spot.y}`).toBe(true)
    }
  })
})

describe('findPath (ported from Pixel Agents)', () => {
  const open = (cols: number, rows: number) => Array.from({ length: rows }, () => Array(cols).fill(true) as boolean[])

  it('finds a shortest 4-way path, without the start tile', () => {
    expect(findPath({ col: 0, row: 0 }, { col: 2, row: 0 }, open(3, 1))).toEqual([
      { col: 1, row: 0 },
      { col: 2, row: 0 },
    ])
  })

  it('goes around blocked tiles', () => {
    const grid = open(3, 2)
    grid[0]![1] = false

    const path = findPath({ col: 0, row: 0 }, { col: 2, row: 0 }, grid)

    expect(path).toHaveLength(4)
    expect(path).not.toContainEqual({ col: 1, row: 0 })
  })

  it('is empty when already there or when the goal cannot be reached', () => {
    const walled = open(3, 1)
    walled[0]![1] = false

    expect(findPath({ col: 1, row: 0 }, { col: 1, row: 0 }, open(3, 1))).toEqual([])
    expect(findPath({ col: 0, row: 0 }, { col: 2, row: 0 }, walled)).toEqual([])
  })

  it('may start and end on a blocked tile, e.g. a chair', () => {
    const grid = open(3, 1)
    grid[0]![0] = false
    grid[0]![2] = false

    expect(findPath({ col: 0, row: 0 }, { col: 2, row: 0 }, grid)).toHaveLength(2)
  })

  it('walks from any desk to the boss, the meeting room and the coffee area', () => {
    const layout = officeLayout()
    const grid = walkable(layout)
    for (const seat of layout.seats) {
      for (const goal of [
        visitorSpot(layout.boss),
        ...layout.meeting,
        layout.coffee[0]!,
        ...layout.seats.map(visitorSpot),
      ]) {
        expect(walkPath(seat, goal, grid).length, `${seat.uid} → ${goal.x},${goal.y}`).toBeGreaterThan(0)
      }
    }
  })

  it('walks in painting pixels through cell centres and ends exactly on the goal', () => {
    const layout = officeLayout()
    const grid = walkable(layout)
    const from = layout.seats[0]!
    const to = layout.coffee[0]!

    const path = walkPath(from, to, grid)

    expect(path.at(-1)).toEqual({ x: to.x, y: to.y })
    for (const [a, b] of path.slice(0, -1).map((p, i) => [p, path[i + 1]!] as const)) {
      expect(Math.abs(a.x - b.x) + Math.abs(a.y - b.y)).toBeLessThanOrEqual(CELL * 2)
    }
    expect(walkPath(to, to, grid)).toEqual([])
  })
})
