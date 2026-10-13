import { describe, expect, it } from 'vitest'
import { BOSS, dmChannelId } from '../domain/chat'
import type { Employee } from '../domain/staff'
import type { SessionStatus } from '../session'
import { visitorSpot } from './layout'
import { type ChatPost, EXCHANGE_MS, TAIL_MS } from './movement'
import { type OfficeInput, type OfficeScene, type OfficeSprite, projectOffice } from './projection'
import { STATE_LABEL, STATE_PRECEDENCE } from './reading'

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
const cy = employee('Cy', 2)
const dot = employee('Dot', 3)
const TEAM = [ada, bob, cy, dot]

/** One post in a scripted history: who said it, where, and how long before `NOW` (negative: after). */
interface Say {
  by: Employee
  ago: number
  channel: string
  thread?: number
  mentions?: string[]
}

const dm = (a: Employee, b: Employee | typeof BOSS) => dmChannelId(a.id, b === BOSS ? BOSS : b.id)

/** The office as it reads at `now`, from a scripted chat history and whatever else the engine knows. */
function scene(
  history: Say[],
  input: Partial<OfficeInput> & { employees?: Employee[]; now?: number } = {},
): OfficeScene {
  const { employees = TEAM, now = NOW, ...rest } = input
  const posts = new Map<string, ChatPost[]>(employees.map((e) => [e.id, []]))
  for (const say of [...history].sort((a, b) => b.ago - a.ago)) {
    posts
      .get(say.by.id)
      ?.push({ at: NOW - say.ago, channelId: say.channel, threadId: say.thread ?? null, mentions: say.mentions ?? [] })
  }
  const activity = Object.fromEntries(employees.map((e) => [e.id, { tool: null, posts: posts.get(e.id) ?? [] }]))
  return projectOffice({
    employees,
    sessions: Object.fromEntries(employees.map((e) => [e.id, 'busy' as SessionStatus])),
    activity,
    now,
    ...rest,
  })
}

/**
 * Every way the floor could say two things about one moment, as one list of complaints; a scene the
 * room agrees on produces none. It reads only what a boss can see: the reason under each sprite and
 * where the sprite stands.
 */
function contradictions(sceneRead: OfficeScene): string[] {
  const found: string[] = []
  const of = new Map(sceneRead.sprites.map((s) => [s.employeeId, s]))
  const nameOf = (sprite: OfficeSprite) => `${sprite.name} (${sprite.reason})`
  const complain = (why: string) => found.push(why)

  for (const sprite of sceneRead.sprites) {
    // The reason names exactly the people the sprite says it is with, and nobody else.
    const named = sceneRead.sprites
      .filter((other) => other.employeeId !== sprite.employeeId && sprite.reason.includes(other.name))
      .map((other) => other.employeeId)
    if (named.sort().join() !== [...sprite.withIds].sort().join())
      complain(`${nameOf(sprite)} names ${named.join(', ') || 'nobody'} but is with ${sprite.withIds.join(', ')}`)

    for (const withId of sprite.withIds) {
      const other = of.get(withId)
      if (!other) {
        complain(`${nameOf(sprite)} names ${withId}, who is not in the room`)
        continue
      }
      if (!other.withIds.includes(sprite.employeeId)) {
        complain(`${nameOf(sprite)} names ${other.name}, who reads ${other.reason}`)
        continue
      }
      if (sprite.state !== 'talking' || other.state !== 'talking')
        complain(`${nameOf(sprite)} and ${nameOf(other)} are together but not both Talking`)

      const meeting = sprite.away?.place === 'meeting' || other.away?.place === 'meeting'
      if (meeting) {
        // A meeting is one place: a chair at the table, or their own desk when the table is full.
        for (const one of [sprite, other])
          if (one.away && one.away.place !== 'meeting')
            complain(`${nameOf(one)} is in a meeting but stands at the ${one.away.place}`)
        continue
      }
      // A visit: one of them is standing at the other's chair, and the host is in it.
      const guest = sprite.away?.place === 'desk' ? sprite : other.away?.place === 'desk' ? other : null
      const host = guest === sprite ? other : sprite
      if (!guest) {
        complain(`${nameOf(sprite)} and ${nameOf(other)} are together but neither came over`)
        continue
      }
      if (host.away) complain(`${nameOf(guest)} came to ${host.name}, who is at the ${host.away.place}`)
      else {
        const chair = visitorSpot(host.seat!)
        if (guest.away!.x !== chair.x || guest.away!.y !== chair.y)
          complain(`${nameOf(guest)} stands away from ${host.name}’s desk`)
      }
    }
  }

  // Two sprites never share one spot, and only one of them has the place at the boss desk.
  const spots = sceneRead.sprites.filter((s) => s.away).map((s) => `${s.away!.x},${s.away!.y}`)
  if (new Set(spots).size !== spots.length) complain(`two sprites stand on one spot: ${spots.join(' ')}`)
  return found
}

/** The names a projected scene shows, as the floor reads them. */
const floor = (read: OfficeScene) => read.sprites.map((s) => `${s.name} · ${s.reason}`)

describe('the precedence table', () => {
  it('is one list, in the order the office reads it, with every state once', () => {
    expect(STATE_PRECEDENCE.map((row) => row.state)).toEqual([
      'off',
      'out_of_budget',
      'parked',
      'waiting',
      'blocked',
      'talking',
      'reading',
      'working',
      'starting',
      'idle',
    ])
    expect(new Set(STATE_PRECEDENCE.map((row) => row.state)).size).toBe(Object.keys(STATE_LABEL).length)
    expect(STATE_PRECEDENCE.every((row) => row.over.length > 10)).toBe(true)
  })

  /** Everything the rows under the one being tested would need to fire, all true at once. */
  const loud = (status: SessionStatus) =>
    scene([{ by: ada, ago: 1_000, channel: dm(ada, bob) }], {
      sessions: { [ada.id]: status, [bob.id]: 'idle' },
      employees: [ada, bob],
      approvals: [{ requesterId: ada.id, status: 'pending' }],
      tickets: [{ assigneeId: ada.id, blocked: true, column: 'doing' }],
    })
  const adaIs = (read: OfficeScene) => read.sprites[0]!.state

  it('off beats everything: no Session, so nothing else can be shown', () => {
    const read = loud('off')
    expect(adaIs(read)).toBe('off')
    expect(read.sprites[0]!.away).toBeUndefined()
    expect(read.sprites[0]!.bubble).toBeUndefined()
  })

  it('out of budget beats what the Employee would be doing with prompts', () => {
    expect(adaIs(loud('out_of_budget'))).toBe('out_of_budget')
  })

  it('parked beats it the same way', () => {
    expect(adaIs(loud('parked'))).toBe('parked')
  })

  it('waiting on you beats blocked, talking and the desk', () => {
    const read = loud('busy')
    expect(adaIs(read)).toBe('waiting')
    expect(read.sprites[0]!).toMatchObject({ bubble: '!', away: { place: 'boss' } })
  })

  it('a Session stopped asking in its terminal is waiting on you, like an Approval (T165)', () => {
    const read = scene([{ by: ada, ago: 1_000, channel: dm(ada, bob) }], {
      sessions: { [ada.id]: 'busy', [bob.id]: 'idle' },
      employees: [ada, bob],
      asking: [ada.id],
      tickets: [{ assigneeId: ada.id, blocked: true, column: 'doing' }],
    })

    expect(adaIs(read)).toBe('waiting')
    expect(read.sprites[0]!).toMatchObject({ reason: 'Waiting on you', bubble: '!', away: { place: 'boss' } })
  })

  it('but a parked Session that is asking is read as parked: it gets no prompts at all', () => {
    const read = projectOffice({
      employees: [ada],
      sessions: { [ada.id]: 'parked' },
      asking: [ada.id],
      now: NOW,
    })

    expect(adaIs(read)).toBe('parked')
  })

  it('blocked beats talking and the desk once the Session has stopped', () => {
    const read = scene([{ by: ada, ago: 1_000, channel: dm(ada, bob) }], {
      employees: [ada, bob],
      sessions: { [ada.id]: 'idle', [bob.id]: 'busy' },
      tickets: [{ assigneeId: ada.id, blocked: true, column: 'doing' }],
    })
    expect(adaIs(read)).toBe('blocked')
    expect(read.sprites[0]!).toMatchObject({ bubble: '?', away: { place: 'coffee' } })
  })

  it('but a busy Session holding a blocked ticket shows what it is doing (T273)', () => {
    // "i have designer that is blocked.. but like he is working": a leftover ticket, parked blocked.
    const tickets = [{ assigneeId: ada.id, blocked: true, column: 'planning' as const }]
    const talking = scene([{ by: ada, ago: 1_000, channel: dm(ada, bob) }], { employees: [ada, bob], tickets })
    const working = scene([], { employees: [ada, bob], tickets })
    const reading = scene([], { employees: [ada, bob], tickets, activity: { [ada.id]: { tool: 'Read', posts: [] } } })

    expect([adaIs(talking), adaIs(working), adaIs(reading)]).toEqual(['talking', 'working', 'reading'])
    expect(working.sprites[0]!.bubble).toBeUndefined()
    expect(working.sprites[0]!.away).toBeUndefined()
  })

  it('talking beats the desk', () => {
    const read = scene([{ by: ada, ago: 1_000, channel: dm(ada, bob) }], { employees: [ada, bob] })
    expect(adaIs(read)).toBe('talking')
  })

  it('reading beats working while the tool only looks', () => {
    const read = projectOffice({
      employees: [ada],
      sessions: { [ada.id]: 'busy' },
      activity: { [ada.id]: { tool: 'mcp__company__board_list', posts: [] } },
      now: NOW,
    })
    expect(read.sprites[0]!.state).toBe('reading')
  })

  it('working is the busy Session with anything else in hand', () => {
    const read = projectOffice({
      employees: [ada],
      sessions: { [ada.id]: 'busy' },
      activity: { [ada.id]: { tool: 'Edit', posts: [] } },
      now: NOW,
    })
    expect(read.sprites[0]!.state).toBe('working')
  })

  it('starting is a Session on its way to its prompt', () => {
    expect(projectOffice({ employees: [ada], sessions: { [ada.id]: 'starting' }, now: NOW }).sprites[0]!.state).toBe(
      'starting',
    )
  })

  it('idle is the last row, and holds whatever the Session ran last', () => {
    const read = projectOffice({
      employees: [ada],
      sessions: { [ada.id]: 'idle' },
      activity: { [ada.id]: { tool: 'Edit', posts: [] } },
      now: NOW,
    })
    expect(read.sprites[0]!.state).toBe('idle')
  })
})

describe('one reading of the room', () => {
  it('sits a three-way exchange in the meeting room, each naming the other two', () => {
    const read = scene([
      { by: ada, ago: 9_000, channel: 'tech' },
      { by: bob, ago: 6_000, channel: 'tech' },
      { by: cy, ago: 3_000, channel: 'tech' },
    ])

    expect(floor(read)).toEqual([
      'Ada · In a meeting with Bob and Cy',
      'Bob · In a meeting with Ada and Cy',
      'Cy · In a meeting with Ada and Bob',
      'Dot · Working',
    ])
    expect(contradictions(read)).toEqual([])
  })

  it('leaves out of the meeting whoever the exchange has not brought in yet', () => {
    // Cy's post is still to come: Ada and Bob must not name someone sitting at their own desk.
    const read = scene(
      [
        { by: ada, ago: 9_000, channel: 'tech' },
        { by: bob, ago: 6_000, channel: 'tech' },
        { by: cy, ago: -3_000, channel: 'tech' },
      ],
      { employees: [ada, bob, cy] },
    )

    expect(floor(read)).toEqual(['Ada · In a meeting with Bob', 'Bob · In a meeting with Ada', 'Cy · Working'])
    expect(contradictions(read)).toEqual([])
  })

  it('reads a DM as a visit with two sides: the guest at the desk, the host in the chair', () => {
    const read = scene([{ by: ada, ago: 1_000, channel: dm(ada, bob) }])

    expect(floor(read)).toEqual(['Ada · Talking to Bob', 'Bob · Talking to Ada', 'Cy · Working', 'Dot · Working'])
    expect(read.sprites[0]!.away).toMatchObject({ ...visitorSpot(read.layout.seats[bob.desk]!), place: 'desk' })
    expect(read.sprites[1]!.away).toBeUndefined()
    expect(contradictions(read)).toEqual([])
  })

  it('does not send a DM during a meeting into the meeting, nor pull the other out of it', () => {
    const read = scene([
      { by: ada, ago: 9_000, channel: 'tech' },
      { by: bob, ago: 6_000, channel: 'tech' },
      { by: cy, ago: 2_000, channel: dm(cy, ada) },
    ])

    expect(floor(read)).toEqual([
      'Ada · In a meeting with Bob',
      'Bob · In a meeting with Ada',
      'Cy · Working',
      'Dot · Working',
    ])
    expect(contradictions(read)).toEqual([])
  })

  it('takes whoever the boss needs out of the meeting, and leaves nobody naming them', () => {
    const history: Say[] = [
      { by: ada, ago: 9_000, channel: 'tech' },
      { by: bob, ago: 6_000, channel: 'tech' },
    ]
    expect(floor(scene(history))[0]).toBe('Ada · In a meeting with Bob')

    const read = scene(history, { approvals: [{ requesterId: ada.id, status: 'pending' }] })

    expect(floor(read)).toEqual(['Ada · Waiting on you', 'Bob · Working', 'Cy · Working', 'Dot · Working'])
    expect(read.sprites[0]!.away).toMatchObject({ place: 'boss' })
    expect(contradictions(read)).toEqual([])
  })

  it('keeps a meeting of three when the boss needs only one of them', () => {
    const read = scene(
      [
        { by: ada, ago: 9_000, channel: 'tech' },
        { by: bob, ago: 6_000, channel: 'tech' },
        { by: cy, ago: 3_000, channel: 'tech' },
      ],
      { approvals: [{ requesterId: cy.id, status: 'pending' }] },
    )

    expect(floor(read)).toEqual([
      'Ada · In a meeting with Bob',
      'Bob · In a meeting with Ada',
      'Cy · Waiting on you',
      'Dot · Working',
    ])
    expect(contradictions(read)).toEqual([])
  })

  it('refuses a visit to someone who is not there to answer', () => {
    for (const [status, reason] of [
      ['off', 'Off'],
      ['parked', 'Parked'],
      ['out_of_budget', 'Out of budget'],
    ] as const) {
      const read = scene([{ by: ada, ago: 1_000, channel: dm(ada, bob) }], {
        employees: [ada, bob],
        sessions: { [ada.id]: 'busy', [bob.id]: status },
      })

      expect(floor(read), status).toEqual(['Ada · Working', `Bob · ${reason}`])
      expect(contradictions(read), status).toEqual([])
    }
  })

  it('refuses a visit to someone the board has blocked at the coffee counter', () => {
    const read = scene([{ by: ada, ago: 1_000, channel: 'tech', mentions: [bob.id] }], {
      employees: [ada, bob],
      sessions: { [ada.id]: 'busy', [bob.id]: 'idle' },
      tickets: [{ assigneeId: bob.id, blocked: true, column: 'doing' }],
    })

    expect(floor(read)).toEqual(['Ada · Working', 'Bob · Blocked'])
    expect(contradictions(read)).toEqual([])
  })

  it('shows one visit when two would call on each other: the older trip is the one the room shows', () => {
    const read = scene([
      { by: ada, ago: 5_000, channel: dm(ada, bob) },
      { by: bob, ago: 2_000, channel: 'general', mentions: [ada.id] },
    ])

    expect(floor(read).slice(0, 2)).toEqual(['Ada · Talking to Bob', 'Bob · Talking to Ada'])
    expect(read.sprites[0]!.away).toMatchObject({ place: 'desk' })
    expect(read.sprites[1]!.away).toBeUndefined()
    expect(contradictions(read)).toEqual([])
  })

  it('counts the boss as a person: whoever answers them is at their chair and in nobody’s meeting', () => {
    const read = scene([
      { by: ada, ago: 2_000, channel: dm(ada, BOSS) },
      { by: bob, ago: 1_000, channel: 'tech', mentions: [ada.id] },
    ])

    expect(floor(read).slice(0, 2)).toEqual(['Ada · Talking to you', 'Bob · Working'])
    expect(read.sprites[0]!.away).toMatchObject({ place: 'boss' })
    expect(read.sprites[0]!.withIds).toEqual([])
    expect(contradictions(read)).toEqual([])
  })

  it('agrees with itself all the way through a scripted morning', () => {
    const history: Say[] = [
      { by: ada, ago: 0, channel: 'tech' },
      { by: bob, ago: -4_000, channel: 'tech' },
      { by: cy, ago: -8_000, channel: 'tech' },
      { by: dot, ago: -20_000, channel: dm(dot, ada) },
      { by: ada, ago: -30_000, channel: dm(ada, BOSS) },
      { by: cy, ago: -40_000, channel: 'prs', thread: 3, mentions: [dot.id] },
      { by: bob, ago: -70_000, channel: 'prs', thread: 3 },
      { by: dot, ago: -90_000, channel: 'general', mentions: [BOSS] },
    ]
    const approvals = [{ requesterId: bob.id, status: 'pending' as const }]
    const tickets = [{ assigneeId: cy.id, blocked: true, column: 'doing' as const }]
    // A blocked ticket sends Cy to the counter only once Cy's Session has stopped (T273).
    const sessions = {
      ...Object.fromEntries(TEAM.map((e) => [e.id, 'busy' as SessionStatus])),
      [cy.id]: 'idle' as const,
    }

    for (let step = 0; step <= EXCHANGE_MS + TAIL_MS + 100_000; step += 3_000) {
      const now = NOW + step
      for (const extra of [{}, { approvals }, { tickets }, { approvals, tickets }, { tickets, sessions }]) {
        const read = scene(history, { ...extra, now })
        expect(contradictions(read), `at +${step}ms with ${JSON.stringify(Object.keys(extra))}`).toEqual([])
      }
    }
  })

  it('is a check with teeth: the boss’s own report is a contradiction', () => {
    // "tinha um meeting com o outro, mas o outro tava talking with me" (#71).
    const read = scene([
      { by: ada, ago: 5_000, channel: 'tech' },
      { by: bob, ago: 1_000, channel: 'tech' },
    ])
    const [meeting, ...rest] = read.sprites
    const { away: _atDesk, ...seated } = rest[0]!
    const bossDesk = { ...seated, reason: 'Talking to you', withIds: [] }

    expect(contradictions(read)).toEqual([])
    expect(contradictions({ ...read, sprites: [meeting!, bossDesk, ...rest.slice(1)] })).toEqual([
      'Ada (In a meeting with Bob) names Bob, who reads Talking to you',
    ])
  })

  it('walks everyone back to their desks once the exchanges are over', () => {
    const history: Say[] = [
      { by: ada, ago: 0, channel: 'tech' },
      { by: bob, ago: 0, channel: 'tech' },
      { by: cy, ago: 0, channel: dm(cy, dot) },
    ]
    const over = NOW + EXCHANGE_MS + TAIL_MS

    expect(scene(history, { now: over - 1 }).sprites.every((s) => s.state === 'talking')).toBe(true)
    const after = scene(history, { now: over })
    expect(floor(after)).toEqual(['Ada · Working', 'Bob · Working', 'Cy · Working', 'Dot · Working'])
    expect(after.nextChangeAt).toBeNull()
    expect(contradictions(after)).toEqual([])
  })
})
