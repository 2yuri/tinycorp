/**
 * Anchors of the Warm Loft (`design/office/rooms/warm-loft.png`), in painting pixels.
 * Measured the way `painted-room.ts` was measured against `empty-room.png`: the 1408×768 art scaled
 * to cover 1040×660 and cropped 85 px off each side — that is `office/rooms/warm-loft.png` — and then
 * every anchor read off the cropped painting.
 *
 * What the loft has, and where it differs from the Night Studio:
 * - Four painted workstations in the bottom-left corner, two to a desk run, and the boss's own desk at
 *   the left end of the back run, where the painting takes it off the frame. Counted against the art
 *   (T93) the loft draws one chair more than that: a fifth behind the back run, against the brick.
 *   The run stands on the only floor between it and the wall, so there is nowhere for a sitter to be
 *   and the loft keeps its four seats; the other five rooms seat every chair their art draws.
 * - The meeting room is the glass box on the right. The painting draws one panel of its near-left front
 *   standing open, between the mullions at x 704 and x 779: that panel is the sliding door, and the
 *   floor stops at the glass everywhere else, so it is the only way in or out. The office only draws
 *   the panels while they slide, so here a door nobody is near reads as the open one the art painted.
 * - The floor stops at the glass box's west corner. The tile behind the box, up to the kitchen counter,
 *   is painted behind two panes of glass: a sprite standing there is drawn over glass it is behind.
 *   The loft's coffee corner is the lounge instead — the sofa, the armchairs and the actual coffee table.
 * - The loft has no TV. The Company's sign goes on the brick pier between the two tall windows on the
 *   back-right wall, where the painting hangs a framed print.
 */
import { coffeeQueue } from './coffee-queue'
import { chairFoot, deskBand, type PaintedRoom, type Point } from './painted-room'

const rect = (x: number, y: number, w: number, h: number): Point[] => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
]

const poly = (...xy: number[]): Point[] =>
  Array.from({ length: xy.length / 2 }, (_, i) => ({ x: xy[2 * i]!, y: xy[2 * i + 1]! }))

/**
 * How many Employees the loft seats — four painted chairs and the two desks its free floor grows —
 * and so how long the line in its lounge has to be: a usage limit parks all of them at once.
 */
const SEATS = 6

/** The long meeting table, lying against the whiteboard wall on the room's back-left axis. */
const MEETING_TABLE = poly(740, 471, 862, 410, 884, 421, 762, 482)

/**
 * The lounge in the middle of the room — sofa, the two armchairs and the coffee table — which is this
 * room's coffee corner, since its kitchen counter is painted behind the meeting room's glass.
 */
export const WARM_LOFT_LOUNGE = [
  rect(580, 230, 132, 82),
  rect(450, 254, 70, 72),
  rect(596, 308, 68, 60),
  rect(540, 276, 90, 54),
]

/** The two desk runs in the bottom-left corner: the back one against the brick, the front one before it. */
const BACK_DESKS = poly(0, 384, 250, 384, 250, 430, 170, 452, 110, 500, 34, 500, 0, 444)
const FRONT_DESKS = poly(186, 480, 406, 480, 406, 522, 300, 570, 230, 600, 186, 532)

export const WARM_LOFT_ROOM: PaintedRoom = {
  width: 1040,
  height: 660,
  seats: [
    // The two chairs in front of the back run, backs to the viewer, each turned up and to the left,
    // where its own keyboard is. A seat is the floor the painted chair's wheels stand on (T91).
    {
      x: 148,
      y: 520,
      facing: 'left',
      visitor: { x: 180, y: 524, facing: 'left' },
      occluders: [chairFoot({ x: 148, y: 520 }, 20)],
    },
    {
      x: 221,
      y: 478,
      facing: 'left',
      visitor: { x: 268, y: 452, facing: 'left' },
      occluders: [chairFoot({ x: 221, y: 478 }, 20)],
    },
    // The chair tucked in behind the front run's monitors, turned towards the viewer. Its seat is the
    // floor its own wheels stand on — the painted back stands 73 px over it, as the run's other
    // chairs do — and the run is drawn again over the sitter from its far edge down, so the desk cuts
    // them at the waist instead of the other way round (T103).
    {
      x: 258,
      y: 514,
      facing: 'down',
      turn: 'right',
      visitor: { x: 210, y: 458, facing: 'left' },
      occluders: [deskBand({ x: 210, y: 510 }, { x: 310, y: 460 }, 60)],
    },
    // The chair in front of the front run, nearest the viewer.
    {
      x: 338,
      y: 590,
      facing: 'left',
      visitor: { x: 414, y: 566, facing: 'left' },
      occluders: [chairFoot({ x: 338, y: 590 }, 20)],
    },
  ],
  boss: {
    // The left end of the back run, where the painting takes the desk off the frame. It draws no
    // chair there — every painted one is an Employee's — so the boss brings the sheet's own, and the
    // seat is the floor in front of the desk that it stands on.
    desk: { x: 0, y: 384, w: 120, h: 96 },
    seat: { x: 75, y: 508, facing: 'left' },
    visitor: { x: 120, y: 500, facing: 'left' },
  },
  /**
   * No screen in the loft. The Company's name goes where a loft paints one: on the bare brick of the
   * back-left wall, between the shelf and the tall window, skewed along the wall like the TV was.
   */
  // The whiteboard inside the glass meeting room (T280).
  logo: [
    {
      corners: [
        { x: 714, y: 356 },
        { x: 788, y: 323 },
        { x: 788, y: 381 },
        { x: 714, y: 411 },
      ],
    },
  ],
  meeting: {
    area: poly(656, 498, 843, 405, 1015, 491, 828, 584),
    table: MEETING_TABLE,
    // Down the table's near side, where the painting puts the chairs. Sitters are drawn from behind,
    // turned up and to the left, which is where the table and the whiteboard beyond it are.
    spots: [
      { x: 790, y: 493, facing: 'left' },
      { x: 818, y: 479, facing: 'left' },
      { x: 846, y: 465, facing: 'left' },
      { x: 874, y: 451, facing: 'left' },
    ],
  },
  coffee: {
    // The loft's corner is the lounge, so the line stands along the near side of it, facing back into
    // it: one run of bare timber between the armchairs above and the desk pod's floor below, taken at
    // the boards' own angle (T107).
    spots: coffeeQueue(
      [
        { x: 424, y: 352, facing: 'up' },
        { x: 624, y: 392, facing: 'up' },
      ],
      SEATS,
    ),
  },
  /**
   * The glass front of the meeting room. Its mullions stand at x 656, 704, 779 and 828, and the painting
   * draws the middle panel standing open: that stretch of the foot is the door. The room needs no second
   * wall — its floor reaches the box nowhere else.
   */
  walls: [
    {
      name: 'meeting-glass',
      from: { x: 656, y: 498 },
      to: { x: 828, y: 584 },
      door: { from: { x: 704, y: 522 }, to: { x: 779, y: 560 } },
      height: 145,
    },
  ],
  /** The wood floor, from the brick walls to the frame, stopping at the glass box's west corner. */
  floor: poly(0, 460, 260, 330, 556, 196, 636, 236, 636, 488, 828, 584, 828, 592, 708, 652, 326, 652, 0, 492),
  obstacles: [
    BACK_DESKS,
    FRONT_DESKS,
    // The bench along the back-left wall, with the bikes and the radiator standing on it.
    poly(286, 250, 500, 196, 500, 234, 286, 292),
    // The lounge, and the console under the window beside it.
    ...WARM_LOFT_LOUNGE,
    rect(722, 258, 82, 54),
    // The second lounge, along the bottom of the frame: its sofa, low table and bookcase.
    rect(456, 552, 256, 108),
    rect(378, 612, 180, 48),
    // The pots standing on the floor: by the door, beside the bookcase, and before the glass.
    rect(264, 292, 46, 40),
    rect(386, 576, 62, 56),
    rect(772, 524, 58, 66),
    // The meeting room's own table.
    MEETING_TABLE,
  ],
}
