/**
 * The layout pass over a real floor (T105): Scandi Daylight seated to its last chair is the room
 * whose desks sit closest together — `design/office/bug-audit-scandi.png` is that room printing
 * `Bo · Attaking` over two desks a sprite apart. Projected, measured and laid out, no two of its
 * label boxes share a pixel.
 * Those two desks are a desk apart now (T103), so the collision the audit caught is made by hand
 * here rather than read off a room that has since been measured again.
 */
import { describe, expect, it } from 'vitest'
import type { Employee } from '../../../shared/domain/staff'
import { bubbleFor } from '../../../shared/office/bubbles'
import { officeLayout } from '../../../shared/office/layout'
import { type OfficeScene, projectOffice } from '../../../shared/office/projection'
import { isSelectable, ROOMS, type RoomSlug, roomGeometry } from '../../../shared/office/rooms'
import type { SessionStatus } from '../../../shared/session'
import { sliceSheet } from '../sprites'
import { FLOOR_GUTTER } from './away-tag'
import { bubbleBox, bubbleTip } from './bubble-box'
import { CHARACTER_SCALE } from './characters'
import { type FloorLabelSources, type FloorSprite, floorLabelBoxes } from './label-boxes'
import { type FloorLabel, labelsOverlap, layOutLabels } from './label-layout'
import { BUBBLE_COLUMN, bubbleParts, frameRows } from './markers'
import { readOfficeSheet } from './testing'

const NOW = Date.parse('2026-09-17T12:00:00.000Z')

/** The names the office captures use, so the boxes are the width of the words the floor draws. */
const NAMES = ['Bo', 'Flo', 'Gus', 'Hal', 'Ida', 'Jo', 'Kit', 'Lou', 'Max', 'Nel', 'Ola', 'Pip']

function employee(desk: number): Employee {
  return {
    id: `id-${desk}`,
    name: NAMES[desk % NAMES.length]!,
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
    sprite: desk,
    createdAt: '2026-09-17T00:00:00.000Z',
  }
}

/** The marker sheet's bubble drawings and the character sheet's rows, sliced as the stage slices them. */
const markers = (() => {
  const { rgba, width, height } = readOfficeSheet('office-marker-sheet.png')
  return { rgba, width, row: sliceSheet(rgba, width, height, { greenSubject: true })[1]! }
})()
const characters = (() => {
  const { rgba, width, height } = readOfficeSheet('characters.png')
  return sliceSheet(rgba, width, height)
})()

/** How tall a sitter is drawn: their row's tallest seated cell, at the stage's scale. */
function sitterHeight(sprite: number): number {
  const row = characters[sprite % characters.length]!
  return Math.max(...[1, 2].map((column) => row[column]?.h ?? 0)) * CHARACTER_SCALE
}

/**
 * Inter at the floor's 10 px, generously: the real boxes come off Pixi's own metrics, and a test
 * that measures wider than the font does can only be stricter than the stage. The bubbles are the
 * marker sheet's own, hung over the sitter's own height, as the stage hangs them.
 */
const sources: FloorLabelSources = {
  at: (sprite) => sprite.away ?? sprite.seat ?? { x: 0, y: 0 },
  measure: (_key, text) => ({ width: text.length * 6 + 4, height: 14, headroom: 44 }),
  bubble: (sprite) => {
    const glyph = bubbleFor(sprite as OfficeScene['sprites'][number])
    if (!glyph) return null
    const drawn = markers.row[BUBBLE_COLUMN[glyph]]!
    const shape = bubbleParts(frameRows(markers.rgba, markers.width, drawn))
    const feet = sources.at(sprite)
    return bubbleBox(shape, bubbleTip(feet, sitterHeight((sprite as OfficeScene['sprites'][number]).sprite)))
  },
}

/** The floor as it was before T156: the pass never heard of a bubble. */
const blindToBubbles: FloorLabelSources = { ...sources, bubble: () => null }

/** Every desk the room has, taken: the Company the painting seats and not one more. */
function fullRoom(room: RoomSlug, session: SessionStatus = 'busy'): OfficeScene {
  const seats = officeLayout(roomGeometry(room)).seats.length
  const team = Array.from({ length: seats }, (_, desk) => employee(desk))
  return projectOffice({
    room,
    employees: team,
    sessions: Object.fromEntries(team.map((one) => [one.id, session])),
    now: NOW,
  })
}

function boxesOf(scene: OfficeScene, from: FloorLabelSources = sources): FloorLabel[] {
  return floorLabelBoxes(scene.sprites as FloorSprite[], scene.layout.painting, from)
}

/** Every pair the floor would draw on top of each other; two fixed boxes never move, so never count. */
function collisions(boxes: readonly FloorLabel[]): string[] {
  return boxes.flatMap((one, i) =>
    boxes
      .slice(i + 1)
      .flatMap((two) => (!(one.fixed && two.fixed) && labelsOverlap(one, two) ? [`${one.key} over ${two.key}`] : [])),
  )
}

/** Every label laid across a bubble. */
function onBubbles(placed: readonly FloorLabel[]): string[] {
  const bubbles = placed.filter((one) => one.key.startsWith('bubble:'))
  return placed
    .filter((one) => !one.fixed)
    .flatMap((label) =>
      bubbles.filter((bubble) => labelsOverlap(label, bubble)).map((bubble) => `${label.key} on ${bubble.key}`),
    )
}

const floorOf = (scene: OfficeScene) => ({ bottom: scene.layout.painting.height - FLOOR_GUTTER })

describe('the floor of the room with the tightest desks', () => {
  const scene = fullRoom('scandi-daylight')

  /**
   * The audit's own floor printed `Bo · Attaking` over `Gus · Evorking`, two labels under desks a
   * sprite apart. T103 has since moved every chair the painting tucks in on the far side of a run
   * onto the floor its own wheels stand on, which pulled those desks apart: no room of the picker
   * asks for the same pixels twice any more. The pass is still the only thing that guarantees it, so
   * what it has to undo is put back by hand — this room's own two labels, one on the other's spot.
   */
  it('is what the pass is for: two labels piled on one spot come out apart', () => {
    const [first, second] = boxesOf(scene)
    const piled = [first!, { ...second!, x: first!.x, y: first!.y }]

    expect(collisions(piled).length).toBeGreaterThan(0)
    expect(collisions(layOutLabels(piled, floorOf(scene)))).toEqual([])
  })

  it('draws no two labels on top of each other once they are laid out', () => {
    const placed = layOutLabels(boxesOf(scene), floorOf(scene))
    expect(collisions(placed)).toEqual([])
  })

  it('keeps every label on the painting', () => {
    for (const label of layOutLabels(boxesOf(scene), floorOf(scene))) {
      expect(label.y, label.key).toBeGreaterThanOrEqual(0)
      expect(label.y + label.height, label.key).toBeLessThanOrEqual(scene.layout.painting.height)
    }
  })

  it('lays the same floor out the same way twice', () => {
    const once = layOutLabels(boxesOf(scene), floorOf(scene))
    const again = layOutLabels(boxesOf(scene), floorOf(scene))
    expect(again.map((one) => [one.key, one.y])).toEqual(once.map((one) => [one.key, one.y]))
  })
})

describe('every room the picker offers, seated to its last chair', () => {
  it('draws no two labels on top of each other', () => {
    for (const room of ROOMS.filter(isSelectable)) {
      const scene = fullRoom(room.slug)
      const placed = layOutLabels(boxesOf(scene), floorOf(scene))
      expect(collisions(placed), room.slug).toEqual([])
    }
  })
})

/**
 * A sitter's bubble hangs over their head, and a head one desk down the room is level with the chair
 * label of the desk above it (T156). The design audit caught Night Studio with everyone Idle drawing
 * Flo's `Zzz` over the end of `Bo · Idle`, which read `Bo · Idlez`, and Scandi Daylight doing the same
 * three times over.
 */
describe('a floor where everyone is asleep', () => {
  it('lays a label across a bubble when the pass does not know bubbles exist: the audit’s floor', () => {
    for (const room of ['night-studio', 'scandi-daylight'] as const) {
      const scene = fullRoom(room, 'idle')
      const bubbles = boxesOf(scene).filter((one) => one.key.startsWith('bubble:'))
      const labels = layOutLabels(boxesOf(scene, blindToBubbles), floorOf(scene))

      expect(onBubbles([...labels, ...bubbles]), room).not.toEqual([])
    }
  })

  it('draws no label across a bubble, in every room the picker offers', () => {
    for (const room of ROOMS.filter(isSelectable)) {
      const scene = fullRoom(room.slug, 'idle')
      const placed = layOutLabels(boxesOf(scene), floorOf(scene))

      expect(placed.filter((one) => one.key.startsWith('bubble:')).length, room.slug).toBeGreaterThan(0)
      expect(onBubbles(placed), room.slug).toEqual([])
      expect(collisions(placed), room.slug).toEqual([])
    }
  })

  it('moves the label, never the bubble: a bubble stays over its own head', () => {
    const scene = fullRoom('night-studio', 'idle')
    const asked = boxesOf(scene).filter((one) => one.key.startsWith('bubble:'))
    const placed = layOutLabels(boxesOf(scene), floorOf(scene)).filter((one) => one.key.startsWith('bubble:'))

    expect(placed.map(({ key, x, y }) => ({ key, x, y }))).toEqual(asked.map(({ key, x, y }) => ({ key, x, y })))
  })
})
