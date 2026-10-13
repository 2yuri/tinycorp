import { type Sprite, Texture } from 'pixi.js'
import { describe, expect, it } from 'vitest'
import { bossAtDesk } from '../../../shared/office/boss'
import { type Facing, officeLayout } from '../../../shared/office/layout'
import { PLUMBOB } from '../../../shared/office/plumbob'
import { createBoss } from './boss-node'
import type { CharacterFrames, Pose } from './characters'
import type { MarkerFrames } from './markers'

const layout = officeLayout()

interface Ask {
  sheet: number
  pose: Pose
  facing: Facing
}

/** A stand-in for the loaded sheet: it records what was asked of it and hands back a 1×1 frame. */
function sheet(): { asks: Ask[]; characters: CharacterFrames } {
  const asks: Ask[] = []
  return {
    asks,
    characters: (sheetIndex, pose, facing) => {
      asks.push({ sheet: sheetIndex, pose, facing })
      return { texture: Texture.WHITE, flip: false, shift: 0 }
    },
  }
}

/** A stand-in for the marker sheet: it records the turn each frame was asked for. */
function marker(): { turns: number[]; markers: MarkerFrames } {
  const turns: number[] = []
  return {
    turns,
    markers: {
      emerald: (turn) => {
        turns.push(turn)
        return { texture: Texture.WHITE, flip: turn < 0 }
      },
      bubble: () => ({ texture: Texture.WHITE, tip: { x: 0, y: 0 }, body: { x: 0, y: 0, w: 1, h: 1 } }),
    },
  }
}

/** The emerald is the one child of the node that is not the body. */
const emeraldOf = (boss: { node: { children: unknown[] }; body: Sprite }) =>
  boss.node.children.find((child): child is Sprite => child !== boss.body)!

describe('the boss on the stage', () => {
  it('draws the character Your profile picked, seated, facing as the seat says', () => {
    const { asks, characters } = sheet()

    createBoss(bossAtDesk(layout, 4), characters, marker().markers).animate(0)

    expect(asks.at(-1)).toEqual({ sheet: 4, pose: 'sit', facing: layout.boss.seat.facing })
  })

  it('draws another character the moment the profile picks one', () => {
    const { asks, characters } = sheet()
    const boss = createBoss(bossAtDesk(layout, 0), characters, marker().markers)

    boss.setSheet(2)
    boss.animate(16)

    expect(asks.at(-1)?.sheet).toBe(2)
  })

  it('sits on the boss seat, sorted with the walkers so furniture in front covers it', () => {
    const boss = createBoss(bossAtDesk(layout, 1), sheet().characters, marker().markers)

    expect(boss.node.zIndex).toBe(layout.boss.seat.y)
    // The seated cells draw their own chair standing on the floor, so the node sits exactly on the
    // seat: the sprite's chair covers the painted one instead of hovering over it (T91).
    expect({ x: boss.node.x, y: boss.node.y }).toEqual({
      x: layout.boss.seat.x,
      y: layout.boss.seat.y,
    })
  })

  it('carries the plumbob in its own space, above the head and never over the face', () => {
    const { turns, markers } = marker()
    const boss = createBoss(bossAtDesk(layout, 1), sheet().characters, markers)
    const emerald = emeraldOf(boss)

    for (const clock of [0, 400, 1300, 2600, 4100, 7000]) {
      boss.animate(clock)

      // Its lowest point clears the top of the body, whose feet are the node's own origin.
      expect(emerald.y + PLUMBOB.height / 2).toBeLessThanOrEqual(-boss.body.height - PLUMBOB.gap)
      // The sheet is asked for a step of the turn that is never narrower than the sliver, so the
      // diamond never vanishes edge-on, and the drawing keeps the height the pose was measured with.
      expect(Math.abs(turns.at(-1)!)).toBeGreaterThanOrEqual(PLUMBOB.minTurn)
      expect(emerald.height).toBeCloseTo(PLUMBOB.height)
    }
  })

  it('bobs and turns with the clock alone', () => {
    const { turns, markers } = marker()
    const boss = createBoss(bossAtDesk(layout, 1), sheet().characters, markers)
    const emerald = emeraldOf(boss)

    boss.animate(0)
    const first = { y: emerald.y, turn: turns.at(-1) }
    boss.animate(PLUMBOB.bobMs / 4)
    const later = { y: emerald.y, turn: turns.at(-1) }
    boss.animate(0)

    expect(later).not.toEqual(first)
    expect({ y: emerald.y, turn: turns.at(-1) }).toEqual(first)
  })

  it('draws the emerald the far way round once the turn passes edge on', () => {
    const { turns, markers } = marker()
    const boss = createBoss(bossAtDesk(layout, 1), sheet().characters, markers)
    const emerald = emeraldOf(boss)

    // A quarter of the way through one turn the diamond is edge on; past it, the far face comes round.
    boss.animate(0)
    expect(turns.at(-1)).toBeGreaterThan(0)
    expect(emerald.scale.x).toBeGreaterThan(0)
    boss.animate(PLUMBOB.spinMs / 2)
    expect(turns.at(-1)).toBeLessThan(0)
    expect(emerald.scale.x).toBeLessThan(0)
  })
})
