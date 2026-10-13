/**
 * The rooms a Company can work in (design/html/company-settings-office.html): one entry per painting,
 * with what the Office tab shows about it and the anchors the office is built from.
 * A room is only selectable once its geometry has been measured against its own art; until then its
 * thumbnail is dimmed and says `Coming soon`.
 */
import { GARAGE_STARTUP_ROOM } from './garage-startup'
import { GREENHOUSE_ROOM } from './greenhouse'
import { officeLayout } from './layout'
import { NIGHT_CITY_ROOM } from './night-city'
import { NIGHT_SHIFT_ROOM } from './night-shift-room'
import { PAINTED_ROOM, type PaintedRoom } from './painted-room'
import { SCANDI_DAYLIGHT_ROOM } from './scandi-daylight'
import { WARM_LOFT_ROOM } from './warm-loft'

/** The seven rooms of the picker, in the row's order. */
export const ROOM_SLUGS = [
  'night-studio',
  'warm-loft',
  'scandi-daylight',
  'night-shift',
  'greenhouse',
  'garage-startup',
  'night-city',
] as const

export type RoomSlug = (typeof ROOM_SLUGS)[number]

/** The room every Company starts in: the one the office was built on. */
export const DEFAULT_ROOM: RoomSlug = 'night-studio'

/** The four things the detail bar states about a room, measured against its geometry and its art. */
export interface RoomFacts {
  /** Every desk, and how many Employees that leaves once yours is taken: `8 · fits 7 + you`. */
  desks: string
  rooms: string
  lightMode: string
  floorSpace: string
}

export interface OfficeRoom {
  slug: RoomSlug
  name: string
  description: string
  /** Five swatches sampled from the art, darkest first, as the detail bar shows them. */
  palette: string[]
  /** The painting, under the renderer's public folder: the office draws it and the tab previews it. */
  art: string
  /**
   * The colour the room's own light puts on a character standing in it, multiplied over their sprite.
   * The sheet is drawn under a neutral light, so without this a body reads as cut out and dropped in:
   * warm rooms need a warm cast, the night rooms a cool one. White is no cast at all.
   */
  light: number
  /** The measured anchors, or null while the art has none: the room cannot be chosen yet. */
  geometry: PaintedRoom | null
  /** What the detail bar states; null with no geometry, since the facts come from it. */
  facts: RoomFacts | null
}

/**
 * Every desk in a room and how many Employees it seats: the chairs the painting itself draws, and
 * the boss's own desk, which nobody else sits at. A Company bigger than that waits at the coffee
 * counter — a room seats what its art draws and no more (T101, T111).
 */
export function roomDesks(geometry: PaintedRoom): { total: number; employees: number } {
  const employees = officeLayout(geometry).seats.length
  return { employees, total: employees + 1 }
}

/** The detail bar's DESKS value for a geometry: `8 · fits 7 + you`. */
export function desksFact(geometry: PaintedRoom): string {
  const { total, employees } = roomDesks(geometry)
  return `${total} · fits ${employees} + you`
}

export const ROOMS: OfficeRoom[] = [
  {
    slug: 'night-studio',
    name: 'Night Studio',
    description: 'Dark navy walls, warm oak floor, desk lamps.',
    palette: ['#1B2233', '#3E4B63', '#8A5A33', '#C8A16A', '#2F5D50'],
    art: 'office/room.png',
    /** the studio is lit by its screens and one warm lamp: a whisper of blue. */
    light: 0xe6e9f5,
    geometry: PAINTED_ROOM,
    facts: {
      desks: desksFact(PAINTED_ROOM),
      rooms: 'Meeting · coffee',
      lightMode: 'Stays dark',
      floorSpace: 'Tight in the middle',
    },
  },
  {
    slug: 'warm-loft',
    name: 'Warm Loft',
    description: 'Brick and timber, low lamps, a long shared bench.',
    palette: ['#16151D', '#4F5651', '#B2704C', '#D5B186', '#F4E6CB'],
    art: 'office/rooms/warm-loft.png',
    /** brick, amber bulbs and low sun through tall windows. */
    light: 0xffe8cf,
    geometry: WARM_LOFT_ROOM,
    facts: {
      desks: desksFact(WARM_LOFT_ROOM),
      rooms: 'Meeting · coffee',
      lightMode: 'Warm all day',
      floorSpace: 'Lounge in the middle',
    },
  },
  {
    slug: 'scandi-daylight',
    name: 'Scandi Daylight',
    description: 'Pale wood, white walls, daylight from every side.',
    palette: ['#3E3C41', '#5C6361', '#989894', '#C0B7B2', '#DED5D0'],
    art: 'office/rooms/scandi-daylight.png',
    /** white walls and daylight: the sheet's own light already. */
    light: 0xffffff,
    geometry: SCANDI_DAYLIGHT_ROOM,
    facts: {
      desks: desksFact(SCANDI_DAYLIGHT_ROOM),
      rooms: 'Meeting · coffee',
      // The art is painted in daylight; the app has no light theme, so the chrome round it stays dark.
      lightMode: 'Daylight all day',
      floorSpace: 'Wide open middle',
    },
  },
  {
    slug: 'night-shift',
    name: 'Night Shift',
    description: 'Blue dusk, neon signage, screens as the only lamps.',
    palette: ['#0E1326', '#1D1B30', '#45323D', '#314664', '#56CFD6'],
    art: 'office/rooms/night-shift.png',
    /** rain on neon through the glass, and every screen cold. */
    light: 0xd6e4f2,
    geometry: NIGHT_SHIFT_ROOM,
    facts: {
      desks: desksFact(NIGHT_SHIFT_ROOM),
      rooms: 'Meeting · coffee',
      lightMode: 'Stays dark',
      floorSpace: 'Open in the middle',
    },
  },
  {
    slug: 'greenhouse',
    name: 'Greenhouse',
    description: 'Glass roof, planters between the desks, everything green.',
    palette: ['#2E3825', '#676E3D', '#998366', '#ACA689', '#D8CAA9'],
    art: 'office/rooms/greenhouse.png',
    /** daylight through glass and leaves, greened a little on the way. */
    light: 0xf0fbee,
    geometry: GREENHOUSE_ROOM,
    facts: {
      desks: desksFact(GREENHOUSE_ROOM),
      rooms: 'Meeting · coffee',
      lightMode: 'Daylight all day',
      floorSpace: 'Boards between the beds',
    },
  },
  {
    slug: 'garage-startup',
    name: 'Garage Startup',
    description: 'Concrete floor, steel shelving, folding tables.',
    palette: ['#282F39', '#57656D', '#7A8489', '#8B989C', '#A8AEB0'],
    art: 'office/rooms/garage-startup.png',
    /** strip lights on block walls: flat, and a touch grey. */
    light: 0xeef1f4,
    geometry: GARAGE_STARTUP_ROOM,
    facts: {
      desks: desksFact(GARAGE_STARTUP_ROOM),
      rooms: 'Meeting · coffee',
      lightMode: 'Stays dim',
      floorSpace: 'Bare slab in the middle',
    },
  },
  {
    slug: 'night-city',
    name: 'Night City',
    description: 'A wall of windows on the skyline, dark oak, brass desk lamps.',
    palette: ['#10141B', '#2A2228', '#5A3A2E', '#3E6E9A', '#F2C46B'],
    art: 'office/rooms/night-city.png',
    /** brass lamps and blue screens in a dark room: warm, and a little dim. */
    light: 0xeadccc,
    geometry: NIGHT_CITY_ROOM,
    facts: {
      desks: desksFact(NIGHT_CITY_ROOM),
      rooms: 'Meeting · coffee',
      lightMode: 'Stays dark',
      floorSpace: 'Open at the front',
    },
  },
]

export function isRoomSlug(value: unknown): value is RoomSlug {
  return typeof value === 'string' && (ROOM_SLUGS as readonly string[]).includes(value)
}

/** The room a slug names, falling back to the default for one this build does not know. */
export function roomOf(slug: RoomSlug | string | null | undefined): OfficeRoom {
  return ROOMS.find((room) => room.slug === slug) ?? ROOMS.find((room) => room.slug === DEFAULT_ROOM)!
}

/** A room can be chosen only once someone has measured its geometry (T84, T85, T91). */
export function isSelectable(room: OfficeRoom): room is OfficeRoom & { geometry: PaintedRoom; facts: RoomFacts } {
  return room.geometry !== null
}

/** The anchors the office is built from for a slug; the default room's for anything unselectable. */
export function roomGeometry(slug: RoomSlug | string | null | undefined): PaintedRoom {
  const room = roomOf(slug)
  return room.geometry ?? roomOf(DEFAULT_ROOM).geometry!
}
