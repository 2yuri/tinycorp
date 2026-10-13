/**
 * Anchors of the Night Shift room (`design/office/rooms/night-shift.png`), in painting pixels.
 * The painting is that art scaled to cover the same 1040×660 frame as the first room and centre-cropped
 * (see `src/renderer/public/office/rooms/night-shift.png`); everything here was measured against it.
 *
 * The room reads back-to-front as: a window wall of rain and neon down the left with the desk rows
 * against it, a glass meeting cube set into the back wall, and a kitchen counter down the right with a
 * lounge in front of it. The one door the art draws is the meeting cube's sliding panel, on the pane
 * nearest its left post — the handle is painted at 548,222.
 * Counted against the art (T93) the room draws six chairs: the five at the desks above, and one more
 * at the far end of the row nearest the viewer, which is the boss's own. So the Night Shift seats five
 * Employees and the boss, which is what its facts already said.
 */
import { coffeeQueue } from './coffee-queue'
import { chairFoot, type PaintedRoom, type Point, type Spot } from './painted-room'

const rect = (x: number, y: number, w: number, h: number): Point[] => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
]

const poly = (...xy: number[]): Point[] =>
  Array.from({ length: xy.length / 2 }, (_, i) => ({ x: xy[2 * i]!, y: xy[2 * i + 1]! }))

/**
 * A desk seat: the floor the painted chair's wheels stand on, the visitor beside it, and that chair's
 * foot drawn again over the sitter (T91). Every desk in this room faces the same way — its monitors
 * are up and to the left — so every sitter is turned that way.
 */
const seat = (x: number, y: number, visitor: Spot) => ({
  x,
  y,
  facing: 'left' as const,
  visitor,
  occluders: [chairFoot({ x, y }, 22)],
})

/**
 * The meeting cube's floor: the two glass fronts meet at 677,360 and its posts stand at 548,295 and
 * 785,306, so the corner against the back wall follows at 656,241.
 */
const MEETING_AREA = poly(548, 295, 656, 241, 785, 306, 677, 360)
/** The table inside it, its near-right side left clear for the chairs the art paints there. */
/**
 * How many Employees this room seats — five painted chairs and the one desk its free floor grows —
 * and so how long the line at its counter has to be: a usage limit parks all of them at once.
 */
const SEATS = 6

const MEETING_TABLE = poly(600, 262, 676, 224, 748, 260, 672, 298)
/** The kitchen counter, its cupboards and the fridge: what the coffee spots queue in front of. */
export const KITCHEN_COUNTER = poly(896, 348, 1040, 420, 1040, 498, 896, 426)

export const NIGHT_SHIFT_ROOM: PaintedRoom = {
  width: 1040,
  height: 660,
  seats: [
    // The row against the windows, each chair pushed back from its desk, all seen from behind.
    seat(137, 505, { x: 183, y: 512, facing: 'left' }),
    seat(255, 465, { x: 302, y: 434, facing: 'left' }),
    seat(372, 392, { x: 420, y: 404, facing: 'left' }),
    // The island in the middle of the floor.
    seat(455, 550, { x: 500, y: 566, facing: 'left' }),
    seat(365, 612, { x: 310, y: 616, facing: 'right' }),
  ],
  /**
   * The desk nearest the viewer, and the chair at its right end: the boss's own. The frame cuts that
   * chair's wheels away, so the seat is the boards it stands on at the cut, and the sprite's own chair
   * covers it (T95). Whoever needs a decision stands on their right, on the boards below the bin.
   */
  boss: {
    desk: { x: 470, y: 600, w: 150, h: 60 },
    seat: { x: 645, y: 650, facing: 'left' },
    visitor: { x: 688, y: 652, facing: 'left' },
  },
  /**
   * This room paints no TV: the only screens are the two the meeting cube hangs on its back walls, and
   * at 66 px wide neither fits a Company name beside the mark. The bare wall over the kitchen shelves
   * does, and a lit name there reads as one more sign in a room full of them.
   */
  // A neon plaque in the middle of the dark wall between the window and the glass room (T280):
  // the room paints no board, and its two screens sit behind the cube's glass.
  logo: [
    {
      corners: [
        { x: 479, y: 118 },
        { x: 531, y: 144 },
        { x: 531, y: 184 },
        { x: 479, y: 158 },
      ],
      plaque: { art: 'office/plaques/night-shift.png', face: { left: 0.14, top: 0.16, right: 0.86, bottom: 0.84 } },
    },
  ],
  meeting: {
    area: MEETING_AREA,
    table: MEETING_TABLE,
    // The chairs down the table's near-right side, away from the door; sitters are drawn from behind,
    // turned up and to the left, which is where the table is from every one of them.
    spots: [
      { x: 683, y: 313, facing: 'left' },
      { x: 702, y: 304, facing: 'left' },
      { x: 720, y: 295, facing: 'left' },
      { x: 739, y: 285, facing: 'left' },
    ],
  },
  coffee: {
    // The line at the kitchen counter, backs to the room. The boards in front of the run are a wedge
    // — the couch closes one end, the frame cuts the other — so the line goes up the counter to where
    // the wedge runs out and turns back down the rug, rather than standing a second row in the first
    // one (T107).
    spots: coffeeQueue(
      [
        { x: 876, y: 450, facing: 'up' },
        { x: 1000, y: 494, facing: 'up' },
        { x: 890, y: 545, facing: 'up' },
      ],
      SEATS,
    ),
  },
  /**
   * Both glass fronts of the meeting cube. The left one carries the sliding door: its posts are painted
   * at x 548 and 605, and the gap is the pane between them. The right front has no way through, and the
   * cube's other two sides are solid wall against the back of the room, with no floor behind them.
   */
  walls: [
    {
      name: 'meeting-glass',
      from: { x: 548, y: 295 },
      to: { x: 677, y: 360 },
      door: { from: { x: 572, y: 307 }, to: { x: 616, y: 329 } },
      height: 170,
    },
    { name: 'meeting-glass-right', from: { x: 677, y: 360 }, to: { x: 785, y: 306 }, height: 170 },
  ],
  /**
   * The walkable boards: the window wall's foot down the left, the back wall over to the meeting cube,
   * round the cube's two glass fronts, on along the kitchen wall, and back along the dark edge the
   * painting cuts the floor off at.
   */
  floor: poly(0, 460, 448, 238, 548, 288, 677, 360, 785, 304, 1040, 432, 1040, 484, 688, 660, 324, 660, 0, 498),
  obstacles: [
    // The desk row along the windows, from the boss's end up to the corner.
    poly(0, 180, 560, 180, 560, 210, 0, 490),
    // The desk island in the middle of the floor.
    poly(205, 502, 355, 427, 498, 498, 400, 547, 348, 573, 250, 590, 205, 560),
    // The bottom row, which the frame cuts through. It ends at the desk's own right edge: the boards
    // past it carry the boss's chair, and a chair stands on floor a character can reach (T95).
    poly(452, 638, 588, 566, 660, 602, 452, 700),
    // The shelves and the water cooler against the back wall.
    poly(446, 220, 545, 262, 545, 312, 446, 302),
    // The second water cooler, the shelf and the plant beside the kitchen.
    rect(780, 240, 36, 88),
    rect(796, 300, 92, 62),
    KITCHEN_COUNTER,
    // The lounge: both couches and the lamp between them and the counter.
    rect(688, 395, 184, 190),
    rect(864, 500, 28, 28),
    // The low table in front of the couches, the plant and the bin beside it.
    rect(645, 440, 125, 80),
    rect(700, 540, 80, 85),
    rect(672, 585, 45, 65),
    // The meeting room's table.
    MEETING_TABLE,
  ],
}
