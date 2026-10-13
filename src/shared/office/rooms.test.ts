import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Employee } from '../domain/staff'
import { GARAGE_STARTUP_ROOM } from './garage-startup'
import { GREENHOUSE_ROOM } from './greenhouse'
import { cellOf, inside, officeLayout, type Point, spotsClash, walkable, walkPath } from './layout'
import { NIGHT_SHIFT_ROOM } from './night-shift-room'
import { PAINTED_ROOM } from './painted-room'
import { NO_DESK_REASON, projectOffice } from './projection'
import {
  DEFAULT_ROOM,
  desksFact,
  isRoomSlug,
  isSelectable,
  ROOM_SLUGS,
  ROOMS,
  roomDesks,
  roomGeometry,
  roomOf,
} from './rooms'
import { SCANDI_DAYLIGHT_ROOM } from './scandi-daylight'
import { WARM_LOFT_ROOM } from './warm-loft'

/** Where the renderer serves the paintings from; a room's `art` is a path inside it. */
const PUBLIC = join(import.meta.dirname, '../../renderer/public')

describe('the room registry', () => {
  it('has one entry per slug, in the picker order', () => {
    expect(ROOMS.map((room) => room.slug)).toEqual([...ROOM_SLUGS])
  })

  it('ships the painting every entry names', () => {
    for (const room of ROOMS) {
      expect(existsSync(join(PUBLIC, room.art)), `${room.slug}: ${room.art}`).toBe(true)
    }
  })

  it('names, describes and swatches every room', () => {
    for (const room of ROOMS) {
      expect(room.name, room.slug).not.toBe('')
      expect(room.description, room.slug).toMatch(/\.$/)
      expect(room.palette, room.slug).toHaveLength(5)
      for (const swatch of room.palette) expect(swatch, room.slug).toMatch(/^#[0-9A-F]{6}$/)
    }
  })

  it('states the facts only where the geometry they come from is in', () => {
    for (const room of ROOMS) {
      expect(room.facts === null, room.slug).toBe(room.geometry === null)
    }
  })

  it('ships every room of the picker measured against its own art (T91)', () => {
    expect(ROOMS.filter(isSelectable).map((room) => room.slug)).toEqual([...ROOM_SLUGS])
    expect(roomOf('night-studio').geometry).toBe(PAINTED_ROOM)
    expect(roomOf('warm-loft').geometry).toBe(WARM_LOFT_ROOM)
    expect(roomOf('scandi-daylight').geometry).toBe(SCANDI_DAYLIGHT_ROOM)
    expect(roomOf('night-shift').geometry).toBe(NIGHT_SHIFT_ROOM)
    expect(roomOf('greenhouse').geometry).toBe(GREENHOUSE_ROOM)
    expect(roomOf('garage-startup').geometry).toBe(GARAGE_STARTUP_ROOM)
    expect(DEFAULT_ROOM).toBe('night-studio')
  })
})

describe('a selectable room', () => {
  const selectable = ROOMS.filter(isSelectable)

  it('states the desks its geometry actually has', () => {
    for (const room of selectable) {
      expect(room.facts.desks, room.slug).toBe(desksFact(room.geometry))
      const { total, employees } = roomDesks(room.geometry)
      expect(total, room.slug).toBe(employees + 1)
      expect(room.facts.desks, room.slug).toBe(`${total} · fits ${employees} + you`)
    }
  })

  it('has a meeting room and a coffee corner, as its facts say', () => {
    for (const room of selectable) {
      expect(room.geometry.meeting.spots.length, room.slug).toBeGreaterThan(0)
      expect(room.geometry.coffee.spots.length, room.slug).toBeGreaterThan(0)
      expect(room.facts.rooms, room.slug).toBe('Meeting · coffee')
    }
  })

  it('has a coffee corner that holds everyone it seats: a pause sends the whole Company there', () => {
    for (const room of selectable) {
      const { employees } = roomDesks(room.geometry)

      // Out of budget, parked and blocked all stand at the counter, and the spots are handed out in
      // order and wrapped, so a corner smaller than the room would draw two sitters on one spot.
      expect(room.geometry.coffee.spots.length, room.slug).toBeGreaterThanOrEqual(employees)
    }
  })

  it('leaves a whole body between everyone in its coffee corner: nobody stands inside anybody (T107)', () => {
    for (const room of selectable) {
      const spots = room.geometry.coffee.spots

      for (const [i, one] of spots.entries()) {
        for (const other of spots.slice(i + 1)) {
          expect(spotsClash(one, other), `${room.slug}: ${one.x},${one.y} stands on ${other.x},${other.y}`).toBe(false)
        }
      }
    }
  })

  it('stands its whole coffee corner on walkable floor, clear of the painted furniture', () => {
    for (const room of selectable) {
      const grid = walkable(officeLayout(room.geometry))

      for (const spot of room.geometry.coffee.spots) {
        const where = `${room.slug}: ${spot.x},${spot.y}`
        expect(inside(spot, room.geometry.floor), `${where} off the floor`).toBe(true)
        const cell = cellOf(spot)
        expect(grid[cell.row]?.[cell.col], `${where} off the grid`).toBe(true)
        for (const furniture of room.geometry.obstacles) {
          expect(inside(spot, furniture), `${where} inside the furniture`).toBe(false)
        }
      }
    }
  })

  it('can be walked: every seat, meeting chair and coffee spot is reachable from every other', () => {
    for (const room of selectable) {
      const layout = officeLayout(room.geometry)
      const grid = walkable(layout)
      const spots: Point[] = [
        ...layout.seats.map((seat) => seat.visitor),
        ...layout.meeting,
        ...layout.coffee,
        layout.boss.visitor,
      ]
      const [first, ...rest] = spots
      for (const spot of rest) {
        expect(walkPath(first!, spot, grid).length, `${room.slug}: ${spot.x},${spot.y}`).toBeGreaterThan(0)
        expect(walkPath(spot, first!, grid).length, `${room.slug}: ${spot.x},${spot.y}`).toBeGreaterThan(0)
      }
    }
  })
})

/** One Employee per desk index, so a Company can be made as big as a room has to hold. */
function employee(desk: number): Employee {
  return {
    id: `id-${desk}`,
    name: `E${desk}`,
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

describe('the chairs a room paints', () => {
  const selectable = ROOMS.filter(isSelectable)

  it('seats exactly them: a room never advertises a desk it does not have (T111)', () => {
    for (const room of selectable) {
      const layout = officeLayout(room.geometry)

      // A desk of the kit was a generic piece pasted behind a sprite that brings its own chair, and
      // no anchor made that read right; the painted chairs work because the art was drawn for them.
      expect(layout.seats.length, room.slug).toBe(room.geometry.seats.length)
      expect(
        layout.seats.map((seat) => ({ x: seat.x, y: seat.y })),
        room.slug,
      ).toEqual(room.geometry.seats.map((seat) => ({ x: seat.x, y: seat.y })))
      // And the picker counts the same chairs the floor does.
      expect(room.facts.desks, room.slug).toBe(`${layout.seats.length + 1} · fits ${layout.seats.length} + you`)
    }
  })

  it('sends a Company at its full seat count to the corner without piling anyone up (T107)', () => {
    for (const room of selectable) {
      // A usage limit parks everyone at once: the whole Company is standing in the corner together.
      const crowd = Array.from({ length: roomDesks(room.geometry).employees }, (_, desk) => employee(desk))
      const scene = projectOffice({
        employees: crowd,
        room: room.slug,
        sessions: Object.fromEntries(crowd.map((one) => [one.id, 'parked' as const])),
        now: Date.parse('2026-09-17T12:00:00.000Z'),
      })
      const standing = scene.sprites.map((one) => one.away!)

      expect(
        standing.every((spot) => spot?.place === 'coffee'),
        room.slug,
      ).toBe(true)
      for (const [i, one] of standing.entries()) {
        for (const other of standing.slice(i + 1)) {
          expect(
            spotsClash(one, other),
            `${room.slug}: two of ${crowd.length} on ${one.x},${one.y} and ${other.x},${other.y}`,
          ).toBe(false)
        }
      }
    }
  })

  it('holds a Company of twice its chairs inside the painting, the rest of them at the counter', () => {
    for (const room of selectable) {
      const crowd = Array.from({ length: room.geometry.seats.length * 2 }, (_, desk) => employee(desk))
      const scene = projectOffice({
        employees: crowd,
        room: room.slug,
        sessions: Object.fromEntries(crowd.map((one) => [one.id, 'busy' as const])),
        now: Date.parse('2026-09-17T12:00:00.000Z'),
      })
      const { layout } = scene

      // The world is the painting, whatever the Company's size: nothing is drawn below it.
      expect({ width: layout.width, height: layout.height }, room.slug).toEqual(layout.painting)
      for (const seat of layout.seats) {
        expect(inside(seat, room.geometry.floor), `${room.slug} ${seat.uid} off the floor`).toBe(true)
        expect(seat.y, `${room.slug} ${seat.uid} below the painting`).toBeLessThan(layout.painting.height)
      }
      // Everyone is somewhere on that floor: at a chair of their own, or at the counter with none.
      for (const one of scene.sprites) {
        const at = one.away ?? one.seat!
        expect(inside(at, room.geometry.floor), `${room.slug} ${one.name} off the floor`).toBe(true)
        if (one.seat) continue
        expect(one.reason, `${room.slug} ${one.name}`).toBe(NO_DESK_REASON)
        expect(one.away?.place, `${room.slug} ${one.name} is not at the counter`).toBe('coffee')
      }
      // Every chair is taken and the other half of the Company is waiting: the room is full.
      expect(scene.sprites.filter((one) => one.seat).length, room.slug).toBe(layout.seats.length)
      expect(scene.sprites.filter((one) => !one.seat).length, room.slug).toBe(layout.seats.length)
    }
  })
})

describe('the office a room builds', () => {
  it('follows the room it is given: another geometry is another floor', () => {
    const nightStudio = roomOf('night-studio').geometry!
    // What a measured room from T84 would look like to `officeLayout`: its own size and its own seats.
    const other = { ...nightStudio, width: 900, height: 600, seats: nightStudio.seats.slice(0, 2) }

    const here = officeLayout(nightStudio)
    const there = officeLayout(other)

    expect(there.painting).toEqual({ width: 900, height: 600 })
    expect(here.painting).not.toEqual(there.painting)
    // Desk `i` is the same Employee's in both rooms; only where it stands changes.
    expect(there.seats[0]!.uid).toBe(here.seats[0]!.uid)
    expect(there.seats.length).not.toBe(here.seats.length)
  })
})

describe('roomOf', () => {
  it('falls back to the default room for a slug this build does not know', () => {
    expect(roomOf('a-room-from-the-future').slug).toBe(DEFAULT_ROOM)
    expect(roomOf(null).slug).toBe(DEFAULT_ROOM)
    expect(roomGeometry('a-room-from-the-future')).toBe(PAINTED_ROOM)
  })

  it('falls back to the default geometry for a room that has none', () => {
    // Every room of the picker is measured now, so the fallback is exercised with a room that is not.
    const unmeasured = { ...roomOf('greenhouse'), geometry: null, facts: null }
    expect(isSelectable(unmeasured)).toBe(false)
    expect(roomGeometry('a-room-from-the-future')).toBe(PAINTED_ROOM)
  })

  it('knows its own slugs and nothing else', () => {
    expect(isRoomSlug('night-studio')).toBe(true)
    expect(isRoomSlug('warm-loft')).toBe(true)
    expect(isRoomSlug('the-moon')).toBe(false)
    expect(isRoomSlug(7)).toBe(false)
  })
})

describe('the light a room puts on a character', () => {
  it('is a colour every selectable room states, and never darkens a body to mud', () => {
    for (const room of ROOMS.filter(isSelectable)) {
      const light = room.light
      for (const shift of [16, 8, 0]) {
        const channel = (light >> shift) & 0xff
        expect(channel, `${room.slug} channel ${shift}`).toBeGreaterThanOrEqual(0xc8)
        expect(channel, `${room.slug} channel ${shift}`).toBeLessThanOrEqual(0xff)
      }
    }
  })
})
