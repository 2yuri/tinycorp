/**
 * What a clock in a named timezone shows, and the instant behind a reading of one.
 *
 * Two features need this and neither can use `Date`'s own accessors: a Provider's reset time is
 * read in the zone the Provider named (T80), and a Company's daily digest fires at a wall-clock
 * time in the Company's own zone (T172). `Date` only knows UTC and this machine's zone, so the
 * conversion goes through `Intl`, which is the only part of the platform that knows the offset a
 * zone had at a given instant — which is what makes these right across a DST change.
 */
export interface WallClock {
  year: number
  /** 0-11, as `Date` counts months. */
  month: number
  day: number
  hour: number
  minute: number
}

/** The date and time `instant` shows on a clock in `zone`, or local time; null for an unknown zone. */
export function wallClock(instant: Date, zone: string | undefined): WallClock | null {
  if (!zone) {
    return {
      year: instant.getFullYear(),
      month: instant.getMonth(),
      day: instant.getDate(),
      hour: instant.getHours(),
      minute: instant.getMinutes(),
    }
  }
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    }).formatToParts(instant)
  } catch {
    return null
  }
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  return { year: part('year'), month: part('month') - 1, day: part('day'), hour: part('hour'), minute: part('minute') }
}

/** The instant a clock in `zone` (or local time) shows `wall`, using the zone's offset at `near`. */
export function fromWallClock(wall: WallClock, near: Date, zone: string | undefined): Date {
  if (!zone) return new Date(wall.year, wall.month, wall.day, wall.hour, wall.minute)
  const shown = wallClock(near, zone)!
  const offset =
    Date.UTC(shown.year, shown.month, shown.day, shown.hour, shown.minute) -
    Math.floor(near.getTime() / 60_000) * 60_000
  return new Date(Date.UTC(wall.year, wall.month, wall.day, wall.hour, wall.minute) - offset)
}

/** The day of the week `instant` falls on in `zone`, 0 for Sunday; null for an unknown zone. */
export function weekdayIn(instant: Date, zone: string | undefined): number | null {
  const wall = wallClock(instant, zone)
  if (!wall) return null
  return new Date(Date.UTC(wall.year, wall.month, wall.day)).getUTCDay()
}

/** `2026-09-22`: the calendar day `instant` falls on in `zone`; null for an unknown zone. */
export function dayIn(instant: Date, zone: string | undefined): string | null {
  const wall = wallClock(instant, zone)
  if (!wall) return null
  const two = (n: number) => String(n).padStart(2, '0')
  return `${wall.year}-${two(wall.month + 1)}-${two(wall.day)}`
}
