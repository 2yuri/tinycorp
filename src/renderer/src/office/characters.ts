import { Texture } from 'pixi.js'
import type { Facing } from '../../../shared/office/layout'
import { loadSheet } from './sheet-textures'

/** What a character is doing, as far as its drawing goes. */
export type Pose = 'stand' | 'walk' | 'sit' | 'type' | 'read' | 'coffee' | 'waiting'

export interface CharacterFrame {
  /** Trimmed to the drawing: anchor it at its bottom centre. */
  texture: Texture
  /** Mirror the frame horizontally. */
  flip: boolean
  /**
   * Painting pixels to move the drawing sideways so the part that stands on the floor lands on the
   * spot: 0 for a body on its own feet, `SEATED_CHAIR_SHIFT` for a seated one, whose chair is drawn
   * off to one side of the cell.
   */
  shift: number
}

/** Which way a sitter drawn from the front is turned; only a seat facing the viewer has one. */
export type Turn = 'left' | 'right'

export type CharacterFrames = (sheet: number, pose: Pose, facing: Facing, clock: number, turn?: Turn) => CharacterFrame

/** Painting pixels per sheet pixel. */
export const CHARACTER_SCALE = 0.5

/**
 * Painting pixels the seated cells draw their chair off the cell's centre (T91).
 * The seated poses are drawn in the room's own 2:1 angle, turned off the axis, so the swivel chair's
 * wheels sit to one side of the cell while the sitter's leading arm hangs out the other. Measured on
 * the sheet, that base is 18 sheet pixels — 9 painting pixels — from the centre, one way for the
 * left-turned cell and the other for the right-turned one. Moving the drawing by that much puts the
 * chair's wheels on the seat, which is the floor the painted chair stands on, so the sprite's chair
 * covers it instead of standing beside it.
 *
 * The sheet draws the chair on the floor, so nothing sinks any more: a seat is where the chair
 * stands, and the sprite is drawn on it with no offset down (the old sheet's `SEATED_SINK`, which
 * dropped a chairless body onto a painted seat, is gone with it).
 */
export const SEATED_CHAIR_SHIFT = 9

/**
 * Columns of `characters.png`; each row is one character. The last two are the sitter seen from the
 * front, for a chair on the far side of a desk (T97); a row whose front art has not been drawn yet
 * leaves them empty and falls back to the idle pose, which is what those chairs showed before.
 */
const Column = {
  IdleFacingViewer: 0,
  SeatedTurnedLeft: 1,
  SeatedTurnedRight: 2,
  WalkingRight: 3,
  SeatedFrontLeft: 4,
  SeatedFrontRight: 5,
  /** Where a walk cycle starts, when the sheet has one: four steps. */
  WalkCycleFirst: 6,
  /** And where reading starts: the same four turns as sitting, with a sheet of paper in both hands. */
  ReadingFirst: 10,
  /** And waiting on the boss: the same four turns again, with a hand up. */
  WaitingFirst: 14,
} as const

/** How many cells a walk cycle takes. */
const WALK_CYCLE_CELLS = 4

/** How long one step of the walk cycle is held, in milliseconds. */
export const WALK_STEP_MS = 160

/**
 * The walking frames a row has, in order. The sheet's fourth column is the one frame every row has
 * had since the beginning; a row that also carries the four steps of a cycle keeps them after the
 * front-seated pair, and those are used instead.
 */
export function walkCycle(row: readonly Texture[] | undefined): Texture[] {
  if (!row) return []
  const cycle = row
    .slice(Column.WalkCycleFirst, Column.WalkCycleFirst + WALK_CYCLE_CELLS)
    .filter((frame) => frame !== Texture.EMPTY)
  return cycle.length > 1 ? cycle : [row[Column.WalkingRight] ?? Texture.EMPTY]
}

/**
 * The four reading cells, in the order the seated ones are in: turned up-left, up-right, and the two
 * drawn from the front. Empty while the sheet has no reading art, and then an Employee reading looks
 * exactly like one typing, which is what the office did before.
 */
export function readingFrames(row: readonly Texture[] | undefined): Texture[] {
  if (!row) return []
  const frames = row.slice(Column.ReadingFirst, Column.ReadingFirst + 4)
  return frames.length === 4 && frames.every((frame) => frame !== Texture.EMPTY) ? frames : []
}

/**
 * The four hand-up cells, in the order the seated ones are in. Only the looks drawn one character to
 * a sheet carry them; a row without them falls back to sitting, the way a row without reading art
 * falls back to typing — so an Employee waiting on the boss at a look that has no hand still says so
 * with the `!` over their head, which is what the office had before.
 */
export function waitingFrames(row: readonly Texture[] | undefined): Texture[] {
  if (!row) return []
  const frames = row.slice(Column.WaitingFirst, Column.WaitingFirst + 4)
  return frames.length === 4 && frames.every((frame) => frame !== Texture.EMPTY) ? frames : []
}

/** The poses drawn in a chair; the rest stand on their own feet. */
const SEATED: ReadonlySet<Pose> = new Set(['sit', 'type', 'read', 'waiting'])

/**
 * `office/characters.png` (from `design/office/characters.png`): a green-chroma sheet of 18 characters
 * (rows) in 6 poses (columns), cells split by darker gutter lines. The green is keyed out on load.
 * The two seated-from-behind columns are the same pose turned the two ways a desk in a 2:1 isometric
 * room can ask for — up and to the left, up and to the right — each with its own swivel chair, so a
 * sitter covers the painted chair rather than standing in front of it. The last two are the sitter
 * seen from the front, turned each way, for the chairs the art tucks in on the far side of a desk
 * (T97). Each row keeps its own hair and skin.
 * A row whose front art has not been drawn yet leaves those two cells empty, and such a sitter falls
 * back to the idle pose with the desk hiding their legs, which is what those chairs showed before.
 */
export async function loadCharacters(base: string): Promise<CharacterFrames> {
  const [plain, withCoffee] = await Promise.all([
    sheetFrames(`${base}characters.png`),
    // The same people standing with a mug: who waits at the counter holds one (T90).
    sheetFrames(`${base}characters-coffee.png`),
  ])

  return (character, pose, facing, clock, turn) => {
    const frames = pose === 'coffee' ? withCoffee : plain
    const at = (column: number) => frames[character % frames.length]?.[column] ?? Texture.EMPTY
    if (pose === 'walk') {
      // A walk cycle if the sheet has one, stepping at `WALK_STEP_MS`; a sheet with only the one
      // walking frame keeps the old trick, where the frame is flipped every other step so a body
      // going up or down the room at least changes.
      const cycle = walkCycle(frames[character % frames.length])
      if (cycle.length > 1) {
        const step = Math.floor(clock / WALK_STEP_MS) % cycle.length
        return { texture: cycle[step]!, flip: facing === 'left', shift: 0 }
      }
      const stride = (facing === 'up' || facing === 'down') && Math.floor(clock / 300) % 2 === 1
      return { texture: at(Column.WalkingRight), flip: facing === 'left' || stride, shift: 0 }
    }
    if (pose === 'coffee') return { texture: at(Column.IdleFacingViewer), flip: facing === 'left', shift: 0 }
    if (pose === 'waiting') {
      // Waiting on the boss without the one spot at their desk: they stay in their chair with a
      // hand up. Same four turns as sitting; a look with no such art just sits, and the `!` above
      // their head is what says it, as it always did.
      const hand = waitingFrames(frames[character % frames.length])
      if (hand.length === 4) {
        if (facing === 'down') return { texture: hand[turn === 'right' ? 3 : 2]!, flip: false, shift: 0 }
        const right = facing === 'right'
        return {
          texture: hand[right ? 1 : 0]!,
          flip: false,
          shift: right ? SEATED_CHAIR_SHIFT : -SEATED_CHAIR_SHIFT,
        }
      }
    }
    if (pose === 'read') {
      // Reading is its own drawing when the sheet has one: the same turns as sitting, with a sheet of
      // paper in both hands. Without it, a reader is drawn as a sitter, as they always were.
      const reading = readingFrames(frames[character % frames.length])
      if (reading.length === 4) {
        if (facing === 'down') return { texture: reading[turn === 'right' ? 3 : 2]!, flip: false, shift: 0 }
        const right = facing === 'right'
        return {
          texture: reading[right ? 1 : 0]!,
          flip: false,
          shift: right ? SEATED_CHAIR_SHIFT : -SEATED_CHAIR_SHIFT,
        }
      }
    }
    if (SEATED.has(pose) && facing !== 'down') {
      // The seat says which way the desk is: its monitor is up and to one side, never behind the sitter.
      const right = facing === 'right'
      return {
        texture: at(right ? Column.SeatedTurnedRight : Column.SeatedTurnedLeft),
        flip: false,
        shift: right ? SEATED_CHAIR_SHIFT : -SEATED_CHAIR_SHIFT,
      }
    }
    if (SEATED.has(pose) && turn) {
      // A chair on the far side of a desk: they are drawn seated from the front, turned the way the
      // seat says. Every measured seat that faces the viewer says which way it turns (T103), and the
      // room draws its own desk back over the sitter from that desk's far edge down, so what shows
      // over the desk is a person in a chair rather than one standing behind it.
      const front = at(turn === 'right' ? Column.SeatedFrontRight : Column.SeatedFrontLeft)
      if (front !== Texture.EMPTY) return { texture: front, flip: false, shift: 0 }
    }
    return { texture: at(Column.IdleFacingViewer), flip: false, shift: 0 }
  }
}

/** One sheet's cells as textures, keyed and trimmed, row by row. */
async function sheetFrames(url: string): Promise<Texture[][]> {
  return (await loadSheet(url)).textures
}
