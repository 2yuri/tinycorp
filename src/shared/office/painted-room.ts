/**
 * Anchors of the painted office (`design/office/empty-room.png`), in painting pixels.
 * The painting is the Pen `Office Map` layer: 1040×660, the source image scaled to cover it (see `room.png`).
 * Everything the office projection and pathfinding know about the room comes from here.
 */

import { coffeeQueue } from './coffee-queue'

export type Facing = 'up' | 'down' | 'left' | 'right'

export interface Point {
  x: number
  y: number
}

/** Where a character stands or sits (its feet), and which way it faces there. */
export interface Spot extends Point {
  facing: Facing
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** A flat surface in the painting: its corners clockwise from the top-left, in painting pixels. */
export type Quad = readonly [Point, Point, Point, Point]

/**
 * Where the Company's logo is painted (T280): a board, a screen or a panel the painting already has,
 * or a plaque the room hangs for it. `face` is the part of the plaque the logo goes on, as fractions
 * of the plaque's own width and height; without a plaque the logo goes on `corners` itself.
 */
export interface LogoSpot {
  corners: Quad
  plaque?: { art: string; face: { left: number; top: number; right: number; bottom: number } }
}

/** Which way a sitter drawn from the front is turned: only a seat that faces the viewer has one. */
export type Turn = 'left' | 'right'

/** A painted desk seat. */
export interface PaintedSeat extends Spot {
  /** For a seat facing the viewer, which way its sitter is turned; 'left' when the room says nothing. */
  turn?: Turn
  /** Where a visitor stands to talk to whoever sits here. */
  visitor: Spot
  /**
   * Outlines of painted things in front of the sitter (a chair back, the desk before a seat facing the viewer):
   * the painting inside them is drawn again over the sitter, below anyone whose feet are lower than their bottom.
   */
  occluders: Point[][]
}

/**
 * A painted wall a character cannot cross: its foot along the floor, from one end to the other,
 * and the stretch of that foot a door leaves open. Walls with no `door` have no way through.
 */
export interface PaintedWall {
  /** Stable name, for the door sprite and for tests. */
  name: 'meeting-glass' | 'meeting-glass-right' | 'kitchen-partition'
  from: Point
  to: Point
  /** The open stretch of the foot: a sub-segment of `from`→`to`. */
  door?: { from: Point; to: Point }
  /** How tall the wall stands over its foot, in painting pixels; the door panels are drawn this tall. */
  height: number
}

export interface PaintedRoom {
  width: number
  height: number
  seats: PaintedSeat[]
  /** The boss's own desk and chair: the boss sits on `seat` whenever a Company is open (T86). */
  boss: { desk: Rect; seat: Spot; visitor: Spot; occluders?: Point[][] }
  /** Where the Company's logo is painted (T280): each surface it goes on, and the plaque a room hangs for it. */
  logo: readonly LogoSpot[]
  /** The glass meeting room: its floor, its table, and the chairs Employees sit in while they talk. */
  meeting: { area: Point[]; table: Point[]; spots: Spot[] }
  /** The kitchen corner: where parked, out-of-budget and blocked Employees wait, along the counter. */
  coffee: { spots: Spot[] }
  /** The walls between the rooms, each with at most one door gap. */
  walls: PaintedWall[]
  /** Where characters may walk. */
  floor: Point[]
  /** Painted furniture (and the goose) nobody walks through. */
  obstacles: Point[][]
}

const rect = (x: number, y: number, w: number, h: number): Point[] => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
]

const poly = (...xy: number[]): Point[] =>
  Array.from({ length: xy.length / 2 }, (_, i) => ({ x: xy[2 * i]!, y: xy[2 * i + 1]! }))

/**
 * The painted chair a sitter takes, as the floor print its wheels make. A seat is that floor (T91),
 * so this outline is the one painted thing still in front of a sitter drawn from behind: the base of
 * the chair they are in. The sprite carries the rest of the chair, and redrawing more of the painted
 * one would draw the same chair twice, so only its foot goes back over the sprite — where the two
 * coincide, which is what "the sprite's chair covers the painted one" means. It is also where the
 * seat tests read the painted chair off, which is why every seated spot carries one.
 * `half` is how wide the painting draws that base each side of the seat.
 */
export function chairFoot(seat: Point, half = 24): Point[] {
  return poly(
    seat.x - half,
    seat.y - 8,
    seat.x - half + 8,
    seat.y - 24,
    seat.x + half - 8,
    seat.y - 24,
    seat.x + half,
    seat.y - 8,
    seat.x + half - 10,
    seat.y + 4,
    seat.x - half + 10,
    seat.y + 4,
  )
}

/**
 * How many Employees this room seats — five painted chairs and the two desks its free floor grows —
 * and so how long the line at its coffee counter has to be: a usage limit parks all of them at once.
 * `rooms.test.ts` counts the seats off the geometry and holds the corner to holding every one.
 */
const SEATS = 7

/**
 * The stretch of the painting a sitter at a chair on the far side of a desk run sits behind: the
 * run's own top, whatever stands on it, its near face and its legs. The art inside is drawn again
 * over the sitter (T103), so their head and shoulders stand over the desk and everything below it
 * is behind it — a sitter never covers the desk they sit at.
 * `from` and `to` are two points on the run's far edge, where its top meets the floor behind it, and
 * they are wide enough apart to take the whole width of a sitter. `drop` is how far the band reaches
 * below that edge: past the sitter's own chair, and short of the chairs on the near side, which are
 * drawn over it by their own feet.
 */
export function deskBand(from: Point, to: Point, drop: number): Point[] {
  return [from, to, { x: to.x, y: to.y + drop }, { x: from.x, y: from.y + drop }]
}

/** The painted table in the meeting room: a diamond at the back, its right half behind the kitchen partition. */
const MEETING_TABLE = poly(777, 243, 840, 200, 900, 243, 843, 290)

export const PAINTED_ROOM: PaintedRoom = {
  width: 1040,
  height: 660,
  // Six painted chairs, counted against the art again in T93: the boss's own and five Employees'.
  seats: [
    // The left desk row: its lower chair is the boss's own, so only the upper one is an Employee's.
    // Its keyboard is up and to the left of the chair, so the sitter is turned that way.
    {
      x: 209,
      y: 403,
      facing: 'left',
      visitor: { x: 252, y: 396, facing: 'left' },
      occluders: [chairFoot({ x: 209, y: 403 })],
    },
    // The desk island: two chairs on the near side, two behind the monitors.
    {
      x: 218,
      y: 550,
      facing: 'right',
      visitor: { x: 168, y: 528, facing: 'right' },
      occluders: [chairFoot({ x: 218, y: 550 })],
    },
    {
      x: 342,
      y: 613,
      facing: 'right',
      visitor: { x: 392, y: 616, facing: 'left' },
      occluders: [chairFoot({ x: 342, y: 613 })],
    },
    // The two chairs on the island's far side, drawn towards the viewer. This room paints those two
    // pulled back off the run, so the seat is the floor their own wheels stand on — the painted back
    // stands 95 px over it here — and only the last of them is behind the island: each band takes the
    // run's far edge from under the chair down, so a sitter's feet go under the desk, never over it.
    {
      x: 387,
      y: 446,
      facing: 'down',
      turn: 'right',
      visitor: { x: 440, y: 396, facing: 'left' },
      occluders: [deskBand({ x: 335, y: 415 }, { x: 440, y: 467 }, 60)],
    },
    {
      x: 503,
      y: 521,
      facing: 'down',
      turn: 'right',
      visitor: { x: 552, y: 470, facing: 'left' },
      occluders: [deskBand({ x: 450, y: 475 }, { x: 555, y: 527 }, 60)],
    },
  ],
  boss: {
    // The boss's own chair in the painted left row, and the desk it belongs to: the sprite sits in
    // a real chair rather than on the room's edge, and no Employee is seated there (T88).
    desk: { x: 40, y: 360, w: 120, h: 96 },
    seat: { x: 84, y: 461, facing: 'left' },
    occluders: [chairFoot({ x: 84, y: 461 })],
    // Beside the chair, clear of it: whoever needs a decision stands there, never in the seat.
    visitor: { x: 146, y: 466, facing: 'left' },
  },
  // The TV on the wall over the sofa (T280).
  logo: [
    {
      corners: [
        { x: 363, y: 146 },
        { x: 481, y: 87 },
        { x: 481, y: 159 },
        { x: 363, y: 217 },
      ],
    },
  ],
  meeting: {
    area: poly(686, 318, 700, 250, 760, 215, 846, 256, 846, 404),
    table: MEETING_TABLE,
    // Down the table's near-left side, the only side of it the meeting room's floor reaches: its
    // near-right half is behind the kitchen partition. Everyone brings their own chair (the painting
    // draws none here), set back far enough from the edge for it to stand clear of the table, and
    // turned up and to the right, which is where the table is from every one of them.
    spots: [
      { x: 768, y: 263, facing: 'right' },
      { x: 791, y: 280, facing: 'right' },
      { x: 815, y: 296, facing: 'right' },
      { x: 831, y: 308, facing: 'right' },
    ],
  },
  coffee: {
    // The line at the kitchen counter, everyone facing it through the partition (T107). The goose and
    // the frame's own edge close the corner off at the bottom, so the line runs up the counter from
    // its near end, turns out along the glass front, and turns again down the open oak before the
    // free floor the first desk pod takes. Its top end stays below the sliding door, clear of its
    // reach, so waiting here never holds it open.
    spots: coffeeQueue(
      [
        { x: 818, y: 556, facing: 'right' },
        { x: 818, y: 448, facing: 'right' },
        { x: 738, y: 444, facing: 'right' },
        { x: 738, y: 540, facing: 'right' },
      ],
      SEATS,
    ),
  },
  /**
   * The glass front runs down the meeting room's near side; its mullions are painted at x 758-768 and
   * 830-839, so the middle of its three panels — x 769 to 829 — is the sliding door.
   * The kitchen partition closes the floor off at x 847: the painting draws no way into the kitchen,
   * only the counter through it, so the partition has no door gap.
   */
  walls: [
    {
      name: 'meeting-glass',
      from: { x: 686, y: 318 },
      to: { x: 846, y: 404 },
      door: { from: { x: 769, y: 363 }, to: { x: 829, y: 395 } },
      height: 200,
    },
    { name: 'kitchen-partition', from: { x: 847, y: 404 }, to: { x: 847, y: 560 }, height: 156 },
  ],
  floor: poly(
    0,
    372,
    100,
    318,
    250,
    318,
    300,
    332,
    360,
    330,
    600,
    330,
    686,
    318,
    846,
    404,
    848,
    560,
    650,
    660,
    400,
    660,
    0,
    462,
  ),
  obstacles: [
    // The left desk row.
    poly(0, 330, 100, 290, 252, 290, 252, 330, 150, 380, 120, 372, 0, 432),
    // The desk island.
    poly(
      186,
      440,
      300,
      380,
      360,
      380,
      366,
      420,
      440,
      432,
      470,
      440,
      478,
      492,
      536,
      492,
      536,
      530,
      412,
      620,
      380,
      600,
      380,
      560,
      300,
      520,
      250,
      500,
      186,
      500,
    ),
    // Coffee table and couch, and the plants beside it.
    rect(440, 290, 124, 82),
    rect(360, 250, 330, 90),
    rect(318, 310, 46, 38),
    rect(636, 300, 52, 48),
    // The goose.
    rect(742, 512, 50, 72),
    // The meeting room's table.
    MEETING_TABLE,
  ],
}
