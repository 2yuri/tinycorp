import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { dmChannelId } from '../../../shared/domain/chat'
import type { Employee } from '../../../shared/domain/staff'
import type { ChatPost } from '../../../shared/office/movement'
import { NO_DESK_REASON, type OfficeSprite, projectOffice } from '../../../shared/office/projection'
import { floorLabels, spriteTag } from './sprite-tag'

const NOW = Date.parse('2026-09-17T12:00:00.000Z')

/** Any chair of their own: the labels only care that there is one. */
const SEAT = {
  uid: 'desk-0',
  x: 10,
  y: 10,
  facing: 'down' as const,
  visitor: { x: 20, y: 10, facing: 'left' as const },
  occluders: [],
}

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

const ada = employee('Ada', 0)
const bob = employee('Bob', 1)
const post = (channelId: string): ChatPost => ({ at: NOW, channelId, threadId: null, mentions: [] })
const talking = (channelId: string) => ({
  [ada.id]: { tool: null, posts: [post(channelId)] },
  [bob.id]: { tool: null, posts: [post(channelId)] },
})

function tags(input: Parameters<typeof projectOffice>[0]): string[] {
  return projectOffice(input).sprites.map((sprite: OfficeSprite) => spriteTag(sprite))
}

describe('the label under a sprite', () => {
  it('names the Employee and why they are where they are', () => {
    expect(spriteTag({ name: 'Ada', reason: 'In a meeting with Bob' })).toBe('Ada · In a meeting with Bob')
  })

  it('reads the reason off every state the office projects', () => {
    const both = { [ada.id]: 'busy' as const, [bob.id]: 'busy' as const }

    expect(tags({ employees: [ada, bob], sessions: both, activity: talking('tech'), now: NOW })).toEqual([
      'Ada · In a meeting with Bob',
      'Bob · In a meeting with Ada',
    ])
    expect(
      tags({
        employees: [ada, bob],
        sessions: both,
        activity: { [ada.id]: { tool: null, posts: [post(dmChannelId(ada.id, bob.id))] } },
        now: NOW,
      })[0],
    ).toBe('Ada · Talking to Bob')
    expect(
      tags({
        employees: [ada],
        sessions: { [ada.id]: 'busy' },
        approvals: [{ requesterId: ada.id, status: 'pending' }],
        now: NOW,
      }),
    ).toEqual(['Ada · Waiting on you'])
    expect(
      tags({
        employees: [ada],
        // A busy Session reads as what it is doing: Blocked is a stopped Session's reason (T273).
        sessions: { [ada.id]: 'idle' },
        tickets: [{ assigneeId: ada.id, blocked: true, column: 'doing' }],
        now: NOW,
      }),
    ).toEqual(['Ada · Blocked'])
    expect(tags({ employees: [ada], sessions: { [ada.id]: 'out_of_budget' }, now: NOW })).toEqual([
      'Ada · Out of budget',
    ])
    expect(tags({ employees: [ada], sessions: { [ada.id]: 'parked' }, now: NOW })).toEqual(['Ada · Parked'])
    expect(tags({ employees: [ada], sessions: { [ada.id]: 'idle' }, now: NOW })).toEqual(['Ada · Idle'])
    expect(tags({ employees: [ada], sessions: { [ada.id]: 'starting' }, now: NOW })).toEqual(['Ada · Starting…'])
    expect(
      tags({
        employees: [ada],
        sessions: { [ada.id]: 'busy' },
        activity: { [ada.id]: { tool: 'Read', posts: [] } },
        now: NOW,
      }),
    ).toEqual(['Ada · Reading'])
    expect(tags({ employees: [ada], sessions: { [ada.id]: 'busy' }, now: NOW })).toEqual(['Ada · Working'])
    expect(tags({ employees: [ada], now: NOW })).toEqual(['Ada · Off'])
  })
})

describe('a label on the floor', () => {
  it('names every Employee at its own chair, off or not — the boss sits in a painted chair of its own', () => {
    const office = readFileSync(join(import.meta.dirname, 'Office.tsx'), 'utf8')
    expect(office).toContain('walker.tag.visible = labels.chair !== null')
    expect(office).toContain("floorText('Your chair'")
  })
})

describe('the two labels the floor draws (T94)', () => {
  it('leaves an Employee at their own desk exactly as it was: one label, the whole tag', () => {
    expect(floorLabels({ name: 'Ada', reason: 'Working' })).toEqual({
      chair: 'Ada · Working',
      dimmed: false,
      away: null,
    })
  })

  it('keeps the name alone on the chair of whoever is away, and sends the status with them', () => {
    expect(
      floorLabels({
        name: 'Ada',
        reason: 'Talking to Bob',
        away: { x: 10, y: 20, facing: 'left', place: 'desk' },
        seat: SEAT,
      }),
    ).toEqual({ chair: 'Ada', dimmed: true, away: 'Ada · Talking to Bob' })
    expect(
      floorLabels({
        name: 'Ada',
        reason: 'Waiting on you',
        away: { x: 1, y: 2, facing: 'right', place: 'boss' },
        seat: SEAT,
      }),
    ).toEqual({ chair: 'Ada', dimmed: true, away: 'Ada · Waiting on you' })
  })

  it('writes nothing at all for an Employee the room had no desk for: no chair, and the counter speaks', () => {
    // They have no chair to write a name under (T101), and the counter carries one label for
    // everyone standing at it (T100), so this Employee is drawn with no words of their own.
    expect(
      floorLabels({ name: 'Ada', reason: NO_DESK_REASON, away: { x: 10, y: 20, facing: 'left', place: 'coffee' } }),
    ).toEqual({ chair: null, dimmed: true, away: null })
  })

  it('leaves an off Employee their name and their state over their own chair: they are nowhere else', () => {
    expect(floorLabels({ name: 'Ada', reason: 'Off' })).toEqual({
      chair: 'Ada · Off',
      dimmed: false,
      away: null,
    })
  })

  it('reads a whole projected floor: everyone away is named on their chair and told on themselves', () => {
    const visiting = projectOffice({
      employees: [ada, bob],
      sessions: { [ada.id]: 'busy', [bob.id]: 'busy' },
      activity: { [ada.id]: { tool: null, posts: [post(dmChannelId(ada.id, bob.id))] } },
      now: NOW,
    })

    expect(visiting.sprites.map(floorLabels)).toEqual([
      { chair: 'Ada', dimmed: true, away: 'Ada · Talking to Bob' },
      { chair: 'Bob · Talking to Ada', dimmed: false, away: null },
    ])

    const working = projectOffice({ employees: [ada], sessions: { [ada.id]: 'busy' }, now: NOW })
    expect(working.sprites.map(floorLabels)).toEqual([{ chair: 'Ada · Working', dimmed: false, away: null }])
  })
})

describe('a crowded place speaks for itself (T100)', () => {
  it('takes every label off the counter: the corner carries one line for the whole group', () => {
    // A room with a chair for all six, so every one of them is parked off a chair of their own
    // rather than waiting at the counter for a desk the room never had (T111).
    const team = [ada, bob, employee('Cy', 2), employee('Flo', 3), employee('Gus', 4), employee('Hal', 5)]
    const scene = projectOffice({
      employees: team,
      room: 'scandi-daylight',
      sessions: Object.fromEntries(team.map((one) => [one.id, 'parked' as const])),
      now: NOW,
    })

    expect(scene.counterLabel).toBe('At the counter · 6 parked')
    // Nobody at the counter carries a label; their own chairs keep their dimmed names, as they did.
    expect(scene.sprites.map(floorLabels)).toEqual(team.map((one) => ({ chair: one.name, dimmed: true, away: null })))
  })

  it('leaves a sitter in the glass room silent and a sitter at their own desk unchanged', () => {
    // Six in one exchange: the table seats four and leaves two at their own chairs (T94).
    const team = [ada, bob, employee('Cy', 2), employee('Flo', 3), employee('Gus', 4), employee('Hal', 5)]
    const scene = projectOffice({
      employees: team,
      room: 'scandi-daylight',
      sessions: Object.fromEntries(team.map((one) => [one.id, 'busy' as const])),
      activity: Object.fromEntries(team.map((one) => [one.id, { tool: null, posts: [post('tech')] }])),
      now: NOW,
    })

    const inRoom = scene.sprites.filter((one) => one.away?.place === 'meeting')
    const atDesk = scene.sprites.filter((one) => !one.away)
    expect(inRoom).toHaveLength(4)
    expect(atDesk).toHaveLength(2)
    // The room already says `Meeting · 6`; the sitters under it say nothing.
    expect(inRoom.map(floorLabels)).toEqual(inRoom.map((one) => ({ chair: one.name, dimmed: true, away: null })))
    // Whoever the table could not seat stays at their own chair and says, short, that they are in
    // it: `Bo · in the meeting`, as p3YoI 2A draws it — never the long reason the glass room
    // silenced at the table (T156).
    expect(atDesk.map(floorLabels)).toEqual(
      atDesk.map((one) => ({ chair: `${one.name} · in the meeting`, dimmed: false, away: null })),
    )
  })

  it('still sends the label with an Employee away at a host’s desk or at the boss desk', () => {
    const visit = projectOffice({
      employees: [ada, bob],
      sessions: { [ada.id]: 'busy', [bob.id]: 'busy' },
      activity: { [ada.id]: { tool: null, posts: [post(dmChannelId(ada.id, bob.id))] } },
      now: NOW,
    })
    expect(floorLabels(visit.sprites[0]!).away).toBe('Ada · Talking to Bob')

    const boss = projectOffice({
      employees: [ada],
      sessions: { [ada.id]: 'busy' },
      approvals: [{ requesterId: ada.id, status: 'pending' }],
      now: NOW,
    })
    expect(floorLabels(boss.sprites[0]!).away).toBe('Ada · Waiting on you')
  })
})
