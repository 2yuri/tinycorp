/**
 * Anchors of the Greenhouse (`design/office/rooms/greenhouse.png`), in painting pixels.
 * Measured the way the Warm Loft was (T84): the 1408×768 art scaled to cover 1040×660 and
 * centre-cropped — that is `office/rooms/greenhouse.png` — then every anchor read off the crop.
 *
 * What the room has, and how it is read:
 * - Two desk runs pushed back to back along the left glass. The art draws six chairs at them: three
 *   down their near side, drawn from behind, and three tucked in on the far side against the glass,
 *   drawn turned towards the viewer. Every one of them is a seat (T93). The chair nearest the viewer
 *   is the boss's own, so the room seats five Employees and the boss.
 * - A far-side sitter is drawn seated from the front, on the floor the painted chair's wheels stand
 *   on, which covers that chair; the run between them and the viewer is drawn again over them from
 *   its own far edge down, so the desk cuts them at the waist and never the other way round (T103).
 * - A glass potting room in the middle of the back wall, with a work table in it: this room's meeting
 *   room. The sliding door is the pane on its near-left front; the floor reaches it nowhere else.
 * - A kitchen island with two stools in front of the run down the right glass: the coffee corner.
 * - The office grows onto the boards between the island and the lounge, where the warm oak desk pod
 *   sits as well as it does in the first room.
 * - The room is painted in daylight, and the app has no light theme, so it is drawn under the same
 *   dark chrome as the rest (see the T91 PR).
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
 * A painted chair tucked in on the far side of a run, turned towards the viewer: the seat is the
 * floor its own wheels stand on, so the sprite's chair lands on the painted one and covers it, and
 * `band` — the run the painting draws between the viewer and the sitter — is drawn again over them
 * from its far edge down (T103).
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

/** The two desk runs, as the floor they stand on. */
const FRONT_DESKS = poly(48, 380, 190, 305, 268, 345, 126, 420)
const BACK_DESKS = poly(185, 296, 322, 228, 432, 285, 296, 353)
/**
 * Each run's far edge, where its top meets the boards behind it, read off the art at the chairs
 * tucked in along it: both rise to the right, a little shallower than the room's own corners. The
 * drop takes a whole sitter and stops above the chairs on the near side, which are drawn over it.
 */
const FRONT_BAND = deskBand({ x: 35, y: 386 }, { x: 215, y: 311 }, 60)
const BACK_BAND = deskBand({ x: 215, y: 304 }, { x: 305, y: 266 }, 50)
/**
 * How many Employees this room seats — five painted chairs and the three desks its free floor grows
 * — and so how long the line at its coffee corner has to be: a usage limit parks all of them at once.
 */
const SEATS = 8

/** The potting room's floor and the work table in it. */
const MEETING_AREA = poly(420, 314, 517, 247, 637, 297, 540, 364)
const MEETING_TABLE = poly(465, 285, 512, 265, 570, 282, 523, 302)
/** The kitchen island with its stools, and the run along the right glass behind it. */
const GREENHOUSE_ISLAND = poly(738, 405, 830, 350, 895, 388, 845, 480, 790, 465, 760, 440)
const KITCHEN_RUN = poly(820, 285, 1010, 380, 1010, 450, 820, 355)
/** The wicker lounge in the near-left corner. */
const LOUNGE = rect(180, 480, 280, 150)

export const GREENHOUSE_ROOM: PaintedRoom = {
  width: 1040,
  height: 660,
  seats: [
    // The front run's two far-side chairs, against the glass and the planters behind it.
    far(74, 403, FRONT_BAND, { x: 40, y: 360, facing: 'right' }),
    far(175, 353, FRONT_BAND, { x: 130, y: 320, facing: 'right' }),
    // The back run's far-side chair, at its lower end.
    far(253, 313, BACK_BAND, { x: 205, y: 285, facing: 'right' }),
    seat(305, 432, { x: 350, y: 452, facing: 'left' }),
    seat(390, 391, { x: 436, y: 410, facing: 'left' }),
  ],
  boss: {
    // The chair at the near end of the front run, the one the frame brings closest to the viewer.
    // The desk is the run's own near band; the boards each side of it, and the strip behind it, are
    // how anyone reaches the far-side chairs, and a Company at full seats needs them (T93).
    desk: { x: 100, y: 370, w: 168, h: 50 },
    seat: { x: 215, y: 468, facing: 'left' },
    visitor: { x: 268, y: 458, facing: 'left' },
    occluders: [chairFoot({ x: 215, y: 468 }, 22)],
  },
  /** No screen under this glass: the Company's name goes on the potting room's own back panel. */
  // An oak plaque hung from the meeting room's beam (T280): nothing in the greenhouse is a board.
  logo: [
    {
      corners: [
        { x: 392, y: 94 },
        { x: 444, y: 118 },
        { x: 444, y: 174 },
        { x: 392, y: 150 },
      ],
      plaque: { art: 'office/plaques/greenhouse.png', face: { left: 0.14, top: 0.47, right: 0.86, bottom: 0.9 } },
    },
  ],
  meeting: {
    area: MEETING_AREA,
    table: MEETING_TABLE,
    // Down the table's near-right side, away from the door and clear of the west corner the glass
    // turns at: sitters are drawn from behind, turned up and to the left, which is where the table is
    // from every one of them.
    spots: [
      { x: 542, y: 320, facing: 'left' },
      { x: 556, y: 314, facing: 'left' },
      { x: 570, y: 308, facing: 'left' },
      { x: 584, y: 302, facing: 'left' },
    ],
  },
  coffee: {
    // Down the island's near face, past its two stools, and round its bottom corner along the boards
    // in front of the kitchen run: one line, facing the counter all the way (T107).
    spots: coffeeQueue(
      [
        { x: 726, y: 428, facing: 'up' },
        { x: 848, y: 514, facing: 'up' },
        { x: 1035, y: 479, facing: 'up' },
      ],
      SEATS,
    ),
  },
  /**
   * The potting room's two near fronts. The near-left one carries the sliding door — the pane the art
   * draws standing open between 450,326 and 490,343 — and the near-right one has no way through.
   */
  walls: [
    {
      name: 'meeting-glass',
      from: { x: 420, y: 314 },
      to: { x: 540, y: 364 },
      door: { from: { x: 450, y: 326 }, to: { x: 490, y: 343 } },
      height: 150,
    },
    { name: 'meeting-glass-right', from: { x: 540, y: 364 }, to: { x: 637, y: 297 }, height: 150 },
  ],
  /**
   * The boards, from the left glass round the potting room's two near fronts to the right glass, and
   * down to the frame, which the planting beds run along rather than a wall.
   * The top-left edge runs above the back desk run rather than in front of the front one: the art
   * tucks three chairs in behind the runs, and the boards their wheels stand on are boards a sitter
   * has to be able to walk to (T93). The runs themselves are obstacles, so what that leaves open is
   * the strip behind each of them.
   */
  floor: poly(0, 375, 322, 205, 350, 300, 420, 314, 540, 364, 637, 297, 1040, 470, 1040, 660, 0, 660),
  obstacles: [
    FRONT_DESKS,
    BACK_DESKS,
    GREENHOUSE_ISLAND,
    KITCHEN_RUN,
    LOUNGE,
    // The big pots standing on the boards: by the potting room, at the frame, and beside the island.
    rect(640, 300, 70, 70),
    rect(600, 560, 90, 100),
    rect(940, 560, 90, 100),
    MEETING_TABLE,
  ],
}
