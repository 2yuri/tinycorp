/**
 * Anchors of Night City (`design/office/rooms/night-city.png`), in painting pixels.
 * Measured the way Scandi Daylight was: the 1408×768 art from Pen scaled to cover 1040×660 and
 * centre-cropped — that is `office/rooms/night-city.png` — then every anchor read off the crop.
 *
 * What the room has, and how it is read:
 * - A wall of windows onto a city at night down the whole left side, and five desks in one run
 *   along it; in front of them a pair and a single desk on the left, and two pairs on the right.
 *   Every desk has one chair, drawn from behind on its near side and turned up and to the left, where
 *   its own monitor stands: twelve chairs, so the room seats twelve Employees.
 * - The boss's own desk stands apart on the open floor in front, a wide wooden desk with a laptop
 *   and a leather chair on its near side; the second leather chair, behind it, is for nobody.
 * - A glass meeting room against the right-hand back wall. Its near-left front carries the door;
 *   the near-right front has no way through, and the two behind it are blocked as furniture is.
 * - A coffee bar on the right wall with the sofa and a low table beside it: the line for coffee
 *   starts at the bar and runs down the open floor past the boss desk.
 * - The room is painted at night, lit by desk lamps and monitors, and stays that way.
 */
import { coffeeQueue } from './coffee-queue'
import { chairFoot, type PaintedRoom, type Point, type Spot } from './painted-room'

const poly = (...xy: number[]): Point[] =>
  Array.from({ length: xy.length / 2 }, (_, i) => ({ x: xy[2 * i] ?? 0, y: xy[2 * i + 1] ?? 0 }))

/**
 * A painted chair drawn from behind, turned the way its own monitor stands: the seat is the floor
 * its wheels stand on, and that chair's foot goes back over the sitter (T91). The visitor stands
 * beside it on the open side, turned towards whoever sits there.
 */
const seat = (x: number, y: number, visitor: Spot) => ({
  x,
  y,
  facing: 'left' as const,
  visitor,
  occluders: [chairFoot({ x, y }, 20)],
})

/** The desks, as the floor they stand on: the run along the windows, then the four in front of it. */
const WINDOW_RUN = poly(21, 398, 60, 408, 495, 248, 520, 205, 520, 184)
const LEFT_PAIR = poly(178, 440, 196, 458, 408, 396, 402, 366, 380, 360, 178, 420)
const FRONT_DESK = poly(318, 468, 330, 494, 448, 466, 444, 438, 398, 428)
const RIGHT_BACK_PAIR = poly(388, 346, 398, 366, 596, 312, 592, 290, 560, 285)
const RIGHT_FRONT_PAIR = poly(445, 400, 458, 420, 660, 362, 656, 336, 630, 330)
const BOSS_DESK = poly(585, 440, 595, 505, 690, 495, 730, 470, 730, 420, 700, 408)
/** The leather chair behind the boss desk: painted, and nobody sits in it. */
const GUEST_CHAIR = poly(610, 400, 650, 385, 660, 440, 620, 452)
/** The glass room's floor, and the table standing in the middle of it. */
const MEETING_AREA = poly(538, 262, 640, 222, 741, 268, 642, 307)
const MEETING_TABLE = poly(605, 240, 640, 222, 685, 243, 650, 262)
/** The coffee bar along the right wall, the sofa beside it, the low table and the plant at its end. */
const COFFEE_BAR = poly(762, 258, 885, 300, 885, 352, 760, 300)
const SOFA = poly(870, 305, 1000, 350, 1000, 398, 870, 352)
const LOW_TABLE = poly(845, 372, 900, 352, 930, 382, 872, 418)

/**
 * How many Employees this room seats — the twelve painted chairs — and so how long the line for
 * coffee has to be: a usage limit parks all of them at once.
 */
const SEATS = 12

export const NIGHT_CITY_ROOM: PaintedRoom = {
  width: 1040,
  height: 660,
  seats: [
    // The run along the windows, from the corner to the glass room.
    seat(148, 420, { x: 112, y: 432, facing: 'right' }),
    seat(220, 390, { x: 260, y: 382, facing: 'left' }),
    seat(295, 360, { x: 334, y: 366, facing: 'left' }),
    seat(372, 322, { x: 412, y: 330, facing: 'left' }),
    seat(452, 280, { x: 492, y: 286, facing: 'left' }),
    // The pair in front of it on the left, and the single desk nearest the viewer.
    seat(285, 480, { x: 325, y: 506, facing: 'left' }),
    seat(366, 418, { x: 412, y: 414, facing: 'left' }),
    seat(417, 520, { x: 460, y: 526, facing: 'left' }),
    // The pair on the right behind, then the pair on the right in front.
    seat(482, 375, { x: 440, y: 382, facing: 'right' }),
    seat(572, 335, { x: 612, y: 330, facing: 'left' }),
    seat(542, 448, { x: 505, y: 460, facing: 'right' }),
    seat(630, 388, { x: 670, y: 382, facing: 'left' }),
  ],
  boss: {
    desk: { x: 585, y: 408, w: 145, h: 97 },
    seat: { x: 707, y: 522, facing: 'left' },
    visitor: { x: 748, y: 500, facing: 'left' },
    occluders: [chairFoot({ x: 707, y: 522 }, 22)],
  },
  // The framed picture on the right wall, beside the coffee bar (T280).
  logo: [
    {
      corners: [
        { x: 937, y: 254 },
        { x: 978, y: 273 },
        { x: 978, y: 300 },
        { x: 937, y: 281 },
      ],
    },
  ],
  meeting: {
    area: MEETING_AREA,
    table: MEETING_TABLE,
    // Down the table's near-right side, away from the door, turned up and to the left, which is
    // where the table is from every one of them.
    spots: [
      { x: 655, y: 282, facing: 'left' },
      { x: 674, y: 275, facing: 'left' },
      { x: 694, y: 268, facing: 'left' },
    ],
  },
  coffee: {
    // The head at the bar's near end and the line along it to the glass room, then down the open floor
    // between the boss desk and the lounge and back out under the sofa: the whole line stays on the
    // right of the boss desk, so a Company that is all parked never stands in front of the boss.
    spots: coffeeQueue(
      [
        { x: 840, y: 372, facing: 'right' },
        { x: 705, y: 322, facing: 'right' },
        { x: 705, y: 362, facing: 'up' },
        { x: 775, y: 420, facing: 'up' },
        { x: 785, y: 490, facing: 'up' },
        { x: 820, y: 470, facing: 'up' },
        { x: 950, y: 428, facing: 'up' },
      ],
      SEATS,
    ),
  },
  /** The glass room's two near fronts: the door is the first pane of the near-left one, by the corner. */
  walls: [
    {
      name: 'meeting-glass',
      from: { x: 538, y: 262 },
      to: { x: 642, y: 307 },
      door: { from: { x: 548, y: 266 }, to: { x: 585, y: 282 } },
      height: 130,
    },
    { name: 'meeting-glass-right', from: { x: 642, y: 307 }, to: { x: 741, y: 268 }, height: 130 },
  ],
  /** The oak floor: the foot of the window wall, the foot of the right wall, and the two near edges. */
  floor: poly(21, 400, 520, 182, 1020, 403, 520, 648),
  obstacles: [
    WINDOW_RUN,
    LEFT_PAIR,
    FRONT_DESK,
    RIGHT_BACK_PAIR,
    RIGHT_FRONT_PAIR,
    BOSS_DESK,
    GUEST_CHAIR,
    COFFEE_BAR,
    SOFA,
    LOW_TABLE,
    MEETING_TABLE,
    // The glass room's two back fronts: no door, so the only way in stays the near-left pane.
    poly(534, 254, 640, 214, 640, 230, 534, 270),
    poly(640, 214, 745, 260, 745, 276, 640, 230),
  ],
}
