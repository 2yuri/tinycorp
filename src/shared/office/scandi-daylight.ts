/**
 * Anchors of Scandi Daylight (`design/office/rooms/scandi-daylight.png`), in painting pixels.
 * Measured the way the Warm Loft was (T84): the 1408×768 art scaled to cover 1040×660 and
 * centre-cropped — that is `office/rooms/scandi-daylight.png` — then every anchor read off the crop.
 *
 * What the room has, and how it is read:
 * - Three desk clusters down the left half, painting ten chairs between them: five drawn from behind,
 *   on the clusters' near sides, and five turned towards the viewer on their far sides. Every one of
 *   them is a seat (T93) — a room seats as many Employees as its art draws chairs for. The near chair
 *   of the west run is the boss's own, so the room seats nine Employees and the boss.
 * - A far-side sitter is drawn seated from the front, on the floor the painted chair's wheels stand
 *   on, which covers that chair; the cluster between them and the viewer is drawn again over them
 *   from its own far edge down, so the desk cuts them at the waist and never the other way round
 *   (T103).
 * - A glass meeting cube standing free in the middle of the floor. Its near-right front carries the
 *   sliding door and the floor reaches the cube nowhere else, so that is the only way in or out.
 * - A sofa, a rug and a low table in front of the kitchen run on the right: this room's coffee corner,
 *   since the counter itself is painted against the wall with no floor in front of it.
 * - Two desks of the kit on the free floor (T101), in the kit's `pale-oak`: the wood this room is
 *   painted in, so they read as the room's own rather than as a prop from somewhere else. The floor
 *   behind the cube would take a third, but a desk against the back wall reads as furniture stored
 *   there rather than as somewhere to work, so the room stops at two.
 * - The room is painted in daylight — white walls, pale oak, no lamp lit — and the app has no light
 *   theme, so it is drawn under the same dark chrome as the rest (see the T91 PR).
 */
import { coffeeQueue } from './coffee-queue'
import { chairFoot, deskBand, type PaintedRoom, type Point, type Spot } from './painted-room'

const rect = (x: number, y: number, w: number, h: number): Point[] => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
]

const poly = (...xy: number[]): Point[] =>
  Array.from({ length: xy.length / 2 }, (_, i) => ({ x: xy[2 * i]!, y: xy[2 * i + 1]! }))

/**
 * A painted chair drawn from behind, turned the way its own monitor stands: the seat is the floor
 * its wheels stand on, and that chair's foot goes back over the sitter (T91).
 */
const seat = (x: number, y: number, facing: 'left' | 'right', visitor: Spot) => ({
  x,
  y,
  facing,
  visitor,
  occluders: [chairFoot({ x, y }, 22)],
})

/**
 * A painted chair on the far side of a cluster, turned towards the viewer: the seat is the floor that
 * chair's wheels stand on, so the sprite's own chair lands on the painted one and covers it (T103).
 * `band` is the stretch of the cluster the painting draws between the viewer and the sitter, redrawn
 * over them, which is what keeps them behind their desk rather than over it.
 */
const far = (x: number, y: number, band: Point[], visitor: Spot) => ({
  x,
  y,
  facing: 'down' as const,
  // The sheet draws every row seated from the front now, so a far chair is a sitter, not a stander.
  turn: 'right' as const,
  visitor,
  occluders: [band],
})

/** The three desk clusters, as the floor they stand on. */
const WEST_DESK = poly(20, 330, 120, 280, 230, 336, 130, 392)
const WINDOW_DESK = poly(226, 276, 350, 212, 470, 272, 346, 336)
const NEAR_DESK = poly(248, 486, 372, 422, 500, 486, 376, 550)
/**
 * Each cluster's far edge, where its top meets the floor behind it, read off the art over the stretch
 * its own far chairs sit at: the west run's edge falls away to the right, the window island's too,
 * and the near island's rises to the right, since it is the other way round in the painting. Each
 * band drops far enough to take a whole sitter and stops short of the chairs on the near side.
 */
const WEST_BAND = deskBand({ x: 145, y: 320 }, { x: 240, y: 366 }, 46)
const WINDOW_BAND = deskBand({ x: 305, y: 205 }, { x: 480, y: 293 }, 52)
const NEAR_BAND = deskBand({ x: 225, y: 489 }, { x: 380, y: 411 }, 56)
/** The glass cube's floor, and the table standing in the middle of it. */
const MEETING_AREA = poly(538, 273, 676, 201, 805, 270, 667, 342)
const MEETING_TABLE = poly(598, 253, 667, 200, 737, 240, 667, 273)
/**
 * How many Employees this room seats — nine painted chairs and the two desks its free floor grows —
 * and so how long the line in its lounge has to be: a usage limit parks all of them at once.
 */
const SEATS = 11

/** The kitchen run and the fridge down the right wall, and the lounge in front of them. */
const SCANDI_KITCHEN = poly(876, 250, 1040, 332, 1040, 420, 876, 340)
const SCANDI_LOUNGE = [poly(668, 393, 780, 328, 827, 360, 715, 425), poly(763, 432, 816, 400, 870, 430, 817, 462)]

export const SCANDI_DAYLIGHT_ROOM: PaintedRoom = {
  width: 1040,
  height: 660,
  seats: [
    // The west run's far-side chair, at the end away from the boss.
    far(192, 365, WEST_BAND, { x: 250, y: 300, facing: 'left' }),
    // The window island: the two chairs on its near side, each turned up and to the right, where its
    // own monitor stands.
    seat(253, 335, 'right', { x: 234, y: 300, facing: 'right' }),
    seat(313, 363, 'right', { x: 272, y: 392, facing: 'right' }),
    // The window island's two far-side chairs, between it and the windows.
    far(365, 272, WINDOW_BAND, { x: 330, y: 205, facing: 'right' }),
    far(429, 298, WINDOW_BAND, { x: 470, y: 250, facing: 'left' }),
    // The island nearest the viewer, whose monitors are up and to the left instead.
    seat(402, 570, 'left', { x: 452, y: 588, facing: 'left' }),
    seat(475, 538, 'left', { x: 524, y: 552, facing: 'left' }),
    // That island's two far-side chairs, on the open floor behind it.
    far(270, 485, NEAR_BAND, { x: 232, y: 442, facing: 'right' }),
    far(336, 453, NEAR_BAND, { x: 296, y: 412, facing: 'right' }),
  ],
  boss: {
    // The west run, the desk in the corner: its near chair is the boss's, and nobody else sits there.
    // The desk is that corner alone; the floor behind the rest of the run is how anyone reaches the
    // chair at its far end, and a Company at full seats needs it (T93).
    desk: { x: 20, y: 330, w: 130, h: 62 },
    seat: { x: 73, y: 440, facing: 'right' },
    visitor: { x: 126, y: 452, facing: 'left' },
    occluders: [chairFoot({ x: 73, y: 440 }, 22)],
  },
  /** No screen on these walls: the Company's name goes on the bare plaster over the meeting cube. */
  // The first two of the three white panels between the glass room and the kitchen (T280).
  logo: [
    {
      corners: [
        { x: 828, y: 89 },
        { x: 866, y: 106 },
        { x: 866, y: 156 },
        { x: 828, y: 139 },
      ],
    },
    {
      corners: [
        { x: 877, y: 112 },
        { x: 914, y: 129 },
        { x: 914, y: 179 },
        { x: 877, y: 162 },
      ],
    },
  ],
  meeting: {
    area: MEETING_AREA,
    table: MEETING_TABLE,
    // Down the table's near-right side, away from the door and clear of the glass the near-left one
    // stands against: sitters are drawn from behind, turned up and to the left, which is where the
    // table is from every one of them.
    spots: [
      { x: 686, y: 292, facing: 'left' },
      { x: 707, y: 284, facing: 'left' },
      { x: 728, y: 276, facing: 'left' },
      { x: 749, y: 268, facing: 'left' },
    ],
  },
  coffee: {
    // The longest line of any of the six, because this room seats the most: it starts at the kitchen
    // run's far end, comes down in front of the counter and on across the open oak below the sofa and
    // the low table, and at the last desk pod's floor it turns back on itself for the two behind (T107).
    spots: coffeeQueue(
      [
        { x: 990, y: 410, facing: 'up' },
        { x: 668, y: 538, facing: 'up' },
        { x: 668, y: 470, facing: 'up' },
        { x: 770, y: 462, facing: 'up' },
      ],
      SEATS,
    ),
  },
  /**
   * The cube's two near fronts. The near-left one carries the sliding door, the pane the art draws
   * between the posts at 570,289 and 620,314; the near-right front has no way through, and the two
   * behind the cube are blocked as furniture is (see `obstacles`).
   */
  walls: [
    {
      name: 'meeting-glass',
      from: { x: 538, y: 273 },
      to: { x: 667, y: 342 },
      door: { from: { x: 570, y: 289 }, to: { x: 620, y: 314 } },
      height: 170,
    },
    { name: 'meeting-glass-right', from: { x: 667, y: 342 }, to: { x: 805, y: 270 }, height: 170 },
  ],
  /**
   * The pale oak floor: the two back walls' feet, then the frame's right edge, then the slab's own
   * near edges down to the south corner at 517,651. The painting's edges run 0.443 px of height per
   * px of width, not the exact half the first room's did, so the corners follow that.
   */
  floor: poly(0, 269, 517, 40, 1040, 272, 1040, 418, 517, 651, 0, 422),
  obstacles: [
    WEST_DESK,
    WINDOW_DESK,
    NEAR_DESK,
    SCANDI_KITCHEN,
    ...SCANDI_LOUNGE,
    // The potted trees standing on the floor: by the windows, beside the cube, and at the kitchen.
    rect(180, 226, 60, 60),
    rect(430, 150, 60, 60),
    rect(490, 210, 60, 50),
    rect(786, 236, 60, 70),
    rect(0, 300, 50, 60),
    MEETING_TABLE,
    // The cube's two back fronts. They carry no door and the floor runs behind them, so they are
    // blocked as furniture is: the only way into the cube stays the sliding pane on its near left.
    poly(534, 269, 676, 197, 676, 221, 534, 293),
    poly(676, 197, 805, 266, 805, 290, 676, 221),
  ],
}
