/**
 * Anchors of the Garage Startup (`design/office/rooms/garage-startup.png`), in painting pixels.
 * Measured the way the Warm Loft was (T84): the 1408×768 art scaled to cover 1040×660 and
 * centre-cropped — that is `office/rooms/garage-startup.png` — then every anchor read off the crop.
 *
 * What the room has, and how it is read:
 * - Two folding-table runs pushed back to back across the middle. The art draws seven chairs at them:
 *   four down their near sides, drawn from behind, and three tucked in on their far sides, drawn
 *   turned towards the viewer. Every one of them is a seat (T93) — a room seats as many Employees as
 *   its art draws chairs for. The near chair of the front run is the boss's own, so the garage seats
 *   six Employees and the boss.
 * - A far-side sitter is drawn seated from the front, on the floor the painted chair's wheels stand
 *   on, which covers that chair; the table between them and the viewer is drawn again over them from
 *   its own far edge down (T103). These trestle tables are thin, so it takes little of the sitter:
 *   they read as someone sitting at the table with their legs under it, which is what they are.
 * - A glass booth against the right wall: the meeting room. Its near-right front carries the sliding
 *   door, and the floor reaches the booth nowhere else.
 * - Two dark couches and a low table in the near-right corner: the coffee corner, since the counter
 *   itself stands against the wall with no floor in front of it.
 * - One desk of the kit on the bare slab (T101), the kit's `garage-bench`: the same folding table on
 *   steel legs the painting draws. The slab is the only place this room has left, and it holds one.
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
 * A painted chair drawn from behind, turned up and to the left, where its own monitor stands: the
 * seat is the floor its wheels stand on, and that chair's foot goes back over the sitter (T91).
 */
const seat = (x: number, y: number, visitor: Spot) => ({
  x,
  y,
  facing: 'left' as const,
  visitor,
  occluders: [chairFoot({ x, y }, 22)],
})

/**
 * A painted chair on the far side of a table run, turned towards the viewer: the seat is the floor
 * its own wheels stand on, so the sprite's chair lands on the painted one and covers it, and `band`
 * — the table the painting draws between the viewer and the sitter — is drawn again over them from
 * its far edge down (T103).
 */
const far = (x: number, y: number, band: Point[], visitor: Spot) => ({
  x,
  y,
  facing: 'down' as const,
  // Every row of the sheet is drawn seated from the front now, so a far chair is a sitter (T102).
  turn: 'right' as const,
  visitor,
  occluders: [band],
})

/** The two trestle runs, as the floor they stand on. */
const FRONT_TABLES = poly(280, 405, 400, 355, 530, 417, 410, 465)
const BACK_TABLES = poly(450, 305, 570, 255, 770, 350, 650, 400)
/**
 * The far edges of the three tables a far chair is tucked at, read off the art. The front run turns a
 * corner between its two tables — one edge rises to the right, the next falls away — so its chairs
 * take one band each rather than sharing the run's.
 */
const FRONT_LEFT_BAND = deskBand({ x: 250, y: 393 }, { x: 335, y: 352 }, 60)
const FRONT_RIGHT_BAND = deskBand({ x: 385, y: 348 }, { x: 465, y: 386 }, 55)
const BACK_BAND = deskBand({ x: 570, y: 244 }, { x: 660, y: 287 }, 55)
/** The glass booth's floor and the table in it. */
const MEETING_AREA = poly(705, 353, 790, 321, 932, 348, 847, 380)
/**
 * How many Employees this room seats — six painted chairs and the one desk its free floor grows —
 * and so how long the line round its rug has to be: a usage limit parks all of them at once.
 */
const SEATS = 7

const MEETING_TABLE = poly(780, 340, 820, 328, 875, 345, 835, 357)
/** The couches and the low table in the near-right corner, and the counter against the right wall. */
const GARAGE_LOUNGE = [
  poly(815, 430, 880, 392, 945, 425, 880, 465),
  poly(675, 505, 730, 462, 790, 495, 735, 540),
  poly(762, 480, 810, 452, 858, 480, 810, 508),
]
const COUNTER = poly(940, 230, 1040, 280, 1040, 410, 940, 360)
/** The steel shelving and the stacked boxes down the left wall. */
const SHELVING = poly(120, 190, 340, 130, 340, 330, 120, 400)

export const GARAGE_STARTUP_ROOM: PaintedRoom = {
  width: 1040,
  height: 660,
  seats: [
    // The front run's two far-side chairs, tucked in at the table: each seat is the floor its own
    // painted chair's wheels stand on, the back of that chair standing 53 px over it here.
    far(291, 396, FRONT_LEFT_BAND, { x: 250, y: 392, facing: 'right' }),
    far(415, 382, FRONT_RIGHT_BAND, { x: 368, y: 330, facing: 'right' }),
    // The back run's near-side chair at its left end, turned up and to the right, where its own
    // monitor stands: the only painted chair in this room that is not turned up and to the left.
    {
      x: 497,
      y: 347,
      facing: 'right',
      visitor: { x: 540, y: 350, facing: 'left' },
      occluders: [chairFoot({ x: 497, y: 347 }, 22)],
    },
    // The back run's far-side chair, against the block wall behind it.
    far(612, 286, BACK_BAND, { x: 545, y: 258, facing: 'right' }),
    seat(617, 452, { x: 566, y: 470, facing: 'right' }),
    seat(735, 370, { x: 690, y: 392, facing: 'right' }),
  ],
  boss: {
    // The chair at the near end of the front run, the one the frame brings closest to the viewer.
    // The desk is the table's own near half: the concrete behind and beside it is the way round to
    // the far-side chairs, and a Company at full seats has to be able to walk there (T93).
    desk: { x: 300, y: 380, w: 216, h: 85 },
    seat: { x: 460, y: 520, facing: 'left' },
    visitor: { x: 512, y: 534, facing: 'left' },
    occluders: [chairFoot({ x: 460, y: 520 }, 22)],
  },
  /** No screen in the garage: the Company's name is painted on the bare block wall over the shelving. */
  // The middle of the three whiteboards on the pegboard wall (T280).
  logo: [
    {
      corners: [
        { x: 457, y: 100 },
        { x: 564, y: 53 },
        { x: 564, y: 131 },
        { x: 457, y: 179 },
      ],
    },
  ],
  meeting: {
    area: MEETING_AREA,
    table: MEETING_TABLE,
    // Down the table's near-left side, away from the door: sitters are drawn from behind, turned up
    // and to the right, which is where the table is from every one of them.
    spots: [
      { x: 784, y: 350, facing: 'right' },
      { x: 802, y: 356, facing: 'right' },
      { x: 820, y: 362, facing: 'right' },
      { x: 830, y: 366, facing: 'right' },
    ],
  },
  coffee: {
    // The rug is a ring round the low table, so the line goes round it: in off the slab above the rug,
    // along the front of the big couch, round its end and back down the rug's near side, facing the
    // corner the whole way (T107).
    spots: coffeeQueue(
      [
        { x: 700, y: 450, facing: 'up' },
        { x: 790, y: 438, facing: 'up' },
        { x: 890, y: 470, facing: 'up' },
        { x: 880, y: 510, facing: 'up' },
        { x: 800, y: 528, facing: 'up' },
        { x: 740, y: 538, facing: 'up' },
      ],
      SEATS,
    ),
  },
  /**
   * The booth's two near fronts. The near-right one carries the sliding door — the pane the art draws
   * between 880,367 and 920,352 — and the near-left one has no way through.
   */
  walls: [
    { name: 'meeting-glass', from: { x: 705, y: 353 }, to: { x: 847, y: 380 }, height: 160 },
    {
      name: 'meeting-glass-right',
      from: { x: 847, y: 380 },
      to: { x: 932, y: 348 },
      door: { from: { x: 880, y: 367 }, to: { x: 920, y: 352 } },
      height: 160,
    },
  ],
  /**
   * The concrete slab: the two block walls' feet, round the booth's near fronts, and down to the
   * south corner the frame cuts the slab at.
   */
  floor: poly(0, 420, 557, 216, 705, 353, 847, 380, 932, 348, 1040, 393, 1040, 460, 520, 650, 0, 460),
  obstacles: [
    FRONT_TABLES,
    BACK_TABLES,
    SHELVING,
    COUNTER,
    ...GARAGE_LOUNGE,
    // The pots standing on the concrete: by the shelving, at the booth and beside the couches.
    rect(236, 400, 60, 60),
    rect(560, 130, 60, 60),
    rect(660, 520, 70, 80),
    rect(920, 400, 70, 70),
    MEETING_TABLE,
  ],
}
