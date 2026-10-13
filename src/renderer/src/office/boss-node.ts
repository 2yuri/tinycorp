import { Container, Sprite } from 'pixi.js'
import type { BossAtDesk } from '../../../shared/office/boss'
import { PLUMBOB, plumbobPose } from '../../../shared/office/plumbob'
import { CHARACTER_SCALE, type CharacterFrame, type CharacterFrames } from './characters'
import type { MarkerFrames } from './markers'

/**
 * The boss on the stage (T86): their own character, seated at their own desk for as long as the
 * Company is open, with the emerald over their head. It never walks, so it has no path and no goal —
 * only a sheet that changes when Your profile picks another character.
 */
export interface BossNode {
  /** Add this to the world; its `zIndex` sorts it with the walkers, so furniture in front covers it. */
  node: Container
  /** The seated body, under the emerald. */
  body: Sprite
  /** The boss picked another character in Your profile. */
  setSheet(sheet: number): void
  /** Draws the pose at `clock` ms: the seated body, then the emerald bobbing and turning over it. */
  animate(clock: number): void
}

/**
 * The frame the boss is drawn with: their own row of the same sheet and chroma key the Employees use,
 * seated, facing as the room's seat says. Picking the frame is all this decides — the sheet's seated
 * columns draw one body for every row (see `characters.ts`), which is the sheet's limit, not this one.
 */
function bossFrame(characters: CharacterFrames, boss: BossAtDesk, clock: number): CharacterFrame {
  return characters(boss.sprite, 'sit', boss.seat.facing, clock)
}

export function createBoss(boss: BossAtDesk, characters: CharacterFrames, markers: MarkerFrames): BossNode {
  const node = new Container()
  node.zIndex = boss.seat.y
  // The seat is the floor the painted chair stands on: the sheet's own chair is drawn right on it,
  // exactly as an Employee's is at a painted desk.
  node.position.set(Math.round(boss.seat.x), Math.round(boss.seat.y))
  const body = new Sprite()
  body.anchor.set(0.5, 1)
  // The emerald is centred on its own position, so the bob puts its middle where the pose says.
  const emerald = new Sprite()
  emerald.anchor.set(0.5, 0.5)
  node.addChild(body, emerald)
  let at: BossAtDesk = boss

  return {
    node,
    body,
    setSheet(sheet) {
      at = { ...at, sprite: sheet }
    },
    animate(clock) {
      const frame = bossFrame(characters, at, clock)
      body.texture = frame.texture
      body.scale.set(frame.flip ? -CHARACTER_SCALE : CHARACTER_SCALE, CHARACTER_SCALE)
      // The seated cells draw their chair off centre; the shift puts its wheels back on the seat.
      body.x = frame.shift
      const pose = plumbobPose(body.height, clock)
      emerald.position.set(frame.shift, pose.y)
      // The sheet draws the turn in steps of its own, so the diamond is swapped rather than squashed:
      // it keeps the height the pose was measured with, and its width is the step's own.
      const turn = markers.emerald(pose.turn)
      emerald.texture = turn.texture
      const scale = PLUMBOB.height / (turn.texture.height || PLUMBOB.height)
      emerald.scale.set(turn.flip ? -scale : scale, scale)
    },
  }
}
