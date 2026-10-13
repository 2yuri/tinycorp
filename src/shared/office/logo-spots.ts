import type { LogoSpot, Point, Quad } from './painted-room'

/** How much of a surface the logo takes, each way: the rest is the surface's own edge around it. */
export const LOGO_MARGIN = 0.8

/** The point at fractions `u` across and `v` down a surface, as its perspective carries them. */
export function pointIn([topLeft, topRight, bottomRight, bottomLeft]: Quad, u: number, v: number): Point {
  const top = { x: topLeft.x + (topRight.x - topLeft.x) * u, y: topLeft.y + (topRight.y - topLeft.y) * u }
  const bottom = {
    x: bottomLeft.x + (bottomRight.x - bottomLeft.x) * u,
    y: bottomLeft.y + (bottomRight.y - bottomLeft.y) * u,
  }
  return { x: top.x + (bottom.x - top.x) * v, y: top.y + (bottom.y - top.y) * v }
}

/** The part of a surface between fractions of it. */
export function within(surface: Quad, left: number, top: number, right: number, bottom: number): Quad {
  return [
    pointIn(surface, left, top),
    pointIn(surface, right, top),
    pointIn(surface, right, bottom),
    pointIn(surface, left, bottom),
  ]
}

const length = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y)

/**
 * The corners a logo of `aspect` (width over height) takes on a surface (T280): as big as the
 * margin lets it, centred, and never stretched — a wide logo on a tall panel keeps its shape.
 */
export function logoCorners(surface: Quad, aspect: number, margin = LOGO_MARGIN): Quad {
  const across = length(surface[0], surface[1])
  const down = length(surface[0], surface[3])
  const fits = aspect > across / down
  const width = fits ? margin : (margin * (aspect * down)) / across
  const height = fits ? (margin * across) / aspect / down : margin
  return within(surface, (1 - width) / 2, (1 - height) / 2, (1 + width) / 2, (1 + height) / 2)
}

/** The surface a spot's logo goes on: the plaque's face when it hangs one, else the spot itself. */
export function logoSurface(spot: LogoSpot): Quad {
  const face = spot.plaque?.face
  return face ? within(spot.corners, face.left, face.top, face.right, face.bottom) : spot.corners
}
