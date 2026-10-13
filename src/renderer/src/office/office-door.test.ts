import { type Container, Graphics } from 'pixi.js'
import { describe, expect, it } from 'vitest'
import { type DoorStates, doorDepth, doorPanels, doorState } from '../../../shared/office/doors'
import { officeLayout } from '../../../shared/office/layout'
import { PAINTED_ROOM } from '../../../shared/office/painted-room'
import { createDoor, createDoors } from './office-door'

const layout = officeLayout()
const GLASS = PAINTED_ROOM.walls.find((wall) => wall.name === 'meeting-glass')!
const GAP = GLASS.door!

/** Where a pane's shut face sits once the door node has slid it. */
const panesOf = (node: Container) =>
  node.children.filter((child): child is Graphics => child instanceof Graphics).slice(1)

describe('createDoors', () => {
  it('adds one door node, for the glass front', () => {
    const doors = createDoors(layout.walls)

    expect(doors.map((door) => door.name)).toEqual(['meeting-glass'])
    // A threshold plus the two sliding panels.
    expect(doors[0]!.node.children.length).toBe(3)
  })

  it('sorts the door by the bottom of its gap, so walkers pass in front of it or behind it', () => {
    const [door] = createDoors(layout.walls)

    expect(door!.node.zIndex).toBe(doorDepth(GLASS))
    expect(door!.node.zIndex).toBeGreaterThan(GAP.from.y)
    expect(door!.node.zIndex).toBeLessThan(layout.coffee[0]!.y)
  })
})

describe('a door node’s frame', () => {
  it('is hidden while the door is shut: the painting draws it closed', () => {
    const door = createDoor(GLASS)

    door.set(0)

    expect(door.node.visible).toBe(false)
    expect(panesOf(door.node).map((pane) => pane.x)).toEqual([0, 0])
  })

  it('slides the panels apart in step with the state, and shows them as it goes', () => {
    const door = createDoor(GLASS)
    const [left, right] = doorPanels(GLASS)

    const frames = [0.25, 0.5, 1].map((open) => {
      door.set(open)
      const [a, b] = panesOf(door.node)
      return { visible: door.node.visible, alpha: door.node.alpha, at: [a!.x, b!.x] as [number, number] }
    })

    expect(frames.every((frame) => frame.visible)).toBe(true)
    expect(frames.map((frame) => frame.at)).toEqual([
      [left!.slide.x * 0.25, right!.slide.x * 0.25],
      [left!.slide.x * 0.5, right!.slide.x * 0.5],
      [left!.slide.x, right!.slide.x],
    ])
    // Fully open, both panels are clear of the gap.
    expect(frames.at(-1)!.at[0]).toBeLessThan(0)
    expect(frames.at(-1)!.at[1]).toBeGreaterThan(0)
    expect(frames.at(-1)!.alpha).toBe(1)
  })

  it('clamps whatever it is given', () => {
    const door = createDoor(GLASS)

    door.set(4)
    expect(panesOf(door.node)[1]!.x).toBe(doorPanels(GLASS)[1].slide.x)
    door.set(-1)
    expect(door.node.visible).toBe(false)
  })

  it('follows a character walking up to the meeting room, frame by frame', () => {
    const door = createDoor(GLASS)
    const gapMiddle = { x: (GAP.from.x + GAP.to.x) / 2, y: (GAP.from.y + GAP.to.y) / 2 }
    let states: DoorStates = {}
    const opens: number[] = []
    for (let frame = 0; frame < 12; frame++) {
      // Walks in from 100px out, 12px a frame, and stops in the gap.
      const away = Math.max(0, 100 - frame * 12)
      states = doorState([{ x: gapMiddle.x, y: gapMiddle.y + away }], 1_000 + frame * 60, states)
      const open = states['meeting-glass']!.open
      door.set(open)
      opens.push(open)
      expect(door.node.visible, `frame ${frame}`).toBe(open > 0)
    }

    expect(opens[0]).toBe(0)
    expect(opens.at(-1)).toBe(1)
    expect(panesOf(door.node)[0]!.x).toBe(doorPanels(GLASS)[0].slide.x)
  })
})
